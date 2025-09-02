import { MediaSource, MediaItem, IndexingJob } from './types';

// Persistent storage using localStorage
const STORAGE_KEYS = {
  SOURCES: 'driller_sources',
  ITEMS: 'driller_items', 
  JOBS: 'driller_jobs'
};

const loadFromStorage = <T>(key: string, defaultValue: T[]): T[] => {
  try {
    const stored = localStorage.getItem(key);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Convert date strings back to Date objects
      return parsed.map((item: any) => {
        if (item.createdAt) item.createdAt = new Date(item.createdAt);
        if (item.lastIndexed) item.lastIndexed = new Date(item.lastIndexed);
        if (item.modifiedAt) item.modifiedAt = new Date(item.modifiedAt);
        if (item.indexedAt) item.indexedAt = new Date(item.indexedAt);
        if (item.startedAt) item.startedAt = new Date(item.startedAt);
        if (item.completedAt) item.completedAt = new Date(item.completedAt);
        return item;
      });
    }
  } catch (error) {
    console.warn(`Failed to load ${key} from storage:`, error);
  }
  return defaultValue;
};

const saveToStorage = <T>(key: string, data: T[]): void => {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (error) {
    console.warn(`Failed to save ${key} to storage:`, error);
  }
};

const sources: MediaSource[] = loadFromStorage(STORAGE_KEYS.SOURCES, []);
const items: MediaItem[] = loadFromStorage(STORAGE_KEYS.ITEMS, []);
const jobs: IndexingJob[] = loadFromStorage(STORAGE_KEYS.JOBS, []);

export class DatabaseManager {
  constructor(_dbPath?: string) {
    // No-op for in-memory storage
  }
  
  async initialize(): Promise<void> {
    // Initialize database connection if needed
    // For the current in-memory implementation, this is a no-op
    return Promise.resolve();
  }

  // Media Sources
  async addSource(source: Omit<MediaSource, 'id' | 'createdAt'>): Promise<string> {
    const id = crypto.randomUUID();
    const newSource: MediaSource = {
      id,
      name: source.name,
      type: source.type,
      path: source.path,
      enabled: source.enabled,
      config: source.config,
      createdAt: new Date(),
      lastIndexed: undefined
    };
    
    sources.push(newSource);
    saveToStorage(STORAGE_KEYS.SOURCES, sources);
    return id;
  }

  async getSources(): Promise<MediaSource[]> {
    return [...sources].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async removeSource(sourceId: string): Promise<void> {
    const index = sources.findIndex(s => s.id === sourceId);
    if (index !== -1) {
      sources.splice(index, 1);
      // Remove related items and jobs
      const itemIndices = items.map((item, i) => item.sourceId === sourceId ? i : -1).filter(i => i !== -1);
      itemIndices.reverse().forEach(i => items.splice(i, 1));
      
      const jobIndices = jobs.map((job, i) => job.sourceId === sourceId ? i : -1).filter(i => i !== -1);
      jobIndices.reverse().forEach(i => jobs.splice(i, 1));
      
      saveToStorage(STORAGE_KEYS.SOURCES, sources);
      saveToStorage(STORAGE_KEYS.ITEMS, items);
      saveToStorage(STORAGE_KEYS.JOBS, jobs);
    }
  }

  async updateSourceLastIndexed(sourceId: string): Promise<void> {
    const source = sources.find(s => s.id === sourceId);
    if (source) {
      source.lastIndexed = new Date();
      saveToStorage(STORAGE_KEYS.SOURCES, sources);
    }
  }

  // Media Items
  async addMediaItem(item: Omit<MediaItem, 'indexedAt'>): Promise<void> {
    const existingIndex = items.findIndex(i => i.id === item.id);
    const newItem: MediaItem = {
      ...item,
      indexedAt: new Date()
    };
    
    if (existingIndex !== -1) {
      items[existingIndex] = newItem;
    } else {
      items.push(newItem);
    }
    saveToStorage(STORAGE_KEYS.ITEMS, items);
  }

  async searchItems(query: string, limit: number = 50, offset: number = 0): Promise<MediaItem[]> {
    const searchTerm = query.toLowerCase();
    const filtered = items.filter(item => 
      item.name.toLowerCase().includes(searchTerm) || 
      (item.description && item.description.toLowerCase().includes(searchTerm))
    );
    
    return filtered
      .sort((a, b) => (b.indexedAt?.getTime() || 0) - (a.indexedAt?.getTime() || 0))
      .slice(offset, offset + limit);
  }

  async getItemsBySource(sourceId: string): Promise<MediaItem[]> {
    return items.filter(item => item.sourceId === sourceId);
  }

  // Indexing Jobs
  async createIndexingJob(sourceId: string): Promise<string> {
    const id = crypto.randomUUID();
    const job: IndexingJob = {
      id,
      sourceId,
      status: 'running',
      progress: 0,
      processedItems: 0,
      startedAt: new Date()
    };
    
    jobs.push(job);
    saveToStorage(STORAGE_KEYS.JOBS, jobs);
    return id;
  }

  async updateJobProgress(jobId: string, progress: number, processedItems?: number): Promise<void> {
    const job = jobs.find(j => j.id === jobId);
    if (job) {
      job.progress = progress;
      job.processedItems = processedItems || 0;
      saveToStorage(STORAGE_KEYS.JOBS, jobs);
    }
  }

  async completeJob(jobId: string, success: boolean, error?: string): Promise<void> {
    const job = jobs.find(j => j.id === jobId);
    if (job) {
      job.status = success ? 'completed' : 'failed';
      job.completedAt = new Date();
      job.error = error;
      saveToStorage(STORAGE_KEYS.JOBS, jobs);
    }
  }
  
  async cancelJob(jobId: string): Promise<void> {
    const job = jobs.find(j => j.id === jobId);
    if (job) {
      job.status = 'cancelled';
      job.completedAt = new Date();
      saveToStorage(STORAGE_KEYS.JOBS, jobs);
    }
  }

  async getActiveJobs(): Promise<IndexingJob[]> {
    return jobs.filter(job => job.status === 'pending' || job.status === 'running');
  }

  close(): void {
    // No-op for in-memory storage
  }
}
