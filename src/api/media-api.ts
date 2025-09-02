import { MediaSearchEngine } from '../core/media-search-engine';
import { MediaSource, SearchQuery, SearchResult } from '../core/types';

// Singleton instance for the web interface
let engineInstance: MediaSearchEngine | null = null;

export class MediaAPI {
  private static engine: MediaSearchEngine;

  static async initialize(dbPath?: string): Promise<void> {
    if (!engineInstance) {
      engineInstance = new MediaSearchEngine(dbPath);
      await engineInstance.initialize();
    }
    this.engine = engineInstance;
  }

  static async addSource(name: string, type: string, path: string, config?: any): Promise<{ success: boolean; sourceId?: string; error?: string }> {
    return this.engine.addSource({ name, type: type as 'local' | 'remote', path, config });
  }

  static async getSources(): Promise<{ success: boolean; sources?: MediaSource[]; error?: string }> {
    return this.engine.getSources();
  }

  static async removeSource(sourceId: string): Promise<{ success: boolean; error?: string }> {
    return this.engine.removeSource(sourceId);
  }

  static async startIndexing(sourceId: string): Promise<{ success: boolean; jobId?: string; error?: string }> {
    return this.engine.startIndexing(sourceId);
  }

  static async stopIndexing(jobId: string): Promise<{ success: boolean; error?: string }> {
    try {
      await this.engine.stopIndexing(jobId);
      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : String(error) 
      };
    }
  }

  static async search(query: SearchQuery): Promise<{ success: boolean; result?: SearchResult; error?: string }> {
    try {
      const result = await this.engine.search(query);
      return { success: true, result };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : String(error) 
      };
    }
  }

  static async searchText(text: string, limit?: number): Promise<{ success: boolean; result?: SearchResult; error?: string }> {
    try {
      const result = await this.engine.searchText(text, limit);
      return { success: true, result };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : String(error) 
      };
    }
  }

  static async getSuggestions(query: string, limit?: number): Promise<{ success: boolean; suggestions?: string[]; error?: string }> {
    try {
      const suggestions = await this.engine.getSuggestions(query, limit);
      return { success: true, suggestions };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : String(error) 
      };
    }
  }

  static async getStats(): Promise<{ success: boolean; stats?: {
    totalItems: number;
    itemsByType: Record<string, number>;
    itemsBySource: Record<string, number>;
    itemsWithEmbeddings: number;
    sources: number;
    ollamaAvailable: boolean;
  }; error?: string }> {
    try {
      const stats = await this.engine.getStats();
      return { success: true, stats };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : String(error) 
      };
    }
  }

  static async getIndexingStatus(): Promise<{ success: boolean; activeJobs?: string[]; error?: string }> {
    try {
      const activeJobs = await this.engine.getIndexingStatus();
      return { success: true, activeJobs };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : String(error) 
      };
    }
  }

  static async isOllamaAvailable(): Promise<{ success: boolean; available?: boolean; error?: string }> {
    try {
      const available = await this.engine.isOllamaAvailable();
      return { success: true, available };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : String(error) 
      };
    }
  }

  static async close(): Promise<void> {
    if (engineInstance) {
      await engineInstance.close();
      engineInstance = null;
    }
  }
}
