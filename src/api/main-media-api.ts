import { SqliteMainDatabase } from '../core/sqlite-main-database';
import { MediaSource } from '../core/types';
import { LLMProvider, LLMProviderFactory } from '../core/llm-provider';
// Removed unused imports
import { UnifiedMigrator, getDefaultDataDir } from '../core/unified-migrator';
import { getMimeType } from '../core/utils';
import { promises as fs } from 'fs';
import * as path from 'path';
// import * as os from 'os';
import { ConfigStore, StrategyFlags } from '../core/config-store';
import { CanonicalMediaDatabase } from '../core/canonical-media-database';
import { SearchService } from '../core/search-service';
import { ImageSearchStoreSqlite } from '../core/image-search-store-sqlite';
import { AVSearchStoreSqlite } from '../core/av-search-store-sqlite';
import { ImageHybridStore } from '../core/image-hybrid-store';
import { AVHybridStore } from '../core/av-hybrid-store';
import { ImageModalityVecDatabase } from '../core/image-modality-vec-database';
import { AVModalityVecDatabase } from '../core/av-modality-vec-database';
import { IImageSearchStore, IAVSearchStore } from '../core/interfaces/search-store';
import { SqliteVecDatabase } from '../core/sqlite-vec-database';
import { runModalityBackfillIfNeeded } from '../core/modality-backfill';
import { SqliteJobsDatabase } from '../core/sqlite-jobs-database';
import { SearchScoringService } from '../core/search-scoring-service';

/**
 * Minimal Main process MediaAPI for basic functionality
 * This runs in the Electron main process
 */
export class MainMediaAPI {
  // Use a common surface; implementation can be JSON-backed or SQLite-backed
  private static db: any;
  private static jobsDb: SqliteJobsDatabase | null = null;
  private static initialized = false;
  private static backendType: 'sqlite' | 'json' = 'sqlite';
  private static dbPathInfo: string = '';
  private static llm: LLMProvider | null = null;
  private static vecDb: SqliteVecDatabase | null = null;
  private static reconciliationInterval: NodeJS.Timeout | null = null;
  private static mainWindow: any = null; // BrowserWindow reference for IPC events
  // Strategy/config
  private static flags: StrategyFlags = { dualWrite: false, useNewCatalog: false, useNewImageSearch: false, useNewAVSearch: false };
  private static partitions: Record<string, { id: string; role: string; file_path: string }> = {};
  private static sourcePartitionMap: Record<string, { catalog_partition_id: string; image_partition_id: string; av_partition_id: string }> = {};
  private static canonical: CanonicalMediaDatabase | null = null;
  private static configStore: ConfigStore | null = null;
  private static dataDirPath: string = '';
  private static searchService: SearchService | null = null;

  /**
   * Set the main window reference for IPC events
   */
  static setMainWindow(window: any): void {
    this.mainWindow = window;
  }

