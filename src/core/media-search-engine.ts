import { DatabaseManager } from './database';
import { MediaSource, SearchQuery, SearchResult } from './types';
import { LLMProvider, LLMProviderFactory } from './llm-provider';
import { getMimeType } from './utils';

export class MediaSearchEngine {
  private db: DatabaseManager;
  private initialized = false;
  private llmProvider: LLMProvider;

  constructor(_dbPath?: string, providerType: 'ollama' | 'litellm' = 'ollama', providerConfig?: any) {
    this.db = new DatabaseManager();
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
      const jobId = await this.db.createJob({ sourceId });
      
      // Start indexing in background (simplified for now)
      this.performIndexing(jobId, sourceId).catch(error => {
        console.error('Indexing failed:', error);
        this.db.updateJobStatus(jobId, 'failed', 0);
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
    try {
      // 1. Get the source configuration
      const sourceResult = await this.db.getSource(sourceId);
      if (!sourceResult) {
        throw new Error(`Source not found: ${sourceId}`);
      }
      
      const source = sourceResult;
      console.log(`Starting indexing for source: ${source.name} (${source.path})`);
      
      // Update job status to running
      await this.db.updateJobStatus(jobId, 'running');
      
      // 2. Import the file scanner
      const { scanDirectory } = await import('./file-scanner');
      
      // 3. Scan the directory for media files
      const mediaFiles = await scanDirectory(source.path, true, 
        (scannedCount, totalFiles) => {
          // Update job progress
          const progress = totalFiles > 0 ? Math.floor((scannedCount / totalFiles) * 50) : 0;
          this.db.updateJobStatus(jobId, 'running', progress);
        }
      );
      
      console.log(`Found ${mediaFiles.length} media files in ${source.path}`);
      
      // 4. Process each file and generate embeddings
      let processedCount = 0;
      for (const file of mediaFiles) {
        try {
          console.log(`Processing file: ${file.path}`);
          
          // Generate embedding for image
          const embedding = await this.llmProvider.generateImageEmbedding(file.path);
          
          // Store the media item with embedding in the database
          await this.db.addMediaItem({
            sourceId,
            path: file.path,
            name: file.name,
            type: file.type,
            size: file.size,
            createdAt: file.lastModified,
            modifiedAt: file.lastModified,
            mimeType: getMimeType(file.extension),
            embedding
          });
          
          processedCount++;
          
          // Update job progress (50-100%)
          const progress = 50 + Math.floor((processedCount / mediaFiles.length) * 50);
          await this.db.updateJobStatus(jobId, 'running', progress);
          
        } catch (error) {
          console.error(`Error processing file ${file.path}:`, error);
          // Continue with next file
        }
      }
      
      // 5. Complete the job
      await this.db.updateJobStatus(jobId, 'completed', 100);
      await this.db.updateSource(sourceId, { lastIndexed: new Date() });
      console.log(`Indexing completed for source: ${source.name}`);
      
    } catch (error) {
      console.error(`Indexing failed for source ${sourceId}:`, error);
      await this.db.updateJobStatus(jobId, 'failed');
    }
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
      const items = await this.db.searchMediaItems(query.query, query.limit);
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
  async getSuggestions(query: string, limit: number = 2): Promise<{ success: boolean; suggestions?: string[]; error?: string }> {
    try {
      // Simplified implementation
      const suggestions = [];
      for (let i = 1; i <= limit; i++) {
        suggestions.push(`${query} suggestion ${i}`);
      }
      return { success: true, suggestions };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  // Update concurrency settings
  async updateConcurrency(_limit: number): Promise<{ success: boolean; error?: string }> {
    try {
      // This will be handled by the main process
      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  // Get configuration
  async getConfiguration(): Promise<{ success: boolean; config?: any; error?: string }> {
    try {
      // This will be handled by the main process
      return { success: true, config: {} };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }
  
  // Stop indexing
  async stopIndexing(jobId: string): Promise<void> {
    await this.db.updateJobStatus(jobId, 'cancelled');
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
      
      // Get total items count
      const allItems = await this.db.getMediaItems();
      
      return {
        success: true,
        stats: {
          totalSources: sources.length,
          totalItems: allItems.length,
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

  // No explicit close needed for file-based database
  close(): void {
    // FileDatabase doesn't require explicit closing
    console.log('MediaSearchEngine closed');
  }
}
