import type { MediaSource, MediaItem, IndexingJob } from './types';

/**
 * File-based database implementation using Electron IPC
 * Stores data in JSON files via the main process
 */
export class FileDatabase {
  private sources: MediaSource[] = [];
  private items: MediaItem[] = [];
  private jobs: IndexingJob[] = [];
  private dbPath: string = '';

  constructor() {
    console.log('FileDatabase initialized with file-based persistence');
  }

  private getFilePath(collection: string): string {
    return `${this.dbPath}/${collection}.json`;
  }

  private async loadCollection<T>(collection: string): Promise<T[]> {
    try {
      const filePath = this.getFilePath(collection);
      console.log(`Loading ${collection} from:`, filePath);
      
      // Check if Electron API is available
      if (!(window as any).electronAPI) {
        console.warn('Electron API not available for loading', collection);
        return [];
      }
      
      // Check if file exists using IPC
      const exists = await (window as any).electronAPI.fileExists(filePath);
      console.log(`File ${filePath} exists:`, exists);
      if (!exists) return [];
      
      // Read file using IPC
      const data = await (window as any).electronAPI.readFile(filePath);
      console.log(`Read ${collection} data length:`, data?.length || 0);
      if (!data) return [];
      
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
      
      console.log(`Parsed ${collection}:`, parsed);
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
      
      // Write file using IPC
      await (window as any).electronAPI?.writeFile(filePath, serialized);
      console.log(`Saved ${collection} (${data.length} items)`);
    } catch (error) {
      console.error(`Failed to save ${collection}:`, error);
      throw error;
    }
  }

  async initialize(): Promise<void> {
    console.log('=== FileDatabase Initialize Start ===');
    
    // Wait for Electron API to be available (up to 5 seconds)
    let attempts = 0;
    const maxAttempts = 50; // 5 seconds with 100ms intervals
    
    while (!(window as any).electronAPI && attempts < maxAttempts) {
      console.log(`Waiting for Electron API... attempt ${attempts + 1}`);
      await new Promise(resolve => setTimeout(resolve, 100));
      attempts++;
    }
    
    console.log('Electron API available:', !!(window as any).electronAPI);
    console.log('getAppPath method available:', !!(window as any).electronAPI?.getAppPath);
    
    // Get the database path from Electron
    if ((window as any).electronAPI?.getAppPath) {
      const userDataPath = await (window as any).electronAPI.getAppPath('userData');
      this.dbPath = `${userDataPath}/driller-db`;
      console.log('Database path set to:', this.dbPath);
      
      // Ensure database directory exists
      const dirCreated = await (window as any).electronAPI.mkdir(this.dbPath);
      console.log('Database directory created/exists:', dirCreated);
    } else {
      console.warn('Electron API not available after waiting, database will not persist');
      this.dbPath = '';
    }
    
    console.log('Starting to load collections...');
    // Load existing data from files
    this.sources = await this.loadCollection<MediaSource>('sources');
    this.items = await this.loadCollection<MediaItem>('items');
    this.jobs = await this.loadCollection<IndexingJob>('jobs');
    
    console.log(`=== Load Complete: ${this.sources.length} sources, ${this.items.length} items, ${this.jobs.length} jobs ===`);
    
    if (this.sources.length > 0) {
      console.log('Sources found:', this.sources.map(s => ({ id: s.id, name: s.name, path: s.path })));
    } else {
      console.log('No sources found on initialization');
    }
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
    // Check if item already exists with the same path and sourceId
    const existingIndex = this.items.findIndex(i => 
      i.sourceId === item.sourceId && i.path === item.path
    );
    
    if (existingIndex !== -1) {
      // Update existing item
      const id = this.items[existingIndex].id;
      this.items[existingIndex] = { ...item, id, modifiedAt: new Date() };
      await this.saveCollection('items', this.items);
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
      
      this.items.push(newItem);
      await this.saveCollection('items', this.items);
      return id;
    }
  }

  async getMediaItems(sourceId?: string): Promise<MediaItem[]> {
    if (sourceId) {
      return this.items.filter(item => item.sourceId === sourceId);
    }
    return [...this.items];
  }

  async removeMediaItems(sourceId: string): Promise<void> {
    this.items = this.items.filter(item => item.sourceId !== sourceId);
    await this.saveCollection('items', this.items);
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

  async getActiveJobs(): Promise<IndexingJob[]> {
    return this.jobs.filter(job => job.status === 'pending' || job.status === 'running');
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

  async removeJob(jobId: string): Promise<void> {
    const index = this.jobs.findIndex(job => job.id === jobId);
    if (index !== -1) {
      this.jobs.splice(index, 1);
      await this.saveCollection('jobs', this.jobs);
    }
  }

  // Search
  async searchMediaItems(query: string, limit?: number): Promise<MediaItem[]> {
    // Simple text search implementation
    const results = this.items.filter(item => 
      item.name.toLowerCase().includes(query.toLowerCase()) ||
      item.path.toLowerCase().includes(query.toLowerCase())
    );
    
    return limit ? results.slice(0, limit) : results;
  }

  // Vector search (using embeddings)
  async vectorSearch(embedding: Float32Array, limit = 10): Promise<MediaItem[]> {
    // Calculate cosine similarity between the query embedding and all item embeddings
    const itemsWithSimilarity = this.items
      .filter(item => item.embedding)
      .map(item => {
        const similarity = this.cosineSimilarity(embedding, item.embedding as Float32Array);
        return { item, similarity };
      })
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
    
    return itemsWithSimilarity.map(({ item }) => item);
  }

  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
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
