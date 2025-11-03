import '../src/core/logger'
import '../src/core/ffmpeg-bootstrap'
import { app, BrowserWindow, ipcMain, dialog, BrowserView } from 'electron'

// Log version info IMMEDIATELY
console.log('[APP-VERSION] Cinestar version: 0.1.62');
console.log('[APP-VERSION] Packaged:', app?.isPackaged ?? 'unknown');
console.log('[APP-VERSION] Resources path:', process.resourcesPath || 'N/A');

import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { MainMediaAPI } from '../src/api/main-media-api'
import { VideoMediaAPI } from '../src/api/video-media-api'
import { ImageJobProcessor } from '../src/core/image-job-processor'
import { attachPartialSegmentWriter } from '../src/orchestrator'
import { autoTuneFFmpegThreads } from '../src/core/auto-tuner'
import { getMimeType } from '../src/core/utils'
import { initializeLLMConfigHandler } from '../src/main/llm-config-handler'

// ESM-safe __filename and __dirname
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
// Ensure availability for any bundled modules that still reference these identifiers
;(globalThis as any).__filename = __filename
;(globalThis as any).__dirname = __dirname

// Unified data directory used by both Main and Renderer
// Reduce background throttling to avoid delayed paints in development
app.commandLine.appendSwitch('disable-renderer-backgrounding');
const IS_DEV = process.env.NODE_ENV === 'development' || process.env.DEBUG_MODE === 'true'
const DEFAULT_DATA_DIR = IS_DEV ? path.resolve(process.cwd(), 'data') : path.join(os.homedir(), '.cinestar')
const DATA_DIR = process.env.MAIN_DB_DIR || DEFAULT_DATA_DIR
process.env.CINESTAR_DATA_DIR = DATA_DIR

// Default main DB backend to sqlite unless explicitly overridden
if (!process.env.MAIN_DB_BACKEND) process.env.MAIN_DB_BACKEND = 'sqlite'
// Standardize filename used when a directory path is passed
if (!process.env.VECTOR_DB_FILENAME) process.env.VECTOR_DB_FILENAME = 'vector.db'

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, '..')

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']

// Store appView at module level for IPC event routing
let appView: BrowserView | null = null;

// Track active search for cancellation
let activeSearchController: AbortController | null = null;

export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null

// Calculate isPackaged using the same logic as WhisperDirectService
const isPackaged = process.resourcesPath && !process.resourcesPath.includes('Electron.app');

console.log('[WhisperDebug] isPackaged detection:', {
      isPackaged,
      'app.isPackaged': app.isPackaged,
      hasResourcesPath: !!process.resourcesPath,
      hasElectronApp: process.resourcesPath?.includes('Electron.app'),
      defaultApp: process.defaultApp,
      execPath: process.execPath,
    });

