import { MainDatabase } from '../core/main-database';
import { MediaSource, SearchQuery, SearchResult } from '../core/types';
import { LLMProvider, LLMProviderFactory } from '../core/llm-provider';
import { getMimeType } from '../core/utils';

/**
 * Main process MediaAPI that uses Node.js file system directly
 * This runs in the Electron main process
 */
export class MainMediaAPI {
  private static db: MainDatabase;
  private static initialized = false;
  private static llmProvider: LLMProvider;

  static async initialize(dbPath: string, providerType: 'ollama' | 'litellm' = 'ollama', providerConfig?: any): Promise<void> {
    if (this.initialized) return;
    
    this.db = new MainDatabase(dbPath);
    await this.db.initialize();
    this.llmProvider = LLMProviderFactory.createProvider(providerType, providerConfig);
    this.initialized = true;
    console.log('MainMediaAPI initialized');
  }

  private static async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      throw new Error('MainMediaAPI not initialized');
    }
  }

  static async addSource(name: string, type: string, path: string, config?: any): Promise<{ success: boolean; sourceId?: string; error?: string }> {
    try {
      await this.ensureInitialized();
      const sourceId = await this.db.addSource({
        name,
        type: type as 'local' | 'remote',
        path,
        enabled: true,
        config
      });
      return { success: true, sourceId };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  static async getSources(): Promise<{ success: boolean; sources?: MediaSource[]; error?: string }> {
    try {
      await this.ensureInitialized();
      const sources = await this.db.getSources();
      return { success: true, sources };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  static async removeSource(sourceId: string): Promise<{ success: boolean; error?: string }> {
    try {
      await this.ensureInitialized();
      await this.db.removeSource(sourceId);
      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  static async startIndexing(sourceId: string): Promise<{ success: boolean; jobId?: string; error?: string }> {
    try {
      await this.ensureInitialized();
      const jobId = await this.db.createJob({ sourceId });
      
      // Start indexing in background
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

  static async stopIndexing(jobId: string): Promise<{ success: boolean; error?: string }> {
    try {
      await this.ensureInitialized();
      await this.db.updateJobStatus(jobId, 'cancelled');
      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : String(error) 
      };
    }
  }

  static async getIndexingStatus(): Promise<{ success: boolean; activeJobs: string[]; error?: string }> {
    try {
      await this.ensureInitialized();
      const jobs = await this.db.getActiveJobs();
      const activeJobs = jobs.map(job => job.id);
      return { success: true, activeJobs };
    } catch (error) {
      return { 
        success: false, 
        activeJobs: [],
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  static async search(query: SearchQuery): Promise<{ success: boolean; results?: SearchResult; error?: string }> {
    try {
      console.log(`\n=== VECTOR SEARCH START ===`);
      console.log(`Query: "${query.query}"`);
      console.log(`Limit: ${query.limit || 10}`);
      
      await this.ensureInitialized();
      const startTime = Date.now();
      
      // Generate embedding for the search query
      console.log(`Generating query embedding...`);
      const queryEmbedding = await this.llmProvider.generateEmbedding(query.query);
      console.log(`Query embedding generated: ${queryEmbedding.length} dimensions`);
      
      // Perform vector similarity search
      console.log(`Performing vector similarity search...`);
      const items = await this.db.vectorSearch(queryEmbedding, query.limit || 10);
      const executionTime = Date.now() - startTime;
      
      console.log(`Vector search results: ${items.length} items found in ${executionTime}ms`);
      if (items.length > 0) {
        console.log(`Top result: ${items[0].name} (${items[0].path})`);
        if (items[0].description) {
          console.log(`  Description: ${items[0].description.substring(0, 100)}...`);
        }
      }
      
      const results: SearchResult = {
        items,
        total: items.length,
        query: query.query,
        executionTime,
        suggestions: []
      };
      
      console.log(`=== VECTOR SEARCH COMPLETE ===\n`);
      return { success: true, results };
    } catch (error) {
      console.error(`\n✗ VECTOR SEARCH FAILED:`, error);
      console.log(`=== VECTOR SEARCH FAILED ===\n`);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  static async searchText(text: string, limit?: number): Promise<{ success: boolean; results?: SearchResult; error?: string }> {
    try {
      await this.ensureInitialized();
      const query: SearchQuery = {
        query: text,
        limit: limit || 10,
        offset: 0
      };
      
      const result = await this.search(query);
      return result;
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : String(error) 
      };
    }
  }

  static async getSuggestions(query: string, limit: number = 2): Promise<{ success: boolean; suggestions?: string[]; error?: string }> {
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

  static async getStats(): Promise<{ success: boolean; stats?: {
    totalSources: number;
    totalItems: number;
    activeJobs: number;
  }; error?: string }> {
    try {
      await this.ensureInitialized();
      const stats = await this.db.getStats();
      return { success: true, stats };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  static async isOllamaAvailable(): Promise<{ success: boolean; available: boolean; error?: string }> {
    try {
      await this.ensureInitialized();
      if (this.llmProvider.getName() === 'Ollama') {
        const available = await this.llmProvider.isAvailable();
        return { success: true, available };
      }
      return { success: true, available: false };
    } catch (error) {
      return { 
        success: false, 
        available: false,
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  private static async performIndexing(jobId: string, sourceId: string): Promise<void> {
    try {
      console.log(`\n=== INDEXING START ===`);
      console.log(`Job ID: ${jobId}`);
      console.log(`Source ID: ${sourceId}`);
      
      // 1. Get the source configuration
      const source = await this.db.getSource(sourceId);
      if (!source) {
        throw new Error(`Source not found: ${sourceId}`);
      }
      
      console.log(`Source details:`, {
        name: source.name,
        path: source.path,
        type: source.type,
        recursive: source.config?.recursive
      });
      
      // Update job status to running
      await this.db.updateJobStatus(jobId, 'running');
      console.log(`Job status updated to 'running'`);
      
      // 2. Import the file scanner
      const { scanDirectory } = await import('../core/file-scanner');
      console.log(`File scanner imported successfully`);
      
      // 3. Scan for media files
      console.log(`\n--- SCANNING PHASE ---`);
      console.log(`Scanning directory: ${source.path}`);
      console.log(`Recursive scan: ${source.config?.recursive !== false}`);
      
      const mediaFiles = await scanDirectory(source.path, source.config?.recursive !== false);
      console.log(`\n--- SCAN RESULTS ---`);
      console.log(`Found ${mediaFiles.length} media files`);
      
      if (mediaFiles.length > 0) {
        console.log(`First 3 files found:`);
        mediaFiles.slice(0, 3).forEach((file, index) => {
          console.log(`  ${index + 1}. ${file.name} (${file.size} bytes, ${file.type})`);
        });
      }
      
      if (mediaFiles.length === 0) {
        console.log(`No media files found, completing job`);
        await this.db.updateJobStatus(jobId, 'completed', 100);
        console.log(`=== INDEXING COMPLETE (NO FILES) ===\n`);
        return;
      }
      
      // Update job progress (0-50% for scanning)
      await this.db.updateJobStatus(jobId, 'running', 50);
      console.log(`Job progress updated to 50% (scanning complete)`);
      
      // 4. Process each file
      console.log(`\n--- PROCESSING PHASE ---`);
      let processedCount = 0;
      for (const file of mediaFiles) {
        try {
          console.log(`Processing file ${processedCount + 1}/${mediaFiles.length}: ${file.name}`);
        
        // Generate embeddings for images using Ollama LLaVA
        let description = '';
        let embedding: Float32Array | undefined;
        if (file.type === 'image') {
          try {
            console.log(`  🔍 Generating AI embedding for ${file.name}...`);
            embedding = await this.llmProvider.generateImageEmbedding(file.path);
            console.log(`  🧠 Generated embedding vector of size: ${embedding.length}`);
            
            // Also generate description for better search
            description = await this.llmProvider.generateImageDescription(file.path);
            console.log(`  📝 Description: ${description.substring(0, 100)}...`);
          } catch (error) {
            console.error(`  ⚠️ Failed to generate embedding for ${file.name}:`, error);
            description = `Image file: ${file.name}`;
          }
        }
        
        const itemId = await this.db.addMediaItem({
          sourceId,
          name: file.name,
          path: file.path,
          size: file.size,
          type: file.type,
          mimeType: getMimeType(file.path),
          createdAt: new Date(),
          modifiedAt: file.lastModified,
          description,
          embedding,
          metadata: {}
        });
        console.log(`  ✓ Added to database with ID: ${itemId}`);
          processedCount++;
          
          // Update job progress (50-100%)
          const progress = 50 + Math.floor((processedCount / mediaFiles.length) * 50);
          await this.db.updateJobStatus(jobId, 'running', progress);
          
          if (processedCount % 10 === 0 || processedCount === mediaFiles.length) {
            console.log(`  Progress: ${processedCount}/${mediaFiles.length} files (${progress}%)`);
          }
          
        } catch (error) {
          console.error(`  ✗ Error processing file ${file.path}:`, error);
          // Continue with next file
        }
      }
      
      // 5. Complete the job
      console.log(`\n--- COMPLETION PHASE ---`);
      await this.db.updateJobStatus(jobId, 'completed', 100);
      await this.db.updateSource(sourceId, { lastIndexed: new Date() });
      
      console.log(`✓ Job completed successfully`);
      console.log(`✓ Source lastIndexed timestamp updated`);
      console.log(`✓ Total files processed: ${processedCount}`);
      console.log(`=== INDEXING COMPLETE ===\n`);
      
    } catch (error) {
      console.error(`\n✗ INDEXING FAILED for source ${sourceId}:`, error);
      await this.db.updateJobStatus(jobId, 'failed');
      console.log(`=== INDEXING FAILED ===\n`);
    }
  }

  static async close(): Promise<void> {
    // No explicit close needed for file-based database
    console.log('MainMediaAPI closed');
  }
}
