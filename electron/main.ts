import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import { MainMediaAPI } from '../src/api/main-media-api'
const __dirname = path.dirname(fileURLToPath(import.meta.url))

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

function createWindow() {
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, 'electron-vite.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    // win.loadFile('dist/index.html')
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
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

// Initialize MediaAPI in main process
let mediaAPI: typeof MainMediaAPI | null = null;

async function initializeMediaAPI() {
  try {
    const dbPath = path.join(app.getPath('userData'), 'driller-db');
    await MainMediaAPI.initialize(dbPath, 'ollama');
    mediaAPI = MainMediaAPI;
    console.log('MainMediaAPI initialized in main process');
  } catch (error) {
    console.error('Failed to initialize MainMediaAPI:', error);
  }
}

// MediaAPI IPC handlers
ipcMain.handle('media:getSources', async () => {
  if (!mediaAPI) await initializeMediaAPI();
  return await MainMediaAPI.getSources();
});

ipcMain.handle('media:addSource', async (_, name: string, type: string, path: string, config?: any) => {
  if (!mediaAPI) await initializeMediaAPI();
  return await MainMediaAPI.addSource(name, type, path, config);
});

ipcMain.handle('media:removeSource', async (_, sourceId: string) => {
  if (!mediaAPI) await initializeMediaAPI();
  return await MainMediaAPI.removeSource(sourceId);
});

ipcMain.handle('media:startIndexing', async (_, sourceId: string) => {
  if (!mediaAPI) await initializeMediaAPI();
  return await MainMediaAPI.startIndexing(sourceId);
});

ipcMain.handle('media:stopIndexing', async (_, jobId: string) => {
  if (!mediaAPI) await initializeMediaAPI();
  return await MainMediaAPI.stopIndexing(jobId);
});

ipcMain.handle('media:getIndexingStatus', async () => {
  if (!mediaAPI) await initializeMediaAPI();
  return await MainMediaAPI.getIndexingStatus();
});

ipcMain.handle('media:search', async (_, query) => {
  if (!mediaAPI) await initializeMediaAPI();
  return await MainMediaAPI.search(query);
});

ipcMain.handle('media:searchText', async (_, text: string, limit?: number) => {
  if (!mediaAPI) await initializeMediaAPI();
  return await MainMediaAPI.searchText(text, limit);
});

ipcMain.handle('media:getSuggestions', async (_, query: string, limit?: number) => {
  if (!mediaAPI) await initializeMediaAPI();
  return await MainMediaAPI.getSuggestions(query, limit);
});

ipcMain.handle('media:updateConcurrency', async (_, limit: number) => {
  if (!mediaAPI) await initializeMediaAPI();
  return await MainMediaAPI.updateConcurrencySettings(limit);
});

ipcMain.handle('media:getConfiguration', async () => {
  if (!mediaAPI) await initializeMediaAPI();
  return await MainMediaAPI.getConfiguration();
});

ipcMain.handle('media:enableDebugMode', async (_, saveImages: boolean, saveLLaVAOutputs: boolean, outputDir?: string) => {
  if (!mediaAPI) await initializeMediaAPI();
  return await MainMediaAPI.enableDebugMode(saveImages, saveLLaVAOutputs, outputDir);
});

ipcMain.handle('media:disableDebugMode', async () => {
  if (!mediaAPI) await initializeMediaAPI();
  return await MainMediaAPI.disableDebugMode();
});

ipcMain.handle('media:getStats', async () => {
  if (!mediaAPI) await initializeMediaAPI();
  return await MainMediaAPI.getStats();
});

ipcMain.handle('media:getRecentItems', async (_evt, params?: { sourceIds?: string[]; types?: Array<'image'|'video'|'audio'>; limit?: number }) => {
  if (!mediaAPI) await initializeMediaAPI();
  return await MainMediaAPI.getRecentItems(params);
});

ipcMain.handle('media:getItems', async (_evt, sourceId?: string) => {
  if (!mediaAPI) await initializeMediaAPI();
  return await MainMediaAPI.getItems(sourceId);
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
  if (!mediaAPI) await initializeMediaAPI();
  console.log('[ELECTRON-MAIN] Calling MainMediaAPI.isOllamaAvailable()');
  const result = await MainMediaAPI.isOllamaAvailable();
  console.log('[ELECTRON-MAIN] MainMediaAPI.isOllamaAvailable() result:', result);
  return result;
});

ipcMain.handle('media:getImageThumbnail', async (_, imagePath: string) => {
  if (!mediaAPI) await initializeMediaAPI();
  return await MainMediaAPI.getImageThumbnail(imagePath);
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

app.whenReady().then(async () => {
  createWindow();
  await initializeMediaAPI();
})
