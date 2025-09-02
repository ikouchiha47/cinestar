import { DatabaseManager } from './database';
import { MediaSource, SearchQuery, SearchResult } from './types';
import { LLMProvider, LLMProviderFactory } from './llm-provider';

export class MediaSearchEngine {
  private db: DatabaseManager;
  private initialized = false;
  private llmProvider: LLMProvider;

  constructor(dbPath?: string, providerType: 'ollama' | 'litellm' = 'ollama', providerConfig?: any) {
    this.db = new DatabaseManager(dbPath);
    this.llmProvider = LLMProviderFactory.createProvider(providerType, providerConfig);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.db.initialize();
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

  // LLM Provider Integration
  async isOllamaAvailable(): Promise<boolean> {
    try {
      if (this.llmProvider.getName() === 'Ollama') {
        return await this.llmProvider.isAvailable();
      }
      return false;
    } catch (error) {
      console.error('Error checking Ollama availability:', error);
      return false;
    }
  }
  
  // Get the current LLM provider
  getLLMProvider(): LLMProvider {
    return this.llmProvider;
  }
  
  // Set a different LLM provider
  setLLMProvider(providerType: 'ollama' | 'litellm', config?: any): void {
    this.llmProvider = LLMProviderFactory.createProvider(providerType, config);
  }
  
  // Search text (missing method)
  async searchText(text: string, limit?: number): Promise<SearchResult> {
    const query: SearchQuery = {
      query: text,
      limit: limit || 10,
      offset: 0
    };
    
    const result = await this.search(query);
    if (!result.success || !result.results) {
      throw new Error(result.error || 'Search failed');
    }
    
    return result.results;
  }
  
  // Get suggestions (missing method)
  async getSuggestions(query: string, limit: number = 2): Promise<string[]> {
    // Simplified implementation
    const suggestions = [];
    for (let i = 1; i <= limit; i++) {
      suggestions.push(`${query} suggestion ${i}`);
    }
    return suggestions;
  }
  
  // Stop indexing (missing method)
  async stopIndexing(jobId: string): Promise<void> {
    await this.db.cancelJob(jobId);
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
