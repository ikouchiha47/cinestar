import { MainDatabase } from '../core/main-database';
import { MediaSource, SearchQuery, SearchResult } from '../core/types';
import { LLMProvider, LLMProviderFactory } from '../core/llm-provider';
import { SqliteVecDatabase } from '../core/sqlite-vec-database';
import { ConfigManager } from '../core/config';
import { TwoPhaseProcessor } from '../core/two-phase-processor';
import { getMimeType, calculateFileHash } from '../core/utils';
import { ImageCompressor } from '../core/image-compressor';
import { processWithConcurrency } from '../core/concurrency-limiter';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Main process MediaAPI that uses Node.js file system directly
 * This runs in the Electron main process
 */
export class MainMediaAPI {
  private static db: MainDatabase;
  private static vectorDb: SqliteVecDatabase;
  private static processor: TwoPhaseProcessor;
  private static initialized = false;
  private static llmProvider: LLMProvider;

  static async initialize(dbPath: string, providerType: 'ollama' | 'litellm' = 'ollama', providerConfig?: any): Promise<void> {
    if (this.initialized) return;
    
    this.db = new MainDatabase(dbPath);
    await this.db.initialize();
    
    // Initialize vector database and two-phase processor
    this.vectorDb = new SqliteVecDatabase(); // Uses config-based path
    // Use configured provider
    this.llmProvider = LLMProviderFactory.createProvider(providerType, providerConfig);
    this.processor = new TwoPhaseProcessor(this.vectorDb, this.llmProvider);
    
    this.initialized = true;
    console.log('MainMediaAPI initialized with two-phase processing');
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
      
      // Check if re-indexing is required based on config
      const config = ConfigManager.getConfig();

      console.log("reindexing status", config.indexing.reindexOnStartup)
      
      if (!config.indexing.reindexOnStartup) {
        const source = await this.db.getSource(sourceId);
        if (source && source.lastIndexed) {
          console.log(`📋 [CONFIG] Skipping re-index for source ${source.name} (lastIndexed: ${source.lastIndexed})`);
          // return { success: true, jobId: 'skipped' };
        }
      }
      
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
      console.log(`🔍 [QUERY-EMBEDDING] Query text: "${query.query}"`);
      
      const queryEmbedding = await this.llmProvider.generateEmbedding(query.query);
      
      console.log(`Query embedding generated: ${queryEmbedding.length} dimensions`);
      console.log(`🔍 [QUERY-EMBEDDING] First 10 values: [${Array.from(queryEmbedding.slice(0, 10)).map(v => v.toFixed(4)).join(', ')}]`);
      console.log(`🔍 [QUERY-EMBEDDING] Embedding sum: ${Array.from(queryEmbedding).reduce((a, b) => a + b, 0).toFixed(4)}`);
      
      // Perform enhanced vector similarity search using SqliteVecDatabase
      console.log(`Performing enhanced vector similarity search...`);
      const searchResults = await this.vectorDb.searchSimilar(queryEmbedding, query.limit || 10, query.query);
      const executionTime = Date.now() - startTime;
      
      // Convert SqliteVecDatabase results to MediaItem format
      const items = searchResults.map(result => ({
        id: result.id,
        name: result.name,
        path: result.path,
        description: result.caption,
        // Add other required MediaItem properties with defaults
        sourceId: '',
        size: 0,
        type: 'image' as const,
        mimeType: 'image/jpeg',
        createdAt: new Date(),
        lastModified: new Date()
      }));
      
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

  /**
   * Update concurrency settings
   */
  static async updateConcurrencySettings(limit: number): Promise<{ success: boolean; error?: string }> {
    try {
      ConfigManager.setConcurrencyLimit(limit);
      console.log(`📋 [CONFIG] Concurrency limit updated to: ${limit}`);
      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Invalid concurrency limit' 
      };
    }
  }