  /**
   * Get recent media items grouped by type with independent cursors and limits
   */
  static async getRecentItemsGrouped(params?: {
    limits?: { images?: number; videos?: number; audio?: number };
    cursors?: { images?: string; videos?: string; audio?: string };
    orderBy?: 'createdAt' | 'modifiedAt' | 'name' | 'size';
    orderDirection?: 'asc' | 'desc';
  }): Promise<{ success: boolean; results?: {
    images: any[]; videos: any[]; audio: any[];
    hasMore: { images: boolean; videos: boolean; audio: boolean };
    nextCursor: { images?: string; videos?: string; audio?: string };
  }; error?: string }> {
    try {
      await this.ensureInitialized();
      const limits = params?.limits || {};
      const cursors = params?.cursors || {};
      const orderBy = params?.orderBy || 'createdAt';
      const orderDirection = params?.orderDirection || 'desc';

      // Map camelCase to snake_case for database
      const orderByMap: Record<string, 'created_at' | 'modified_at' | 'name' | 'size'> = {
        'createdAt': 'created_at',
        'modifiedAt': 'modified_at',
        'name': 'name',
        'size': 'size'
      };
      const dbOrderBy = orderByMap[orderBy] || 'created_at';

      const [imagesRes, videosRes, audioRes] = [
        await this.canonicalGetMediaItemsPaginated({
          types: ['image'],
          limit: limits.images ?? 20,
          cursor: cursors.images,
          orderBy: dbOrderBy,
          orderDirection: orderDirection === 'asc' ? 'ASC' : 'DESC'
        }),
        await this.canonicalGetMediaItemsPaginated({
          types: ['video'],
          limit: limits.videos ?? 20,
          cursor: cursors.videos,
          orderBy: dbOrderBy,
          orderDirection: orderDirection === 'asc' ? 'ASC' : 'DESC'
        }),
        await this.canonicalGetMediaItemsPaginated({
          types: ['audio'],
          limit: limits.audio ?? 20,
          cursor: cursors.audio,
          orderBy: dbOrderBy,
          orderDirection: orderDirection === 'asc' ? 'ASC' : 'DESC'
        })
      ];

      // Enrich videos with quick thumbnail metadata if available
      try {
        const { getCacheDir } = await import('../core/video-processing');
        for (const v of videosRes.items) {
          try {
            const cacheDir = getCacheDir(v.path);
            const thumbPath = path.join(cacheDir, 'quick_thumb.jpg');
            try {
              await fs.access(thumbPath);
              (v as any).metadata = { ...(v as any).metadata, thumbnailPath: thumbPath, thumbnailUrl: `file://${thumbPath}` };
            } catch {}
          } catch {}
        }
      } catch (e) {
        console.warn('[LISTING-THUMB] Failed to enrich video thumbnails (non-fatal):', e);
      }

      return {
        success: true,
        results: {
          images: imagesRes.items,
          videos: videosRes.items,
          audio: audioRes.items,
          hasMore: {
            images: imagesRes.hasMore,
            videos: videosRes.hasMore,
            audio: audioRes.hasMore
          },
          nextCursor: {
            images: imagesRes.nextCursor,
            videos: videosRes.nextCursor,
            audio: audioRes.nextCursor
          }
        }
      };
    } catch (error) {
      console.error('Failed to get recent items grouped:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  private static buildSearchStores(baseDir: string) {
    try {
      const imageStorePaths = new Set<string>();
      const avStorePaths = new Set<string>();

      // Defaults from partitions
      const defaultImg = this.partitions['default_image'];
      const defaultAv = this.partitions['default_av'];
      if (defaultImg?.file_path) imageStorePaths.add(defaultImg.file_path);
      if (defaultAv?.file_path) avStorePaths.add(defaultAv.file_path);

      // From per-source mapping
      const spm = this.sourcePartitionMap || {};

      for (const sid of Object.keys(spm)) {
        const map = spm[sid];
        if (map?.image_partition_id) {
          const part = this.partitions[map.image_partition_id];
          if (part?.file_path) imageStorePaths.add(part.file_path);
        }
        if (map?.av_partition_id) {
          const part = this.partitions[map.av_partition_id];
          if (part?.file_path) avStorePaths.add(part.file_path);
        }
      }

      // Instantiate cache-based modality stores
      const imageStores: IImageSearchStore[] = Array.from(imageStorePaths).map(p => new ImageSearchStoreSqlite(p));
      const avStores: IAVSearchStore[] = Array.from(avStorePaths).map(p => new AVSearchStoreSqlite(p));

      // Add hybrid strategy (vector + FTS with policy parity) from modality DBs when enabled
      if (this.llm) {
        try {
          if (this.flags.useNewImageSearch) {
            const imgDb = new ImageModalityVecDatabase(path.join(baseDir, 'image_search.db'));
            imageStores.push(new ImageHybridStore(imgDb, this.llm));
          }
        } catch (e) {
          console.warn('[SEARCH-ROUTE] Failed to initialize ImageModalityVecDatabase (non-fatal):', e);
        }
        try {
          if (this.flags.useNewAVSearch) {
            const avDb = new AVModalityVecDatabase(path.join(baseDir, 'av_search.db'));
            avStores.push(new AVHybridStore(avDb, this.llm));
          }
        } catch (e) {
          console.warn('[SEARCH-ROUTE] Failed to initialize AVModalityVecDatabase (non-fatal):', e);
        }
      }

      this.searchService = new SearchService(imageStores, avStores);
      console.log('[SEARCH-ROUTE] Initialized search service with', imageStores.length, 'image stores and', avStores.length, 'av stores', 'baseDir=', baseDir);
    } catch (e) {
      console.warn('[MainMediaAPI] Failed to build search stores:', e);
      this.searchService = null;
    }
  }

  static async initialize(dbPath?: string): Promise<void> {
    if (this.initialized) return;
    
    // Use default data directory if no path provided (fresh install scenario)
    const dataDir = dbPath ?? getDefaultDataDir();
    const baseDir = path.extname(dataDir).toLowerCase() === '.db' ? path.dirname(dataDir) : dataDir;
    this.dataDirPath = baseDir;
    
    // Force SQLite backend (JSON backend deprecated)
    // If a directory was passed, append a filename
    const isFile = path.extname(dataDir).toLowerCase() === '.db';
    const filePath = isFile ? dataDir : path.join(dataDir, 'vector.db');
    
    // Run unified database migrations for fresh installs
    console.log('[MainMediaAPI] Checking unified database migrations...');
    const migrator = new UnifiedMigrator(dataDir);
    const migrationResult = await migrator.migrate((evt) => {
      try {
        if (this.mainWindow?.webContents) {
          this.mainWindow.webContents.send('migration:progress', evt);
        }
      } catch {}
    });
    
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
    // Load config and strategy flags
    try {
      const configDbPath = path.join(baseDir, 'config.db');
      this.configStore = new ConfigStore(configDbPath, baseDir);
      this.flags = this.configStore.loadFlags();
      this.partitions = this.configStore.loadPartitions();
      this.sourcePartitionMap = this.configStore.loadSourcePartitionMap();
      console.log('[STRATEGY] Selected flags:', this.flags);
    } catch (e) {
      console.warn('[MainMediaAPI] Failed to load config store/flags - defaulting', e);
    }

    // Seed modality caches (idempotent) right after migrations and config load
    // This ensures image_search.db and av_search.db are populated before any store initialization
    try {
      runModalityBackfillIfNeeded(baseDir);
      console.log('[MainMediaAPI] Modality backfill checked (idempotent, post-migration)');
    } catch (e) {
      console.warn('[MainMediaAPI] Modality backfill failed (non-fatal):', e);
    }

    // Instantiate canonical catalog adapter
    try {
      const canonicalPath = path.join(baseDir, 'media.db');
      this.canonical = new CanonicalMediaDatabase(canonicalPath);
    } catch (e) {
      console.warn('[MainMediaAPI] Failed to initialize canonical media database:', e);
      this.canonical = null;
    }
    // Initialize sqlite-vec on legacy vector DB (used as vector/FTS strategy)
    try {
      const legacyVecPath = path.join(baseDir, 'vector.db');
      const legacyExists = await fs.access(legacyVecPath).then(() => true).catch(() => false);
      if (legacyExists) {
        this.vecDb = new SqliteVecDatabase(legacyVecPath);
        console.log('[MainMediaAPI] Legacy vector.db available (read-only operations expected)');
      } else {
        this.vecDb = null;
      }
    } catch (e) {
      console.error('[MainMediaAPI] Failed to initialize legacy vector database (non-fatal):', e);
      this.vecDb = null;
    }
    await this.db.initialize();
    // Initialize jobs database (jobs.db)
    try {
      const jobsPath = path.join(baseDir, 'jobs.db');
      this.jobsDb = new SqliteJobsDatabase(jobsPath);
      await this.jobsDb.initialize();
      console.log('[MainMediaAPI] Jobs DB initialized at', jobsPath);
    } catch (e) {
      console.error('[MainMediaAPI] Failed to initialize jobs database:', e);
      this.jobsDb = null;
    }
    // Initialize LLM provider (Ollama by default)
    try {
      this.llm = LLMProviderFactory.createProvider('ollama');
    } catch (e) {
      console.error('[MainMediaAPI] Failed to initialize LLM provider:', e);
      this.llm = null;
    }
    // Build search stores after LLM is resolved (vector/FTS need llm/vecDb)
    this.buildSearchStores(baseDir);
    
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
      const rows = this.canonical!.db.prepare(`
        SELECT id, name, type, root_path, status, created_at, updated_at
        FROM sources
        ORDER BY created_at DESC
      `).all() as any[];
      const sources: MediaSource[] = rows.map(r => ({
        id: r.id,
        name: r.name,
        type: r.type,
        path: r.root_path,
        enabled: r.status !== 'disabled',
        config: {},
        createdAt: r.created_at ? new Date(r.created_at) : new Date(),
      }));
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
      const { generateDeterministicId } = await import('../core/utils/crypto-utils');
      const srcId = await generateDeterministicId(`${source.name}|${source.path}`);
      this.canonical!.upsertSourceFromLegacy({
        id: srcId,
        name: source.name,
        type: source.type,
        path: source.path,
        enabled: source.enabled,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      return { success: true, id: srcId };
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
      const row = this.canonical!.db.prepare(`
        SELECT id, name, type, root_path, status FROM sources WHERE id = ?
      `).get(id) as any;
      if (!row) {
        return { success: false, error: 'Source not found' };
      }
      const next = {
        id,
        name: updates.name ?? row.name,
        type: updates.type ?? row.type,
        path: updates.path ?? row.root_path,
        enabled: updates.enabled ?? (row.status !== 'disabled'),
      };
      this.canonical!.upsertSourceFromLegacy({
        id: next.id,
        name: next.name,
        type: next.type,
        path: next.path,
        enabled: next.enabled,
        createdAt: new Date(),
        updatedAt: new Date()
      });
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
      this.canonical!.deleteSource(sourceId);
      return { success: true };
    } catch (error) {
      console.error('Failed to remove source:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Get recent media items with optional filters
   *
   * @deprecated Use `getRecentItemsGrouped()` with per-type cursors for UI listings.
   * This method returns a single merged feed across types and can starve
   * older items of a different type. Kept for scoped overlays and backward
   * compatibility.
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
      
      // Use cursor-based pagination on canonical catalog
      const result = await this.canonicalGetMediaItemsPaginated({
        types: params?.types,
        limit: params?.limit || 50,
        cursor: params?.cursor,
        orderBy: dbOrderBy,
        orderDirection: params?.orderDirection === 'asc' ? 'ASC' : 'DESC'
      });

      // Enrich videos with quick thumbnail metadata if available (non-grouped)
      try {
        const { getCacheDir } = await import('../core/video-processing');
        for (const it of result.items) {
          if (String(it.type || '').toLowerCase() !== 'video') continue;
          try {
            const cacheDir = getCacheDir(it.path);
            const thumbPath = path.join(cacheDir, 'quick_thumb.jpg');
            try {
              await fs.access(thumbPath);
              (it as any).metadata = { ...(it as any).metadata, thumbnailPath: thumbPath, thumbnailUrl: `file://${thumbPath}` };
            } catch {}
          } catch {}
        }
      } catch {}

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
      
      // Use canonical offset-based pagination
      const limit = params?.limit || 50;
      const offset = params?.offset || 0;
      const types = params?.types && params.types.length ? params.types : undefined;
      const orderBy = params?.orderBy || 'created_at';
      const orderDirection = params?.orderDirection === 'asc' ? 'ASC' : 'DESC';

      const orderColumn = orderBy === 'createdAt' ? 'created_at' : (orderBy === 'modifiedAt' ? 'modified_at' : (orderBy === 'name' ? 'path' : 'size'));
      const typeFilter = types ? `AND type IN (${types.map(() => '?').join(',')})` : '';
      const sql = `
        SELECT id, source_id, type, path, size, mime, created_at, modified_at
        FROM media_items
        WHERE deleted_at IS NULL
        ${typeFilter}
        ORDER BY ${orderColumn} ${orderDirection}
        LIMIT ? OFFSET ?
      `;
      const paramsArr: any[] = [];
      if (types) paramsArr.push(...types);
      paramsArr.push(limit, offset);
      const rows = this.canonical!.db.prepare(sql).all(...paramsArr) as any[];
      const items = rows.map(r => ({
        id: r.id,
        sourceId: r.source_id,
        name: path.basename(r.path),
        path: r.path,
        size: Number(r.size || 0),
        type: r.type,
        mimeType: r.mime,
        createdAt: r.created_at,
        modifiedAt: r.modified_at,
      }));
      const hasMore = items.length === limit; // heuristic
      
      console.log(`[MainMediaAPI] getRecentItemsWithOffset returning ${items.length} items (hasMore: ${hasMore})`);
      return { success: true, items, hasMore };
    } catch (error) {
      console.error('Failed to get recent items with offset:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  private static async canonicalGetMediaItemsPaginated(params: {
    types?: Array<'image'|'video'|'audio'>;
    limit?: number;
    cursor?: string;
    orderBy?: 'created_at'|'modified_at'|'name'|'size';
    orderDirection?: 'ASC'|'DESC';
  }): Promise<{ items: any[]; nextCursor?: string; hasMore: boolean }>{
    const limit = params.limit ?? 20;
    const types = params.types && params.types.length ? params.types : undefined;
    const orderBy = params.orderBy || 'created_at';
    const orderDirection = params.orderDirection || 'DESC';
    const orderColumn = orderBy === 'name' ? 'path' : orderBy; // name -> path

    const filters: string[] = ['deleted_at IS NULL'];
    const args: any[] = [];
    if (types) {
      filters.push(`type IN (${types.map(() => '?').join(',')})`);
      args.push(...types);
    }
    if (params.cursor) {
      if (orderDirection === 'DESC') {
        filters.push(`${orderColumn} < ?`);
      } else {
        filters.push(`${orderColumn} > ?`);
      }
      args.push(params.cursor);
    }

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const sql = `
      SELECT id, source_id, type, path, size, mime, created_at, modified_at
      FROM media_items
      ${where}
      ORDER BY ${orderColumn} ${orderDirection}
      LIMIT ?
    `;
    args.push(limit + 1); // fetch one extra to detect hasMore
    const rows = this.canonical!.db.prepare(sql).all(...args) as any[];
    const slice = rows.slice(0, limit);
    const items = slice.map(r => ({
      id: r.id,
      sourceId: r.source_id,
      name: path.basename(r.path),
      path: r.path,
      size: Number(r.size || 0),
      type: r.type,
      mimeType: r.mime,
      createdAt: r.created_at,
      modifiedAt: r.modified_at,
    }));
    const hasMore = rows.length > limit;
    const last = slice[slice.length - 1];
    const nextCursor = last ? (orderColumn === 'created_at' ? last.created_at : (orderColumn === 'modified_at' ? last.modified_at : (orderColumn === 'size' ? String(last.size||0) : last.path))) : undefined;
    return { items, nextCursor, hasMore };
  }

  /**
   * Get specific video items by path (optimized for video processing)
   */
  static async getVideosByPath(videoPath: string): Promise<{ success: boolean; items?: any[]; error?: string }> {
    try {
      await this.ensureInitialized();
      console.log(`[MainMediaAPI] getVideosByPath: ${videoPath}`);
      
      // Query canonical media.db (not vector.db) for videos
      const videoItems = this.canonical!.getMediaItemsByPath(videoPath, true);
      
      // Map snake_case to camelCase for consistency
      const mappedItems = videoItems.map(item => ({
        ...item,
        sourceId: item.source_id,  // Map source_id to sourceId
        createdAt: item.created_at,
        modifiedAt: item.modified_at,
        durationMs: item.duration_ms
      }));
      
      console.log(`[MainMediaAPI] Found ${mappedItems.length} video items for path: ${videoPath}`);
      return { success: true, items: mappedItems };
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

      // Resolve or create single_files source in canonical catalog only
      if (sourceId === 'single_files') {
        const sources = this.canonical!.db.prepare(`
          SELECT id, name, root_path FROM sources
        `).all() as any[];
        let singleFilesSource = sources.find((s: any) => s.id === 'single_files');
        if (!singleFilesSource) {
          singleFilesSource = sources.find((s: any) => s.name === 'Single File Uploads' || s.root_path === 'various');
        }
        if (singleFilesSource) {
          actualSourceId = singleFilesSource.id;
          console.log(`[ADD-ITEM-FOR-FILE] Using existing single files source (canonical): ${actualSourceId}`);
        } else {
          console.log('[ADD-ITEM-FOR-FILE] Creating single_files source in canonical catalog');
          this.canonical!.upsertSourceFromLegacy({
            id: 'single_files',
            name: 'Single File Uploads',
            type: 'local',
            path: 'various',
            enabled: true,
            createdAt: new Date(),
            updatedAt: new Date()
          });
          actualSourceId = 'single_files';
        }
      }

      const stats = await fs.stat(filePath);
      const name = path.basename(filePath);
      const mime = getMimeType(filePath);
      const lower = (mime || '').toLowerCase();
      let type: 'image' | 'video' | 'audio' = 'image';
      if (lower.startsWith('video/')) type = 'video';
      else if (lower.startsWith('audio/')) type = 'audio';

      console.log(`[ADD-ITEM-FOR-FILE-DEBUG] Adding media item (canonical only):`, {
        sourceId: actualSourceId,
        name: name,
        path: filePath,
        type: type,
        size: Number(stats.size || 0),
        description: description,
        metadata: metadata
      });

      // Duplicate check in canonical catalog
      const existingCanonical = this.canonical!.getMediaItemsByPath(filePath, true);
      if (existingCanonical && existingCanonical.length > 0) {
        const ex = existingCanonical[0];
        console.log(`[ADD-ITEM-FOR-FILE-DEBUG] Item already exists in canonical, returning existing ID:`, {
          existingId: ex.id,
          name: name,
          type: type
        });
        return { success: true, id: ex.id };
      }

      const { generateDeterministicId } = await import('../core/utils/crypto-utils');
      const id = await generateDeterministicId(filePath);

      // Upsert into canonical catalog (media.db)
      this.canonical!.upsertMediaItemFromLegacy({
        id,
        sourceId: actualSourceId,
        type,
        path: filePath,
        size: Number(stats.size || 0),
        mimeType: mime,
        createdAt: new Date(stats.birthtimeMs || stats.ctimeMs || Date.now()),
        modifiedAt: new Date(stats.mtimeMs || Date.now()),
      });
      console.log('[WRITE-ROUTE] catalog=canonical upserted item to media.db');

      console.log(`[ADD-ITEM-FOR-FILE-DEBUG] Media item added successfully (canonical):`, {
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
          if (this.llm) {
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
      
      // Read from canonical database (media.db) where addSource() writes
      let source: any = null;
      try {
        const row = this.canonical!.db.prepare(`
          SELECT id, name, type, root_path, status
          FROM sources
          WHERE id = ?
        `).get(sourceId) as any;
        if (row) {
          source = {
            id: row.id,
            name: row.name,
            type: row.type || 'local',
            path: row.root_path,
            enabled: row.status !== 'disabled',
            config: {}
          };
        }
      } catch {}
      
      if (!source) {
        return { success: false, error: 'Source not found' };
      }

      const jobId = await this.jobsDb!.createJob({ 
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
        this.jobsDb!.updateJobStatus(jobId, 'failed', 0);
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

      const jobId = await this.jobsDb!.createJob({ 
        sourceId,
        title: 'Force Re-indexing',
        description: `Force re-indexing ${source.name} (regenerating all captions and embeddings)`,
        operationType: 'force_reindex',
        targetFile: source.path
      });
      
      // Start force re-indexing in background
      this.performIndexing(jobId, sourceId, true).catch(error => {
        console.error('Force re-indexing failed:', error);
        this.jobsDb!.updateJobStatus(jobId, 'failed', 0);
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

      // 1) Read images from canonical catalog (media.db) only
      const rows = this.canonical!.db.prepare(`
        SELECT id, source_id, path, size
        FROM media_items
        WHERE type = 'image'
      `).all() as any[];
      const imageItems = rows.map((r: any) => ({
        id: r.id,
        sourceId: r.source_id,
        name: path.basename(r.path),
        path: r.path,
        size: Number(r.size || 0),
        type: 'image'
      }));

      console.log(`[UNINDEXED-RECOVERY] Found ${imageItems.length} image items to check`);

      // 2) Gather existing pending/running and completed image jobs from jobs.db
      const existingJobs = this.jobsDb!.db.prepare(`
        SELECT DISTINCT file_path 
        FROM indexing_jobs 
        WHERE job_type = 'image_processing' 
          AND status IN ('pending', 'running')
      `).all() as any[];
      const pendingPaths = new Set(existingJobs.map((j: any) => j.file_path));
      console.log(`[UNINDEXED-RECOVERY] Found ${pendingPaths.size} images with pending/running jobs`);

      const completedJobs = this.jobsDb!.db.prepare(`
        SELECT DISTINCT file_path
        FROM indexing_jobs
        WHERE job_type = 'image_processing'
          AND status = 'completed'
      `).all() as any[];
      const completedPaths = new Set(completedJobs.map((j: any) => j.file_path));

      // 3) Determine which images still need processing
      const unindexedImages: any[] = [];
      for (const item of imageItems) {
        if (pendingPaths.has(item.path)) {
          console.log(`[UNINDEXED-RECOVERY] Skipping ${item.name} - already has pending/running job`);
          continue;
        }
        if (completedPaths.has(item.path)) {
          continue;
        }
        unindexedImages.push(item);
        console.log(`[UNINDEXED-RECOVERY] Will enqueue unindexed image: ${item.name} (${item.id})`);
      }

      if (unindexedImages.length === 0) {
        console.log(`[UNINDEXED-RECOVERY] No unindexed images found`);
        return { success: true, unindexedCount: 0 };
      }

      console.log(`[UNINDEXED-RECOVERY] Found ${unindexedImages.length} unindexed images, starting background processing`);

      // 4) Choose a source id from canonical sources (avoid legacy DB)
      const sources = this.canonical!.db.prepare(`
        SELECT id, name, root_path FROM sources WHERE status = 'active'
      `).all() as any[];
      const singleFilesSource = sources.find((s: any) => 
        s.name === 'Single File Uploads' || s.root_path === 'various' || s.id === 'single_files'
      );
      const actualSourceId = singleFilesSource ? singleFilesSource.id : (sources.length > 0 ? sources[0].id : 'single_files');

      // 5) Create UI-visible job and dispatch enqueue loop
      const jobId = await this.jobsDb!.createJob({ 
        sourceId: actualSourceId,
        title: 'Processing Unindexed Images',
        description: `Generating captions and embeddings for ${unindexedImages.length} unindexed images`,
        operationType: 'image_recovery',
        totalItems: unindexedImages.length,
        processedItems: 0
      });

      this.processUnindexedImagesWithJobTracking(jobId, unindexedImages).catch(error => {
        console.error('[UNINDEXED-RECOVERY] Background processing failed:', error);
        this.jobsDb!.updateJobStatus(jobId, 'failed', 0);
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
      console.log(`[FAST-THUMBNAIL] Thumbnail ready for ${name} (using original image: ${filePath})`);
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
      // Create an image_processing job that workers will pick up (canonical path)
      const stats = await fs.stat(filePath);
      const imageJobId = `img_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      await this.jobsDb!.createImageProcessingJob({
        id: imageJobId,
        sourceId,
        filePath,
        fileName: name,
        fileSize: Number(stats.size || 0),
        status: 'pending',
        jobType: 'image_processing',
        retryCount: 0
      });
      console.log(`[CAPTION-QUEUE] Enqueued image_processing job ${imageJobId} for ${name}`);
    } catch (error) {
      console.error(`[CAPTION-QUEUE] Failed to queue ${name} for captioning:`, error);
    }
  }

  /**
   * Process single image captioning in background with job tracking
   */
  // Legacy captioning methods are no longer used; workers handle processing

  /**
   * Process single image captioning in background (legacy method for recovery)
   */
  // private static async processSingleImageCaptioning(...) is deprecated under split DB architecture

  /**
   * Process unindexed images in background with job tracking for UI
   */
  private static async processUnindexedImagesWithJobTracking(jobId: string, unindexedImages: any[]): Promise<void> {
    console.log(`[UNINDEXED-RECOVERY] Starting background processing of ${unindexedImages.length} images (Job: ${jobId})`);
    
    // Update job status to running
    await this.jobsDb!.updateJobStatus(jobId, 'running', 0);
    
    let processedCount = 0;
    
    for (const item of unindexedImages) {
      try {
        console.log(`[UNINDEXED-RECOVERY] Processing image ${processedCount + 1}/${unindexedImages.length}: ${item.name}`);
        // Enqueue an image_processing job for the worker
        const imageJobId = `img_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        await this.jobsDb!.createImageProcessingJob({
          id: imageJobId,
          sourceId: item.sourceId,
          filePath: item.path,
          fileName: item.name,
          fileSize: Number(item.size || 0),
          status: 'pending',
          jobType: 'image_processing',
          retryCount: 0
        });
        
        processedCount++;
        
        // Update job progress for UI
        const progress = Math.round((processedCount / unindexedImages.length) * 100);
        await this.jobsDb!.updateJobStatus(jobId, 'running', progress);
        
        // Small delay to avoid overwhelming the system
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        console.error(`[UNINDEXED-RECOVERY] Failed to process ${item.name}:`, error);
        // Continue with next image even if one fails
      }
    }
    
    // Mark job as completed
    await this.jobsDb!.updateJobStatus(jobId, 'completed', 100);
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
      
      // Do not write to legacy vector.db during cutover
      
      // CRITICAL: Also delete associated video processing jobs to prevent resurrection
      if (item.type === 'video' && item.path) {
        try {
          const { VideoMediaAPI } = await import('./video-media-api');
          const videoAPI = VideoMediaAPI.getInstance();
          
          // Ensure jobsDb is set on the singleton
          if (this.jobsDb) {
            videoAPI.setJobsDatabase(this.jobsDb);
          }
          
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
            
            // Skip legacy vector.db cleanup writes during cutover
            
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
      await this.jobsDb!.updateJobStatus(jobId, 'cancelled');
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
      const activeJobs = await this.jobsDb!.getActiveJobs();
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
      
      const result = await this.jobsDb!.resetStalledJobs();
      
      if (result.resetCount > 0) {
        console.log(`[JOB-RECOVERY] Reset ${result.resetCount} stalled jobs to pending status`);
        
        // Restart the recovered jobs
        for (const jobId of result.jobIds) {
          try {
            const jobs = await this.jobsDb!.getJobs();
            const job = jobs.find((j: any) => j.id === jobId);
            if (job && job.status === 'pending') {
              console.log(`[JOB-RECOVERY] Restarting recovered job: ${jobId} for source: ${job.sourceId}`);
              // Restart the indexing for this source
              this.performIndexing(jobId, job.sourceId, false).catch((error: any) => {
                console.error(`[JOB-RECOVERY] Failed to restart job ${jobId}:`, error);
                this.jobsDb!.updateJobStatus(jobId, 'failed', 0);
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
      const mediaJobs = await this.jobsDb!.getActiveJobs();
      console.log(`[INDEXING-STATUS-DEBUG] Media jobs from DB:`, mediaJobs.map((j: any) => ({ id: j.id, status: j.status, sourceId: j.sourceId })));
      
      // Get video processing jobs using singleton VideoMediaAPI
      let videoJobs: any[] = [];
      try {
        const { VideoMediaAPI } = await import('./video-media-api');
        const videoApi = VideoMediaAPI.getInstance();
        
        // Ensure jobsDb is set on the singleton
        if (this.jobsDb) {
          videoApi.setJobsDatabase(this.jobsDb);
        }
        
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
      // Treat queued + in-progress jobs as active so UI shows jobs immediately after upload
      const activeJobs = allJobs
        .filter((j: any) => ['running', 'processing', 'pending', 'scheduled'].includes(j.status))
        .map((j: any) => j.id);
      console.log(`[INDEXING-STATUS-DEBUG] Active jobs (queued/processing):`, activeJobs);
      
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
      
      // Prefer canonical source (media.db), fallback to legacy only if needed
      let source: any = null;
      try {
        const row = this.canonical!.db.prepare(`
          SELECT id, name, type, root_path, status
          FROM sources
          WHERE id = ?
        `).get(sourceId) as any;
        if (row) {
          source = {
            id: row.id,
            name: row.name,
            type: row.type || 'local',
            path: row.root_path,
            enabled: row.status !== 'disabled',
            config: {}
          };
        }
      } catch {}
      console.log(`[PERFORM-INDEXING] 📁 Got source:`, source ? `${source.name} (${source.path})` : 'null');
      
      if (!source) {
        throw new Error(`Source not found in canonical catalog: ${sourceId}`);
      }
      
      console.log(`[PERFORM-INDEXING] 📝 Updating job status to 'running'`);
      await this.jobsDb!.updateJobStatus(jobId, 'running');
      
      // Ensure source exists in canonical catalog (media.db)
      if (this.canonical) {
        try {
          this.canonical.upsertSourceFromLegacy({
            id: source.id,
            name: source.name,
            type: source.type || 'local',
            path: source.path,
            enabled: source.enabled !== false,
            createdAt: new Date(),
            updatedAt: new Date()
          });
        } catch (e) {
          console.warn('[PERFORM-INDEXING] canonical upsertSource failed (non-fatal):', e);
        }
      }
      
      console.log(`[PERFORM-INDEXING] 📦 Importing file scanner...`);
      // Import file scanner
      const { scanDirectory } = await import('../core/file-scanner');
      console.log(`[PERFORM-INDEXING] ✅ File scanner imported successfully`);
      
      console.log(`[PERFORM-INDEXING] 🔍 Scanning directory: ${source.path}, recursive: ${source.config?.recursive !== false}`);
      // Scan for media files
      const mediaFiles = await scanDirectory(source.path, source.config?.recursive !== false);
      console.log(`[PERFORM-INDEXING] 📊 Found ${mediaFiles.length} media files`);
      
      if (mediaFiles.length === 0) {
        await this.jobsDb!.updateJobStatus(jobId, 'completed', 100);
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

          // Upsert into canonical catalog (media.db) only
          if (this.canonical) {
            try {
              this.canonical.upsertMediaItemFromLegacy({
                id: itemId,
                sourceId,
                type: file.type,
                path: file.path,
                size: file.size,
                mimeType: getMimeType(file.path),
                createdAt: new Date(),
                modifiedAt: file.lastModified
              });
            } catch (e) {
              console.warn('[INDEX] canonical upsertMediaItem failed (non-fatal):', e);
            }
          }

          // 3) Create background job for caption+embedding - ASYNC PROCESSING
          const imageJobId = `img_${Date.now()}_${Math.random().toString(36).substring(7)}`;
          await this.jobsDb!.createImageProcessingJob({
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
          await this.jobsDb!.updateJobStatus(jobId, 'running', progress);
          
        } catch (error) {
          console.error(`[INDEX] Failed to add file ${file.name}:`, error);
        }
      }
      
      console.log(`[INDEXING] ✅ Added ${addedCount} images to DB - visible immediately`);
      console.log(`[INDEXING] 🔄 Created ${jobsCreated} background jobs for caption/embedding`);
      
      await this.jobsDb!.updateJobStatus(jobId, 'completed', 100);
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
      await this.jobsDb!.updateJobStatus(jobId, 'failed', 0);
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

      // Phase 2: Use modality-backed SearchService (no vector.db)
      if (this.searchService && q) {
        try {
          console.log(`[SEARCH-TIMING] 🔎 Using SearchService (modality stores)`);
          const searchLimit = limit * requestedTypes.length;
          const searchStart = Date.now();
          const res = await this.searchService.search(q, searchLimit);
          console.log(`[SEARCH-TIMING] ⏱️  SearchService took: ${Date.now() - searchStart}ms, got ${res.items.length} items`);

          // Apply adaptive scoring if we have LLM classification
          let scoredItems = res.items || [];
          if (queryClassification && scoredItems.length > 0) {
            try {
              const scoringStart = Date.now();
              const scoringService = new SearchScoringService();
              const videoResults = scoredItems.filter((r: any) => r.type === 'video' || r.type === 'audio');
              
              if (videoResults.length > 0) {
                console.log(`[SEARCH-SCORING] Applying adaptive scoring to ${videoResults.length} video/audio results`);
                const scored = await scoringService.scoreResults(videoResults, q, queryClassification);
                
                // Replace original items with scored items
                const scoredMap = new Map(scored.map(s => [s.id, s]));
                scoredItems = scoredItems.map((item: any) => {
                  const scoredItem = scoredMap.get(item.id);
                  if (scoredItem) {
                    return { ...item, score: scoredItem.adaptiveScore, scoreBreakdown: scoredItem.scoreBreakdown };
                  }
                  return item;
                });
                
                // Re-sort by adaptive score
                scoredItems.sort((a: any, b: any) => (b.score || 0) - (a.score || 0));
                
                console.log(`[SEARCH-SCORING] ⏱️  Adaptive scoring took: ${Date.now() - scoringStart}ms`);
                console.log(`[SEARCH-SCORING] Top result boosted: ${scored[0]?.similarity.toFixed(3)} → ${scored[0]?.adaptiveScore.toFixed(3)}`);
              }
              
              scoringService.close();
            } catch (scoringError) {
              console.warn('[SEARCH-SCORING] Adaptive scoring failed, using base results:', scoringError);
              // Continue with unscored results
            }
          }

          const transformStart = Date.now();
          const allItems = (res.items || []).map((r: any) => {
            const mimeType = getMimeType(r.path);
            let type: 'image' | 'video' | 'audio' = r.type || 'image';
            return {
              id: r.id,
              name: r.name || (r.path ? r.path.split('/').pop() : 'item'),
              path: r.path,
              size: r.size,
              type,
              mimeType,
              sourceId: r.sourceId,
              createdAt: r.createdAt || new Date(),
              score: typeof r.score === 'number' ? r.score : undefined,
            };
          });
          console.log(`[SEARCH-TIMING] ⏱️  Result transformation took: ${Date.now() - transformStart}ms`);

          // Group by type and apply pagination per type
          const groupingStart = Date.now();
          const imageItems = allItems.filter(item => item.type === 'image');
          const audioItems = allItems.filter(item => item.type === 'audio');
          const videoItems = allItems.filter(item => item.type === 'video');
          const dedupeStart = Date.now();
          const deduplicatedVideos = await this.deduplicateVideoResults(videoItems);
          console.log(`[SEARCH-TIMING] ⏱️  Video deduplication took: ${Date.now() - dedupeStart}ms (${videoItems.length} → ${deduplicatedVideos.length})`);
          console.log(`[SEARCH-TIMING] ⏱️  Type grouping took: ${Date.now() - groupingStart}ms (${imageItems.length} images, ${deduplicatedVideos.length} videos, ${audioItems.length} audio)`);

          const typeGroups = {
            image: imageItems,
            video: deduplicatedVideos,
            audio: audioItems
          } as Record<'image'|'video'|'audio', any[]>;

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
          return {
            success: true,
            results: {
              ...grouped,
              query: q,
              executionTime
            }
          };
        } catch (e) {
          console.warn('[UNIFIED-SEARCH] SearchService path failed, falling back to basic search:', e);
          // Fall through to fallback
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
      const cursor = query.cursor && query.cursor.ts && query.cursor.id
        ? { ts: String(query.cursor.ts), id: String(query.cursor.id) }
        : undefined;
      const sourceIds = Array.isArray(query.sourceIds) ? query.sourceIds.map(String) : undefined;
      const started = Date.now();

      if (!this.searchService) {
        return { success: true, results: { items: [], total: 0, hasMore: false, nextCursor: undefined, query: q, executionTime: 0, suggestions: [] } };
      }

      const out = await this.searchService.search(q, limit, cursor);
      const baseItems = out.items || [];
      const filtered = sourceIds && sourceIds.length > 0
        ? baseItems.filter(it => !it.sourceId || sourceIds.includes(String(it.sourceId)))
        : baseItems;
      const items = filtered.slice(0, limit);
      let nextCursor = out.nextCursor;
      if (items.length > 0) {
        const last = items[items.length - 1];
        if (last.createdAt) nextCursor = { ts: last.createdAt.toISOString(), id: String(last.id) };
      }
      const total = out.total;
      const hasMore = !!nextCursor;
      const executionTime = Date.now() - started;
      return {
        success: true,
        results: {
          items,
          total,
          hasMore,
          nextCursor,
          query: q,
          executionTime,
          suggestions: []
        }
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Reload configuration from config.db and rebuild strategy/search stores.
   */
  static async reloadConfiguration(): Promise<{ success: boolean; error?: string }> {
    try {
      await this.ensureInitialized();
      const baseDir = this.dataDirPath || getDefaultDataDir();
      const configDbPath = path.join(baseDir, 'config.db');
      this.configStore = new ConfigStore(configDbPath, baseDir);
      this.flags = this.configStore.loadFlags();
      this.partitions = this.configStore.loadPartitions();
      this.sourcePartitionMap = this.configStore.loadSourcePartitionMap();
      console.log('[STRATEGY] Reloaded flags:', this.flags);

      // Recreate canonical adapter
      try {
        const canonicalPath = path.join(baseDir, 'media.db');
        this.canonical = new CanonicalMediaDatabase(canonicalPath);
      } catch (e) {
        console.warn('[MainMediaAPI] Failed to reinitialize canonical media database:', e);
        this.canonical = null;
      }

      // Recreate search stores
      this.buildSearchStores(baseDir);

      return { success: true };
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
   * Get current configuration
   */
  static async getConfiguration(): Promise<{ success: boolean; config?: any; error?: string }> {
    try {
      const flags = this.flags;
      const partitions = this.partitions;
      const sourcePartitions = this.sourcePartitionMap;
      const snapshot = {
        flags,
        partitions,
        sourcePartitions,
        dataDir: this.dataDirPath
      };
      return { success: true, config: snapshot };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
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
