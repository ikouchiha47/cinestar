import { MainDatabase } from '../core/main-database';
import { SqliteMainDatabase } from '../core/sqlite-main-database';
import { MediaSource } from '../core/types';
import { LLMProvider, LLMProviderFactory } from '../core/llm-provider';
import { SqliteVecDatabase } from '../core/sqlite-vec-database';
import { ImageCompressor } from '../core/image-compressor';
import { ConfigManager } from '../core/config';
import { DatabaseMigrator, getDefaultDataDir } from '../core/database-migrator';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

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

  static async initialize(dbPath?: string): Promise<void> {
    if (this.initialized) return;
    
    // Use default data directory if no path provided (fresh install scenario)
    const dataDir = dbPath ?? getDefaultDataDir();
    
    // Select backend (default: sqlite)
    const backend = (process.env.MAIN_DB_BACKEND || 'sqlite').toLowerCase();
    if (backend === 'sqlite') {
      // If a directory was passed, append a filename
      const isFile = path.extname(dataDir).toLowerCase() === '.db';
      const filePath = isFile ? dataDir : path.join(dataDir, process.env.VECTOR_DB_FILENAME || 'vector.db');
      
      // Run database migrations for fresh installs
      console.log('[MainMediaAPI] Checking database migrations...');
      const migrator = new DatabaseMigrator(filePath);
      const migrationResult = await migrator.migrate();
      
      if (!migrationResult.success) {
        throw new Error(`Database migration failed: ${migrationResult.error}`);
      }
      
      if (migrationResult.migrationsRun.length > 0) {
        console.log(`[MainMediaAPI] Applied ${migrationResult.migrationsRun.length} migrations:`, migrationResult.migrationsRun);
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
    } else {
      // Legacy JSON-backed implementation
      this.db = new MainDatabase(dataDir);
      this.backendType = 'json';
      this.dbPathInfo = dataDir;
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
    offset?: number 
  }): Promise<{ success: boolean; items?: any[]; total?: number; error?: string }> {
    try {
      await this.ensureInitialized();
      console.log(`[MainMediaAPI] getRecentItems using backend=${this.backendType}`);
      const allItems: any[] = await this.db.getMediaItems();
      
      let filteredItems = allItems;
      
      // Filter by source IDs if provided
      if (params?.sourceIds?.length) {
        const sourceIdSet = new Set(params.sourceIds);
        filteredItems = filteredItems.filter((item: any) => sourceIdSet.has(item.sourceId));
      }
      
      // Filter by types if provided
      if (params?.types?.length) {
        const typeSet = new Set(params.types);
        filteredItems = filteredItems.filter((item: any) => {
          const mime: string = (item.mimeType || '').toLowerCase();
          if (mime.startsWith('video/')) return typeSet.has('video');
          if (mime.startsWith('audio/')) return typeSet.has('audio');
          return typeSet.has('image');
        });
      }
      
      // Sort by creation date (most recent first)
      filteredItems.sort((a: any, b: any) => {
        const aDate = new Date(a.createdAt || 0);
        const bDate = new Date(b.createdAt || 0);
        return bDate.getTime() - aDate.getTime();
      });
      
      const total = filteredItems.length;
      const offset = params?.offset || 0;
      const limit = params?.limit || 50;
      
      const items = filteredItems.slice(offset, offset + limit);
      
      return { success: true, items, total };
    } catch (error) {
      console.error('Failed to get recent items:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Get media items, optionally filtered by sourceId
   */
  static async getItems(sourceId?: string): Promise<{ success: boolean; items?: any[]; error?: string }> {
    try {
      await this.ensureInitialized();
      console.log(`[MainMediaAPI] getItems(${sourceId ?? 'ALL'}) using backend=${this.backendType}`);
      const items = await this.db.getMediaItems(sourceId);
      return { success: true, items };
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
    try {
      await this.ensureInitialized();
      const stats = await fs.stat(filePath);
      const name = path.basename(filePath);
      const mime = this.getMimeType(filePath);
      const lower = (mime || '').toLowerCase();
      let type: 'image' | 'video' | 'audio' | 'other' = 'other';
      if (lower.startsWith('image/')) type = 'image';
      else if (lower.startsWith('video/')) type = 'video';
      else if (lower.startsWith('audio/')) type = 'audio';

      const id = await this.db.addMediaItem({
        sourceId,
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
      return { success: true, id };
    } catch (error) {
      console.error('[MainMediaAPI] addItemForFile failed:', error);
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

      const jobId = await this.db.createJob({ sourceId });
      
      // Start indexing in background (simplified version)
      this.performIndexing(jobId, sourceId).catch(error => {
        console.error('Indexing failed:', error);
        this.db.updateJobStatus(jobId, 'failed', 0);
      });
      
      return { success: true, jobId };
    } catch (error) {
      console.error('Failed to start indexing:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
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
   * Get indexing status
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
      const jobs = await this.db.getActiveJobs();
      const activeJobs = jobs.map((job: any) => job.id);
      
      const jobDetails = jobs.map((j: any) => ({
        id: j.id,
        sourceId: j.sourceId,
        status: j.status,
        progress: j.progress,
        totalItems: j.totalItems,
        processedItems: j.processedItems,
        startedAt: j.startedAt,
        completedAt: j.completedAt,
      }));
      
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
  private static async performIndexing(jobId: string, sourceId: string): Promise<void> {
    try {
      console.log(`Starting indexing job ${jobId} for source ${sourceId}`);
      
      const source = await this.db.getSource(sourceId);
      if (!source) {
        throw new Error(`Source not found: ${sourceId}`);
      }
      
      await this.db.updateJobStatus(jobId, 'running');
      
      // Import file scanner
      const { scanDirectory } = await import('../core/file-scanner');
      
      // Scan for media files
      const mediaFiles = await scanDirectory(source.path, source.config?.recursive !== false);
      console.log(`Found ${mediaFiles.length} media files`);
      
      if (mediaFiles.length === 0) {
        await this.db.updateJobStatus(jobId, 'completed', 100);
        return;
      }
      
      // Process files: add to SQLite and (if available) generate captions + embeddings
      let processedCount = 0;
      
      for (const file of mediaFiles) {
        try {
          // 0) Optional compression for vision models
          let inferencePath = file.path;
          try {
            const cfg = ConfigManager.getConfig();
            if (cfg.compression.enabled && ImageCompressor.shouldCompress(file.path, file.size)) {
              const tempDir = path.join(os.tmpdir(), 'driller-compressed');
              const settings = ImageCompressor.getOptimalSettings(file.path, file.size, cfg.ai.visionModelDims);
              const res = await ImageCompressor.compressImage(file.path, tempDir, settings);
              inferencePath = res.compressedPath;
              console.log(`[INDEX] Using compressed image for inference: ${path.basename(inferencePath)}`);
            }
          } catch (e) {
            console.warn('[INDEX] Compression step failed, falling back to original:', e);
          }

          // 1) Persist to main items table (upsert by sourceId+path)
          const itemId = await this.db.addMediaItem({
            sourceId,
            name: file.name,
            path: file.path,
            size: file.size,
            type: file.type,
            mimeType: this.getMimeType(file.path),
            createdAt: new Date(),
            modifiedAt: file.lastModified,
            description: `${file.type} file: ${file.name}`,
            metadata: {}
          });
          // 2) Persist to sqlite-vec media_items with pending statuses
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
              console.log(`[INDEX] Staged item in sqlite-vec with ID ${itemId}: ${file.name}`);
            } catch (e) {
              console.warn('[INDEX] Failed to stage item in sqlite-vec media_items:', e);
            }
          }

          // 3) If LLM available, generate caption + embeddings (no fallbacks)
          if (this.llm && this.vecDb) {
            try {
              const caption = await this.llm.generateImageDescription(inferencePath, file.path);
              this.vecDb.updateCaption(itemId, caption, 'completed');
            } catch (e) {
              console.warn('[INDEX] Caption generation failed:', e);
              try { this.vecDb.updateStatus(itemId, 'failed', undefined); } catch {}
            }
            try {
              const embedding = await this.llm!.generateImageEmbedding(inferencePath);
              this.vecDb.updateEmbedding(itemId, embedding, 'completed');
              if (typeof (this.db as any).updateItemEmbedding === 'function') {
                try { await (this.db as any).updateItemEmbedding(itemId, embedding); } catch {}
              }
              console.log(`[INDEX] Stored embedding for ${file.name} (${embedding.length} dims)`);
            } catch (e) {
              console.warn('[INDEX] Embedding generation failed (no fallback):', e);
              try { this.vecDb.updateStatus(itemId, undefined, 'failed'); } catch {}
            }
          }
          
          processedCount++;
          const progress = Math.floor((processedCount / mediaFiles.length) * 100);
          await this.db.updateJobStatus(jobId, 'running', progress);
          
        } catch (error) {
          console.error(`Failed to process file ${file.name}:`, error);
        }
      }
      
      await this.db.updateJobStatus(jobId, 'completed', 100);
      console.log(`Indexing job ${jobId} completed. Processed ${processedCount}/${mediaFiles.length} files`);
      
    } catch (error) {
      console.error(`Indexing job ${jobId} failed:`, error);
      await this.db.updateJobStatus(jobId, 'failed', 0);
    }
  }

  /**
   * Search functionality (simplified implementation)
   */
  static async search(query: any): Promise<{ success: boolean; results?: any; error?: string }> {
    try {
      await this.ensureInitialized();
      const q = String(query.query || '').trim();
      const limit = query.limit || 20;
      const started = Date.now();

      if (this.vecDb && this.llm && q) {
        try {
          // Semantic search via sqlite-vec (vector-only)
          const textEmbedding = await this.llm.generateEmbedding(q);
          const vecResults = await this.vecDb.searchSimilar(textEmbedding, limit, q);
          const items = vecResults.map(r => ({
            id: r.id,
            name: r.name,
            path: r.path,
            size: r.size,
            type: 'image',
            mimeType: this.getMimeType(r.path),
            sourceId: r.sourceId,
            createdAt: new Date(),
          }));
          const executionTime = Date.now() - started;
          return { success: true, results: { items, total: items.length, query: q, executionTime, suggestions: [] } };
        } catch (e) {
          console.warn('[SEARCH] Semantic search failed (vector-only):', e);
          // Vector-only: return empty results on failure
          const executionTime = Date.now() - started;
          return { success: true, results: { items: [], total: 0, query: q, executionTime, suggestions: [] } };
        }
      }

      // Vector-only enforcement: if no vecDb/llm or no query, return empty
      const executionTime = Date.now() - started;
      return { success: true, results: { items: [], total: 0, query: q, executionTime, suggestions: [] } };
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
      const mime = this.getMimeType(imagePath) || (ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'png' ? 'image/png' : 'application/octet-stream');
      const base64 = data.toString('base64');
      const dataUrl = `data:${mime};base64,${base64}`;
      return { success: true, dataUrl };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Simple mime type detection
   */
  private static getMimeType(filePath: string): string {
    const ext = filePath.toLowerCase().split('.').pop() || '';
    const mimeTypes: { [key: string]: string } = {
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'webp': 'image/webp',
      'mp4': 'video/mp4',
      'mov': 'video/quicktime',
      'avi': 'video/x-msvideo',
      'mkv': 'video/x-matroska',
      'webm': 'video/webm',
      'm4v': 'video/x-m4v',
      'flv': 'video/x-flv',
      'wmv': 'video/x-ms-wmv',
      'mp3': 'audio/mpeg',
      'wav': 'audio/wav',
      'flac': 'audio/flac',
      'm4a': 'audio/mp4',
      'aac': 'audio/aac',
      'ogg': 'audio/ogg'
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }
}
