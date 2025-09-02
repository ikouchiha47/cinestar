import { MediaSearchEngine } from '../core/media-search-engine';
import { MediaSource, SearchQuery, SearchResult } from '../core/types';

// Singleton instance for the web interface
let engineInstance: MediaSearchEngine | null = null;

export class MediaAPI {
  private static engine: MediaSearchEngine;

  static async initialize(dbPath?: string, providerType: 'ollama' | 'litellm' = 'ollama', providerConfig?: any): Promise<void> {
    if (!engineInstance) {
      engineInstance = new MediaSearchEngine(dbPath, providerType, providerConfig);
      await engineInstance.initialize();
    }
    this.engine = engineInstance;
  }
  
  static setLLMProvider(providerType: 'ollama' | 'litellm', config?: any): void {
    if (this.engine) {
      this.engine.setLLMProvider(providerType, config);
    }
  }
  
  static getLLMProviderInfo(): { name: string; model: string } | null {
    if (!this.engine) return null;
    
    const provider = this.engine.getLLMProvider();
    return {
      name: provider.getName(),
      model: provider.getModel()
    };
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

  static async search(query: SearchQuery): Promise<{ success: boolean; results?: SearchResult; error?: string }> {
    try {
      const response = await this.engine.search(query);
      if (response.success && response.results) {
        return { success: true, results: response.results };
      } else {
        return { success: false, error: response.error || 'Search failed' };
      }
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : String(error) 
      };
    }
  }

  static async searchText(text: string, limit?: number): Promise<{ success: boolean; results?: SearchResult; error?: string }> {
    try {
      const response = await this.engine.searchText(text, limit);
      if (response && typeof response === 'object' && 'items' in response) {
        return { success: true, results: response };
      } else {
        return { success: false, error: 'Invalid search result format' };
      }
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
    totalSources: number;
    totalItems: number;
    activeJobs: number;
  }; error?: string }> {
    try {
      const result = await this.engine.getStats();
      if (result.success && result.stats) {
        return { success: true, stats: result.stats };
      } else {
        return { success: false, error: result.error || 'Failed to get stats' };
      }
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : String(error) 
      };
    }
  }

  static async getIndexingStatus(): Promise<{ success: boolean; activeJobs: string[]; error?: string }> {
    try {
      const result = await this.engine.getIndexingStatus();
      if (result.success && result.activeJobs) {
        return { success: true, activeJobs: result.activeJobs };
      } else {
        return { success: false, activeJobs: [], error: result.error || 'Failed to get indexing status' };
      }
    } catch (error) {
      return { 
        success: false, 
        activeJobs: [],
        error: error instanceof Error ? error.message : String(error) 
      };
    }
  }

  static async isOllamaAvailable(): Promise<{ success: boolean; available: boolean; error?: string }> {
    try {
      const available = await this.engine.isOllamaAvailable();
      return { success: true, available };
    } catch (error) {
      return { 
        success: false, 
        available: false,
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