async function waitForUrl(url: string, timeoutMs = 15000, intervalMs = 250): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { method: 'HEAD' } as any);
      if ((res as any)?.ok) return true;
    } catch (_) {
      // ignore until next interval
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

async function createWindow() {
  console.log('[MAIN-PROCESS] Creating BrowserWindow at:', new Date().toISOString());
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    backgroundColor: '#0b0b0b',
    show: true,
    title: 'Cinestar',
    icon: path.join(process.env.VITE_PUBLIC, 'icons', 'icon-256.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      backgroundThrottling: false,
    },
  })

  // We'll open dev tools on the app view later, not the main window

  // Helper to compute content bounds for views
  const getContentBounds = () => {
    // Get the actual window bounds (includes frame)
    const windowBounds = win!.getBounds();
    // Get content size (excludes frame)
    const [contentWidth, contentHeight] = win!.getContentSize();
    
    console.log('[ELECTRON-BOUNDS] Window bounds (with frame):', windowBounds);
    console.log('[ELECTRON-BOUNDS] Content size (without frame):', { width: contentWidth, height: contentHeight });
    
    // BrowserView uses logical pixels, which should match content size
    // The browser will handle devicePixelRatio internally
    return { x: 0, y: 0, width: contentWidth, height: contentHeight } as const;
  };

  // No separate splash view needed - React component handles splash
  console.log('[MAIN-PROCESS] Using React splash component');

  // Keep current views fitted on resize
  win.on('resize', () => {
    const bounds = getContentBounds();
    console.log('[ELECTRON-RESIZE] Setting BrowserView bounds:', bounds);
    try { 
      win?.getBrowserViews()?.forEach(v => {
        v.setBounds(bounds);
        // Disable auto-resize to prevent scaling issues on Retina displays
        v.setAutoResize({ width: false, height: false });
      }); 
    } catch {}
  });

  // Prepare the main app BrowserView; swap when page fully loads to avoid black gap
  appView = new BrowserView({ webPreferences: { preload: path.join(__dirname, 'preload.mjs'), backgroundThrottling: false } });

  // React component handles splash - no need for separate splash view

  if (VITE_DEV_SERVER_URL) {
    console.log('[MAIN-PROCESS] Waiting for dev server at:', VITE_DEV_SERVER_URL, 'time:', new Date().toISOString());
    const ok = await waitForUrl(VITE_DEV_SERVER_URL);
    if (ok) {
      console.log('[MAIN-PROCESS] Dev server reachable. Loading main URL at:', new Date().toISOString());
      
      // FIRST: Add BrowserView to window and set bounds BEFORE loading content
      try {
        console.log('[ELECTRON-INIT] Adding appView to window BEFORE loading...');
        win?.setBrowserView(appView);
        const initialBounds = getContentBounds();
        console.log('[ELECTRON-INIT] Setting initial appView bounds:', initialBounds);
        appView.setBounds(initialBounds);
        // Disable auto-resize to prevent scaling issues on Retina displays
        appView.setAutoResize({ width: false, height: false });
        console.log('[ELECTRON-INIT] Auto-resize DISABLED (manual resize handling)');
      } catch (e) {
        console.warn('[MAIN-PROCESS] Failed to add app view:', e);
      }
      
      // SECOND: Set up DevTools listeners
      console.log('[MAIN-PROCESS] IS_DEV:', IS_DEV, 'NODE_ENV:', process.env.NODE_ENV, 'DEBUG_MODE:', process.env.DEBUG_MODE);
      if (IS_DEV) {
        console.log('[MAIN-PROCESS] Setting up DevTools for appView (before load)...');
        // Attach listener BEFORE loading to ensure we catch the event
        appView.webContents.once('did-finish-load', () => {
          console.log('[MAIN-PROCESS] Content loaded, opening DevTools for appView...');
          if (appView) {
            appView.webContents.openDevTools({ mode: 'detach' });
            console.log('[MAIN-PROCESS] DevTools opened for appView');
          }
        });
        
        // Also set up DevTools for main window
        if (win) {
          win.webContents.once('did-finish-load', () => {
            console.log('[MAIN-PROCESS] Main window loaded, opening DevTools...');
            if (win) {
              win.webContents.openDevTools({ mode: 'detach' });
              console.log('[MAIN-PROCESS] DevTools opened for main window');
            }
          });
        }
      } else {
        console.log('[MAIN-PROCESS] Skipping DevTools (not in dev mode)');
      }

      // THIRD: Now load the URL - React will see correct viewport dimensions
      await appView.webContents.loadURL(VITE_DEV_SERVER_URL);
      console.log('[MAIN-PROCESS] Main load completed at:', new Date().toISOString());
    } else {
      console.warn('[MAIN-PROCESS] Dev server not reachable within timeout. Keeping splash visible.', new Date().toISOString());
    }
  } else {
    console.log('[MAIN-PROCESS] Loading production index.html at:', new Date().toISOString());
    
    // FIRST: Add BrowserView to window and set bounds BEFORE loading content
    try {
      console.log('[ELECTRON-INIT-PROD] Adding appView to window BEFORE loading...');
      win?.setBrowserView(appView);
      const initialBounds = getContentBounds();
      console.log('[ELECTRON-INIT-PROD] Setting initial appView bounds:', initialBounds);
      appView.setBounds(initialBounds);
      // Disable auto-resize to prevent scaling issues on Retina displays
      appView.setAutoResize({ width: false, height: false });
      console.log('[ELECTRON-INIT-PROD] Auto-resize DISABLED (manual resize handling)');
    } catch (e) {
      console.warn('[MAIN-PROCESS] Failed to add app view (prod):', e);
    }
    
    // SECOND: Set up DevTools listeners
    console.log('[MAIN-PROCESS] (production path) IS_DEV:', IS_DEV);
    if (IS_DEV) {
      console.log('[MAIN-PROCESS] (production path) Setting up DevTools for appView (before load)...');
      // Attach listener BEFORE loading to ensure we catch the event
      appView.webContents.once('did-finish-load', () => {
        console.log('[MAIN-PROCESS] (production path) Content loaded, opening DevTools for appView...');
        if (appView) {
          appView.webContents.openDevTools({ mode: 'detach' });
          console.log('[MAIN-PROCESS] (production path) DevTools opened for appView');
        }
      });
      
      // Also set up DevTools for main window
      if (win) {
        win.webContents.once('did-finish-load', () => {
          console.log('[MAIN-PROCESS] (production path) Main window loaded, opening DevTools...');
          if (win) {
            win.webContents.openDevTools({ mode: 'detach' });
            console.log('[MAIN-PROCESS] (production path) DevTools opened for main window');
          }
        });
      }
    }
    
    // THIRD: Now load the file - React will see correct viewport dimensions
    await appView.webContents.loadFile(path.join(RENDERER_DIST, 'index.html'))
    console.log('[MAIN-PROCESS] Main load completed at:', new Date().toISOString());
  }

  // When the renderer signals it's mounted, ensure app view is properly sized
  ipcMain.on('renderer:app-mounted', () => {
    try {
      console.log('[MAIN-PROCESS] Renderer reported app-mounted at:', new Date().toISOString());
      // Ensure appView is visible and sized
      try {
        const mountBounds = getContentBounds();
        console.log('[ELECTRON-MOUNT] Setting appView bounds on mount:', mountBounds);
        appView.setBounds(mountBounds);
        // Disable auto-resize to prevent scaling issues on Retina displays
        appView.setAutoResize({ width: false, height: false });
      } catch {}
    } catch (e) {
      console.warn('[MAIN-PROCESS] Failed to finalize app setup:', e);
    }
  });
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  const isLocalMode = process.env.NODE_ENV === 'development' || process.env.LOCAL_MODE === 'true';
  
  if (isLocalMode && BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// Database file operations
const DB_PATH = path.join(app.getPath('userData'), 'cinestar-db');

// Ensure DB directory exists
if (!fs.existsSync(DB_PATH)) {
  fs.mkdirSync(DB_PATH, { recursive: true });
}

// File system IPC handlers
ipcMain.handle('fs:readFile', async (_, filePath) => {
  try {
    return await fs.promises.readFile(filePath, 'utf8');
  } catch (error) {
    console.error('Error reading file:', error);
    return null;
  }
});

ipcMain.handle('fs:writeFile', async (_, filePath, data) => {
  try {
    await fs.promises.writeFile(filePath, data);
    return true;
  } catch (error) {
    console.error('Error writing file:', error);
    return false;
  }
});

ipcMain.handle('fs:exists', (_, filePath) => {
  return fs.existsSync(filePath);
});

ipcMain.handle('fs:mkdir', async (_, dirPath) => {
  try {
    await fs.promises.mkdir(dirPath, { recursive: true });
    return true;
  } catch (error) {
    console.error('Error creating directory:', error);
    return false;
  }
});

ipcMain.handle('app:getPath', (_, name) => {
  return app.getPath(name);
});

// Expose unified data dir to renderer
ipcMain.handle('app:getDataDir', async () => {
  try {
    await fs.promises.mkdir(DATA_DIR, { recursive: true })
  } catch (e) {
    // ignore
  }
  return DATA_DIR
});

// Initialize MediaAPI in main process
let mediaAPI: typeof MainMediaAPI | null = null;
let videoAPI: VideoMediaAPI | null = null;
let videoJobProcessors: any[] = []; // Support multiple workers (v1 or v2)
let imageJobProcessors: ImageJobProcessor[] = []; // Support multiple workers
let globalJobsDb: any | null = null; // Shared jobs database instance
let mediaInitAttempted = false;
let mediaInitializing = false; // Prevent concurrent initialization
let mediaInitFailed = false;
let mediaInitErrorMessage = '';

// Helper to get config file path (dev vs prod)
const getConfigPath = () => IS_DEV 
  ? path.join(DATA_DIR, 'config.dev.json')
  : path.join(DATA_DIR, 'config.json');

async function initializeMediaAPI() {
  // Prevent concurrent initialization attempts
  if (mediaInitializing) {
    console.log('[MEDIA-INIT] Already initializing, waiting...');
    while (mediaInitializing) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return;
  }
  
  // Avoid tight retry loops if we've already attempted and failed
  if (mediaInitAttempted && mediaInitFailed) {
    return;
  }
  
  mediaInitializing = true;
  mediaInitAttempted = true;
  
  try {
    await MainMediaAPI.initialize(DATA_DIR);
    mediaAPI = MainMediaAPI;
    mediaInitFailed = false;
    mediaInitErrorMessage = '';
    console.log('MainMediaAPI initialized in main process');
    
    // Set main window reference for IPC events - use appView for BrowserView architecture
    if (appView) {
      MainMediaAPI.setMainWindow(appView);
      console.log('[MainMediaAPI] Main window reference set for IPC events (using appView)');
      console.log('[MainMediaAPI] appView webContents ID:', appView.webContents.id);
    }
    
    // Start image job workers (coordinator pattern - multiple workers can run safely)
    if (imageJobProcessors.length === 0) {
      console.log('[IMAGE-WORKERS] Creating image job workers...');
      const { SqliteJobsDatabase } = await import('../src/core/sqlite-jobs-database');
      const { CanonicalMediaDatabase } = await import('../src/core/canonical-media-database');
      const { ImageSearchWriter } = await import('../src/core/image-search-writer');
      
      // Use split database architecture
      const jobsDbPath = path.join(DATA_DIR, 'jobs.db');  // Dedicated jobs database
      const mediaDbPath = path.join(DATA_DIR, 'media.db');  // Media metadata
      const imageSearchDbPath = path.join(DATA_DIR, 'image_search.db');  // Search index
      
      const jobsDb = new SqliteJobsDatabase(jobsDbPath);
      await jobsDb.initialize();
      globalJobsDb = jobsDb; // Store for use in VideoMediaAPI
      const mediaDb = new CanonicalMediaDatabase(mediaDbPath);
      const searchWriter = new ImageSearchWriter(imageSearchDbPath);
      
      // Read worker count from config (default to 2)
      let numWorkers = 2;
      try {
        const configPath = getConfigPath();
        if (fs.existsSync(configPath)) {
          const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
          numWorkers = config.workers?.imageWorkers || 2;
          console.log(`[IMAGE-WORKERS] Config specifies ${numWorkers} workers`);
        }
      } catch (error) {
        console.warn('[IMAGE-WORKERS] Failed to read config, using default:', error);
      }
      
      for (let i = 0; i < numWorkers; i++) {
        const worker = new ImageJobProcessor(jobsDb, mediaDb, searchWriter, `worker-${i + 1}`);
        await worker.start();
        imageJobProcessors.push(worker);
      }
      console.log(`[IMAGE-WORKERS] ✅ Started ${numWorkers} image job workers with split DB architecture`);
    }
  } catch (error: any) {
    mediaAPI = null;
    mediaInitFailed = true;
    mediaInitErrorMessage = error instanceof Error ? error.message : String(error);
    console.error('Failed to initialize MainMediaAPI:', error);
  } finally {
    mediaInitializing = false;
  }
}

// Guard helper to prevent repeated initialization loops and provide clean failures
async function guardMedia<T>(fn: () => Promise<T>): Promise<T> {
  if (!mediaAPI) await initializeMediaAPI();
  if (!mediaAPI) {
    return { success: false, error: `MainMediaAPI unavailable: ${mediaInitErrorMessage || 'initialization failed'}` } as any;
  }
  return await fn();
}

async function initializeVideoAPI() {
  // Direct file logging for debugging (bypasses broken console logger)
  const debugLog = (msg: string) => {
    try {
      const logPath = path.join(os.homedir(), '.cinestar', 'init-debug.txt');
      fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}\n`);
    } catch {}
  };
  
  try {
    debugLog('initializeVideoAPI called');
    videoAPI = VideoMediaAPI.getInstance();
    debugLog('VideoMediaAPI.getInstance() succeeded');
    
    // Set jobs database before initialization
    if (globalJobsDb) {
      videoAPI.setJobsDatabase(globalJobsDb);
      debugLog('VideoMediaAPI.setJobsDatabase() succeeded');
    }
    
    await videoAPI.initialize();
    debugLog('videoAPI.initialize() succeeded');
    
    // Attach partial writer to persist segments early for non-blocking search
    attachPartialSegmentWriter(videoAPI);
    console.log('VideoMediaAPI initialized in main process');
    debugLog('VideoMediaAPI fully initialized');
    
    // Start video job workers (coordinator pattern - multiple workers can run safely)
    if (videoJobProcessors.length === 0) {
      debugLog('Creating VideoJobProcessor workers...');
      console.log('[VIDEO-WORKERS] Creating video job workers...');
      
      // Import split DB dependencies
      const { VideoDatabase } = await import('../src/core/video-database');
      const { CanonicalMediaDatabase } = await import('../src/core/canonical-media-database');
      const { AVSearchWriter } = await import('../src/core/av-search-writer');
      
      // Use split database architecture
      const mediaDbPath = path.join(DATA_DIR, 'media.db');  // Basic catalog
      const avSearchDbPath = path.join(DATA_DIR, 'av_search.db');  // Search index
      
      const videoDb = new VideoDatabase();  // Uses internal path resolution (video-rag.db)
      const mediaDb = new CanonicalMediaDatabase(mediaDbPath);
      const avSearchWriter = new AVSearchWriter(avSearchDbPath);
      
      // Read worker count from config (default to 2)
      let numWorkers = 2;
      try {
        const configPath = getConfigPath();
        if (fs.existsSync(configPath)) {
          const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
          numWorkers = config.workers?.videoWorkers || 2;
          console.log(`[VIDEO-WORKERS] Config specifies ${numWorkers} workers`);
        }
      } catch (error) {
        console.warn('[VIDEO-WORKERS] Failed to read config, using default:', error);
      }
      
      // Import refactored video processing orchestrator
      const { VideoJobOrchestrator } = await import('../src/core/video-processing/index');
      const { SqliteJobsDatabase } = await import('../src/core/sqlite-jobs-database');
      
      // Initialize jobs.db for batch storage
      const jobsDbPath = path.join(DATA_DIR, 'jobs.db');
      const jobsDb = new SqliteJobsDatabase(jobsDbPath);
      await jobsDb.initialize();
      console.log('[VIDEO-WORKERS] ✅ Initialized jobs.db for batch storage');
      
      for (let i = 0; i < numWorkers; i++) {
        const worker = new VideoJobOrchestrator(
          videoDb,
          mediaDb,
          avSearchWriter,
          jobsDb,
          `worker-${i + 1}`
        );
        await worker.start();
        videoJobProcessors.push(worker);
        debugLog(`VideoJobOrchestrator worker-${i + 1} started`);
      }
      
      console.log(`[VIDEO-WORKERS] ✅ Started ${numWorkers} video job workers with split DB architecture`);
      debugLog(`All ${numWorkers} VideoJobProcessor workers started`);
    } else {
      debugLog('VideoJobProcessors already exist, skipping initialization');
    }
  } catch (error) {
    debugLog(`ERROR in initializeVideoAPI: ${error}`);
    console.error('Failed to initialize VideoMediaAPI:', error);
  }
}

async function runAutoTune() {
  try {
    if (!win) return;
    win.webContents.send('config:autoTune:started', { stage: 'ffmpeg_threads' });
    console.log('[AUTO-TUNE] Starting FFmpeg threads auto-tune...');
    const result = await autoTuneFFmpegThreads();
    
    if (result.isDefault) {
      console.log(`[AUTO-TUNE] Using default threadsPerProcess=${result.selected} (test video unavailable or no improvement found)`);
    } else {
      console.log(`[AUTO-TUNE] Selected threadsPerProcess=${result.selected} (${result.measurements.length > 0 ? 'tuned' : 'configured'})`);
    }
    
    win.webContents.send('config:autoTune:completed', {
      stage: 'ffmpeg_threads',
      selected: result.selected,
      measurements: result.measurements,
      isDefault: result.isDefault
    });
  } catch (e) {
    console.warn('[AUTO-TUNE] Failed to auto-tune FFmpeg threads:', e);
    if (win) win.webContents.send('config:autoTune:failed', { stage: 'ffmpeg_threads', error: String(e) });
  }
}

// MediaAPI IPC handlers
ipcMain.handle('media:getSources', async () => {
  return await guardMedia(() => MainMediaAPI.getSources());
});

ipcMain.handle('media:addSource', async (_, name: string, type: string, path: string, config?: any) => {
  return await guardMedia(() => MainMediaAPI.addSource({
    name,
    type: type as 'local' | 'remote',
    path,
    enabled: true,
    config,
    createdAt: new Date()
  }));
});

ipcMain.handle('media:addItemForFile', async (_, sourceId: string, filePath: string, description?: string, metadata?: Record<string, any>) => {
  return await guardMedia(() => MainMediaAPI.addItemForFile(sourceId, filePath, description, metadata));
});

ipcMain.handle('media:indexUnprocessedImages', async () => {
  return await guardMedia(() => MainMediaAPI.indexUnprocessedImages());
});

ipcMain.handle('media:deleteMediaItem', async (_, itemId: string, deleteFile: boolean = false) => {
  return await guardMedia(() => MainMediaAPI.deleteMediaItem(itemId, deleteFile));
});

ipcMain.handle('media:startCleanupJob', async () => {
  return await guardMedia(() => MainMediaAPI.startCleanupJob());
});

ipcMain.handle('media:removeSource', async (_, sourceId: string) => {
  return await guardMedia(() => MainMediaAPI.removeSource(sourceId));
});

ipcMain.handle('media:startIndexing', async (_, sourceId: string) => {
  return await guardMedia(() => MainMediaAPI.startIndexing(sourceId));
});

ipcMain.handle('media:forceReindex', async (_, sourceId: string) => {
  return await guardMedia(() => MainMediaAPI.forceReindex(sourceId));
});

ipcMain.handle('media:cleanupDuplicates', async () => {
  return await guardMedia(() => MainMediaAPI.cleanupDuplicateSources());
});

ipcMain.handle('media:stopIndexing', async (_, jobId: string) => {
  return await guardMedia(() => MainMediaAPI.stopIndexing(jobId));
});

ipcMain.handle('media:getIndexingStatus', async () => {
  return await guardMedia(() => MainMediaAPI.getIndexingStatus());
});

ipcMain.handle('media:search', async (_, query) => {
  return await guardMedia(() => MainMediaAPI.search(query));
});

ipcMain.handle('media:searchText', async (_, text: string, limit?: number) => {
  return await guardMedia(() => MainMediaAPI.searchText(text, limit));
});

ipcMain.handle('media:getSuggestions', async (_, query: string, limit?: number) => {
  return await guardMedia(() => MainMediaAPI.getSuggestions(query, limit));
});

ipcMain.handle('media:updateConcurrency', async (_, limit: number) => {
  return await guardMedia(() => MainMediaAPI.updateConcurrencySettings(limit));
});

ipcMain.handle('media:getConfiguration', async () => {
  return await guardMedia(() => MainMediaAPI.getConfiguration());
});

ipcMain.handle('media:enableDebugMode', async (_, saveImages: boolean, saveLLaVAOutputs: boolean, outputDir?: string) => {
  return await guardMedia(() => MainMediaAPI.enableDebugMode(saveImages, saveLLaVAOutputs, outputDir));
});

ipcMain.handle('media:disableDebugMode', async () => {
  return await guardMedia(() => MainMediaAPI.disableDebugMode());
});

ipcMain.handle('media:getStats', async () => {
  return await guardMedia(() => MainMediaAPI.getStats());
});

// Manual trigger for auto-tuning from renderer
ipcMain.handle('config:autoTune', async () => {
  await runAutoTune();
  return true;
});


// Reload configuration (flags, partitions, source maps)
ipcMain.handle('config:reload', async () => {
  if (!mediaAPI) await initializeMediaAPI();
  try {
    const res = await MainMediaAPI.reloadConfiguration();
    return res;
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
});


ipcMain.handle('media:getRecentItems', async (_evt, params?: { sourceIds?: string[]; types?: Array<'image'|'video'|'audio'>; limit?: number }) => {
  return await guardMedia(() => MainMediaAPI.getRecentItems(params));
});

ipcMain.handle('media:getRecentItemsGrouped', async (_evt, params?: {
  limits?: { images?: number; videos?: number; audio?: number };
  cursors?: { images?: string; videos?: string; audio?: string };
  orderBy?: 'createdAt' | 'modifiedAt' | 'name' | 'size';
  orderDirection?: 'asc' | 'desc';
}) => {
  return await guardMedia(() => MainMediaAPI.getRecentItemsGrouped(params));
});

ipcMain.handle('media:getItems', async (_evt, sourceId?: string) => {
  return await guardMedia(() => MainMediaAPI.getItems(sourceId));
});

// App-level progress (taskbar/dock). Pass value in [0,1]; pass -1 to clear.
ipcMain.handle('app:setProgress', async (_evt, value: number) => {
  if (!win) return false;
  try {
    if (typeof value === 'number' && value >= 0 && value <= 1) {
      win.setProgressBar(value);
    } else {
      win.setProgressBar(-1);
    }
    return true;
  } catch (e) {
    console.warn('Failed to set progress bar:', e);
    return false;
  }
});

ipcMain.handle('media:isOllamaAvailable', async () => {
  console.log('[ELECTRON-MAIN] media:isOllamaAvailable called');
  return await guardMedia(async () => {
    console.log('[ELECTRON-MAIN] Calling MainMediaAPI.isOllamaAvailable()');
    const result = await MainMediaAPI.isOllamaAvailable();
    console.log('[ELECTRON-MAIN] MainMediaAPI.isOllamaAvailable() result:', result);
    return result;
  });
});

ipcMain.handle('media:getImageThumbnail', async (_, imagePath: string) => {
  return await guardMedia(() => MainMediaAPI.getImageThumbnail(imagePath));
});

// Unified search IPC handler - now uses the new unifiedSearch method with cancellation
ipcMain.handle('search:unified', async (_evt, query: { query: string; limit?: number; offset?: number; types?: ('image' | 'video' | 'audio')[] }) => {
  if (!mediaAPI) await initializeMediaAPI();
  
  // Cancel previous search if exists
  if (activeSearchController) {
    activeSearchController.abort();
    console.log(`[SEARCH-CANCEL] 🚫 Cancelled previous search`);
  }
  
  // Create new abort controller for this search
  activeSearchController = new AbortController();
  const signal = activeSearchController.signal;
  
  try {
    console.log(`[IPC-SEARCH] 🔍 Received search request: "${query.query}"`);
    
    const result = await MainMediaAPI.unifiedSearch(query.query || '', {
      types: query.types || ['image', 'video', 'audio'],
      limit: query.limit || 20,
      offset: query.offset || 0,
      signal
    });
    
    console.log(`[IPC-SEARCH] ✅ Returning to frontend:`, {
      success: result.success,
      imageCount: result.results?.images?.length || 0,
      videoCount: result.results?.videos?.length || 0,
      audioCount: result.results?.audio?.length || 0
    });
    
    return result;
  } catch (error: any) {
    // Check if this was an abort
    if (error.name === 'AbortError' || signal.aborted) {
      console.log(`[SEARCH-CANCEL] ⏹️  Search aborted`);
      return {
        success: false,
        cancelled: true,
        error: 'Search cancelled'
      };
    }
    
    console.error('[UNIFIED-SEARCH] Failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown search error'
    };
  } finally {
    // Clear the controller if this was the active one
    if (activeSearchController?.signal === signal) {
      activeSearchController = null;
    }
  }
});

// Video processing IPC handlers
ipcMain.handle('video:processVideo', async (_, videoPath: string) => {
  console.log(`[IPC-VIDEO-PROCESS] 🚀 Received video processing request for: ${videoPath}`);
  
  if (!videoAPI) await initializeVideoAPI();
  try {
    console.log(`[IPC-VIDEO-PROCESS] 📞 Calling videoAPI.processVideo(${videoPath})`);
    const videoId = await videoAPI!.processVideo(videoPath);
    console.log(`[IPC-VIDEO-PROCESS] ✅ Video processing initiated, videoId: ${videoId}`);
    return { success: true, videoId };
  } catch (error) {
    console.error(`[IPC-VIDEO-PROCESS] ❌ Video processing failed:`, error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('video:processAudio', async (_, audioPath: string) => {
  if (!videoAPI) await initializeVideoAPI();
  try {
    return { success: true, videoId: await videoAPI!.processAudio(audioPath) };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('video:searchVideos', async (_, query: any) => {
  if (!videoAPI) await initializeVideoAPI();
  try {
    const results = await videoAPI!.searchVideos(query);
    
    // Group segments by parent video to avoid duplicates
    const videoGroups = new Map<string, any[]>();
    results.forEach((result: any) => {
      const videoId = result.video.id;
      if (!videoGroups.has(videoId)) {
        videoGroups.set(videoId, []);
      }
      videoGroups.get(videoId)!.push(result);
    });

    // Transform to MediaItem[] format, one result per parent video
    const transformedResults = Array.from(videoGroups.entries()).map(([videoId, segments]) => {
      // Use the highest scoring segment for this video
      const bestSegment = segments.sort((a, b) => b.score - a.score)[0];
      const segment = bestSegment.segment;
      const video = bestSegment.video;
      
      const isSegment = segment && segment.startTime !== undefined;
      const hasMultipleSegments = segments.length > 1;
      
      return {
        id: video.id, // Use video ID to avoid duplicates
        name: hasMultipleSegments 
          ? `${video.fileName} (${segments.length} segments match)`
          : isSegment 
            ? `${video.fileName} - Segment ${Math.floor(segment.startTime)}s-${Math.floor(segment.endTime)}s`
            : video.fileName,
        path: isSegment 
          ? `${video.filePath}#t=${segment.startTime},${segment.endTime}`
          : video.filePath,
        size: video.fileSize || 0,
        type: 'video', // Always mark as video since these are video search results
        mimeType: getMimeType(video.filePath) || 'video/mp4',
        sourceId: video.id,
        createdAt: video.createdAt || new Date(),
        modifiedAt: video.updatedAt || new Date(),
        description: hasMultipleSegments
          ? `Video with ${segments.length} matching segments: ${segments.map(s => `${Math.floor(s.segment.startTime)}s-${Math.floor(s.segment.endTime)}s`).join(', ')}`
          : isSegment 
            ? `Video segment: ${segment.transcription || segment.caption || 'No description'}`
            : `Video file: ${video.fileName}`,
        score: bestSegment.score, // Use best segment's score
        matchType: bestSegment.matchType,
        snippet: bestSegment.snippet,
        // Additional video-specific fields
        duration: video.duration, // Always use full video duration
        matchingSegments: segments.length, // How many segments matched
        bestSegment: isSegment ? {
          startTime: segment.startTime,
          endTime: segment.endTime,
          duration: segment.duration
        } : undefined,
      };
    })
    .sort((a, b) => b.score - a.score); // Re-sort by best scores
    
    return { success: true, results: transformedResults };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('video:getJobStatus', async (_, videoPath: string) => {
  if (!videoAPI) await initializeVideoAPI();
  return videoAPI!.getJobStatus(videoPath);
});

