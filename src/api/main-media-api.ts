import { SqliteMainDatabase } from '../core/sqlite-main-database';
import { MediaSource } from '../core/types';
import { LLMProvider, LLMProviderFactory } from '../core/llm-provider';
import { SqliteVecDatabase } from '../core/sqlite-vec-database';
import { ImageCompressor } from '../core/image-compressor';
import { ConfigManager } from '../core/config';
import { UnifiedMigrator, getDefaultDataDir } from '../core/unified-migrator';
import { getMimeType } from '../core/utils';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Minimal Main process MediaAPI for basic functionality
 * This runs in the Electron main process
 */
export class MainMediaAPI {
  // Use a common surface; implementation can be JSON-backed or SQLite-backed
  private static db: any;
  private static initialized = false;
  private static backendType: 'sqlite' | 'json' = 'sqlite';
  private static dbPathInfo: string = '';
  private static llm: LLMProvider | null = null;
  private static vecDb: SqliteVecDatabase | null = null;
  private static reconciliationInterval: NodeJS.Timeout | null = null;
  private static mainWindow: any = null; // BrowserWindow reference for IPC events

  /**
   * Set the main window reference for IPC events
   */
  static setMainWindow(window: any): void {
    this.mainWindow = window;
  }

  static async initialize(dbPath?: string): Promise<void> {
    if (this.initialized) return;
    
    // Use default data directory if no path provided (fresh install scenario)
    const dataDir = dbPath ?? getDefaultDataDir();
    
    // Force SQLite backend (JSON backend deprecated)
    // If a directory was passed, append a filename
    const isFile = path.extname(dataDir).toLowerCase() === '.db';
    const filePath = isFile ? dataDir : path.join(dataDir, 'vector.db');
    
    // Run unified database migrations for fresh installs
    console.log('[MainMediaAPI] Checking unified database migrations...');
    const migrator = new UnifiedMigrator(dataDir);
    const migrationResult = await migrator.migrate();
    
    if (!migrationResult.success) {
      throw new Error(`Unified migration failed: ${migrationResult.error}`);
    }
    
    if (migrationResult.migrationsRun.length > 0) {
      console.log(`[MainMediaAPI] Applied ${migrationResult.migrationsRun.length} migrations:`, migrationResult.migrationsRun);
      console.log(`[MainMediaAPI] Video DB: ${migrationResult.videoDB.migrationsApplied} total migrations`);
      console.log(`[MainMediaAPI] Media DB: ${migrationResult.mediaDB.migrationsApplied} total migrations`);
    }
    
    this.db = new SqliteMainDatabase(filePath);
    this.backendType = 'sqlite';
    this.dbPathInfo = filePath;
    // Initialize sqlite-vec on the same file for unified storage
    try {
      this.vecDb = new SqliteVecDatabase(filePath);
    } catch (e) {
      console.error('[MainMediaAPI] Failed to initialize sqlite-vec database:', e);
      this.vecDb = null;
    }
    await this.db.initialize();
    // Initialize LLM provider (Ollama by default)
    try {
      this.llm = LLMProviderFactory.createProvider('ollama');
    } catch (e) {
      console.warn('[MainMediaAPI] Failed to initialize LLM provider:', e);
      this.llm = null;
    }
    
    this.initialized = true;
    console.log(`[MainMediaAPI] initialized with backend=${this.backendType} path=${this.dbPathInfo}`);
  
  // Start background reconciliation service
  this.startBackgroundReconciliation();
  }

