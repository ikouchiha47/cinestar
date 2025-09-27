import { app, BrowserWindow, ipcMain, dialog, BrowserView } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { MainMediaAPI } from '../src/api/main-media-api'
import { VideoMediaAPI } from '../src/api/video-media-api'
import { VideoJobProcessor } from '../src/core/video-job-processor'
import { attachPartialSegmentWriter } from '../src/orchestrator'
import { autoTuneFFmpegThreads } from '../src/core/auto-tuner'

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
const DEFAULT_DATA_DIR = IS_DEV ? path.resolve(process.cwd(), 'data') : path.join(os.homedir(), '.driller')
const DATA_DIR = process.env.MAIN_DB_DIR || DEFAULT_DATA_DIR
process.env.DRILLER_DATA_DIR = DATA_DIR

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
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null

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
    minHeight: 700,
    backgroundColor: '#0b0b0b',
    show: true,
    icon: path.join(process.env.VITE_PUBLIC, 'electron-vite.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      backgroundThrottling: false,
    },
  })

  // Helper to compute content bounds for views
  const getContentBounds = () => {
    const [width, height] = win!.getContentSize();
    return { x: 0, y: 0, width, height } as const;
  };

  // Create a splash BrowserView and attach it immediately
  let splashView: BrowserView | null = null;
  try {
    const splashPath = path.join(process.env.VITE_PUBLIC, 'splash.html');
    splashView = new BrowserView({ webPreferences: { backgroundThrottling: false } });
    win.setBrowserView(splashView);
    splashView.setBounds(getContentBounds());
    splashView.setAutoResize({ width: true, height: true });
    await splashView.webContents.loadFile(splashPath);
    console.log('[MAIN-PROCESS] Splash loaded at:', new Date().toISOString());
  } catch (e) {
    console.warn('[MAIN-PROCESS] Failed to load splash:', e);
  }

  // Keep current views fitted on resize
  win.on('resize', () => {
    const bounds = getContentBounds();
    try { win?.getBrowserViews()?.forEach(v => v.setBounds(bounds)); } catch {}
  });

  // Prepare the main app BrowserView; swap when page fully loads to avoid black gap
  const appView = new BrowserView({ webPreferences: { preload: path.join(__dirname, 'preload.mjs'), backgroundThrottling: false } });

  // Helper to remove splash safely
  const removeSplash = () => {
    if (!splashView) return;
    try {
      console.log('[MAIN-PROCESS] Removing splash at:', new Date().toISOString());
      try { win?.removeBrowserView(splashView); } catch {}
    } catch (e) {
      console.warn('[MAIN-PROCESS] Failed removing splash:', e);
    } finally {
      splashView = null;
    }
  };

  let splashFallbackTimer: NodeJS.Timeout | null = null;

  if (VITE_DEV_SERVER_URL) {
    console.log('[MAIN-PROCESS] Waiting for dev server at:', VITE_DEV_SERVER_URL, 'time:', new Date().toISOString());
    const ok = await waitForUrl(VITE_DEV_SERVER_URL);
    if (ok) {
      console.log('[MAIN-PROCESS] Dev server reachable. Loading main URL at:', new Date().toISOString());
      await appView.webContents.loadURL(VITE_DEV_SERVER_URL);
      console.log('[MAIN-PROCESS] Main load initiated at:', new Date().toISOString());
      try {
        // Add app view under splash
        win?.addBrowserView(appView);
        appView.setBounds(getContentBounds());
        appView.setAutoResize({ width: true, height: true });
        // Ensure splash stays on top until renderer signals readiness
        if (splashView && typeof (win as any).setTopBrowserView === 'function') {
          (win as any).setTopBrowserView(splashView);
        }
        // Fallback: if renderer doesn't signal within 5s, remove splash
        if (splashFallbackTimer) clearTimeout(splashFallbackTimer);
        splashFallbackTimer = setTimeout(removeSplash, 5000);
      } catch (e) {
        console.warn('[MAIN-PROCESS] Failed to add app view:', e);
      }
    } else {
      console.warn('[MAIN-PROCESS] Dev server not reachable within timeout. Keeping splash visible.', new Date().toISOString());
    }
  } else {
    console.log('[MAIN-PROCESS] Loading production index.html at:', new Date().toISOString());
    await appView.webContents.loadFile(path.join(RENDERER_DIST, 'index.html'))
    console.log('[MAIN-PROCESS] Main load initiated at:', new Date().toISOString());
    try {
      win?.addBrowserView(appView);
      appView.setBounds(getContentBounds());
      appView.setAutoResize({ width: true, height: true });
      if (splashView && typeof (win as any).setTopBrowserView === 'function') {
        (win as any).setTopBrowserView(splashView);
      }
      if (splashFallbackTimer) clearTimeout(splashFallbackTimer);
      splashFallbackTimer = setTimeout(removeSplash, 5000);
    } catch (e) {
      console.warn('[MAIN-PROCESS] Failed to add app view (prod):', e);
    }
  }

  // When the renderer signals it's mounted, remove the splash and bring app to front
  ipcMain.on('renderer:app-mounted', () => {
    try {
      if (splashView) {
        console.log('[MAIN-PROCESS] Renderer reported app-mounted; removing splash at:', new Date().toISOString());
        removeSplash();
      }
      // Ensure appView is visible and sized
      try {
        win?.addBrowserView(appView);
        appView.setBounds(getContentBounds());
        appView.setAutoResize({ width: true, height: true });
      } catch {}
      if (splashFallbackTimer) { clearTimeout(splashFallbackTimer); splashFallbackTimer = null; }
    } catch (e) {
      console.warn('[MAIN-PROCESS] Failed to finalize splash removal:', e);
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
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// Database file operations
const DB_PATH = path.join(app.getPath('userData'), 'driller-db');

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
let videoJobProcessor: VideoJobProcessor | null = null;
let mediaInitAttempted = false;
let mediaInitFailed = false;
let mediaInitErrorMessage = '';

async function initializeMediaAPI() {
  // Avoid tight retry loops if we've already attempted and failed
  if (mediaInitAttempted && mediaInitFailed) {
    return;
  }
  mediaInitAttempted = true;
  try {
    await MainMediaAPI.initialize(DATA_DIR);
    mediaAPI = MainMediaAPI;
    mediaInitFailed = false;
    mediaInitErrorMessage = '';
    console.log('MainMediaAPI initialized in main process');
  } catch (error: any) {
    mediaAPI = null;
    mediaInitFailed = true;
    mediaInitErrorMessage = error instanceof Error ? error.message : String(error);
    console.error('Failed to initialize MainMediaAPI:', error);
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
  try {
    videoAPI = VideoMediaAPI.getInstance();
    await videoAPI.initialize();
    // Attach partial writer to persist segments early for non-blocking search
    attachPartialSegmentWriter(videoAPI);
    console.log('VideoMediaAPI initialized in main process');
    
    // Start the background job processor
    if (!videoJobProcessor) {
      videoJobProcessor = new VideoJobProcessor();
      await videoJobProcessor.start();
      console.log('VideoJobProcessor started in main process');
    }
  } catch (error) {
    console.error('Failed to initialize VideoMediaAPI:', error);
  }
}

async function runAutoTune() {
  try {
    if (!win) return;
    win.webContents.send('config:autoTune:started', { stage: 'ffmpeg_threads' });
    console.log('[AUTO-TUNE] Starting FFmpeg threads auto-tune...');
    const result = await autoTuneFFmpegThreads();
    if (result) {
      console.log(`[AUTO-TUNE] Selected threadsPerProcess=${result.selected}`);
      win.webContents.send('config:autoTune:completed', {
        stage: 'ffmpeg_threads',
        selected: result.selected,
        measurements: result.measurements
      });
    } else {
      console.log('[AUTO-TUNE] Skipped (env/config already set or test video unavailable).');
      win.webContents.send('config:autoTune:skipped', { stage: 'ffmpeg_threads' });
    }
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

ipcMain.handle('media:getRecentItems', async (_evt, params?: { sourceIds?: string[]; types?: Array<'image'|'video'|'audio'>; limit?: number }) => {
  return await guardMedia(() => MainMediaAPI.getRecentItems(params));
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

// Unified search IPC handler
ipcMain.handle('search:unified', async (_evt, query: { query: string; limit?: number; offset?: number }) => {
  // Ensure both APIs are initialized (guarded)
  if (!mediaAPI) await initializeMediaAPI();
  if (!videoAPI) await initializeVideoAPI();

  // Default response shape
  const grouped = {
    images: [] as any[],
    videos: [] as any[],
    totals: { images: 0, videos: 0 },
    hasMore: { images: false, videos: false }
  };

  const q = query?.query ?? '';
  const limit = query?.limit ?? 20;
  const offset = query?.offset ?? 0;
  const videoFetchLimit = Math.max(1, limit) + 1; // fetch one extra to determine hasMore

  // Media/vector: use existing MainMediaAPI.search (returns items + total + hasMore)
  let mediaOk = false;
  try {
    if (mediaAPI) {
      const mediaSearch = await MainMediaAPI.search({ query: q, limit, offset });
      if (mediaSearch?.success && mediaSearch?.results) {
        grouped.images = mediaSearch.results.items || [];
        grouped.totals.images = mediaSearch.results.total || 0;
        grouped.hasMore.images = !!mediaSearch.results.hasMore;
        mediaOk = true;
      }
    }
  } catch (e) {
    console.warn('[UNIFIED-SEARCH] Media search failed:', e);
  }

  // Video/text: call VideoMediaAPI.searchVideos (text search over segments_fts)
  let videoOk = false;
  try {
    if (videoAPI) {
      const raw = await videoAPI.searchVideos({ query: q, limit: videoFetchLimit, offset, searchType: 'text' });
      if (Array.isArray(raw)) {
        const hasMore = raw.length > limit;
        const trimmed = hasMore ? raw.slice(0, limit) : raw;
        grouped.videos = trimmed;
        grouped.totals.videos = offset + trimmed.length; // approximate when total unknown
        grouped.hasMore.videos = hasMore;
        videoOk = true;
      }
    }
  } catch (e) {
    console.warn('[UNIFIED-SEARCH] Video search failed:', e);
  }

  return {
    success: mediaOk || videoOk,
    results: grouped
  };
});

// Video processing IPC handlers
ipcMain.handle('video:processVideo', async (_, videoPath: string) => {
  if (!videoAPI) await initializeVideoAPI();
  try {
    return { success: true, videoId: await videoAPI!.processVideo(videoPath) };
  } catch (error) {
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
    return { success: true, results };
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

app.whenReady().then(async () => {
  await createWindow();
  // Defer heavy initialization so the UI can appear immediately
  setTimeout(() => {
    initializeMediaAPI().catch((e) => console.warn('[MAIN-PROCESS] MediaAPI init failed:', e));
    initializeVideoAPI().catch((e) => console.warn('[MAIN-PROCESS] VideoAPI init failed:', e));
    // Kick off background auto-tuning of FFmpeg per-process threads after initializations
    runAutoTune();
  }, 0);
})
