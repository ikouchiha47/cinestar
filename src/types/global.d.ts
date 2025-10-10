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
      
      // User preferences
      getUserPreferences: () => Promise<{ success: boolean; preferences?: any; error?: string }>;
      saveUserPreferences: (prefs: any) => Promise<{ success: boolean; error?: string }>;
      
      // Whisper model download
      downloadWhisperModel: (options: { modelName: string }) => Promise<{ success: boolean; error?: string }>;
      onWhisperDownloadProgress: (callback: (progress: number) => void) => () => void;
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
      getItems: (sourceId?: string) => Promise<{ success: boolean; items?: any[]; total?: number; error?: string }>;
      getVideosByPath: (videoPath: string) => Promise<{ success: boolean; items?: any[]; error?: string }>;
      getRecentItems: (params?: { 
        sourceIds?: string[]; 
        types?: Array<'image'|'video'|'audio'>; 
        limit?: number; 
        cursor?: string;
        orderBy?: 'createdAt' | 'modifiedAt' | 'name' | 'size';
        orderDirection?: 'asc' | 'desc';
      }) => Promise<{ success: boolean; items?: any[]; nextCursor?: string; hasMore?: boolean; error?: string }>;
      search: (query: SearchQuery) => Promise<{ success: boolean; results?: SearchResult; error?: string }>;
      searchText: (text: string, limit?: number) => Promise<{ success: boolean; results?: SearchResult; error?: string }>;
      unifiedSearch: (query: string, options?: { types?: ('image' | 'video' | 'audio')[]; limit?: number; offset?: number }) => Promise<{
        success: boolean;
        results?: {
          images: any[];
          videos: any[];
          audio: any[];
          totals: { images: number; videos: number; audio: number };
          hasMore: { images: boolean; videos: boolean; audio: boolean };
          query: string;
          executionTime: number;
        };
        error?: string;
      }>;
      getSuggestions: (query: string, limit?: number) => Promise<{ success: boolean; suggestions?: string[]; error?: string }>;
      getStats: () => Promise<{ success: boolean; stats?: { totalSources: number; totalItems: number; activeJobs: number }; error?: string }>;
      isOllamaAvailable: () => Promise<{ success: boolean; available: boolean; error?: string }>;
      selectDirectory: () => Promise<{ canceled: boolean; path?: string }>;
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
      // Video player methods
      getMetadata: (videoPath: string) => Promise<{
        success: boolean;
        metadata?: {
          id: string;
          fileName: string;
          duration: number;
          frameRate: number;
          fileSize: number;
          totalSegments: number;
          processingStatus: string;
        };
        error?: string;
      }>;
      getSegmentsForPlayer: (videoPath: string, searchQuery?: string) => Promise<{
        success: boolean;
        segments?: Array<{
          id: string;
          startTime: number;
          endTime: number;
          transcription: string;
          caption: string;
          reconstructedScene: string;
          relevanceScore?: number;
        }>;
        error?: string;
      }>;
    };
  }
}

export {};
