/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
  interface ProcessEnv {
    /**
     * The built directory structure
     *
     * ```tree
     * ├─┬─┬ dist
     * │ │ └── index.html
     * │ │
     * │ ├─┬ dist-electron
     * │ │ ├── main.js
     * │ │ └── preload.js
     * │
     * ```
     */
    APP_ROOT: string
    /** /dist/ or /public/ */
    VITE_PUBLIC: string
  }
}

// Used in Renderer process, expose in `preload.ts`
interface Window {
  ipcRenderer: import('electron').IpcRenderer
  mediaAPI: {
    getSources: () => Promise<{ success: boolean; sources?: any[]; error?: string }>;
    addSource: (name: string, type: string, path: string, config?: any) => Promise<any>;
    removeSource: (sourceId: string) => Promise<any>;
    startIndexing: (sourceId: string) => Promise<any>;
    forceReindex: (sourceId: string) => Promise<any>;
    cleanupDuplicates: () => Promise<any>;
    stopIndexing: (jobId: string) => Promise<any>;
    getIndexingStatus: () => Promise<any>;
    search: (query: any) => Promise<any>;
    searchText: (text: string, limit?: number) => Promise<any>;
    getSuggestions: (query: string, limit?: number) => Promise<any>;
    getStats: () => Promise<any>;
    getItems: (sourceId?: string) => Promise<{ success: boolean; items?: any[]; error?: string }>;
    isOllamaAvailable: () => Promise<any>;
    getImageThumbnail: (imagePath: string) => Promise<{ success: boolean; dataUrl?: string; error?: string }>;
    selectDirectory: () => Promise<any>;
  }
}
