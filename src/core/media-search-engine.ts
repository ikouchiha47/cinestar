import { DatabaseManager } from './database';
import { MediaSource, MediaItem, SearchQuery, SearchResult, IndexingJob } from './types';

export class MediaSearchEngine {
  private db: DatabaseManager;
  private initialized = false;

  constructor(dbPath?: string) {
    this.db = new DatabaseManager(dbPath);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
  }

  // Source Management
  async addSource(source: {
    name: string;
    type: 'local' | 'remote';
    path: string;
    enabled?: boolean;
    config?: Record<string, any>;
  }): Promise<{ success: boolean; sourceId?: string; error?: string }> {
    try {
      const sourceId = await this.db.addSource({
        name: source.name,
        type: source.type,
        path: source.path,
        enabled: source.enabled ?? true,
        config: source.config
      });
      
      return { success: true, sourceId };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  async getSources(): Promise<{ success: boolean; sources?: MediaSource[]; error?: string }> {
    try {
      const sources = await this.db.getSources();
      return { success: true, sources };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  async removeSource(sourceId: string): Promise<{ success: boolean; error?: string }> {
    try {
      await this.db.removeSource(sourceId);
      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  // Indexing
  async startIndexing(sourceId: string): Promise<{ success: boolean; jobId?: string; error?: string }> {
    try {
      const jobId = await this.db.createIndexingJob(sourceId);
      
      // Start indexing in background (simplified for now)
      this.performIndexing(jobId, sourceId).catch(error => {
        console.error('Indexing failed:', error);
        this.db.completeJob(jobId, false, error.message);
      });
      
      return { success: true, jobId };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  private async performIndexing(jobId: string, sourceId: string): Promise<void> {
    // Simplified indexing - in real implementation this would:
    // 1. Get the source configuration
    // 2. Use appropriate plugin to scan files
    // 3. Generate embeddings for each file
    // 4. Store in database
    
    // For now, just simulate completion
    await new Promise(resolve => setTimeout(resolve, 2000));
    await this.db.completeJob(jobId, true);
    await this.db.updateSourceLastIndexed(sourceId);
  }

  async getIndexingStatus(): Promise<{ success: boolean; activeJobs?: string[]; error?: string }> {
    try {
      const jobs = await this.db.getActiveJobs();
      const activeJobs = jobs.map(job => job.id);
      return { success: true, activeJobs };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  // Search
  async search(query: SearchQuery): Promise<{ success: boolean; results?: SearchResult; error?: string }> {
    try {
      const startTime = Date.now();
      const items = await this.db.searchItems(query.query, query.limit, query.offset);
      const executionTime = Date.now() - startTime;
      
      const results: SearchResult = {
        items,
        total: items.length,
        query: query.query,
        executionTime,
        suggestions: []
      };
      
      return { success: true, results };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  // Ollama Integration (placeholder)
  async isOllamaAvailable(): Promise<{ success: boolean; available?: boolean; error?: string }> {
    try {
      // Simplified check - in real implementation would ping Ollama API
      return { success: true, available: false };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  // Statistics
  async getStats(): Promise<{ 
    success: boolean; 
    stats?: { 
      totalSources: number; 
      totalItems: number; 
      activeJobs: number; 
    }; 
    error?: string; 
  }> {
    try {
      const sources = await this.db.getSources();
      const activeJobs = await this.db.getActiveJobs();
      
      // Get total items count (simplified)
      let totalItems = 0;
      for (const source of sources) {
        const items = await this.db.getItemsBySource(source.id);
        totalItems += items.length;
      }
      
      return {
        success: true,
        stats: {
          totalSources: sources.length,
          totalItems,
          activeJobs: activeJobs.length
        }
      };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  close(): void {
    this.db.close();
  }
}
