import { MediaSource, SearchQuery, SearchResult } from '../core/types';

declare global {
  interface Window {
    ipcRenderer?: {
      on: (...args: any[]) => any;
      off: (...args: any[]) => any;
      send: (...args: any[]) => any;
      invoke: (...args: any[]) => Promise<any>;
    };
    electronAPI: {
      readFile: (filePath: string) => Promise<string | null>;
      writeFile: (filePath: string, data: string) => Promise<boolean>;
      fileExists: (filePath: string) => Promise<boolean>;
      mkdir: (dirPath: string) => Promise<boolean>;
      getAppPath: (name: string) => Promise<string>;
    };
    
    mediaAPI: {
      getSources: () => Promise<{ success: boolean; sources?: MediaSource[]; error?: string }>;
      addSource: (name: string, type: string, path: string, config?: any) => Promise<{ success: boolean; sourceId?: string; error?: string }>;
      removeSource: (sourceId: string) => Promise<{ success: boolean; error?: string }>;
      startIndexing: (sourceId: string) => Promise<{ success: boolean; jobId?: string; error?: string }>;
      stopIndexing: (jobId: string) => Promise<{ success: boolean; error?: string }>;
      getIndexingStatus: () => Promise<{
        success: boolean;
        activeJobs: string[];
        jobs?: Array<{ id: string; sourceId: string; status: string; progress: number; totalItems?: number; processedItems?: number; startedAt?: Date; completedAt?: Date; phase?: string }>;
        error?: string;
      }>;
      getItems: (sourceId?: string) => Promise<{ success: boolean; items?: any[]; error?: string }>;
      search: (query: SearchQuery) => Promise<{ success: boolean; results?: SearchResult; error?: string }>;
      searchText: (text: string, limit?: number) => Promise<{ success: boolean; results?: SearchResult; error?: string }>;
      getSuggestions: (query: string, limit?: number) => Promise<{ success: boolean; suggestions?: string[]; error?: string }>;
      getStats: () => Promise<{ success: boolean; stats?: { totalSources: number; totalItems: number; activeJobs: number }; error?: string }>;
      isOllamaAvailable: () => Promise<{ success: boolean; available: boolean; error?: string }>;
      selectDirectory: () => Promise<{ canceled: boolean; path?: string }>;
      getRecentItems: (params?: { sourceIds?: string[]; types?: Array<'image'|'video'|'audio'>; limit?: number; offset?: number }) => Promise<{ success: boolean; items?: any[]; error?: string }>;
    };
    
    videoAPI: {
      processVideo: (videoPath: string) => Promise<{ success: boolean; videoId?: string; error?: string }>;
      processAudio: (audioPath: string) => Promise<{ success: boolean; videoId?: string; error?: string }>;
      searchVideos: (query: any) => Promise<{ success: boolean; results?: any[]; error?: string }>;
      getJobStatus: (videoPath: string) => Promise<any>;
      getActiveJobs: () => Promise<any[]>;
      getVideoFile: (videoPath: string) => Promise<any>;
      getVideoSegments: (videoId: string) => Promise<any[]>;
      isVideoFile: (filePath: string) => Promise<boolean>;
      isAudioFile: (filePath: string) => Promise<boolean>;
      selectVideoFile: () => Promise<{ canceled: boolean; path?: string }>;
    };
  }
}

export {};
