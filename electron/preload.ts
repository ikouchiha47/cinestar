import { ipcRenderer, contextBridge } from 'electron'

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    return ipcRenderer.off(channel, ...omit)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },
})

// Expose file system API for database operations
contextBridge.exposeInMainWorld('electronAPI', {
  readFile: (filePath: string) => ipcRenderer.invoke('fs:readFile', filePath),
  writeFile: (filePath: string, data: string) => ipcRenderer.invoke('fs:writeFile', filePath, data),
  fileExists: (filePath: string) => ipcRenderer.invoke('fs:exists', filePath),
  mkdir: (dirPath: string) => ipcRenderer.invoke('fs:mkdir', dirPath),
  getAppPath: (name: string) => ipcRenderer.invoke('app:getPath', name),
  getDataDir: () => ipcRenderer.invoke('app:getDataDir'),
})

// Expose MediaAPI for the renderer process
contextBridge.exposeInMainWorld('mediaAPI', {
  getSources: () => ipcRenderer.invoke('media:getSources'),
  addSource: (name: string, type: string, path: string, config?: any) => 
    ipcRenderer.invoke('media:addSource', name, type, path, config),
  addItemForFile: (sourceId: string, filePath: string, description?: string, metadata?: Record<string, any>) =>
    ipcRenderer.invoke('media:addItemForFile', sourceId, filePath, description, metadata),
  indexUnprocessedImages: () => ipcRenderer.invoke('media:indexUnprocessedImages'),
  deleteMediaItem: (itemId: string, deleteFile?: boolean) => ipcRenderer.invoke('media:deleteMediaItem', itemId, deleteFile),
  startCleanupJob: () => ipcRenderer.invoke('media:startCleanupJob'),
  removeSource: (sourceId: string) => ipcRenderer.invoke('media:removeSource', sourceId),
  startIndexing: (sourceId: string) => ipcRenderer.invoke('media:startIndexing', sourceId),
  forceReindex: (sourceId: string) => ipcRenderer.invoke('media:forceReindex', sourceId),
  cleanupDuplicates: () => ipcRenderer.invoke('media:cleanupDuplicates'),
  stopIndexing: (jobId: string) => ipcRenderer.invoke('media:stopIndexing', jobId),
  getIndexingStatus: () => ipcRenderer.invoke('media:getIndexingStatus'),
  search: (query: any) => ipcRenderer.invoke('media:search', query),
  searchText: (text: string, limit?: number) => ipcRenderer.invoke('media:searchText', text, limit),
  unifiedSearch: (query: string, options?: { types?: ('image' | 'video' | 'audio')[]; limit?: number; offset?: number }) => 
    ipcRenderer.invoke('search:unified', { query, ...options }),
  getSuggestions: (query: string, limit?: number) => ipcRenderer.invoke('media:getSuggestions', query, limit),
  getStats: () => ipcRenderer.invoke('media:getStats'),
  getRecentItems: (params?: { sourceIds?: string[]; types?: Array<'image'|'video'|'audio'>; limit?: number; offset?: number }) => ipcRenderer.invoke('media:getRecentItems', params),
  getItems: (sourceId?: string) => ipcRenderer.invoke('media:getItems', sourceId),
  isOllamaAvailable: () => ipcRenderer.invoke('media:isOllamaAvailable'),
  getImageThumbnail: (imagePath: string) => ipcRenderer.invoke('media:getImageThumbnail', imagePath),
  selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory'),
})

// Expose VideoAPI for the renderer process
contextBridge.exposeInMainWorld('videoAPI', {
  processVideo: (videoPath: string) => ipcRenderer.invoke('video:processVideo', videoPath),
  processAudio: (audioPath: string) => ipcRenderer.invoke('video:processAudio', audioPath),
  searchVideos: (query: any) => ipcRenderer.invoke('video:searchVideos', query),
  getJobStatus: (videoPath: string) => ipcRenderer.invoke('video:getJobStatus', videoPath),
  getActiveJobs: () => ipcRenderer.invoke('video:getActiveJobs'),
  getVideoFile: (videoPath: string) => ipcRenderer.invoke('video:getVideoFile', videoPath),
  getVideoSegments: (videoId: string) => ipcRenderer.invoke('video:getVideoSegments', videoId),
  isVideoFile: (filePath: string) => ipcRenderer.invoke('video:isVideoFile', filePath),
  isAudioFile: (filePath: string) => ipcRenderer.invoke('video:isAudioFile', filePath),
  selectVideoFile: () => ipcRenderer.invoke('dialog:selectVideoFile'),
  selectImageFile: () => ipcRenderer.invoke('dialog:selectImageFile'),
  selectAudioFile: () => ipcRenderer.invoke('dialog:selectAudioFile'),
  // Video player methods
  getMetadata: (videoPath: string) => ipcRenderer.invoke('video:getMetadata', videoPath),
  getSegmentsForPlayer: (videoPath: string, searchQuery?: string) => ipcRenderer.invoke('video:getSegmentsForPlayer', videoPath, searchQuery),
})
