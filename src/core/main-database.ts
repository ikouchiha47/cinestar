import fs from 'fs/promises';
import path from 'path';
import { MediaItem, MediaSource, IndexingJob } from './types';
import { EnhancedVectorSearch } from './enhanced-vector-search';

/**
 * Main process database implementation using Node.js file system
 * This runs in the Electron main process and doesn't rely on browser APIs
 */
export class MainDatabase {
  private sources: MediaSource[] = [];
  private items: MediaItem[] = [];
  private jobs: IndexingJob[] = [];
  private dbPath: string = '';
  private initialized = false;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    console.log('MainDatabase initialized with path:', dbPath);
  }

  private getFilePath(collection: string): string {
    return path.join(this.dbPath, `${collection}.json`);
  }

  private async loadCollection<T>(collection: string): Promise<T[]> {
    try {
      const filePath = this.getFilePath(collection);
      console.log(`Loading ${collection} from:`, filePath);
      
      // Check if file exists
      const exists = await fs.access(filePath).then(() => true).catch(() => false);
      console.log(`File ${filePath} exists:`, exists);
      if (!exists) return [];
      
      // Read file
      const data = await fs.readFile(filePath, 'utf8');
      console.log(`Read ${collection} data length:`, data.length);
      
      // Parse the data and convert date strings back to Date objects
      const parsed = JSON.parse(data, (key, value) => {
        // Convert ISO date strings back to Date objects
        if (typeof value === 'string' && 
            (key === 'createdAt' || key === 'modifiedAt' || key === 'lastIndexed' || 
             key === 'startedAt' || key === 'completedAt')) {
          return new Date(value);
        }
        return value;
      });
      
      console.log(`Parsed ${collection}:`) //, parsed);
      return parsed || [];
    } catch (error) {
      console.error(`Failed to load ${collection}:`, error);
      return [];
    }
  }

  private async saveCollection<T>(collection: string, data: T[]): Promise<void> {
    try {
      const filePath = this.getFilePath(collection);
      const serialized = JSON.stringify(data, null, 2);
      
      await fs.writeFile(filePath, serialized);
      console.log(`Saved ${collection} (${data.length} items)`);
    } catch (error) {
      console.error(`Failed to save ${collection}:`, error);
      throw error;
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    console.log('=== MainDatabase Initialize Start ===');
    
    // Ensure database directory exists
    try {
      await fs.mkdir(this.dbPath, { recursive: true });
      console.log('Database directory created/exists:', true);
    } catch (error) {
      console.error('Failed to create database directory:', error);
      throw error;
    }
    
    console.log('Starting to load collections...');
    // Load existing data from files
    this.sources = await this.loadCollection<MediaSource>('sources');
    this.items = await this.loadCollection<MediaItem>('items');
    this.jobs = await this.loadCollection<IndexingJob>('jobs');
    
    // Database loaded silently
    
    this.initialized = true;
  }

  // Media Sources
  async addSource(source: Omit<MediaSource, 'id' | 'createdAt'>): Promise<string> {
    console.log('Adding new source:', source);
    const id = crypto.randomUUID();
    const newSource: MediaSource = {
      id,
      name: source.name,
      type: source.type,
      path: source.path,
      enabled: source.enabled ?? true,
      config: source.config,
      createdAt: new Date(),
      lastIndexed: undefined
    };
    
    console.log('Created new source object:', newSource);
    this.sources.push(newSource);
    await this.saveCollection('sources', this.sources);
    console.log(`Source added with ID: ${id}, total sources: ${this.sources.length}`);
    return id;
  }

  async getSources(): Promise<MediaSource[]> {
    return [...this.sources].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async getSource(sourceId: string): Promise<MediaSource | undefined> {
    return this.sources.find(s => s.id === sourceId);
  }

  async updateSource(sourceId: string, updates: Partial<MediaSource>): Promise<void> {
    const index = this.sources.findIndex(s => s.id === sourceId);
    if (index !== -1) {
      this.sources[index] = { ...this.sources[index], ...updates };
      await this.saveCollection('sources', this.sources);
    }
  }

  async removeSource(sourceId: string): Promise<void> {
    const index = this.sources.findIndex(s => s.id === sourceId);
    if (index !== -1) {
      this.sources.splice(index, 1);
      
      // Remove related items and jobs
      const itemIndices = this.items.map((item, i) => item.sourceId === sourceId ? i : -1).filter(i => i !== -1);
      itemIndices.reverse().forEach(i => this.items.splice(i, 1));
      
      const jobIndices = this.jobs.map((job, i) => job.sourceId === sourceId ? i : -1).filter(i => i !== -1);
      jobIndices.reverse().forEach(i => this.jobs.splice(i, 1));
      
      await Promise.all([
        this.saveCollection('sources', this.sources),
        this.saveCollection('items', this.items),
        this.saveCollection('jobs', this.jobs)
      ]);
    }
  }

  // Media Items
  async addMediaItem(item: Omit<MediaItem, 'id'>): Promise<string> {
    console.log(`[DB] Adding media item: ${item.name} (${item.path})`);
    
    // Check if item already exists with the same path and sourceId
    const existingIndex = this.items.findIndex(i => 
      i.sourceId === item.sourceId && i.path === item.path
    );
    
    if (existingIndex !== -1) {
      // Update existing item
      const id = this.items[existingIndex].id;
      console.log(`[DB] Updating existing item with ID: ${id}`);
      this.items[existingIndex] = { ...item, id, modifiedAt: new Date() };
      await this.saveCollection('items', this.items);
      console.log(`[DB] Item updated and saved`);
      return id;
    } else {
      // Add new item
      const id = crypto.randomUUID();
      const newItem: MediaItem = {
        ...item,
        id,
        createdAt: new Date(),
        modifiedAt: new Date()
      };
      
      console.log(`[DB] Creating new item with ID: ${id}`);
      this.items.push(newItem);
      await this.saveCollection('items', this.items);
      console.log(`[DB] New item added and saved. Total items: ${this.items.length}`);
      return id;
    }
  }

  async getMediaItems(sourceId?: string): Promise<MediaItem[]> {
    if (sourceId) {
      return this.items.filter(item => item.sourceId === sourceId);
    }
    return [...this.items];
  }

  async getItemByPath(filePath: string): Promise<MediaItem | null> {
    const item = this.items.find(item => item.path === filePath);
    return item || null;
  }

  async removeMediaItems(sourceId: string): Promise<void> {
    this.items = this.items.filter(item => item.sourceId !== sourceId);
    await this.saveCollection('items', this.items);
  }

  // Search
  async searchMediaItems(query: string, limit?: number): Promise<MediaItem[]> {
    console.log(`[DB] Semantic search in ${this.items.length} items for query: "${query}"`);
    
    // Semantic search implementation using descriptions
    const results = this.items.filter(item => {
      const nameMatch = item.name.toLowerCase().includes(query.toLowerCase());
      const pathMatch = item.path.toLowerCase().includes(query.toLowerCase());
      const descriptionMatch = item.description && item.description.toLowerCase().includes(query.toLowerCase());
      const match = nameMatch || pathMatch || descriptionMatch;
      
      if (match) {
        console.log(`[DB] Match found: ${item.name} (name: ${nameMatch}, path: ${pathMatch}, description: ${descriptionMatch})`);
        if (descriptionMatch && item.description) {
          console.log(`[DB]   Description: ${item.description.substring(0, 150)}...`);
        }
      }
      
      return match;
    });
    
    // Sort results by relevance (description matches first, then name, then path)
    results.sort((a, b) => {
      const aDescMatch = a.description && a.description.toLowerCase().includes(query.toLowerCase());
      const bDescMatch = b.description && b.description.toLowerCase().includes(query.toLowerCase());
      const aNameMatch = a.name.toLowerCase().includes(query.toLowerCase());
      const bNameMatch = b.name.toLowerCase().includes(query.toLowerCase());
      
      if (aDescMatch && !bDescMatch) return -1;
      if (!aDescMatch && bDescMatch) return 1;
      if (aNameMatch && !bNameMatch) return -1;
      if (!aNameMatch && bNameMatch) return 1;
      return 0;
    });
    
    console.log(`[DB] Semantic search complete: ${results.length} matches found`);
    return limit ? results.slice(0, limit) : results;
  }

  // Vector search (using embeddings) with enhanced ranking
  async vectorSearch(queryEmbedding: Float32Array, limit = 10, query?: string): Promise<MediaItem[]> {
    console.log(`[DB] Using enhanced vector search algorithm`);
    
    // Use the enhanced vector search algorithm
    const searchResults = EnhancedVectorSearch.searchSimilar(
      this.items, 
      queryEmbedding, 
      query || '', 
      limit
    );
    
    // Convert search results back to MediaItem array
    const mediaItems: MediaItem[] = [];
    for (const result of searchResults) {
      const item = this.items.find(i => i.id === result.id);
      if (item) {
        mediaItems.push(item);
      }
    }
    
    return mediaItems;
  }


  // Indexing Jobs
  async createJob(job: { sourceId: string; config?: Record<string, any> }): Promise<string> {
    const id = crypto.randomUUID();
    const newJob: IndexingJob = {
      id,
      sourceId: job.sourceId,
      status: 'pending',
      progress: 0,
      startedAt: undefined,
      completedAt: undefined
    };
    
    this.jobs.push(newJob);
    await this.saveCollection('jobs', this.jobs);
    return id;
  }

  async getJobs(sourceId?: string): Promise<IndexingJob[]> {
    if (sourceId) {
      return this.jobs.filter(job => job.sourceId === sourceId);
    }
    return [...this.jobs];
  }

  async updateJobStatus(jobId: string, status: IndexingJob['status'], progress?: number): Promise<void> {
    const index = this.jobs.findIndex(job => job.id === jobId);
    if (index !== -1) {
      const updates: Partial<IndexingJob> = { status };
      
      if (progress !== undefined) {
        updates.progress = progress;
      }
      
      if (status === 'running' && !this.jobs[index].startedAt) {
        updates.startedAt = new Date();
      } else if (status === 'completed' || status === 'failed') {
        updates.completedAt = new Date();
        
        // Update source lastIndexed timestamp if job completed successfully
        if (status === 'completed') {
          const sourceIndex = this.sources.findIndex(s => s.id === this.jobs[index].sourceId);
          if (sourceIndex !== -1) {
            this.sources[sourceIndex].lastIndexed = new Date();
            await this.saveCollection('sources', this.sources);
          }
        }
      }
      
      this.jobs[index] = { ...this.jobs[index], ...updates };
      await this.saveCollection('jobs', this.jobs);
    }
  }

  async getActiveJobs(): Promise<IndexingJob[]> {
    return this.jobs.filter(job => job.status === 'pending' || job.status === 'running');
  }

  async removeJob(jobId: string): Promise<void> {
    const index = this.jobs.findIndex(job => job.id === jobId);
    if (index !== -1) {
      this.jobs.splice(index, 1);
      await this.saveCollection('jobs', this.jobs);
    }
  }

  // Stats
  async getStats(): Promise<{ totalSources: number; totalItems: number; activeJobs: number }> {
    const activeJobs = await this.getActiveJobs();
    
    return {
      totalSources: this.sources.length,
      totalItems: this.items.length,
      activeJobs: activeJobs.length
    };
  }
}