  private static async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      throw new Error('MainMediaAPI not initialized. Call initialize() first.');
    }
  }

  /**
   * Get all media sources
   */
  static async getSources(): Promise<{ success: boolean; sources?: MediaSource[]; error?: string }> {
    try {
      await this.ensureInitialized();
      const sources = await this.db.getSources();
      return { success: true, sources };
    } catch (error) {
      console.error('Failed to get sources:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Add a new media source
   */
  static async addSource(source: Omit<MediaSource, 'id'>): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      await this.ensureInitialized();
      const id = await this.db.addSource(source);
      return { success: true, id };
    } catch (error) {
      console.error('Failed to add source:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Update a media source
   */
  static async updateSource(id: string, updates: Partial<Omit<MediaSource, 'id'>>): Promise<{ success: boolean; error?: string }> {
    try {
      await this.ensureInitialized();
      await this.db.updateSource(id, updates);
      return { success: true };
    } catch (error) {
      console.error('Failed to update source:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Remove a media source
   */
  static async removeSource(sourceId: string): Promise<{ success: boolean; error?: string }> {
    try {
      await this.ensureInitialized();
      await this.db.removeSource(sourceId);
      return { success: true };
    } catch (error) {
      console.error('Failed to remove source:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Get recent media items with optional filters
   */
  static async getRecentItems(params?: { 
    sourceIds?: string[]; 
    types?: Array<'image'|'video'|'audio'>; 
    limit?: number; 
    cursor?: string; // ISO timestamp cursor for efficient pagination
    orderBy?: 'createdAt' | 'modifiedAt' | 'name' | 'size';
    orderDirection?: 'asc' | 'desc';
  }): Promise<{ success: boolean; items?: any[]; nextCursor?: string; hasMore?: boolean; error?: string }> {
    try {
      await this.ensureInitialized();
      console.log(`[MainMediaAPI] getRecentItems using backend=${this.backendType}`, params);
      
      // Map camelCase to snake_case for database
      const orderByMap: Record<string, 'created_at' | 'modified_at' | 'name' | 'size'> = {
        'createdAt': 'created_at',
        'modifiedAt': 'modified_at',
        'name': 'name',
        'size': 'size'
      };
      
      const dbOrderBy = params?.orderBy ? orderByMap[params.orderBy] || 'created_at' : 'created_at';
      
      // Use cursor-based pagination - efficient and consistent
      const result = await this.db.getMediaItemsPaginated({
        sourceIds: params?.sourceIds,
        types: params?.types,
        limit: params?.limit || 50,
        cursor: params?.cursor,
        orderBy: dbOrderBy,
        orderDirection: params?.orderDirection === 'asc' ? 'ASC' : 'DESC'
      });
      
      console.log(`[MainMediaAPI] getRecentItems returning ${result.items.length} items (hasMore: ${result.hasMore})`);
      return { 
        success: true, 
        items: result.items, 
        nextCursor: result.nextCursor,
        hasMore: result.hasMore 
      };
    } catch (error) {
      console.error('Failed to get recent items:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Legacy method with offset pagination (deprecated but kept for compatibility)
   */
  static async getRecentItemsWithOffset(params?: { 
    sourceIds?: string[]; 
    types?: Array<'image'|'video'|'audio'>; 
    limit?: number; 
    offset?: number;
    orderBy?: 'createdAt' | 'modifiedAt' | 'name' | 'size';
    orderDirection?: 'asc' | 'desc';
  }): Promise<{ success: boolean; items?: any[]; hasMore?: boolean; error?: string }> {
    try {
      await this.ensureInitialized();
      console.warn(`[MainMediaAPI] getRecentItemsWithOffset is deprecated - use cursor-based getRecentItems instead`);
      
      // Use legacy offset-based pagination (no more COUNT queries)
      const result = await this.db.getMediaItemsWithOffset({
        sourceIds: params?.sourceIds,
        types: params?.types,
        limit: params?.limit || 50,
        offset: params?.offset || 0,
        orderBy: params?.orderBy || 'created_at',
        orderDirection: params?.orderDirection === 'asc' ? 'ASC' : 'DESC'
      });
      
      console.log(`[MainMediaAPI] getRecentItemsWithOffset returning ${result.items.length} items (hasMore: ${result.hasMore})`);
      return { success: true, items: result.items, hasMore: result.hasMore };
    } catch (error) {
      console.error('Failed to get recent items with offset:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Get specific video items by path (optimized for video processing)
   */
  static async getVideosByPath(videoPath: string): Promise<{ success: boolean; items?: any[]; error?: string }> {
    try {
      await this.ensureInitialized();
      console.log(`[MainMediaAPI] getVideosByPath: ${videoPath}`);
      
      // Use database-level filtering - no more SELECT *
      const videoItems = await this.db.getMediaItemsByPath(videoPath, 'video');
      
      console.log(`[MainMediaAPI] Found ${videoItems.length} video items for path: ${videoPath}`);
      return { success: true, items: videoItems };
    } catch (error) {
      console.error('Failed to get videos by path:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Get media items, optionally filtered by sourceId
   */
  static async getItems(sourceId?: string): Promise<{ success: boolean; items?: any[]; total?: number; error?: string }> {
    try {
      // Convert single sourceId to sourceIds array for getRecentItemsWithOffset
      // Handle 'ALL' as undefined (get all items)
      const actualSourceId = sourceId === 'ALL' ? undefined : sourceId;
      const params = actualSourceId ? { sourceIds: [actualSourceId] } : undefined;
      
      // Use legacy offset-based method but simulate 'total' for backward compatibility
      const result = await this.getRecentItemsWithOffset(params);
      
      if (!result.success) {
        return result as any;
      }
      
      // Simulate total count for backward compatibility
      // This is not accurate but prevents breaking existing code
      const estimatedTotal = result.items?.length || 0;
      const total = result.hasMore ? estimatedTotal + 1 : estimatedTotal;
      
      console.log(`[MainMediaAPI] getItems returning ${result.items?.length || 0} items (estimated total: ${total})`);
      return { 
        success: true, 
        items: result.items, 
        total // Estimated total for backward compatibility
      };
    } catch (error) {
      console.error('Failed to get items:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Insert or update a single file as a media item in the main database.
   * Useful for external pipelines (e.g., Video RAG) to reflect files in the unified UI without running full indexing.
   */
  static async addItemForFile(sourceId: string, filePath: string, description?: string, metadata?: Record<string, any>): Promise<{ success: boolean; id?: string; error?: string }> {
    let actualSourceId = sourceId; // Declare in function scope
    try {
      await this.ensureInitialized();
      
      // Ensure the single_files source exists or find existing one
      if (sourceId === 'single_files') {
        const sources = await this.db.getSources();
        
        // First try to find by ID
        let singleFilesSource = sources.find((s: any) => s.id === 'single_files');
        
        // If not found by ID, try to find by name or path
        if (!singleFilesSource) {
          singleFilesSource = sources.find((s: any) => 
            s.name === 'Single File Uploads' || 
            s.path === 'various'
          );
        }
        
        if (singleFilesSource) {
          // Use the existing source ID
          actualSourceId = singleFilesSource.id;
          console.log(`[ADD-ITEM-FOR-FILE] Using existing single files source: ${actualSourceId}`);
        } else {
          // Create new source with unique path
          console.log('[ADD-ITEM-FOR-FILE] Creating single_files source');
          const newSourceId = await this.db.addSource({
            name: 'Single File Uploads',
            type: 'local',
            path: `single_files_${Date.now()}`, // Use unique path to avoid conflicts
            enabled: true,
            config: { singleFileUploads: true },
            createdAt: new Date()
          });
          actualSourceId = newSourceId;
        }
      }
      
      const stats = await fs.stat(filePath);
      const name = path.basename(filePath);
      const mime = getMimeType(filePath);
      const lower = (mime || '').toLowerCase();
      let type: 'image' | 'video' | 'audio' = 'image';
      if (lower.startsWith('video/')) type = 'video';
      else if (lower.startsWith('audio/')) type = 'audio';

      console.log(`[ADD-ITEM-FOR-FILE-DEBUG] Adding media item:`, {
        sourceId: actualSourceId,
        name: name,
        path: filePath,
        type: type,
        size: Number(stats.size || 0),
        description: description,
        metadata: metadata
      });

      // Check if item already exists to prevent duplicates
      const existingItems = await this.db.getMediaItems();
      const existingItem = existingItems.find((item: any) => 
        item.path === filePath && item.type === type
      );
      
      if (existingItem) {
        console.log(`[ADD-ITEM-FOR-FILE-DEBUG] Item already exists, returning existing ID:`, {
          existingId: existingItem.id,
          name: existingItem.name,
          type: existingItem.type
        });
        return { success: true, id: existingItem.id };
      }

      const id = await this.db.addMediaItem({
        sourceId: actualSourceId,
        name,
        path: filePath,
        size: Number(stats.size || 0),
        type,
        mimeType: mime,
        createdAt: new Date(stats.birthtimeMs || stats.ctimeMs || Date.now()),
        modifiedAt: new Date(stats.mtimeMs || Date.now()),
        description,
        metadata,
      });
      
      console.log(`[ADD-ITEM-FOR-FILE-DEBUG] Media item added successfully:`, {
        id: id,
        name: name,
        type: type
      });
      
      // Fast processing for images: generate thumbnail immediately, queue captioning for background
      if (type === 'image') {
        console.log(`[ADD-ITEM-FOR-FILE] Starting fast processing for image: ${name}`);
        try {
          // Stage 1: Fast thumbnail generation (immediate)
          await this.generateFastThumbnail(id, filePath, name);
          
          // Stage 2: Queue for background captioning job
          if (this.vecDb && this.llm) {
            await this.queueImageForCaptioning(id, filePath, name, actualSourceId);
          }
        } catch (processingError) {
          console.warn(`[ADD-ITEM-FOR-FILE] Fast processing failed for ${name}:`, processingError);
          // Don't fail the upload if processing fails
        }
      }
      
      return { success: true, id };
    } catch (error) {
      console.error('[MainMediaAPI] addItemForFile failed:', error);
      console.error('[ADD-ITEM-FOR-FILE-ERROR] Failed to add item:', {
        sourceId: actualSourceId,
        filePath: filePath,
        error: error instanceof Error ? error.message : String(error)
      });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Get basic statistics
   */
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
      console.error('Failed to get stats:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Start indexing a source
   */
  static async startIndexing(sourceId: string): Promise<{ success: boolean; jobId?: string; error?: string }> {
    try {
      await this.ensureInitialized();
      
      const source = await this.db.getSource(sourceId);
      if (!source) {
        return { success: false, error: 'Source not found' };
      }

      const jobId = await this.db.createJob({ 
        sourceId,
        title: 'Scanning Media Files',
        description: `Scanning ${source.name} for new media files`,
        operationType: 'media_scan',
        targetFile: source.path
      });
      
      console.log(`[INDEXING-START] Created job ${jobId}, calling performIndexing for source ${sourceId}`);
      
      // Start indexing in background (simplified version)
      this.performIndexing(jobId, sourceId, false).catch(error => {
        console.error('[INDEXING-ERROR] Indexing failed:', error);
        console.error('[INDEXING-ERROR] Stack:', error.stack);
        this.db.updateJobStatus(jobId, 'failed', 0);
      });
      
      console.log(`[INDEXING-START] performIndexing called (async), returning jobId ${jobId}`);
      
      return { success: true, jobId };
    } catch (error) {
      console.error('Failed to start indexing:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Clean up duplicate sources
   */
  static async cleanupDuplicateSources(): Promise<{ success: boolean; removed?: number; kept?: number; error?: string }> {
    try {
      await this.ensureInitialized();
      const result = await this.db.removeDuplicateSources();
      return { success: true, removed: result.removed, kept: result.kept };
    } catch (error) {
      console.error('Failed to cleanup duplicate sources:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Force re-index a source (regenerates all captions and embeddings)
   */
  static async forceReindex(sourceId: string): Promise<{ success: boolean; jobId?: string; error?: string }> {
    try {
      await this.ensureInitialized();
      
      const source = await this.db.getSource(sourceId);
      if (!source) {
        return { success: false, error: 'Source not found' };
      }

      const jobId = await this.db.createJob({ 
        sourceId,
        title: 'Force Re-indexing',
        description: `Force re-indexing ${source.name} (regenerating all captions and embeddings)`,
        operationType: 'force_reindex',
        targetFile: source.path
      });
      
      // Start force re-indexing in background
      this.performIndexing(jobId, sourceId, true).catch(error => {
        console.error('Force re-indexing failed:', error);
        this.db.updateJobStatus(jobId, 'failed', 0);
      });
      
      return { success: true, jobId };
    } catch (error) {
      console.error('Failed to start force re-indexing:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Detect and queue unindexed images for background processing
   */
  static async indexUnprocessedImages(): Promise<{ success: boolean; jobId?: string; unindexedCount?: number; error?: string }> {
    try {
      await this.ensureInitialized();
      
      if (!this.vecDb || !this.llm) {
        return { success: false, error: 'Vector database or LLM not available' };
      }

      // Get all image items from the database
      const allItems = await this.db.getMediaItems();
      const imageItems = allItems.filter((item: any) => item.type === 'image');
      
      console.log(`[UNINDEXED-RECOVERY] Found ${imageItems.length} image items to check`);
      
      // Check which images don't have captions/embeddings
      const unindexedImages: any[] = [];
      
      for (const item of imageItems) {
        try {
          // Check if image has been indexed by looking at the vector database
          const mediaItem = this.vecDb.getMediaItem(item.id);
          const needsIndexing = !mediaItem || 
                                mediaItem.captionStatus !== 'completed' || 
                                mediaItem.embeddingStatus !== 'completed';
          
          if (needsIndexing) {
            unindexedImages.push(item);
            console.log(`[UNINDEXED-RECOVERY] Found unindexed image: ${item.name} (${item.id}) - Status: caption=${mediaItem?.captionStatus || 'missing'}, embedding=${mediaItem?.embeddingStatus || 'missing'}`);
          }
        } catch (e) {
          // If we can't check, assume it needs indexing
          unindexedImages.push(item);
          console.log(`[UNINDEXED-RECOVERY] Cannot check status for ${item.name}, adding to queue`);
        }
      }
      
      if (unindexedImages.length === 0) {
        console.log(`[UNINDEXED-RECOVERY] No unindexed images found`);
        return { success: true, unindexedCount: 0 };
      }
      
      console.log(`[UNINDEXED-RECOVERY] Found ${unindexedImages.length} unindexed images, starting background processing`);
      
      // Find the actual single_files sourceId
      const sources = await this.db.getSources();
      const singleFilesSource = sources.find((s: any) => 
        s.name === 'Single File Uploads' || 
        s.path === 'various' ||
        s.id === 'single_files'
      );
      
      const actualSourceId = singleFilesSource ? singleFilesSource.id : 'single_files';
      
      // Create a proper indexing job that shows up in the UI
      const jobId = await this.db.createJob({ 
        sourceId: actualSourceId,
        title: 'Processing Unindexed Images',
        description: `Generating captions and embeddings for ${unindexedImages.length} unindexed images`,
        operationType: 'image_recovery',
        totalItems: unindexedImages.length,
        processedItems: 0
      });
      
      // Process unindexed images in background with job tracking
      this.processUnindexedImagesWithJobTracking(jobId, unindexedImages).catch(error => {
        console.error('[UNINDEXED-RECOVERY] Background processing failed:', error);
        this.db.updateJobStatus(jobId, 'failed', 0);
      });
      
      return { success: true, jobId, unindexedCount: unindexedImages.length };
      
    } catch (error) {
      console.error('[UNINDEXED-RECOVERY] Failed to detect unindexed images:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Generate fast thumbnail for immediate UI display
   */
  private static async generateFastThumbnail(id: string, filePath: string, name: string): Promise<void> {
    console.log(`[FAST-THUMBNAIL] Generating thumbnail for: ${name}`);
    
    try {
      // For now, we'll use the image itself as thumbnail (fast)
      // In the future, this could generate a smaller thumbnail using sharp or similar
      
      // Update metadata with thumbnail path
      if (this.vecDb) {
        // Store thumbnail path in metadata (for now, just log - could be stored in metadata field)
        const mediaItem = this.vecDb.getMediaItem(id);
        if (mediaItem) {
          // In the future, this could store thumbnail path in a metadata field
          console.log(`[FAST-THUMBNAIL] Thumbnail ready for ${name} (using original image: ${filePath})`);
        }
      }
    } catch (error) {
      console.error(`[FAST-THUMBNAIL] Failed to generate thumbnail for ${name}:`, error);
    }
  }

  /**
   * Queue image for background captioning job
   */
  private static async queueImageForCaptioning(id: string, filePath: string, name: string, sourceId: string): Promise<void> {
    console.log(`[CAPTION-QUEUE] Queuing image for background captioning: ${name}`);
    
    try {
      // Set status to pending for captioning
      this.vecDb!.updateStatus(id, 'pending', 'pending');
      
      // Start background captioning job with tracking (delayed)
      setTimeout(() => {
        // Create job only when we're about to start processing
        this.db.createJob({ 
          sourceId: sourceId,
          title: 'Generating Caption',
          description: `Generating caption for ${name}`,
          operationType: 'image_caption',
          targetFile: filePath,
          totalItems: 1,
          processedItems: 0
        }).then((jobId: string) => {
          this.processSingleImageCaptioningWithJob(jobId, id, filePath, name).catch((error: any) => {
            console.error(`[CAPTION-QUEUE] Background captioning failed for ${name}:`, error);
            this.db.updateJobStatus(jobId, 'failed', 0);
          });
        }).catch((error: any) => {
          console.error(`[CAPTION-QUEUE] Failed to create job for ${name}:`, error);
        });
      }, 2000); // Start after 2 seconds to avoid blocking upload
      
      console.log(`[CAPTION-QUEUE] Queued ${name} for background captioning (will start in 2s)`);
    } catch (error) {
      console.error(`[CAPTION-QUEUE] Failed to queue ${name} for captioning:`, error);
    }
  }

  /**
   * Process single image captioning in background with job tracking
   */
  private static async processSingleImageCaptioningWithJob(jobId: string, id: string, filePath: string, name: string): Promise<void> {
    console.log(`[BACKGROUND-CAPTION] Starting captioning for: ${name} (Job: ${jobId})`);
    
    try {
      // Update job to running
      await this.db.updateJobStatus(jobId, 'running', 0);
      
      // Generate caption
      const caption = await this.llm!.generateImageDescription(filePath);
      if (caption) {
        await this.vecDb!.updateCaption(id, caption, 'completed');
        console.log(`[BACKGROUND-CAPTION] Generated caption for ${name}: "${caption.substring(0, 80)}..."`);
        
        // Update progress
        await this.db.updateJobStatus(jobId, 'running', 50);
        
        // Generate embedding from caption
        const embedding = await this.llm!.generateEmbedding(caption);
        if (embedding) {
          await this.vecDb!.updateEmbedding(id, embedding, 'completed');
          console.log(`[BACKGROUND-CAPTION] Generated embedding for ${name}`);
        }
      }
      
      // Mark job as completed
      await this.db.updateJobStatus(jobId, 'completed', 100);
      
    } catch (error) {
      console.error(`[BACKGROUND-CAPTION] Failed to caption ${name}:`, error);
      // Mark as failed
      await this.vecDb!.updateCaption(id, '', 'failed');
      await this.vecDb!.updateEmbedding(id, new Float32Array([]), 'failed');
      await this.db.updateJobStatus(jobId, 'failed', 0);
    }
  }

  /**
   * Process single image captioning in background (legacy method for recovery)
   */
  private static async processSingleImageCaptioning(id: string, filePath: string, name: string): Promise<void> {
    console.log(`[BACKGROUND-CAPTION] Starting captioning for: ${name}`);
    
    try {
      // Generate caption
      const caption = await this.llm!.generateImageDescription(filePath);
      if (caption) {
        await this.vecDb!.updateCaption(id, caption, 'completed');
        console.log(`[BACKGROUND-CAPTION] Generated caption for ${name}: "${caption.substring(0, 80)}..."`);
        
        // Generate embedding from caption
        const embedding = await this.llm!.generateEmbedding(caption);
        if (embedding) {
          await this.vecDb!.updateEmbedding(id, embedding, 'completed');
          console.log(`[BACKGROUND-CAPTION] Generated embedding for ${name}`);
        }
      }
    } catch (error) {
      console.error(`[BACKGROUND-CAPTION] Failed to caption ${name}:`, error);
      // Mark as failed
      await this.vecDb!.updateCaption(id, '', 'failed');
      await this.vecDb!.updateEmbedding(id, new Float32Array([]), 'failed');
    }
  }

  /**
   * Process unindexed images in background with job tracking for UI
   */
  private static async processUnindexedImagesWithJobTracking(jobId: string, unindexedImages: any[]): Promise<void> {
    console.log(`[UNINDEXED-RECOVERY] Starting background processing of ${unindexedImages.length} images (Job: ${jobId})`);
    
    // Update job status to running
    await this.db.updateJobStatus(jobId, 'running', 0);
    
    let processedCount = 0;
    
    for (const item of unindexedImages) {
      try {
        console.log(`[UNINDEXED-RECOVERY] Processing image ${processedCount + 1}/${unindexedImages.length}: ${item.name}`);
        
        // Use the same background captioning process
        await this.processSingleImageCaptioning(item.id, item.path, item.name);
        
        processedCount++;
        
        // Update job progress for UI
        const progress = Math.round((processedCount / unindexedImages.length) * 100);
        await this.db.updateJobStatus(jobId, 'running', progress);
        
        // Small delay to avoid overwhelming the system
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        console.error(`[UNINDEXED-RECOVERY] Failed to process ${item.name}:`, error);
        // Continue with next image even if one fails
      }
    }
    
    // Mark job as completed
    await this.db.updateJobStatus(jobId, 'completed', 100);
    console.log(`[UNINDEXED-RECOVERY] Completed background processing of ${unindexedImages.length} images (Job: ${jobId})`);
  }

  /**
   * Delete a media item from the library (database only)
   */
  static async deleteMediaItem(itemId: string, deleteFile: boolean = false): Promise<{ success: boolean; error?: string }> {
    try {
      await this.ensureInitialized();
      
      // Get the item details before deletion
      const items = await this.db.getMediaItems();
      const item = items.find((i: any) => i.id === itemId);
      
      if (!item) {
        return { success: false, error: 'Media item not found' };
      }
      
      console.log(`[MEDIA-DELETE] Removing media item from library: ${item.name} (${itemId})`);
      
      // Remove from main database only - let triggers handle FTS cleanup
      await this.db.removeMediaItem(itemId);
      
      // Remove from vector database (this has sqlite-vec loaded and can handle vec_embeddings)
      if (this.vecDb) {
        try {
          this.vecDb.removeMediaItem(itemId);
          console.log(`[MEDIA-DELETE] Removed from vector database: ${itemId}`);
        } catch (error) {
          console.warn(`[MEDIA-DELETE] Failed to remove from vector DB (non-critical):`, error);
        }
      }
      
      // CRITICAL: Also delete associated video processing jobs to prevent resurrection
      if (item.type === 'video' && item.path) {
        try {
          const { VideoMediaAPI } = await import('./video-media-api');
          const videoAPI = VideoMediaAPI.getInstance();
          
          // Delete all jobs for this video path
          const deleted = await videoAPI.deleteJobsByVideoPath(item.path);
          console.log(`[MEDIA-DELETE] Deleted ${deleted} video processing jobs for: ${item.path}`);
        } catch (error) {
          console.warn(`[MEDIA-DELETE] Failed to delete video jobs (non-critical):`, error);
        }
      }
      
      console.log(`[MEDIA-DELETE] Successfully removed ${item.name} from library`);
      return { success: true };
      
    } catch (error) {
      console.error('[MEDIA-DELETE] Failed to delete media item:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Start background cleanup job to remove orphaned files and database entries
   */
  static async startCleanupJob(): Promise<{ success: boolean; jobId?: string; error?: string }> {
    try {
      await this.ensureInitialized();
      
      console.log(`[CLEANUP-JOB] Starting background cleanup job`);
      
      // Create a cleanup job
      const jobId = `cleanup_${Date.now()}`;
      
      // Start cleanup in background
      this.performCleanup(jobId).catch(error => {
        console.error('[CLEANUP-JOB] Background cleanup failed:', error);
      });
      
      return { success: true, jobId };
      
    } catch (error) {
      console.error('[CLEANUP-JOB] Failed to start cleanup job:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Perform background cleanup operations
   */
  private static async performCleanup(jobId: string): Promise<void> {
    console.log(`[CLEANUP-JOB] Starting cleanup job ${jobId}`);
    
    try {
      // 1. Find orphaned database entries (files that no longer exist)
      const items = await this.db.getMediaItems();
      const orphanedItems: any[] = [];
      
      console.log(`[CLEANUP-JOB] Checking ${items.length} items for orphaned files`);
      
      for (const item of items) {
        try {
          const fs = await import('fs');
          if (item.path && !fs.existsSync(item.path)) {
            orphanedItems.push(item);
            console.log(`[CLEANUP-JOB] Found orphaned item: ${item.name} (file missing: ${item.path})`);
          }
        } catch (e) {
          // If we can't check the file, skip it
          console.warn(`[CLEANUP-JOB] Cannot check file existence for ${item.name}:`, e);
        }
      }
      
      // 2. Remove orphaned database entries
      if (orphanedItems.length > 0) {
        console.log(`[CLEANUP-JOB] Removing ${orphanedItems.length} orphaned database entries`);
        
        for (const item of orphanedItems) {
          try {
            await this.db.removeMediaItem(item.id);
            
            // Also remove from vector database
            if (this.vecDb) {
              try {
                await this.vecDb.removeMediaItem(item.id);
              } catch (e) {
                console.warn(`[CLEANUP-JOB] Failed to remove from vector db: ${item.id}`, e);
              }
            }
            
            console.log(`[CLEANUP-JOB] Removed orphaned entry: ${item.name} (${item.id})`);
            
            // Small delay to avoid overwhelming the system
            await new Promise(resolve => setTimeout(resolve, 100));
            
          } catch (error) {
            console.error(`[CLEANUP-JOB] Failed to remove orphaned entry ${item.id}:`, error);
          }
        }
      }
      
      // 3. Clean up empty sources (sources with no items)
      console.log(`[CLEANUP-JOB] Checking for empty sources`);
      const sources = await this.db.getSources();
      const emptySources: any[] = [];
      
      for (const source of sources) {
        const sourceItems = await this.db.getMediaItems(source.id);
        if (sourceItems.length === 0 && source.id !== 'single_files') { // Don't remove single_files source
          emptySources.push(source);
        }
      }
      
      if (emptySources.length > 0) {
        console.log(`[CLEANUP-JOB] Removing ${emptySources.length} empty sources`);
        for (const source of emptySources) {
          try {
            await this.db.removeSource(source.id);
            console.log(`[CLEANUP-JOB] Removed empty source: ${source.name} (${source.id})`);
          } catch (error) {
            console.error(`[CLEANUP-JOB] Failed to remove empty source ${source.id}:`, error);
          }
        }
      }
      
      console.log(`[CLEANUP-JOB] Cleanup job ${jobId} completed successfully`);
      console.log(`[CLEANUP-JOB] Summary: Removed ${orphanedItems.length} orphaned items, ${emptySources.length} empty sources`);
      
    } catch (error) {
      console.error(`[CLEANUP-JOB] Cleanup job ${jobId} failed:`, error);
    }
  }

  /**
   * Stop indexing a job
   */
  static async stopIndexing(jobId: string): Promise<{ success: boolean; error?: string }> {
    try {
      await this.ensureInitialized();
      await this.db.updateJobStatus(jobId, 'cancelled');
      return { success: true };
    } catch (error) {
      console.error('Failed to stop indexing:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Start background reconciliation service
   */
  static startBackgroundReconciliation(): void {
    // Run reconciliation every 30 minutes (infrequent)
    const RECONCILIATION_INTERVAL = 30 * 60 * 1000; // 30 minutes
    
    console.log('[JOB-RECONCILIATION] Starting background reconciliation service (every 30 minutes)');
    
    // Initial reconciliation after 2 minutes (let app settle)
    setTimeout(() => {
      this.runReconciliation().catch((error: any) => {
        console.warn('[JOB-RECONCILIATION] Initial reconciliation failed:', error);
      });
    }, 2 * 60 * 1000); // 2 minutes
    
    // Then run periodically
    this.reconciliationInterval = setInterval(() => {
      this.runReconciliation().catch((error: any) => {
        console.warn('[JOB-RECONCILIATION] Periodic reconciliation failed:', error);
      });
    }, RECONCILIATION_INTERVAL);
  }

  /**
   * Stop background reconciliation service
   */
  static stopBackgroundReconciliation(): void {
    if (this.reconciliationInterval) {
      clearInterval(this.reconciliationInterval);
      this.reconciliationInterval = null;
      console.log('[JOB-RECONCILIATION] Background reconciliation service stopped');
    }
  }

  /**
   * Run a single reconciliation cycle
   */
  static async runReconciliation(): Promise<{ stalledJobs: number; unindexedImages: number }> {
    console.log('[JOB-RECONCILIATION] Running reconciliation cycle...');
    
    let stalledJobsCount = 0;
    let unindexedImagesCount = 0;
    
    try {
      // 1. Check for stalled jobs (only if no active jobs to avoid conflicts)
      const activeJobs = await this.db.getActiveJobs();
      if (activeJobs.length === 0) {
        console.log('[JOB-RECONCILIATION] No active jobs - checking for stalled jobs');
        const stalledResult = await this.recoverStalledJobs();
        stalledJobsCount = stalledResult.recoveredCount;
      } else {
        console.log(`[JOB-RECONCILIATION] ${activeJobs.length} active jobs running - skipping stalled job check`);
      }
      
      // 2. Check for unindexed images (less aggressive)
      const unindexedResult = await this.indexUnprocessedImages();
      if (unindexedResult.success && unindexedResult.unindexedCount) {
        unindexedImagesCount = unindexedResult.unindexedCount;
        if (unindexedImagesCount > 0) {
          console.log(`[JOB-RECONCILIATION] Found ${unindexedImagesCount} unindexed images - started background processing`);
        }
      }
      
      console.log(`[JOB-RECONCILIATION] Cycle complete - recovered ${stalledJobsCount} stalled jobs, ${unindexedImagesCount} unindexed images`);
      
    } catch (error) {
      console.error('[JOB-RECONCILIATION] Reconciliation cycle failed:', error);
    }
    
    return { stalledJobs: stalledJobsCount, unindexedImages: unindexedImagesCount };
  }

  /**
   * Recover stalled jobs on startup
   */
  static async recoverStalledJobs(): Promise<{ success: boolean; recoveredCount: number; error?: string }> {
    try {
      await this.ensureInitialized();
      console.log('[JOB-RECOVERY] Checking for stalled indexing jobs...');
      
      const result = await this.db.resetStalledJobs();
      
      if (result.resetCount > 0) {
        console.log(`[JOB-RECOVERY] Reset ${result.resetCount} stalled jobs to pending status`);
        
        // Restart the recovered jobs
        for (const jobId of result.jobIds) {
          try {
            const jobs = await this.db.getJobs();
            const job = jobs.find((j: any) => j.id === jobId);
            if (job && job.status === 'pending') {
              console.log(`[JOB-RECOVERY] Restarting recovered job: ${jobId} for source: ${job.sourceId}`);
              // Restart the indexing for this source
              this.performIndexing(jobId, job.sourceId, false).catch((error: any) => {
                console.error(`[JOB-RECOVERY] Failed to restart job ${jobId}:`, error);
                this.db.updateJobStatus(jobId, 'failed', 0);
              });
            }
          } catch (error) {
            console.error(`[JOB-RECOVERY] Failed to restart job ${jobId}:`, error);
          }
        }
      } else {
        console.log('[JOB-RECOVERY] No stalled jobs found');
      }
      
      return { success: true, recoveredCount: result.resetCount };
    } catch (error) {
      console.error('[JOB-RECOVERY] Failed to recover stalled jobs:', error);
      return { success: false, recoveredCount: 0, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Get indexing status (includes both media indexing and video processing jobs)
   */
  static async getIndexingStatus(): Promise<{ 
    success: boolean; 
    activeJobs: string[]; 
    jobs?: Array<{ 
      id: string; 
      sourceId: string; 
      status: string; 
      progress: number; 
      totalItems?: number; 
      processedItems?: number; 
      startedAt?: Date; 
      completedAt?: Date 
    }>; 
    error?: string 
  }> {
    try {
      await this.ensureInitialized();
      
      // Get media indexing jobs
      const mediaJobs = await this.db.getActiveJobs();
      console.log(`[INDEXING-STATUS-DEBUG] Media jobs from DB:`, mediaJobs.map((j: any) => ({ id: j.id, status: j.status, sourceId: j.sourceId })));
      
      // Get video processing jobs using singleton VideoMediaAPI
      let videoJobs: any[] = [];
      try {
        const { VideoMediaAPI } = await import('./video-media-api');
        const videoApi = VideoMediaAPI.getInstance();
        
        // Use the singleton instance instead of creating new connections
        const activeVideoJobs = await videoApi.getActiveJobs();
        // VideoMediaAPI doesn't have getPendingJobs, so we get all active jobs
        const pendingVideoJobs: any[] = [];

        // Merge and de-duplicate by job id
        const byId: Record<string, any> = {};
        for (const j of [...activeVideoJobs, ...pendingVideoJobs]) {
          if (!byId[j.id]) byId[j.id] = j;
        }
        videoJobs = Object.values(byId);
        console.log(`[INDEXING-STATUS-DEBUG] Video jobs:`, videoJobs.map((j: any) => ({ id: j.id, status: j.status })));
        
        // [DEBUG] Log actual video job structure
        if (videoJobs.length > 0) {
          console.log(`[VIDEO-JOB-STRUCTURE-DEBUG] First video job fields:`, Object.keys(videoJobs[0]));
          console.log(`[VIDEO-JOB-STRUCTURE-DEBUG] First video job data:`, videoJobs[0]);
        }
      } catch (e) {
        console.error('[MainMediaAPI] Failed to get video jobs:', e);
        console.error('[MainMediaAPI] Video job error stack:', e instanceof Error ? e.stack : e);
      }
      
      // Combine all jobs
      const allJobs = [...mediaJobs, ...videoJobs];
      // Only treat running (media) and processing (video) as active/in-progress
      const activeJobs = allJobs
        .filter((j: any) => j.status === 'running' || j.status === 'processing')
        .map((j: any) => j.id);
      console.log(`[INDEXING-STATUS-DEBUG] Active jobs (running/processing):`, activeJobs);
      
      // Get detailed job info for UI display (only active/pending jobs)
      const relevantJobs = [...mediaJobs, ...videoJobs].filter(j => 
        j.status === 'running' || j.status === 'processing' || j.status === 'pending' || j.status === 'scheduled'
      );
      const jobDetails = relevantJobs.map(j => {
        // Determine if this is a video job (from VideoDatabase)
        const isVideoJob = !j.sourceId && (j.videoPath || j.video_path); // Video jobs have video_path but no sourceId
        
        // Generate appropriate title and description for video jobs
        let jobTitle = j.title;
        let jobDescription = j.description;
        let operationType = j.operationType;
        let targetFile = j.targetFile;
        
        if (isVideoJob) {
          // Extract filename from video path (handle both field names)
          const videoPath = j.videoPath || j.video_path;
          const fileName = videoPath ? videoPath.split('/').pop() : (j.file_name || j.fileName || 'video');
          
          // [DEBUG] Log video job mapping
          console.log(`[VIDEO-JOB-MAPPING-DEBUG] Processing video job ${j.id}:`, {
            isVideoJob,
            videoPath,
            fileName,
            status: j.status,
            progress: j.progress
          });
          
          // Set descriptive titles based on video job status/progress
          if (j.status === 'scheduled' || j.status === 'pending') {
            // Explicitly show queued state, not processing
            jobTitle = 'Queued';
            jobDescription = `Queued for video processing: ${fileName}`;
            operationType = 'video_queue';
          } else if (j.status === 'running' || j.status === 'processing') {
            // Use stored status message and metadata instead of hardcoded progress thresholds
            console.log(`[UI-DEBUG] Job ${j.id}: statusMessage="${j.statusMessage}", progress=${j.progress}`);
            if (j.statusMessage) {
              // Use stored status message as job title
              jobTitle = j.statusMessage;
              
              // Try to get additional info from metadata
              let metadata: any = {};
              try {
                metadata = j.metadata ? JSON.parse(j.metadata) : {};
              } catch (e) {
                // Ignore metadata parsing errors
              }
              
              jobDescription = metadata.actionDescription || `Processing ${fileName}`;
              operationType = metadata.currentPhase === 'phase0' ? 'video_segmentation' : 'video_keyframes';
            } else {
              // Fallback to old progress-based logic (for compatibility)
              if (j.progress < 30) {
                jobTitle = 'Extracting Video Segments';
                jobDescription = `Extracting segments from ${fileName}`;
                operationType = 'video_segmentation';
              } else if (j.progress < 70) {
                jobTitle = 'Generating Transcriptions';
                jobDescription = `Creating transcriptions for ${fileName}`;
                operationType = 'video_transcription';
              } else {
                jobTitle = 'Creating Keyframes';
                jobDescription = `Generating keyframes for ${fileName}`;
                operationType = 'video_keyframes';
              }
            }
          } else if (j.status === 'completed') {
            jobTitle = 'Video Processing Complete';
            jobDescription = `Completed processing ${fileName}`;
            operationType = 'video_complete';
          }
          
          targetFile = videoPath;
        }
        
        const mappedJob = {
          id: j.id,
          sourceId: j.sourceId,
          status: j.status,
          progress: j.progress,
          totalItems: j.totalItems,
          processedItems: j.processedItems,
          startedAt: j.startedAt,
          completedAt: j.completedAt,
          type: isVideoJob ? 'video' : (j.type || 'media'), // Properly mark video jobs
          refinementPass: j.refinementPass,
          threshold: j.threshold,
          title: jobTitle,
          description: jobDescription,
          operationType: operationType,
          targetFile: targetFile
        };
        
        // [DEBUG] Log final mapped job
        if (isVideoJob) {
          console.log(`[VIDEO-JOB-FINAL-DEBUG] Final mapped job for ${j.id}:`, mappedJob);
        }
        
        return mappedJob;
      });
      
      // [DEBUG] Log job details being sent to UI
      console.log(`[INDEXING-API-DEBUG] Sending ${jobDetails.length} jobs to UI:`);
      jobDetails.forEach((job, index) => {
        console.log(`[INDEXING-API-DEBUG] Job ${index + 1}:`, {
          id: job.id,
          status: job.status,
          type: job.type,
          title: job.title,
          description: job.description,
          operationType: job.operationType,
          targetFile: job.targetFile
        });
      });
      
      return { success: true, activeJobs, jobs: jobDetails };
    } catch (error) {
      console.error('Failed to get indexing status:', error);
      return { 
        success: false, 
        activeJobs: [],
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  /**
   * Simplified indexing implementation
   */
  private static async performIndexing(jobId: string, sourceId: string, forceReindex: boolean = false): Promise<void> {
    console.log(`[PERFORM-INDEXING] 🚀 ENTERED performIndexing - jobId: ${jobId}, sourceId: ${sourceId}, forceReindex: ${forceReindex}`);
    try {
      console.log(`[PERFORM-INDEXING] ✅ Inside try block, starting indexing job ${jobId} for source ${sourceId}`);
      
      const source = await this.db.getSource(sourceId);
      console.log(`[PERFORM-INDEXING] 📁 Got source:`, source ? `${source.name} (${source.path})` : 'null');
      
      if (!source) {
        throw new Error(`Source not found: ${sourceId}`);
      }
      
      console.log(`[PERFORM-INDEXING] 📝 Updating job status to 'running'`);
      await this.db.updateJobStatus(jobId, 'running');
      
      console.log(`[PERFORM-INDEXING] 📦 Importing file scanner...`);
      // Import file scanner
      const { scanDirectory } = await import('../core/file-scanner');
      console.log(`[PERFORM-INDEXING] ✅ File scanner imported successfully`);
      
      console.log(`[PERFORM-INDEXING] 🔍 Scanning directory: ${source.path}, recursive: ${source.config?.recursive !== false}`);
      // Scan for media files
      const mediaFiles = await scanDirectory(source.path, source.config?.recursive !== false);
      console.log(`[PERFORM-INDEXING] 📊 Found ${mediaFiles.length} media files`);
      
      if (mediaFiles.length === 0) {
        await this.db.updateJobStatus(jobId, 'completed', 100);
        return;
      }
      
      // NEW APPROACH: Add all files to DB immediately, create background jobs for processing
      const { generateDeterministicId } = await import('../core/utils/crypto-utils');
      let addedCount = 0;
      let jobsCreated = 0;
      
      for (const file of mediaFiles) {
        try {
          // Generate deterministic ID based on path hash
          const itemId = await generateDeterministicId(file.path);

          // 1) Add to main DB immediately - INSTANT VISIBILITY
          await this.db.addMediaItem({
            id: itemId,
            sourceId,
            name: file.name,
            path: file.path,
            size: file.size,
            type: file.type,
            mimeType: getMimeType(file.path),
            createdAt: new Date(),
            modifiedAt: file.lastModified,
            description: `${file.type} file: ${file.name}`,
            metadata: {}
          });

          // 2) Add to vector DB with status='pending' - SEARCHABLE LATER
          if (this.vecDb) {
            try {
              await this.vecDb.addMediaItemWithIdAsync(itemId, {
                sourceId,
                name: file.name,
                path: file.path,
                size: file.size,
                type: file.type,
                createdAt: file.lastModified,
                updatedAt: file.lastModified,
                caption: undefined,
                captionGeneratedAt: undefined,
                captionStatus: 'pending',
                embedding: undefined,
                embeddingGeneratedAt: undefined,
                embeddingStatus: 'pending',
              } as any);
            } catch (e) {
              console.warn('[INDEX] Failed to stage item in sqlite-vec:', e);
            }
          }

          // 3) Create background job for caption+embedding - ASYNC PROCESSING
          const imageJobId = `img_${Date.now()}_${Math.random().toString(36).substring(7)}`;
          await this.db.createImageProcessingJob({
            id: imageJobId,
            sourceId,
            filePath: file.path,
            fileName: file.name,
            fileSize: file.size,
            status: 'pending',
            jobType: 'image_processing',
            retryCount: 0
          });
          
          addedCount++;
          jobsCreated++;
          
          // Update scan job progress
          const progress = Math.floor((addedCount / mediaFiles.length) * 100);
          await this.db.updateJobStatus(jobId, 'running', progress);
          
        } catch (error) {
          console.error(`[INDEX] Failed to add file ${file.name}:`, error);
        }
      }
      
      console.log(`[INDEXING] ✅ Added ${addedCount} images to DB - visible immediately`);
      console.log(`[INDEXING] 🔄 Created ${jobsCreated} background jobs for caption/embedding`);
      
      await this.db.updateJobStatus(jobId, 'completed', 100);
      console.log(`[INDEXING] Scan job ${jobId} completed. Added ${addedCount}/${mediaFiles.length} files, created ${jobsCreated} background jobs`);
      
      // Emit IPC event to trigger UI refresh immediately
      console.log(`[INDEXING-IPC-DEBUG] Checking IPC send conditions:`, {
        hasMainWindow: !!this.mainWindow,
        addedCount,
        isDestroyed: this.mainWindow?.webContents?.isDestroyed?.() ?? 'N/A',
        webContentsId: this.mainWindow ? this.mainWindow.webContents.id : 'N/A'
      });
      
      if (this.mainWindow && addedCount > 0) {
        console.log(`[INDEXING] 📡 Sending media:scan-completed event to renderer (${addedCount} items)`);
        try {
          this.mainWindow.webContents.send('media:scan-completed', {
            sourceId,
            itemsAdded: addedCount,
            jobsCreated: jobsCreated
          });
          console.log(`[INDEXING] 📡 Sent scan-completed event to UI (${addedCount} items)`);
        } catch (error) {
          console.error(`[INDEXING-IPC-ERROR] Failed to send IPC event:`, error);
        }
      } else {
        console.log(`[INDEXING-IPC-DEBUG] Skipping IPC send - mainWindow: ${!!this.mainWindow}, addedCount: ${addedCount}`);
      }
      
    } catch (error) {
      console.error(`[PERFORM-INDEXING] ❌ Indexing job ${jobId} failed:`, error);
      console.error(`[PERFORM-INDEXING] ❌ Error stack:`, error instanceof Error ? error.stack : 'No stack');
      await this.db.updateJobStatus(jobId, 'failed', 0);
    }
  }

  /**
   * Unified search across all media types with proper grouping
   */
  static async unifiedSearch(query: string, options: {
    types?: ('image' | 'video' | 'audio')[];
    limit?: number;
    offset?: number;
    signal?: AbortSignal;
  } = {}): Promise<{
    success: boolean;
    results?: {
      images: any[];
      videos: any[];
      audio: any[];
      totals: { images: number; videos: number; audio: number };
      hasMore: { images: boolean; videos: boolean; audio: boolean };
      query: string;
      executionTime: number;
    };
    error?: string;
  }> {
    try {
      await this.ensureInitialized();
      const q = String(query || '').trim();
      const limit = options.limit || 20;
      const offset = options.offset || 0;
      const requestedTypes = options.types || ['image', 'video', 'audio'];
      const signal = options.signal;
      const started = Date.now();
      console.log(`[SEARCH-TIMING] 🔍 Starting unified search for query: "${q}", types: [${requestedTypes.join(', ')}], limit: ${limit}, offset: ${offset}`);

      // Check cancellation before starting
      if (signal?.aborted) {
        throw new Error('Search cancelled before starting');
      }

      // Multi-modal query classification and transformation
      let searchQuery = q;
      let enhancedEntities: string[] = [];
      let queryClassification = null;
      let multiModalQuery = null;

      if (searchQuery.length > 3) {
        console.log(`[MULTIMODAL-SEARCH] Processing query: "${q}"`);
        
        // Check cancellation before expensive LLM operations
        if (signal?.aborted) {
          throw new Error('Search cancelled before query classification');
        }
        
        try {
          // Step 1: Classify query type (spatial, temporal, audio, action, mixed)
          queryClassification = await this.llm!.classifyQueryType(q);
          console.log(`[MULTIMODAL-SEARCH] Classified as: ${queryClassification.type} (${queryClassification.confidence})`);

          // Step 2: Transform for multi-modal search
          multiModalQuery = await this.llm!.transformMultiModalQuery(q, queryClassification);
          searchQuery = multiModalQuery.transformed;
          enhancedEntities = [
            ...multiModalQuery.searchKeywords.text,
            ...multiModalQuery.searchKeywords.visual,
            ...multiModalQuery.searchKeywords.audio,
            ...multiModalQuery.searchKeywords.temporal,
            ...multiModalQuery.searchKeywords.action
          ].filter(Boolean);
          
          console.log(`[MULTIMODAL-SEARCH] Transformed query: "${searchQuery}"`);
          console.log(`[MULTIMODAL-SEARCH] Keywords by modality:`, {
            text: multiModalQuery.searchKeywords.text,
            visual: multiModalQuery.searchKeywords.visual,
            audio: multiModalQuery.searchKeywords.audio,
            temporal: multiModalQuery.searchKeywords.temporal,
            action: multiModalQuery.searchKeywords.action
          });
          // console.log(`[MULTIMODAL-SEARCH] Embeddings text:`, {
          //   text: multiModalQuery.embeddings.text,
          //   visual: multiModalQuery.embeddings.visual,
          //   audio: multiModalQuery.embeddings.audio
          // });
        } catch (error) {
          console.warn('[MULTIMODAL-SEARCH] Classification failed, using original query:', error);
          // Fallback to simple entity extraction
          try {
            enhancedEntities = await this.llm!.extractSearchEntities(q);
          } catch (fallbackError) {
            enhancedEntities = q.split(' ').filter(word => word.length > 2);
          }
        }
      }

      // Initialize grouped results
      const grouped = {
        images: [] as any[],
        videos: [] as any[],
        audio: [] as any[],
        totals: { images: 0, videos: 0, audio: 0 },
        hasMore: { images: false, videos: false, audio: false }
      };

      // Try semantic search first if available
      if (this.vecDb && this.llm && q) {
        try {
          console.log(`[SEARCH-TIMING] 🧠 Using semantic search (vector + LLM)`);
          const embeddingStart = Date.now();
          // Get more results to ensure we have enough for each type after grouping
          const searchLimit = limit * requestedTypes.length;
          
          // Generate embeddings based on query classification
          const queryForEmbedding = searchQuery !== q ? searchQuery : q;
          let embeddings = [];
          
          console.log(`[SEARCH-TIMING] 🔍 Generating embeddings for: "${queryForEmbedding}"`);
          
          // Primary text embedding
          const textEmbedding = await this.llm.generateEmbedding(queryForEmbedding);
          embeddings.push(textEmbedding);
          
          console.log("[IS MULTIMODAL QUERY] ", multiModalQuery)
          
          // Additional modality-specific embeddings
          // if (multiModalQuery) {
          //   // Visual embedding - use embedding text or keywords
          //   const visualKeywords = multiModalQuery.searchKeywords.visual;
          //   if (visualKeywords && visualKeywords.length > 0) {
          //     try {
          //       const visualText = multiModalQuery.embeddings.visual || visualKeywords.join(' ');
          //       const visualEmbedding = await this.llm.generateEmbedding(visualText);
          //       embeddings.push(visualEmbedding);
          //       console.log(`[SEARCH-TIMING] ✅ Added visual embedding: "${visualText}"`);
          //     } catch (error) {
          //       console.warn('[SEARCH-TIMING] ❌ Visual embedding failed:', error);
          //     }
          //   }
            
          //   // Audio embedding - use embedding text or keywords
          //   const audioKeywords = multiModalQuery.searchKeywords.audio;
          //   if (audioKeywords && audioKeywords.length > 0) {
          //     try {
          //       const audioText = multiModalQuery.embeddings.audio || audioKeywords.join(' ');
          //       const audioEmbedding = await this.llm.generateEmbedding(audioText);
          //       embeddings.push(audioEmbedding);
          //       console.log(`[SEARCH-TIMING] ✅ Added audio embedding: "${audioText}"`);
          //     } catch (error) {
          //       console.warn('[SEARCH-TIMING] ❌ Audio embedding failed:', error);
          //     }
          //   }
          // }
          
          // Combine embeddings (average for now, could be weighted)
          const combinedEmbedding = embeddings.length > 1 
            ? new Float32Array(embeddings[0].map((_, idx) => 
                embeddings.reduce((sum, emb) => sum + emb[idx], 0) / embeddings.length
              ))
            : textEmbedding;
            
          console.log(`[SEARCH-TIMING] ⏱️  Embedding generation took: ${Date.now() - embeddingStart}ms (${embeddings.length} embeddings)`);
          
          // TODO: Apply temporal filters if specified (disabled for now - needs segment filtering logic)
          if (multiModalQuery?.filters.timeRange) {
            console.log(`[SEARCH-TIMING] 📅 Time filter detected: ${multiModalQuery.filters.timeRange[0]}s - ${multiModalQuery.filters.timeRange[1]}s (filtering disabled for now)`);
          }

          const vectorSearchStart = Date.now();
          const paginatedResults = await this.vecDb.searchSimilar(combinedEmbedding, searchLimit, 0, q);
          console.log(`[SEARCH-TIMING] ⏱️  Vector search took: ${Date.now() - vectorSearchStart}ms, found ${paginatedResults.results.length} results`);
          
          // Transform and group results by media type with enhanced scoring
          const transformStart = Date.now();
          const allItems = paginatedResults.results.map(r => {
            const mimeType = getMimeType(r.path);
            const lower = (mimeType || '').toLowerCase();
            let type: 'image' | 'video' | 'audio' = 'image';
            
            // First check database type for video segments
            if (r.type === 'video_segment' || r.type === 'video') {
              type = 'video';
            } else if (r.type === 'audio') {
              type = 'audio';
            } else if (lower.startsWith('video/')) {
              type = 'video';
            } else if (lower.startsWith('audio/')) {
              type = 'audio';
            }
            
            // Enhanced scoring based on query classification
            let enhancedScore = r.similarity || 0;
            if (multiModalQuery && queryClassification) {
              // Boost score based on query type matching content type
              if (queryClassification.type === 'temporal' && r.path.includes('#t=')) {
                enhancedScore *= 1.1; // Boost temporal queries for segments
              }
              if (queryClassification.type === 'spatial' && r.type === 'video') {
                enhancedScore *= 1.05; // Boost spatial queries for videos
              }
            }
            
            return {
              id: r.id,
              name: r.name,
              path: r.path,
              size: r.size,
              type,
              mimeType: mimeType || (type === 'video' ? 'video/mp4' : undefined),
              sourceId: r.sourceId,
              createdAt: new Date(),
              score: enhancedScore,
              metadata: (r as any).metadata ? (typeof (r as any).metadata === 'string' ? JSON.parse((r as any).metadata) : (r as any).metadata) : undefined,
              queryType: queryClassification?.type, // Store query type for debugging
              matchingKeywords: enhancedEntities.slice(0, 3) // Top matching keywords
            };
          });
          console.log(`[SEARCH-TIMING] ⏱️  Result transformation took: ${Date.now() - transformStart}ms`);

          // Group by type and apply pagination per type
          const groupingStart = Date.now();
          const imageItems = allItems.filter(item => item.type === 'image');
          const audioItems = allItems.filter(item => item.type === 'audio');
          
          // For videos, deduplicate parent videos and segments
          const videoItems = allItems.filter(item => item.type === 'video');
          const dedupeStart = Date.now();
          const deduplicatedVideos = await this.deduplicateVideoResults(videoItems);
          console.log(`[SEARCH-TIMING] ⏱️  Video deduplication took: ${Date.now() - dedupeStart}ms (${videoItems.length} → ${deduplicatedVideos.length})`);
          console.log(`[SEARCH-TIMING] ⏱️  Type grouping took: ${Date.now() - groupingStart}ms (${imageItems.length} images, ${deduplicatedVideos.length} videos, ${audioItems.length} audio)`);
          
          const typeGroups = {
            image: imageItems,
            video: deduplicatedVideos,
            audio: audioItems
          };

          // Apply pagination and limits per type
          const paginationStart = Date.now();
          requestedTypes.forEach(type => {
            const items = typeGroups[type] || [];
            const total = items.length;
            const paginatedItems = items.slice(offset, offset + limit);
            
            if (type === 'image') {
              grouped.images = paginatedItems;
              grouped.totals.images = total;
              grouped.hasMore.images = (offset + limit) < total;
            } else if (type === 'video') {
              grouped.videos = paginatedItems;
              grouped.totals.videos = total;
              grouped.hasMore.videos = (offset + limit) < total;
            } else if (type === 'audio') {
              grouped.audio = paginatedItems;
              grouped.totals.audio = total;
              grouped.hasMore.audio = (offset + limit) < total;
            }
          });
          console.log(`[SEARCH-TIMING] ⏱️  Pagination took: ${Date.now() - paginationStart}ms`);

          const executionTime = Date.now() - started;
          console.log(`[SEARCH-TIMING] ✅ Semantic search completed in ${executionTime}ms`);
          console.log(`[SEARCH-TIMING] 📊 Results: ${grouped.images.length} images, ${grouped.videos.length} videos, ${grouped.audio.length} audio`);
          
          // Debug: Log video segments details
          if (grouped.videos.length > 0) {
            grouped.videos.forEach((video, idx) => {
              console.log(`[SEARCH-RESULT-DEBUG] Video ${idx + 1}:`, {
                name: video.name,
                path: video.path,
                hasSegments: video.hasSegments,
                segmentCount: video.segments?.length || 0,
                segments: video.segments?.map((s: any) => `${s.startTime}s-${s.endTime}s`) || []
              });
            });
          }
          
          return { 
            success: true, 
            results: { 
              ...grouped,
              query: q, 
              executionTime
            } 
          };
        } catch (e) {
          console.warn('[UNIFIED-SEARCH] Semantic search failed, falling back to basic search:', e);
          // Fall through to fallback below
        }
      }

      // Fallback: search main DB with text filtering
      try {
        console.log(`[SEARCH-TIMING] 📝 Using fallback text search`);
        const dbFetchStart = Date.now();
        const allItems = await this.db.getMediaItems();
        console.log(`[SEARCH-TIMING] ⏱️  Database fetch took: ${Date.now() - dbFetchStart}ms, got ${allItems.length} items`);
        let filteredItems = allItems as any[];

        // Apply text filtering if query provided
        const filterStart = Date.now();
        if (q) {
          const queryLower = q.toLowerCase();
          filteredItems = allItems.filter((item: any) =>
            (item.name || '').toLowerCase().includes(queryLower) ||
            (item.description || '').toLowerCase().includes(queryLower) ||
            (item.path || '').toLowerCase().includes(queryLower)
          );
        }
        console.log(`[SEARCH-TIMING] ⏱️  Text filtering took: ${Date.now() - filterStart}ms (${allItems.length} → ${filteredItems.length} items)`);

        // Transform items with proper type detection
        const transformStart = Date.now();
        const transformedItems = filteredItems.map((it: any) => {
          const mimeType = getMimeType(it.path);
          const lower = (mimeType || '').toLowerCase();
          let type: 'image' | 'video' | 'audio' = it.type || 'image';
          
          // First check database type for video segments
          if (it.type === 'video_segment' || it.type === 'video') {
            type = 'video';
          } else if (it.type === 'audio') {
            type = 'audio';
          } else if (lower.startsWith('video/')) {
            type = 'video';
          } else if (lower.startsWith('audio/')) {
            type = 'audio';
          } else if (lower.startsWith('image/')) {
            type = 'image';
          }
          
          return {
            id: it.id,
            name: it.name,
            path: it.path,
            size: it.size,
            type,
            mimeType: mimeType || (type === 'video' ? 'video/mp4' : undefined),
            sourceId: it.sourceId,
            createdAt: it.createdAt ? new Date(it.createdAt) : new Date(),
            metadata: it.metadata ? (typeof it.metadata === 'string' ? JSON.parse(it.metadata) : it.metadata) : undefined,
          };
        });
        console.log(`[SEARCH-TIMING] ⏱️  Result transformation took: ${Date.now() - transformStart}ms`);

        // Group by type
        const groupingStart = Date.now();
        const imageItems = transformedItems.filter(item => item.type === 'image');
        const audioItems = transformedItems.filter(item => item.type === 'audio');
        
        // For videos, deduplicate parent videos and segments
        const videoItems = transformedItems.filter(item => item.type === 'video');
        const dedupeStart = Date.now();
        const deduplicatedVideos = await this.deduplicateVideoResults(videoItems);
        console.log(`[SEARCH-TIMING] ⏱️  Video deduplication took: ${Date.now() - dedupeStart}ms (${videoItems.length} → ${deduplicatedVideos.length})`);
        console.log(`[SEARCH-TIMING] ⏱️  Type grouping took: ${Date.now() - groupingStart}ms (${imageItems.length} images, ${deduplicatedVideos.length} videos, ${audioItems.length} audio)`);
        
        const typeGroups = {
          image: imageItems,
          video: deduplicatedVideos,
          audio: audioItems
        };

        // Apply pagination per type
        const paginationStart = Date.now();
        requestedTypes.forEach(type => {
          const items = typeGroups[type] || [];
          
          // Sort by createdAt desc
          items.sort((a: any, b: any) => {
            const aDate = new Date(a.createdAt || 0);
            const bDate = new Date(b.createdAt || 0);
            return bDate.getTime() - aDate.getTime();
          });

          const total = items.length;
          const paginatedItems = items.slice(offset, offset + limit);
          
          if (type === 'image') {
            grouped.images = paginatedItems;
            grouped.totals.images = total;
            grouped.hasMore.images = (offset + limit) < total;
          } else if (type === 'video') {
            grouped.videos = paginatedItems;
            grouped.totals.videos = total;
            grouped.hasMore.videos = (offset + limit) < total;
          } else if (type === 'audio') {
            grouped.audio = paginatedItems;
            grouped.totals.audio = total;
            grouped.hasMore.audio = (offset + limit) < total;
          }
        });
        console.log(`[SEARCH-TIMING] ⏱️  Pagination took: ${Date.now() - paginationStart}ms`);

        const executionTime = Date.now() - started;
        console.log(`[SEARCH-TIMING] ✅ Fallback search completed in ${executionTime}ms`);
        console.log(`[SEARCH-TIMING] 📊 Results: ${grouped.images.length} images, ${grouped.videos.length} videos, ${grouped.audio.length} audio`);
        return {
          success: true,
          results: {
            ...grouped,
            query: q,
            executionTime
          }
        };
      } catch (fallbackError) {
        console.error('[UNIFIED-SEARCH] Fallback search failed:', fallbackError);
        throw fallbackError;
      }
    } catch (error) {
      console.error('[UNIFIED-SEARCH] Search failed:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown search error' 
      };
    }
  }

  /**
   * Deduplicate video results to avoid showing both parent video and segments
   * Groups by video file path and shows parent video with segment count
   */
  private static async deduplicateVideoResults(videoItems: any[]): Promise<any[]> {
    // Group by video file path (remove #t= fragments for segments)
    const videoGroups = new Map<string, any[]>();
    
    videoItems.forEach(item => {
      // Extract base video path (remove #t=start,end for segments)
      const basePath = item.path.split('#t=')[0];
      
      if (!videoGroups.has(basePath)) {
        videoGroups.set(basePath, []);
      }
      videoGroups.get(basePath)!.push(item);
    });

    // For each video group, return the best representation
    const results = await Promise.all(
      Array.from(videoGroups.entries()).map(async ([basePath, items]) => {
        // Separate parent videos and segments
        const parentVideos = items.filter(item => !item.path.includes('#t='));
        const segments = items.filter(item => item.path.includes('#t='));
        
        // If we only have segments, try to fetch the parent video from database
        if (parentVideos.length === 0 && segments.length > 0) {
          try {
            const allItems = await this.db.getMediaItems();
            const parentVideo = allItems.find((item: any) => 
              item.path === basePath && item.type === 'video'
            );
            
            if (parentVideo) {
              // Add metadata field with proper structure
              const metadata = parentVideo.metadata ? 
                (typeof parentVideo.metadata === 'string' ? JSON.parse(parentVideo.metadata) : parentVideo.metadata) 
                : undefined;
              
              return {
                ...parentVideo,
                metadata,
                name: `${parentVideo.name} (${segments.length} segments match)`,
                matchingSegments: segments.length,
                hasSegments: true,
                type: 'video',
                mimeType: 'video/mp4',
                segments: segments.map(seg => ({
                  id: seg.id,
                  name: seg.name,
                  path: seg.path,
                  startTime: seg.path.match(/#t=([^,]+),/)?.[1],
                  endTime: seg.path.match(/#t=[^,]+,([^&]+)/)?.[1],
                  score: seg.score
                }))
              };
            }
          } catch (error) {
            console.error('[DEDUP-ERROR] Failed to fetch parent video:', error);
          }
        }
        
        // Prefer parent video if it exists, otherwise use best segment
        const primaryItem = parentVideos.length > 0 ? parentVideos[0] : segments[0];
        
        if (!primaryItem) return null;
        
        // If we have both parent and segments, show parent with segment info
        if (parentVideos.length > 0 && segments.length > 0) {
          const parentVideo = parentVideos[0];
          return {
            ...parentVideo, // Use parent video (which has thumbnail metadata)
            name: `${parentVideo.name} (${segments.length} segments match)`,
            matchingSegments: segments.length,
            hasSegments: true,
            segments: segments.map(seg => ({
              id: seg.id,
              name: seg.name,
              path: seg.path,
              startTime: seg.path.match(/#t=([^,]+),/)?.[1],
              endTime: seg.path.match(/#t=[^,]+,([^&]+)/)?.[1],
              score: seg.score
            })) // Store segment info for future chapter-like functionality
          };
        }
        
        return primaryItem;
      })
    );
    
    return results.filter(Boolean);
  }

  /**
   * Legacy search functionality - now wraps unifiedSearch for backward compatibility
   */
  static async search(query: any): Promise<{ success: boolean; results?: any; error?: string }> {
    try {
      await this.ensureInitialized();
      const q = String(query.query || '').trim();
      const limit = query.limit || 20;
      const offset = query.offset || 0;
      const started = Date.now();

      // Try semantic search first if available
      if (this.vecDb && this.llm && q) {
        try {
          const textEmbedding = await this.llm.generateEmbedding(q);
          const paginatedResults = await this.vecDb.searchSimilar(textEmbedding, limit, offset, q);
          const items = paginatedResults.results.map(r => {
            const mimeType = getMimeType(r.path);
            const lower = (mimeType || '').toLowerCase();
            let type: 'image' | 'video' | 'audio' = 'image';
            if (lower.startsWith('video/')) type = 'video';
            else if (lower.startsWith('audio/')) type = 'audio';
            
            return {
              id: r.id,
              name: r.name,
              path: r.path,
              size: r.size,
              type,
              mimeType,
              sourceId: r.sourceId,
              createdAt: new Date(),
            };
          });
          const executionTime = Date.now() - started;
          return { 
            success: true, 
            results: { 
              items, 
              total: paginatedResults.total, 
              hasMore: paginatedResults.hasMore,
              query: q, 
              executionTime, 
              suggestions: [] 
            } 
          };
        } catch (e) {
          console.warn('[SEARCH] Semantic search failed, falling back to basic search:', e);
          // do not return; fall through to fallback below
        }
      }

      // Fallback: return items from main DB with simple text filtering and pagination
      try {
        const allItems = await this.db.getMediaItems();
        let filteredItems = allItems as any[];

        if (q) {
          const queryLower = q.toLowerCase();
          filteredItems = allItems.filter((item: any) =>
            (item.name || '').toLowerCase().includes(queryLower) ||
            (item.description || '').toLowerCase().includes(queryLower) ||
            (item.path || '').toLowerCase().includes(queryLower)
          );
        }

        // Sort by createdAt desc if present
        filteredItems.sort((a: any, b: any) => {
          const aDate = new Date(a.createdAt || 0);
          const bDate = new Date(b.createdAt || 0);
          return bDate.getTime() - aDate.getTime();
        });

        const total = filteredItems.length;
        const items = filteredItems.slice(offset, offset + limit).map((it: any) => {
          const mimeType = getMimeType(it.path);
          const lower = (mimeType || '').toLowerCase();
          let type: 'image' | 'video' | 'audio' = it.type || 'image';
          
          // Override type based on MIME type if database type is wrong or missing
          if (lower.startsWith('video/')) type = 'video';
          else if (lower.startsWith('audio/')) type = 'audio';
          else if (lower.startsWith('image/')) type = 'image';
          
          return {
            id: it.id,
            name: it.name,
            path: it.path,
            size: it.size,
            type,
            mimeType,
            sourceId: it.sourceId,
            createdAt: it.createdAt ? new Date(it.createdAt) : new Date(),
          };
        });
        const hasMore = (offset + limit) < total;

        const executionTime = Date.now() - started;
        return {
          success: true,
          results: {
            items,
            total,
            hasMore,
            query: q,
            executionTime,
            suggestions: []
          }
        };
      } catch (fallbackError) {
        console.error('[SEARCH] Fallback search failed:', fallbackError);
        const executionTime = Date.now() - started;
        return { success: false, error: fallbackError instanceof Error ? fallbackError.message : 'Unknown error', results: { items: [], total: 0, hasMore: false, query: q, executionTime, suggestions: [] } };
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Text search functionality
   */
  static async searchText(text: string, limit?: number): Promise<{ success: boolean; results?: any; error?: string }> {
    return this.search({ query: text, limit: limit || 10 });
  }

  /**
   * Get search suggestions
   */
  static async getSuggestions(query: string, limit: number = 2): Promise<{ success: boolean; suggestions?: string[]; error?: string }> {
    try {
      const suggestions = [];
      for (let i = 1; i <= limit; i++) {
        suggestions.push(`${query} suggestion ${i}`);
      }
      return { success: true, suggestions };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Update concurrency settings (placeholder)
   */
  static async updateConcurrencySettings(limit: number): Promise<{ success: boolean; error?: string }> {
    try {
      console.log(`Concurrency limit updated to: ${limit}`);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Invalid concurrency limit' };
    }
  }

  /**
   * Get current configuration (placeholder)
   */
  static async getConfiguration(): Promise<{ success: boolean; config?: any; error?: string }> {
    try {
      const config = { indexing: { reindexOnStartup: false }, concurrency: { limit: 3 } };
      return { success: true, config };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to get configuration' };
    }
  }

  /**
   * Enable debug mode (placeholder)
   */
  static async enableDebugMode(_saveImages: boolean = true, _saveLLaVAOutputs: boolean = true, _outputDir?: string): Promise<{ success: boolean; error?: string }> {
    try {
      console.log('Debug mode enabled');
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to enable debug mode' };
    }
  }

  /**
   * Disable debug mode (placeholder)
   */
  static async disableDebugMode(): Promise<{ success: boolean; error?: string }> {
    try {
      console.log('Debug mode disabled');
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to disable debug mode' };
    }
  }

  /**
   * Check if Ollama is available (placeholder)
   */
  static async isOllamaAvailable(): Promise<{ success: boolean; available: boolean; error?: string }> {
    try {
      return { success: true, available: false };
    } catch (error) {
      return { success: false, available: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Get image thumbnail (placeholder)
   */
  static async getImageThumbnail(_imagePath: string): Promise<{ success: boolean; dataUrl?: string; error?: string }> {
    try {
      const imagePath = _imagePath;
      if (!imagePath) {
        return { success: false, error: 'Empty image path' };
      }

      // Read the image from disk and return a data URL. This runs in Electron main, so Node fs is available.
      const data = await fs.readFile(imagePath);
      // Derive mime type from extension
      const ext = (path.extname(imagePath) || '').replace('.', '').toLowerCase();
      const mime = getMimeType(imagePath) || (ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'png' ? 'image/png' : 'application/octet-stream');
      const base64 = data.toString('base64');
      const dataUrl = `data:${mime};base64,${base64}`;
      return { success: true, dataUrl };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

}
