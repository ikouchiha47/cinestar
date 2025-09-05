import { MediaSource, SearchQuery, SearchResult } from '../core/types';

declare global {
  interface Window {
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
      getIndexingStatus: () => Promise<{ success: boolean; activeJobs: string[]; error?: string }>;
      search: (query: SearchQuery) => Promise<{ success: boolean; results?: SearchResult; error?: string }>;
      searchText: (text: string, limit?: number) => Promise<{ success: boolean; results?: SearchResult; error?: string }>;
      getSuggestions: (query: string, limit?: number) => Promise<{ success: boolean; suggestions?: string[]; error?: string }>;
      getStats: () => Promise<{ success: boolean; stats?: { totalSources: number; totalItems: number; activeJobs: number }; error?: string }>;
      isOllamaAvailable: () => Promise<{ success: boolean; available: boolean; error?: string }>;
      selectDirectory: () => Promise<{ canceled: boolean; path?: string }>;
    };
  }
}

export {};
