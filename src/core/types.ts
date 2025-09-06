export interface MediaItem {
  id: string;
  name: string;
  path: string;
  size: number;
  // Programmable media kind (e.g. 'image' | 'video' | 'audio' | 'document' | ...)
  type: string;
  mimeType: string;
  sourceId: string;
  caption?: string;
  description?: string; // AI-generated description/caption
  embedding?: Float32Array;
  embeddingStatus?: string; // Status of embedding generation
  createdAt: Date;
  lastModified?: Date;
  modifiedAt?: Date; // Alternative name for lastModified
  fileHash?: string; // SHA-256 hash to detect file changes
  metadata?: Record<string, any>; // Arbitrary additional metadata
}

export interface MediaSource {
  id: string;
  name: string;
  type: 'local' | 'remote';
  path: string;
  enabled: boolean;
  config?: Record<string, any>;
  createdAt: Date;
  lastIndexed?: Date;
}

export interface IndexingJob {
  id: string;
  sourceId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  totalItems?: number;
  processedItems?: number;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  // Optional fine-grained phase: used by UI when available
  phase?: 'scanning' | 'captioning' | 'embedding' | 'finalizing' | 'queued' | 'unknown';
}

export interface SearchQuery {
  query: string;
  type?: 'semantic' | 'text' | 'hybrid';
  filters?: {
    sourceIds?: string[];
    types?: string[];
    dateRange?: {
      start?: Date;
      end?: Date;
    };
  };
  limit?: number;
  offset?: number;
}

export interface SearchResult {
  items: MediaItem[];
  total: number;
  query: string;
  executionTime: number;
  suggestions?: string[];
}

export interface SourcePlugin {
  name: string;
  type: string;
  validateConfig(config: Record<string, any>): Promise<{ valid: boolean; error?: string }>;
  listItems(source: MediaSource): AsyncGenerator<MediaItem, void, unknown>;
  getItemContent?(item: MediaItem): Promise<Buffer>;
}

export interface EmbeddingProvider {
  name: string;
  generateEmbedding(content: string | Buffer, type: 'text' | 'image'): Promise<Float32Array>;
  isAvailable(): Promise<boolean>;
}