ipcMain.handle('video:getActiveJobs', async () => {
  if (!videoAPI) await initializeVideoAPI();
  return videoAPI!.getActiveJobs();
});

ipcMain.handle('video:getVideoFile', async (_, videoPath: string) => {
  if (!videoAPI) await initializeVideoAPI();
  return await videoAPI!.getVideoFile(videoPath);
});

ipcMain.handle('video:getVideoSegments', async (_, videoId: string) => {
  if (!videoAPI) await initializeVideoAPI();
  return await videoAPI!.getVideoSegments(videoId);
});

ipcMain.handle('video:isVideoFile', (_, filePath: string) => {
  return VideoMediaAPI.isVideoFile(filePath);
});

ipcMain.handle('video:isAudioFile', (_, filePath: string) => {
  return VideoMediaAPI.isAudioFile(filePath);
});

// Video player IPC handlers
ipcMain.handle('video:getMetadata', async (_, videoPath: string) => {
  if (!videoAPI) await initializeVideoAPI();
  try {
    const videoFile = await videoAPI!.getVideoFile(videoPath);
    if (!videoFile) {
      return { success: false, error: 'Video not found in database' };
    }
    
    return {
      success: true,
      metadata: {
        id: videoFile.id,
        fileName: videoFile.fileName,
        duration: videoFile.duration,
        frameRate: videoFile.frameRate,
        fileSize: videoFile.fileSize,
        totalSegments: videoFile.totalSegments,
        processingStatus: videoFile.processingStatus
      }
    };
  } catch (error) {
    console.error('[VIDEO-METADATA-ERROR]', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('video:getSegmentsForPlayer', async (_, videoPath: string, searchQuery?: string) => {
  if (!videoAPI) await initializeVideoAPI();
  try {
    console.log(`[VIDEO-SEGMENTS-DEBUG] Getting segments for: ${videoPath}`);
    console.log(`[VIDEO-SEGMENTS-DEBUG] Search query: ${searchQuery || 'none'}`);
    
    // Get video file from database
    const videoFile = await videoAPI!.getVideoFile(videoPath);
    if (!videoFile) {
      console.log(`[VIDEO-SEGMENTS-DEBUG] Video file not found in database`);
      return { success: true, segments: [] };
    }
    
    console.log(`[VIDEO-SEGMENTS-DEBUG] Found video file: ${videoFile.id}`);
    
    // Get all segments for this video
    const segments = await videoAPI!.getVideoSegments(videoFile.id);
    console.log(`[VIDEO-SEGMENTS-DEBUG] Found ${segments.length} segments in database`);
    
    // If we have a search query, filter and score segments by relevance
    let processedSegments = segments.map(segment => ({
      id: segment.id,
      startTime: segment.startTime,
      endTime: segment.endTime,
      transcription: segment.transcription || '',
      caption: segment.caption || '',
      reconstructedScene: segment.reconstructedScene || '',
      relevanceScore: searchQuery ? calculateRelevanceScore(segment, searchQuery) : undefined
    }));
    
    console.log(`[VIDEO-SEGMENTS-DEBUG] Mapped ${processedSegments.length} segments with scores:`, 
      processedSegments.map(s => ({ 
        time: `${s.startTime}-${s.endTime}`, 
        score: s.relevanceScore 
      }))
    );
    
    // If search query provided, sort by relevance (don't filter - show all segments)
    if (searchQuery) {
      processedSegments = processedSegments
        .sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
      
      console.log(`[VIDEO-SEGMENTS-DEBUG] Sorted ${processedSegments.length} segments by relevance`);
    }
    
    console.log(`[VIDEO-SEGMENTS-DEBUG] Returning ${processedSegments.length} segments to UI`);
    
    return {
      success: true,
      segments: processedSegments
    };
  } catch (error) {
    console.error('[VIDEO-SEGMENTS-ERROR]', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// Helper function to calculate relevance score for search queries
function calculateRelevanceScore(segment: any, searchQuery: string): number {
  const query = searchQuery.toLowerCase();
  const transcription = (segment.transcription || '').toLowerCase();
  const caption = (segment.caption || '').toLowerCase();
  const reconstructedScene = (segment.reconstructedScene || '').toLowerCase();
  
  let score = 0;
  
  // Exact matches get highest score
  if (transcription.includes(query)) score += 0.8;
  if (caption.includes(query)) score += 0.6;
  if (reconstructedScene.includes(query)) score += 0.7;
  
  // Word matches get medium score
  const queryWords = query.split(' ').filter(word => word.length > 2);
  queryWords.forEach(word => {
    if (transcription.includes(word)) score += 0.3;
    if (caption.includes(word)) score += 0.2;
    if (reconstructedScene.includes(word)) score += 0.25;
  });
  
  return Math.min(score, 1.0); // Cap at 1.0
}

// Directory selection dialog
ipcMain.handle('dialog:selectDirectory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: 'Select Media Directory'
  });
  
  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true };
  }
  
  return { canceled: false, path: result.filePaths[0] };
});

// File selection dialog for video/audio files
ipcMain.handle('dialog:selectVideoFile', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    title: 'Select Video or Audio File',
    filters: [
      { name: 'Video Files', extensions: ['mp4', 'avi', 'mov', 'mkv', 'webm', 'flv', 'wmv', 'm4v'] },
      { name: 'Audio Files', extensions: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  
  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true };
  }
  
  return { canceled: false, path: result.filePaths[0] };
});

// File selection dialog for image files
ipcMain.handle('dialog:selectImageFile', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    title: 'Select Image File',
    filters: [
      { name: 'Image Files', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'tiff', 'ico', 'heic', 'heif'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  
  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true };
  }
  
  return { canceled: false, path: result.filePaths[0] };
});

// File selection dialog for audio files
ipcMain.handle('dialog:selectAudioFile', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    title: 'Select Audio File',
    filters: [
      { name: 'Audio Files', extensions: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma', 'opus', 'amr'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  
  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true };
  }
  
  return { canceled: false, path: result.filePaths[0] };
});

