export type SearchItem = {
  id: string;
  type: 'image' | 'video' | 'audio';
  path: string;
  name?: string;
  size?: number;
  mimeType?: string | null;
  sourceId?: string;
  startMs?: number | null;
  endMs?: number | null;
  score?: number;
  createdAt?: Date;
};

export type SearchCursor = {
  ts: string; // ISO timestamp string
  id: string; // tie-breaker id
};

interface SearchConfig {
  maxSearchDepth: number;
  minResultsThreshold: number;
  cleanedQueryWeight: number;
  stepBackQueryWeight: number;
}

export interface IImageSearchStore {
  search(
    q: string, 
    limit: number, 
    cursor?: SearchCursor, 
    config?: SearchConfig
  ): Promise<{ 
    items: SearchItem[]; 
    total: number; 
    nextCursor?: SearchCursor;
    searchDepth: number;
  }>;
}

export interface IAVSearchStore {
  search(
    q: string, 
    limit: number, 
    cursor?: SearchCursor, 
    config?: SearchConfig
  ): Promise<{ 
    items: SearchItem[]; 
    total: number; 
    nextCursor?: SearchCursor;
    searchDepth: number;
  }>;
}
