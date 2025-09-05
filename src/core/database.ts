import { MediaSource, MediaItem, IndexingJob } from './types';
import { FileDatabase } from './file-database';

// For renderer process safety
declare global {
  interface Window {
    electronAPI?: {
      getAppPath: () => Promise<string>;
      saveData: (key: string, data: any) => Promise<void>;
      loadData: (key: string) => Promise<any>;
    };
  }
}

/**
 * Database manager for the application
 * Handles all database operations using localStorage as a fallback
 * when running in a web browser or when Electron APIs are not available
 */
export class DatabaseManager {
  private db: FileDatabase;
  private initialized = false;
  private isElectron: boolean;

  constructor() {
    // Check if we're running in Electron
    this.isElectron = !!(window.electronAPI);
    console.log('DatabaseManager initialized, isElectron:', this.isElectron);
    this.db = new FileDatabase();
  }
  
  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    console.log('Initializing database');
    await this.db.initialize();
    this.initialized = true;
    console.log('Database initialized');
  }

  // Media Sources
  async addSource(source: Omit<MediaSource, 'id' | 'createdAt'>): Promise<string> {
    return this.db.addSource(source);
  }

  async getSources(): Promise<MediaSource[]> {
    return this.db.getSources();
  }

  async getSource(sourceId: string): Promise<MediaSource | undefined> {
    return this.db.getSource(sourceId);
  }

  async removeSource(sourceId: string): Promise<void> {
    return this.db.removeSource(sourceId);
  }

  async updateSource(sourceId: string, updates: Partial<MediaSource>): Promise<void> {
    return this.db.updateSource(sourceId, updates);
  }

  // Media Items
  async addMediaItem(item: Omit<MediaItem, 'id'>): Promise<string> {
    return this.db.addMediaItem(item);
  }

  async getMediaItems(sourceId?: string): Promise<MediaItem[]> {
    return this.db.getMediaItems(sourceId);
  }

  async searchMediaItems(query: string, limit?: number): Promise<MediaItem[]> {
    return this.db.searchMediaItems(query, limit);
  }

  async vectorSearch(embedding: Float32Array, limit = 10): Promise<MediaItem[]> {
    return this.db.vectorSearch(embedding, limit);
  }

  // Indexing Jobs
  async createJob(job: Omit<IndexingJob, 'id' | 'createdAt' | 'status' | 'progress'>): Promise<string> {
    return this.db.createJob(job);
  }

  async getJobs(sourceId?: string): Promise<IndexingJob[]> {
    return this.db.getJobs(sourceId);
  }

  async updateJobStatus(jobId: string, status: IndexingJob['status'], progress?: number): Promise<void> {
    return this.db.updateJobStatus(jobId, status, progress);
  }

  async getActiveJobs(): Promise<IndexingJob[]> {
    return this.db.getActiveJobs();
  }
  
  async removeJob(sourceId: string): Promise<void> {
    return this.db.removeJob(sourceId);
  }
}