// Configuration management
// Use separate config files for dev and production to avoid conflicts
const CONFIG_FILE = IS_DEV 
  ? path.join(DATA_DIR, 'config.dev.json')
  : path.join(DATA_DIR, 'config.json');

ipcMain.handle('config:get', async () => {
  try {
    // Load existing config.json if it exists
    if (fs.existsSync(CONFIG_FILE)) {
      const configData = await fs.promises.readFile(CONFIG_FILE, 'utf8');
      const config = JSON.parse(configData);
      console.log('[CONFIG] Loaded config from:', CONFIG_FILE);
      
      // Ensure workers section exists (migration for existing configs)
      if (!config.workers) {
        (config as any).workers = {
          imageWorkers: 2,
          videoWorkers: 2
        };
        console.log('[CONFIG] Added missing workers section to config');
      }
      
      // Merge modelDownloaded from preferences.json (single source of truth)
      try {
        const preferencesPath = path.join(DATA_DIR, 'preferences.json');
        if (fs.existsSync(preferencesPath)) {
          const prefsData = await fs.promises.readFile(preferencesPath, 'utf8');
          const prefs = JSON.parse(prefsData);
          if (!config.aiServices) (config as any).aiServices = {};
          if (!config.aiServices.transcription) (config as any).aiServices.transcription = {};
          (config as any).aiServices.transcription.modelDownloaded = !!prefs.whisperModelDownloaded;
          // Map onboarding completion from preferences as a fallback to avoid re-showing welcome
          if (prefs.onboardingComplete === true) {
            if (!(config as any).onboarding) (config as any).onboarding = { complete: true, firstLaunchDate: new Date().toISOString() };
            else (config as any).onboarding.complete = true;
          }
        }
      } catch {}
      return config;
    }
    
    // Try to copy from template in production builds
    if (!IS_DEV) {
      try {
        const templatePath = path.join(process.resourcesPath, 'config.template.json');
        if (fs.existsSync(templatePath)) {
          await fs.promises.copyFile(templatePath, CONFIG_FILE);
          const configData = await fs.promises.readFile(CONFIG_FILE, 'utf8');
          const config = JSON.parse(configData);
          console.log('[CONFIG] Created config from template:', CONFIG_FILE);
          return config;
        }
      } catch (error) {
        console.warn('[CONFIG] Failed to copy template, creating default:', error);
      }
    }
    
    // Initialize defaults from ConfigManager if no config exists
    const { ConfigManager } = await import('../src/core/config');
    const backendConfig = ConfigManager.getConfig();
    
    const defaultConfig = {
      version: 1,
      onboarding: {
        complete: false,
        firstLaunchDate: null
      },
      features: {
        images: true,
        videos: false,
        audio: false
      },
      workers: {
        imageWorkers: 2,
        videoWorkers: 2
      },
      aiServices: {
        transcription: {
          baseUrl: backendConfig.ai.transcriptionUrl,
          model: 'whisper-base.en',
          enabled: false,
          modelDownloaded: false
        },
        captioning: {
          baseUrl: backendConfig.ai.captionUrl,
          model: backendConfig.ai.visionModel,
          enabled: true
        },
        sceneReconstruction: {
          baseUrl: backendConfig.ai.embedUrl,
          model: backendConfig.ai.generalPurposeModel,
          enabled: true
        }
      },
      lastModified: new Date().toISOString()
    };
    // Override modelDownloaded from preferences.json when available
    try {
      const preferencesPath = path.join(DATA_DIR, 'preferences.json');
      if (fs.existsSync(preferencesPath)) {
        const prefsData = await fs.promises.readFile(preferencesPath, 'utf8');
        const prefs = JSON.parse(prefsData);
        (defaultConfig as any).aiServices.transcription.modelDownloaded = !!prefs.whisperModelDownloaded;
      }
    } catch {}

    // Save default config
    await fs.promises.writeFile(CONFIG_FILE, JSON.stringify(defaultConfig, null, 2), 'utf8');
    console.log('[CONFIG] Created default config at:', CONFIG_FILE);
    
    return defaultConfig;
  } catch (error) {
    console.error('Failed to read config:', error);
    return {};
  }
});