  /**
   * Get current configuration
   */
  static async getConfiguration(): Promise<{ success: boolean; config?: any; error?: string }> {
    try {
      const config = ConfigManager.getConfig();
      return { success: true, config };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to get configuration' 
      };
    }
  }

  /**
   * Enable debug mode
   */
  static async enableDebugMode(saveImages: boolean = true, saveLLaVAOutputs: boolean = true, outputDir?: string): Promise<{ success: boolean; error?: string }> {
    try {
      ConfigManager.enableDebugMode(saveImages, saveLLaVAOutputs, outputDir);
      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to enable debug mode' 
      };
    }
  }

  /**
   * Disable debug mode
   */
  static async disableDebugMode(): Promise<{ success: boolean; error?: string }> {
    try {
      ConfigManager.disableDebugMode();
      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to disable debug mode' 
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
    console.log('[MAIN-MEDIA-API] isOllamaAvailable() called');
    try {
      await this.ensureInitialized();
      const providerName = this.llmProvider.getName();
      console.log('[MAIN-MEDIA-API] Provider name:', providerName);
      if (providerName === 'Ollama' || providerName === 'Subprocess Ollama') {
        console.log('[MAIN-MEDIA-API] Calling provider.isAvailable()');
        const available = await this.llmProvider.isAvailable();
        console.log('[MAIN-MEDIA-API] Provider.isAvailable() returned:', available);
        return { success: true, available };
      }
      console.log('[MAIN-MEDIA-API] Provider not Ollama-based, returning false');
      return { success: true, available: false };
    } catch (error) {
      console.error('[MAIN-MEDIA-API] Error in isOllamaAvailable:', error);
      return { 
        success: false, 
        available: false,
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  static async getImageThumbnail(imagePath: string): Promise<{ success: boolean; dataUrl?: string; error?: string }> {
    try {
      await this.ensureInitialized();
      
      // Check if file exists
      if (!fs.existsSync(imagePath)) {
        return { success: false, error: 'Image file not found' };
      }
      
      // Read the image file
      const imageBuffer = fs.readFileSync(imagePath);
      const mimeType = getMimeType(imagePath);
      
      // Convert to base64 data URL
      const base64 = imageBuffer.toString('base64');
      const dataUrl = `data:${mimeType};base64,${base64}`;
      
      return { success: true, dataUrl };
    } catch (error) {
      return { 
        success: false, 
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
      
      // 4. Process files with bounded concurrency
      console.log(`\n--- PARALLEL PROCESSING PHASE ---`);
      const CONCURRENCY_LIMIT = await ConfigManager.getOptimalConcurrency(mediaFiles.length);
      console.log(`Processing ${mediaFiles.length} files with optimal concurrency limit: ${CONCURRENCY_LIMIT}`);
      console.log(`📋 [CONFIG] Base concurrency: ${ConfigManager.getConcurrencyLimit()}, Optimal for ${mediaFiles.length} files: ${CONCURRENCY_LIMIT}`);
      
      let processedCount = 0;
      
      const processingResults = await processWithConcurrency(
        mediaFiles,
        async (file, index) => {
          const fileStartTime = Date.now();
          try {
            console.log(`⏱️  [${index + 1}/${mediaFiles.length}] Processing: ${file.name} (${(file.size / 1024).toFixed(1)}KB)`);
            
            // Check if file already exists and hasn't changed
            const fileHash = await calculateFileHash(file.path);
            const existingItem = await this.db.getItemByPath(file.path);
            
            if (existingItem && existingItem.fileHash === fileHash) {
              console.log(`  ⏭️ [${file.name}] Skipping - already processed (hash: ${fileHash.substring(0, 8)}...)`);
              return {
                success: true,
                file: file.name,
                itemId: existingItem.id,
                skipped: true,
                timing: { total: 0, compression: 0, embedding: 0, description: 0, database: 0 }
              };
            }
            
            console.log(`  🔄 [${file.name}] ${existingItem ? 'File changed, re-processing' : 'New file'} (hash: ${fileHash.substring(0, 8)}...)`);
            
            // Generate embeddings for images using Ollama LLaVA
            let description = '';
            let embedding: Float32Array | undefined;
            let embeddingTime = 0;
            let descriptionTime = 0;
            
            let compressionTime = 0;
            let compressedPath = file.path;
            let compressionResult: any = null;
            
            if (file.type === 'image') {
              try {
                // Step 1: Compress image if needed
                if (ImageCompressor.shouldCompress(file.path, file.size)) {
                  const compressStart = Date.now();
                  console.log(`  🗜️ [${file.name}] Compressing image...`);
                  
                  // Create temp directory for compressed images
                  const tempDir = path.join(os.tmpdir(), 'driller-compressed');
                  const config = ConfigManager.getConfig();
                  const settings = ImageCompressor.getOptimalSettings(file.path, file.size, config.ai.visionModelDims);
                  
                  compressionResult = await ImageCompressor.compressImage(file.path, tempDir, settings);
                  compressedPath = compressionResult.compressedPath;
                  compressionTime = Date.now() - compressStart;
                  
                  console.log(`  ✅ [${file.name}] Compressed: ${compressionResult.compressionRatio.toFixed(1)}% savings in ${compressionTime}ms`);
                  
                  // Debug: Save compressed image if DEBUG_MODE=true
                  const debugConfig = ConfigManager.getDebugConfig();
                  if (debugConfig.enabled && debugConfig.saveCompressedImages) {
                    try {
                      await fs.promises.mkdir(debugConfig.outputDir, { recursive: true });
                      const debugImagePath = path.join(debugConfig.outputDir, `compressed_${file.name}`);
                      await fs.promises.copyFile(compressedPath, debugImagePath);
                      console.log(`  🐛 [DEBUG] Saved compressed image: ${debugImagePath}`);
                    } catch (debugError) {
                      console.warn(`  ⚠️ [DEBUG] Failed to save compressed image: ${debugError}`);
                    }
                  }
                } else {
                  console.log(`  ⏭️ [${file.name}] Skipping compression (${(file.size / 1024).toFixed(1)}KB)`);
                }
                
                // Step 2: Generate AI embeddings using compressed image
                const embeddingStart = Date.now();
                console.log(`  🔍 [${file.name}] Generating AI embedding...`);
                embedding = await this.llmProvider.generateImageEmbedding(compressedPath);
                embeddingTime = Date.now() - embeddingStart;
                console.log(`  🧠 [${file.name}] Generated embedding vector of size: ${embedding.length} in ${embeddingTime}ms`);
                
                // Step 3: Generate description using compressed image
                const descriptionStart = Date.now();
                console.log(`  📝 [${file.name}] Generating description...`);
                description = await this.llmProvider.generateImageDescription(compressedPath);
                descriptionTime = Date.now() - descriptionStart;
                console.log(`  📝 [${file.name}] Description generated in ${descriptionTime}ms: ${description.substring(0, 100)}...`);
                
                // Debug: Save LLaVA output if DEBUG_MODE=true
                const debugConfig = ConfigManager.getDebugConfig();
                if (debugConfig.enabled && debugConfig.saveLLaVAOutputs) {
                  try {
                    await fs.promises.mkdir(debugConfig.outputDir, { recursive: true });
                    const debugOutputPath = path.join(debugConfig.outputDir, `llava_output_${path.parse(file.name).name}.txt`);
                    const debugContent = `File: ${file.name}\nOriginal Size: ${(file.size / 1024).toFixed(1)}KB\nCompressed: ${compressionResult ? 'Yes' : 'No'}\n${compressionResult ? `Compressed Size: ${(compressionResult.compressedSize / 1024).toFixed(1)}KB\nCompression Ratio: ${compressionResult.compressionRatio.toFixed(1)}%\n` : ''}Processing Time: ${descriptionTime}ms\n\nVision Description:\n${description}`;
                    await fs.promises.writeFile(debugOutputPath, debugContent, 'utf8');
                    console.log(`  🐛 [DEBUG] Saved LLaVA output: ${debugOutputPath}`);
                  } catch (debugError) {
                    console.warn(`  ⚠️ [DEBUG] Failed to save LLaVA output: ${debugError}`);
                  }
                }
                
                // Clean up temporary compressed file if created
                if (compressionResult && compressedPath !== file.path) {
                  try {
                    await fs.promises.unlink(compressedPath);
                    console.log(`  🗑️ [${file.name}] Cleaned up temporary compressed file`);
                  } catch (cleanupError) {
                    console.warn(`  ⚠️ [${file.name}] Failed to cleanup temp file: ${cleanupError}`);
                  }
                }
                
              } catch (error) {
                const errorTime = Date.now() - fileStartTime;
                console.error(`  ⚠️ [${file.name}] Failed to process image after ${errorTime}ms:`, error);
                description = `Image file: ${file.name}`;
                
                // Clean up on error
                if (compressionResult && compressedPath !== file.path) {
                  try {
                    await fs.promises.unlink(compressedPath);
                  } catch (cleanupError) {
                    // Ignore cleanup errors
                  }
                }
              }
            }
            
            // Time database insertion
            const dbStart = Date.now();
            
            // Save to MainDatabase (jobs/sources tracking)
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
            
            // Save to VectorDatabase (for search functionality)
            const mediaItem = {
              id: fileHash,
              sourceId: sourceId,
              name: file.name,
              path: file.path,
              size: file.size,
              type: file.type,
              createdAt: new Date(),
              updatedAt: new Date(),
              captionStatus: (description ? 'completed' : 'failed') as 'pending' | 'processing' | 'completed' | 'failed',
              embeddingStatus: (embedding ? 'completed' : 'failed') as 'pending' | 'processing' | 'completed' | 'failed'
            };
            
            // Add to vector database
            this.vectorDb.addMediaItem(mediaItem);
            
            // Update with caption and embedding if available
            if (description) {
              this.vectorDb.updateCaption(fileHash, description, 'completed');
            }
            if (embedding) {
              this.vectorDb.updateEmbedding(fileHash, embedding, 'completed');
            }
            
            const dbTime = Date.now() - dbStart;
            const totalTime = Date.now() - fileStartTime;
            
            console.log(`  ✅ [${file.name}] Complete in ${totalTime}ms (compression: ${compressionTime}ms, embedding: ${embeddingTime}ms, description: ${descriptionTime}ms, db: ${dbTime}ms) - ID: ${itemId}`);
            
            return { 
              success: true, 
              itemId, 
              fileName: file.name,
              timings: {
                total: totalTime,
                compression: compressionTime,
                embedding: embeddingTime,
                description: descriptionTime,
                database: dbTime
              }
            };
          } catch (error) {
            const errorTime = Date.now() - fileStartTime;
            console.error(`  ✗ [${file.name}] Error processing file after ${errorTime}ms:`, error);
            return { 
              success: false, 
              error: error instanceof Error ? error.message : String(error), 
              fileName: file.name,
              timings: { total: errorTime, compression: 0, embedding: 0, description: 0, database: 0 }
            };
          }
        },
        CONCURRENCY_LIMIT,
        async (completed, total, file) => {
          processedCount = completed;
          
          // Update job progress (50-100%)
          const progress = 50 + Math.floor((completed / total) * 50);
          await this.db.updateJobStatus(jobId, 'running', progress);
          
          if (completed % 5 === 0 || completed === total) {
            console.log(`  📊 Progress: ${completed}/${total} files (${progress}%) - Latest: ${file.name}`);
          }
        }
      );
      
      // Calculate timing statistics
      const successfulResults = processingResults.filter((r: any) => r.success);
      const failedResults = processingResults.filter((r: any) => !r.success);
      
      if (successfulResults.length > 0) {
        const totalCompressionTime = successfulResults.reduce((sum: number, r: any) => sum + (r.timings?.compression || 0), 0);
        const totalEmbeddingTime = successfulResults.reduce((sum: number, r: any) => sum + (r.timings?.embedding || 0), 0);
        const totalDescriptionTime = successfulResults.reduce((sum: number, r: any) => sum + (r.timings?.description || 0), 0);
        const totalDbTime = successfulResults.reduce((sum: number, r: any) => sum + (r.timings?.database || 0), 0);
        const avgCompressionTime = totalCompressionTime / successfulResults.length;
        const avgEmbeddingTime = totalEmbeddingTime / successfulResults.length;
        const avgDescriptionTime = totalDescriptionTime / successfulResults.length;
        const avgDbTime = totalDbTime / successfulResults.length;
        
        console.log(`\n📊 [TIMING SUMMARY]`);
        console.log(`   Successful: ${successfulResults.length}/${mediaFiles.length} files`);
        console.log(`   Failed: ${failedResults.length}/${mediaFiles.length} files`);
        console.log(`   Average compression time: ${avgCompressionTime.toFixed(0)}ms`);
        console.log(`   Average embedding time: ${avgEmbeddingTime.toFixed(0)}ms`);
        console.log(`   Average description time: ${avgDescriptionTime.toFixed(0)}ms`);
        console.log(`   Average database time: ${avgDbTime.toFixed(0)}ms`);
        console.log(`   Total compression time: ${totalCompressionTime.toFixed(0)}ms`);
        console.log(`   Total AI processing time: ${(totalEmbeddingTime + totalDescriptionTime).toFixed(0)}ms`);
        console.log(`   Total database time: ${totalDbTime.toFixed(0)}ms`);
      }
      
      console.log(`✅ Parallel processing complete: ${processedCount}/${mediaFiles.length} files processed`);
      
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

  /**
   * Index source using two-phase processing
   */
  static async indexSourceTwoPhase(sourceId: string): Promise<{ success: boolean; error?: string }> {
    try {
      await this.ensureInitialized();
      
      const source = await this.db.getSource(sourceId);
      if (!source) {
        return { success: false, error: 'Source not found' };
      }

      console.log(`🚀 [TWO-PHASE] Starting indexing for source: ${source.name}`);
      
      // Scan for media files
      const files = await this.scanMediaFiles(source.path);
      console.log(`📁 [TWO-PHASE] Found ${files.length} media files`);
      
      // Add files to two-phase processor
      const mediaItems = files.map(file => ({
        id: this.generateId(),
        sourceId: sourceId,
        name: path.basename(file.path),
        path: file.path,
        size: file.size,
        type: file.type
      }));
      
      this.processor.addMediaItems(mediaItems);
      
      // Run processing phases
      await this.processor.runProcessing(3, 5); // Small batches to avoid overwhelming Ollama
      
      const stats = this.processor.getStats();
      console.log(`✅ [TWO-PHASE] Indexing completed. Phase 1: ${stats.phase1.completed}/${stats.phase1.total}, Phase 2: ${stats.phase2.completed}/${stats.phase2.total}`);
      
      return { success: true };
    } catch (error) {
      console.error('Error in two-phase indexing:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  /**
   * Search using vector database
   */
  static async searchVector(query: string, limit: number = 10): Promise<{ success: boolean; results?: any[]; error?: string }> {
    try {
      await this.ensureInitialized();
      
      const results = await this.processor.search(query, limit);
      
      return {
        success: true,
        results: results.map(r => ({
          id: r.item.id,
          name: r.item.name,
          path: r.item.path,
          caption: r.item.caption,
          similarity: r.similarity,
          type: r.item.type,
          size: r.item.size
        }))
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get two-phase processing statistics
   */
  static async getTwoPhaseStats(): Promise<{ success: boolean; stats?: any; error?: string }> {
    try {
      await this.ensureInitialized();
      
      const stats = this.processor.getStats();
      const vectorStats = this.vectorDb.getStats();
      
      return {
        success: true,
        stats: {
          twoPhase: stats,
          database: vectorStats
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Process Phase 1 only (captions)
   */
  static async processPhase1(batchSize: number = 5): Promise<{ success: boolean; error?: string }> {
    try {
      await this.ensureInitialized();
      await this.processor.processPhase1(batchSize);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Process Phase 2 only (embeddings)
   */
  static async processPhase2(batchSize: number = 10): Promise<{ success: boolean; error?: string }> {
    try {
      await this.ensureInitialized();
      await this.processor.processPhase2(batchSize);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  static async close(): Promise<void> {
    if (this.vectorDb) {
      this.vectorDb.close();
    }
    console.log('MainMediaAPI closed');
  }
}
