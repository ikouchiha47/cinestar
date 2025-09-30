import '../src/core/logger'
import '../src/core/ffmpeg-bootstrap'
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
import { getMimeType } from '../src/core/utils'

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
const DEFAULT_DATA_DIR = IS_DEV ? path.resolve(process.cwd(), 'data') : path.join(os.homedir(), '.clipwise')
const DATA_DIR = process.env.MAIN_DB_DIR || DEFAULT_DATA_DIR
process.env.CLIPWISE_DATA_DIR = DATA_DIR

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
    minHeight: 600,
    backgroundColor: '#0b0b0b',
    show: true,
    title: 'Clipwise',
    icon: path.join(process.env.VITE_PUBLIC, 'icons', 'icon-256.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      backgroundThrottling: false,
    },
  })

  // We'll open dev tools on the app view later, not the main window

  // Helper to compute content bounds for views
  const getContentBounds = () => {
    const [width, height] = win!.getContentSize();
    return { x: 0, y: 0, width, height } as const;
  };

  // No separate splash view needed - React component handles splash
  console.log('[MAIN-PROCESS] Using React splash component');

  // Keep current views fitted on resize
  win.on('resize', () => {
    const bounds = getContentBounds();
    try { win?.getBrowserViews()?.forEach(v => v.setBounds(bounds)); } catch {}
  });

  // Prepare the main app BrowserView; swap when page fully loads to avoid black gap
  const appView = new BrowserView({ webPreferences: { preload: path.join(__dirname, 'preload.mjs'), backgroundThrottling: false } });

  // React component handles splash - no need for separate splash view

  if (VITE_DEV_SERVER_URL) {
    console.log('[MAIN-PROCESS] Waiting for dev server at:', VITE_DEV_SERVER_URL, 'time:', new Date().toISOString());
    const ok = await waitForUrl(VITE_DEV_SERVER_URL);
    if (ok) {
      console.log('[MAIN-PROCESS] Dev server reachable. Loading main URL at:', new Date().toISOString());
      await appView.webContents.loadURL(VITE_DEV_SERVER_URL);
      console.log('[MAIN-PROCESS] Main load initiated at:', new Date().toISOString());
      
      // Open dev tools on the app view in development
      if (IS_DEV) {
        appView.webContents.openDevTools();
      }
      try {
        // Add app view - React splash component will handle the transition
        win?.setBrowserView(appView);
        appView.setBounds(getContentBounds());
        appView.setAutoResize({ width: true, height: true });
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
    
    // Open dev tools on the app view in development
    if (IS_DEV) {
      appView.webContents.openDevTools();
    }
    try {
      win?.setBrowserView(appView);
      appView.setBounds(getContentBounds());
      appView.setAutoResize({ width: true, height: true });
    } catch (e) {
      console.warn('[MAIN-PROCESS] Failed to add app view (prod):', e);
    }
  }

  // When the renderer signals it's mounted, ensure app view is properly sized
  ipcMain.on('renderer:app-mounted', () => {
    try {
      console.log('[MAIN-PROCESS] Renderer reported app-mounted at:', new Date().toISOString());
      // Ensure appView is visible and sized
      try {
        appView.setBounds(getContentBounds());
        appView.setAutoResize({ width: true, height: true });
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
const DB_PATH = path.join(app.getPath('userData'), 'clipwise-db');

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

// Unified search IPC handler - now uses the new unifiedSearch method
ipcMain.handle('search:unified', async (_evt, query: { query: string; limit?: number; offset?: number; types?: ('image' | 'video' | 'audio')[] }) => {
  if (!mediaAPI) await initializeMediaAPI();
  
  try {
    const result = await MainMediaAPI.unifiedSearch(query.query || '', {
      types: query.types || ['image', 'video', 'audio'],
      limit: query.limit || 20,
      offset: query.offset || 0
    });
    
    return result;
  } catch (error) {
    console.error('[UNIFIED-SEARCH] Failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown search error'
    };
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
    console.log(`[VIDEO-SEGMENTS-DEBUG] Found ${segments.length} segments`);
    
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
    
    // If search query provided, sort by relevance and filter out low scores
    if (searchQuery) {
      processedSegments = processedSegments
        .filter(segment => (segment.relevanceScore || 0) > 0.1)
        .sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
      
      console.log(`[VIDEO-SEGMENTS-DEBUG] After filtering by search query: ${processedSegments.length} segments`);
    }
    
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
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

ipcMain.handle('config:get', async () => {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const configData = await fs.promises.readFile(CONFIG_FILE, 'utf8');
      return JSON.parse(configData);
    }
    return {};
  } catch (error) {
    console.error('Failed to read config:', error);
    return {};
  }
});

ipcMain.handle('config:set', async (_, config) => {
  try {
    // Ensure config directory exists
    await fs.promises.mkdir(path.dirname(CONFIG_FILE), { recursive: true });
    
    // Read existing config and merge
    let existingConfig = {};
    if (fs.existsSync(CONFIG_FILE)) {
      try {
        const configData = await fs.promises.readFile(CONFIG_FILE, 'utf8');
        existingConfig = JSON.parse(configData);
      } catch (error) {
        console.warn('Failed to read existing config, creating new:', error);
      }
    }
    
    const mergedConfig = { ...existingConfig, ...config };
    await fs.promises.writeFile(CONFIG_FILE, JSON.stringify(mergedConfig, null, 2));
    console.log('Config saved successfully');
    return { success: true };
  } catch (error) {
    console.error('Failed to save config:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

app.whenReady().then(async () => {
  // Run data migration first
  try {
    const { DataMigrator } = await import('../src/core/data-migrator');
    const migrationResult = await DataMigrator.migrateFromPreviousInstallations();
    
    if (migrationResult.migratedFiles.length > 0) {
      console.log(`[MAIN-PROCESS] Migrated ${migrationResult.migratedFiles.length} files from previous installations`);
    }
  } catch (error) {
    console.warn('[MAIN-PROCESS] Data migration failed:', error);
  }

  // Create browser window (unless explicitly disabled)
  const isHeadless = process.env.HEADLESS_MODE === 'true';
  
  if (!isHeadless) {
    console.log('[MAIN-PROCESS] Creating browser window');
    await createWindow();
  } else {
    console.log('[MAIN-PROCESS] Headless mode enabled, no browser window');
  }
  
  // Defer heavy initialization so the UI can appear immediately
  setTimeout(() => {
    initializeMediaAPI().catch((e) => console.warn('[MAIN-PROCESS] MediaAPI init failed:', e));
    initializeVideoAPI().catch((e) => console.warn('[MAIN-PROCESS] VideoAPI init failed:', e));
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