// Save unified configuration with deep merge
ipcMain.handle('config:set', async (_, config) => {
  try {
    // Ensure config directory exists
    await fs.promises.mkdir(path.dirname(CONFIG_FILE), { recursive: true });

    // Read existing config and merge
    let existingConfig: any = {};
    if (fs.existsSync(CONFIG_FILE)) {
      try {
        const configData = await fs.promises.readFile(CONFIG_FILE, 'utf8');
        existingConfig = JSON.parse(configData);
      } catch (error) {
        console.warn('Failed to read existing config, creating new:', error);
      }
    }

    // Deep merge to preserve nested structures
    const mergedConfig = {
      ...existingConfig,
      ...config,
      onboarding: { ...existingConfig.onboarding, ...config.onboarding },
      features: { ...existingConfig.features, ...config.features },
      aiServices: {
        ...existingConfig.aiServices,
        ...config.aiServices,
        transcription: { ...existingConfig.aiServices?.transcription, ...config.aiServices?.transcription },
        captioning: { ...existingConfig.aiServices?.captioning, ...config.aiServices?.captioning },
        sceneReconstruction: { ...existingConfig.aiServices?.sceneReconstruction, ...config.aiServices?.sceneReconstruction }
      },
      lastModified: new Date().toISOString()
    };

    await fs.promises.writeFile(CONFIG_FILE, JSON.stringify(mergedConfig, null, 2), 'utf8');

    console.log('[CONFIG] Settings saved to unified config.json');
    return { success: true };
  } catch (error) {
    console.error('Failed to save config:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

// Startup config normalizer to ensure consistency
async function normalizeConfigAtStartup() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      console.log('[CONFIG-NORMALIZE] No config file found, skipping normalization');
      return;
    }
    
    const configData = await fs.promises.readFile(CONFIG_FILE, 'utf8');
    let cfg = JSON.parse(configData);
    let changed = false;
    
    // Initialize resources section if missing
    if (!cfg.resources) {
      cfg.resources = {};
      changed = true;
    }
    
    // Check if Whisper model file actually exists
    const whisperModelName = cfg.aiServices?.transcription?.model?.replace('whisper-', '') || 'base.en';
    const whisperModelPath = path.join(app.getPath('userData'), 'whisper-models', `ggml-${whisperModelName}.bin`);
    const whisperExists = fs.existsSync(whisperModelPath);
    
    // Update whisper resource status based on actual file
    if (whisperExists && !cfg.resources.whisper?.downloaded) {
      cfg.resources.whisper = {
        downloaded: true,
        path: whisperModelPath,
        model: whisperModelName,
        lastChecked: new Date().toISOString()
      };
      cfg.aiServices = cfg.aiServices || {};
      cfg.aiServices.transcription = cfg.aiServices.transcription || {};
      cfg.aiServices.transcription.modelDownloaded = true;
      changed = true;
      console.log('[CONFIG-NORMALIZE] Detected existing Whisper model, updated resources.whisper.downloaded=true');
    } else if (!whisperExists && cfg.resources.whisper?.downloaded) {
      cfg.resources.whisper.downloaded = false;
      cfg.aiServices.transcription.modelDownloaded = false;
      changed = true;
      console.log('[CONFIG-NORMALIZE] Whisper model file missing, updated resources.whisper.downloaded=false');
    }
    
    // Enforce invariant: if (features.videos || features.audio) && whisperExists && !enabled, set enabled=true
    const hasMediaFeatures = cfg.features?.videos || cfg.features?.audio;
    const whisperDownloaded = cfg.resources.whisper?.downloaded || false;
    const transcriptionEnabled = cfg.aiServices?.transcription?.enabled || false;
    
    if (hasMediaFeatures && whisperDownloaded && !transcriptionEnabled) {
      cfg.aiServices.transcription.enabled = true;
      changed = true;
      console.log('[CONFIG-NORMALIZE] Enabled transcription because features require it and model is present');
    }
    
    // If features are OFF but enabled is true, turn it off
    if (!hasMediaFeatures && transcriptionEnabled) {
      cfg.aiServices.transcription.enabled = false;
      changed = true;
      console.log('[CONFIG-NORMALIZE] Disabled transcription because media features are off');
    }
    
    if (changed) {
      cfg.lastModified = new Date().toISOString();
      await fs.promises.writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
      console.log('[CONFIG-NORMALIZE] Config normalized and saved');
    } else {
      console.log('[CONFIG-NORMALIZE] Config is consistent, no changes needed');
    }
  } catch (error) {
    console.error('[CONFIG-NORMALIZE] Failed to normalize config:', error);
  }
}

ipcMain.handle('whisper:setup', async (evt, options: { modelName?: string; useCuda?: boolean } = {}) => {
  try {
    const modelName = options.modelName || 'base.en';
    const useCuda = options.useCuda !== undefined ? String(options.useCuda) : '';
    const isDev = process.env.NODE_ENV === 'development' || !!process.env.VITE_DEV_SERVER_URL;
    
    const { spawn } = await import('child_process');

    // Resolve script path for dev vs packaged (prefer .cjs fallback to .js)
    const devScriptPathCjs = path.join(process.cwd(), 'scripts', 'whisper-setup.cjs');
    const devScriptPathJs  = path.join(process.cwd(), 'scripts', 'whisper-setup.js');
    // Prefer unpacked in production so Node can execute it directly
    const prodUnpackedScriptCjs = path.join(process.resourcesPath, 'app.asar.unpacked', 'scripts', 'whisper-setup.cjs');
    const prodUnpackedScriptJs  = path.join(process.resourcesPath, 'app.asar.unpacked', 'scripts', 'whisper-setup.js');
    const prodAsarScriptCjs     = path.join(process.resourcesPath, 'app.asar', 'scripts', 'whisper-setup.cjs');
    const prodAsarScriptJs      = path.join(process.resourcesPath, 'app.asar', 'scripts', 'whisper-setup.js');

    let scriptPath = '';
    if (isDev) {
      scriptPath = fs.existsSync(devScriptPathCjs) ? devScriptPathCjs : devScriptPathJs;
    } else {
      if (fs.existsSync(prodUnpackedScriptCjs)) scriptPath = prodUnpackedScriptCjs;
      else if (fs.existsSync(prodUnpackedScriptJs)) scriptPath = prodUnpackedScriptJs;
      else if (fs.existsSync(prodAsarScriptCjs)) scriptPath = prodAsarScriptCjs;
      else scriptPath = prodAsarScriptJs;
    }

    console.log(`[WHISPER-SETUP] Spawning setup for model: ${modelName}, CUDA: ${useCuda}, scriptPath: ${scriptPath}`);

    // Choose executable: in dev use system node; in prod use Electron as Node runtime
    const cmd = isDev ? 'node' : process.execPath;
    const env = { ...process.env } as NodeJS.ProcessEnv;
    if (!isDev) env.ELECTRON_RUN_AS_NODE = '1';

    // Build arguments for the setup script (no ESM flags; script runs as CommonJS)
    const args = [scriptPath, modelName];
    if (useCuda !== '') args.push(useCuda);

    const child = spawn(cmd, args, { cwd: path.dirname(scriptPath), env });

    // Buffer stdout and parse JSON progress messages
    let stdoutBuf = '';
    child.stdout.on('data', (chunk: Buffer) => {
      try {
        const text = chunk.toString();
        stdoutBuf += text;
        let idx;
        while ((idx = stdoutBuf.indexOf('\n')) >= 0) {
          const line = stdoutBuf.slice(0, idx).trim();
          stdoutBuf = stdoutBuf.slice(idx + 1);
          if (!line) continue;
          try {
            const obj = JSON.parse(line);
            if (obj.type === 'whisper:setup:progress' && typeof obj.progress === 'number') {
              console.log(`[WHISPER-SETUP] Progress: ${obj.progress}% - ${obj.message || ''}`);
              evt.sender.send('whisper:setup:progress', obj.progress);
            } else if (obj.type === 'whisper:setup:signal' && obj.status) {
              console.log(`[WHISPER-SETUP] Signal: ${obj.status}${obj.error ? ` - ${obj.error}` : ''}`);
              evt.sender.send('whisper:setup:signal', { status: obj.status, error: obj.error });
            }
          } catch {
            // Non-JSON line; log it for debugging
            console.log('[WHISPER-SETUP][stdout]', line);
          }
        }
      } catch {}
    });

    child.stderr.on('data', (chunk: Buffer) => {
      // Forward important stderr as signals? For now, log only.
      console.log('[WHISPER-SETUP][stderr]', chunk.toString());
    });

    const exitCode: number = await new Promise((resolve) => {
      child.on('close', (code) => resolve(code ?? 1));
      child.on('error', () => resolve(1));
    });

    if (exitCode === 0) {
      // Update preferences.json on success
      const preferencesPath = path.join(DATA_DIR, 'preferences.json');
      try {
        let prefs: any = {};
        if (fs.existsSync(preferencesPath)) {
          prefs = JSON.parse(await fs.promises.readFile(preferencesPath, 'utf8'));
        }
        prefs.whisperModelDownloaded = true;
        prefs.onboardingComplete = true;
        await fs.promises.writeFile(preferencesPath, JSON.stringify(prefs, null, 2));
      } catch (e) {
        console.warn('[WHISPER-SETUP] Failed updating preferences after setup:', e);
      }
      // Also persist onboarding completion and modelDownloaded to unified config so renderer can gate onboarding/dev flow
      try {
        let cfg: any = {};
        if (fs.existsSync(CONFIG_FILE)) {
          try {
            const data = await fs.promises.readFile(CONFIG_FILE, 'utf8');
            cfg = JSON.parse(data);
          } catch (e) {
            console.warn('[WHISPER-SETUP] Failed reading existing config, will recreate:', e);
          }
        }
        const firstLaunchDate = cfg?.onboarding?.firstLaunchDate || new Date().toISOString();
        cfg.onboarding = { ...(cfg.onboarding || {}), complete: true, firstLaunchDate };
        cfg.aiServices = { ...(cfg.aiServices || {}) };
        cfg.aiServices.transcription = { ...(cfg.aiServices.transcription || {}), modelDownloaded: true };
        
        // Initialize resources section if not present
        cfg.resources = cfg.resources || {};
        
        // Set whisper resource as downloaded
        const whisperModelPath = path.join(app.getPath('userData'), 'whisper-models', `ggml-${modelName}.bin`);
        cfg.resources.whisper = {
          downloaded: true,
          path: whisperModelPath,
          model: modelName,
          lastChecked: new Date().toISOString()
        };
        
        // If videos or audio features are enabled, also enable transcription
        const hasMediaFeatures = cfg.features?.videos || cfg.features?.audio;
        if (hasMediaFeatures) {
          cfg.aiServices.transcription.enabled = true;
          console.log('[CONFIG] Transcription enabled after setup success (features require it)');
        }
        
        cfg.lastModified = new Date().toISOString();
        await fs.promises.mkdir(path.dirname(CONFIG_FILE), { recursive: true });
        await fs.promises.writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
        console.log('[CONFIG] Whisper setup complete: modelDownloaded=true, resources.whisper.downloaded=true, enabled=' + (hasMediaFeatures ? 'true' : 'false'));
      } catch (e) {
        console.warn('[WHISPER-SETUP] Failed updating config onboarding state:', e);
      }
      return { success: true, model: modelName };
    } else {
      evt.sender.send('whisper:setup:signal', { status: 'failed' });
      return { success: false, error: `Setup process exited with code ${exitCode}` };
    }
  } catch (error) {
    console.error('[WHISPER-SETUP] Setup failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});


app.whenReady().then(async () => {
  // Run data migration ONLY in production (never in dev mode)
  const isDev = process.env.NODE_ENV === 'development' || !!process.env.VITE_DEV_SERVER_URL;
  
  if (!isDev) {
    try {
      const { DataMigrator } = await import('../src/core/data-migrator');
      const migrationResult = await DataMigrator.migrateFromPreviousInstallations();
      
      if (migrationResult.migratedFiles.length > 0) {
        console.log(`[MAIN-PROCESS] Migrated ${migrationResult.migratedFiles.length} files from previous installations`);
      }
    } catch (error) {
      console.error('[MAIN-PROCESS] Data migration failed:', error);
    }
  } else {
    console.log('[MAIN-PROCESS] Skipping data migration in development mode');
  }

  // Create browser window (unless explicitly disabled)
  const isHeadless = process.env.HEADLESS_MODE === 'true';
  
  if (!isHeadless) {
    console.log('[MAIN-PROCESS] Creating browser window');
    await createWindow();
  } else {
    console.log('[MAIN-PROCESS] Headless mode enabled, no browser window');
  }
  
  // Initialize LLM Config Handler (lightweight, no async needed)
  try {
    const llmConfigHandler = initializeLLMConfigHandler();
    await llmConfigHandler.initialize();
    console.log('[MAIN-PROCESS] LLM Config Handler initialized');
  } catch (error) {
    console.warn('[MAIN-PROCESS] LLM Config Handler init failed:', error);
  }

  // Normalize config at startup to ensure consistency
  setTimeout(async () => {
    try {
      await normalizeConfigAtStartup();
    } catch (e) {
      console.warn('[CONFIG-NORMALIZE] Startup normalization failed:', e);
    }
  }, 100);
  
  // Defer heavy initialization so the UI can appear immediately
  setTimeout(async () => {
    // Initialize MediaAPI first to set up globalJobsDb
    await initializeMediaAPI().catch((e) => console.warn('[MAIN-PROCESS] MediaAPI init failed:', e));
    // Then initialize VideoAPI which depends on globalJobsDb
    await initializeVideoAPI().catch((e) => console.warn('[MAIN-PROCESS] VideoAPI init failed:', e));
    // Kick off background auto-tuning of FFmpeg per-process threads after initializations
    runAutoTune();
  }, 0);
})

// Cleanup on app exit
app.on('before-quit', async () => {
  try {
    // Stop background reconciliation
    const { MainMediaAPI } = await import('../src/api/main-media-api');
    MainMediaAPI.stopBackgroundReconciliation();
    
    // Cleanup temporary files
    const { DataMigrator } = await import('../src/core/data-migrator');
    const { ConfigManager } = await import('../src/core/config');
    
    const debugConfig = ConfigManager.getDebugConfig();
    if (debugConfig.cleanupOnExit) {
      await DataMigrator.cleanupTemporaryFiles(debugConfig.enabled);
    }
  } catch (error) {
    console.warn('[MAIN-PROCESS] Cleanup failed:', error);
  }
})
