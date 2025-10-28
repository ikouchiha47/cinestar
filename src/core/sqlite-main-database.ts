import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { MediaItem, MediaSource, IndexingJob } from './types';

export class SqliteMainDatabase {
  public db: Database.Database; // Public for direct SQL access in processors
  private initialized = false;
  private dbFilePath: string;

  constructor(dbFilePath: string) {
    const dir = path.dirname(dbFilePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.dbFilePath = dbFilePath;
    this.db = new Database(dbFilePath);
    console.log('[SqliteMainDatabase] Using file:', dbFilePath);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.db.pragma('journal_mode = wal');
    this.db.pragma('foreign_keys = ON');
    // Skip table creation - tables are created by migrations
    // Clean stale jobs
    this.db.prepare(`UPDATE indexing_jobs SET status='failed', completed_at=? WHERE status IN ('running','pending')`).run(new Date().toISOString());
    this.initialized = true;
  }

  // Sources
  async addSource(source: Omit<MediaSource, 'id' | 'createdAt'>): Promise<string> {
    // Check if source with same path already exists
    const existing = this.db.prepare(`SELECT id FROM media_sources WHERE path = ?`).get(source.path) as any;
    if (existing) {
      throw new Error(`Source with path "${source.path}" already exists`);
    }

    const id = crypto.randomUUID();
    this.db.prepare(`INSERT INTO media_sources(id,name,type,path,enabled,config,created_at) VALUES(?,?,?,?,?,?,?)`).run(
      id,
      source.name,
      source.type,
      source.path,
      source.enabled ? 1 : 0,
      source.config ? JSON.stringify(source.config) : null,
      new Date().toISOString()
    );
    return id;
  }
  async removeDuplicateSources(): Promise<{ removed: number; kept: number }> {
    // Find duplicates by path, keeping the most recent one
    const duplicates = this.db.prepare(`
      SELECT path, COUNT(*) as count, GROUP_CONCAT(id) as ids, MAX(datetime(created_at)) as latest_date
      FROM media_sources 
      GROUP BY path 
      HAVING COUNT(*) > 1
    `).all() as any[];

    let removedCount = 0;
    let keptCount = 0;

    for (const duplicate of duplicates) {
      const ids = duplicate.ids.split(',');
      // Get the most recent source for this path
      const latest = this.db.prepare(`
        SELECT id FROM media_sources 
        WHERE path = ? 
        ORDER BY datetime(created_at) DESC 
        LIMIT 1
      `).get(duplicate.path) as any;

      // Remove all except the latest
      for (const id of ids) {
        if (id !== latest.id) {
          this.db.prepare(`DELETE FROM media_sources WHERE id = ?`).run(id);
          // Also clean up related data
          this.db.prepare(`DELETE FROM media_items WHERE source_id = ?`).run(id);
          this.db.prepare(`DELETE FROM indexing_jobs WHERE source_id = ?`).run(id);
          removedCount++;
        } else {
          keptCount++;
        }
      }
    }

    return { removed: removedCount, kept: keptCount };
  }

  async getSources(): Promise<MediaSource[]> {
    const rows = this.db.prepare(`SELECT * FROM media_sources ORDER BY datetime(created_at) DESC`).all() as any[];
    return rows.map(r => ({
      id: r.id, name: r.name, type: r.type, path: r.path, enabled: !!r.enabled,
      config: r.config ? JSON.parse(r.config) : undefined,
      createdAt: new Date(r.created_at),
      lastIndexed: r.last_indexed ? new Date(r.last_indexed) : undefined
    }));
  }
  async getSource(sourceId: string): Promise<MediaSource | undefined> {
    const r = this.db.prepare(`SELECT * FROM media_sources WHERE id=?`).get(sourceId) as any;
    if (!r) return undefined;
    return { id: r.id, name: r.name, type: r.type, path: r.path, enabled: !!r.enabled, config: r.config ? JSON.parse(r.config) : undefined, createdAt: new Date(r.created_at), lastIndexed: r.last_indexed ? new Date(r.last_indexed) : undefined };
  }
  async updateSource(sourceId: string, updates: Partial<MediaSource>): Promise<void> {
    const sets: string[] = []; const vals: any[] = [];
    if (updates.name !== undefined) { sets.push('name=?'); vals.push(updates.name); }
    if (updates.enabled !== undefined) { sets.push('enabled=?'); vals.push(updates.enabled ? 1 : 0); }
    if (updates.config !== undefined) { sets.push('config=?'); vals.push(JSON.stringify(updates.config)); }
    if (updates.lastIndexed !== undefined) { sets.push('last_indexed=?'); vals.push(updates.lastIndexed?.toISOString()); }
    if (!sets.length) return;
    vals.push(sourceId);
    this.db.prepare(`UPDATE media_sources SET ${sets.join(', ')} WHERE id=?`).run(...vals);
  }
  async removeSource(sourceId: string): Promise<void> {
    this.db.prepare(`DELETE FROM media_sources WHERE id=?`).run(sourceId);
  }

  async removeMediaItem(itemId: string): Promise<void> {
    this.db.prepare(`DELETE FROM media_items WHERE id=?`).run(itemId);
    console.log(`[SqliteMainDatabase] Removed media item: ${itemId}`);
  }

  // Items
  async addMediaItem(item: Omit<MediaItem, 'id'>): Promise<string> {
    const existing = this.db.prepare(`SELECT id FROM media_items WHERE source_id=? AND path=?`).get(item.sourceId, item.path) as any;
    if (existing?.id) {
      this.db.prepare(`UPDATE media_items SET name=?, size=?, type=?, mime_type=?, modified_at=?, caption=?, metadata=? WHERE id=?`).run(
        item.name, item.size, item.type, item.mimeType || null, (item.modifiedAt || new Date()).toISOString(), item.description || null, item.metadata ? JSON.stringify(item.metadata) : null, existing.id
      );
      console.log(`[SqliteMainDatabase] Updated item in SQLite (${this.dbFilePath}):`, item.path);
      return existing.id as string;
    }
    const id = crypto.randomUUID();
    this.db.prepare(`INSERT INTO media_items(id,source_id,name,path,size,type,mime_type,created_at,modified_at,caption,metadata) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, item.sourceId, item.name, item.path, item.size, item.type, item.mimeType || null,
      (item.createdAt || new Date()).toISOString(), (item.modifiedAt || new Date()).toISOString(), item.description || null, item.metadata ? JSON.stringify(item.metadata) : null
    );
    console.log(`[SqliteMainDatabase] Inserted item into SQLite (${this.dbFilePath}):`, item.path);
    return id;
  }
  async getMediaItems(sourceId?: string): Promise<MediaItem[]> {
    const rows = sourceId
      ? (this.db.prepare(`SELECT * FROM media_items WHERE source_id=? ORDER BY datetime(created_at) DESC`).all(sourceId) as any[])
      : (this.db.prepare(`SELECT * FROM media_items ORDER BY datetime(created_at) DESC`).all() as any[]);
    console.log(`[SqliteMainDatabase] getMediaItems(${sourceId ?? 'ALL'}) from SQLite (${this.dbFilePath}) ->`, rows.length, 'rows');
    return rows.map(r => ({
      id: r.id, sourceId: r.source_id, name: r.name, path: r.path, size: r.size, type: r.type, mimeType: r.mime_type,
      createdAt: new Date(r.created_at), modifiedAt: new Date(r.modified_at), description: r.caption || undefined,
      embedding: r.embedding ? new Float32Array((r.embedding as Buffer).buffer, (r.embedding as Buffer).byteOffset, (r.embedding as Buffer).byteLength / 4) : undefined,
      metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
    }));
  }

  // Get media items by path and type (optimized for video processing)
  async getMediaItemsByPath(path: string, type?: string): Promise<MediaItem[]> {
    const query = type 
      ? `SELECT * FROM media_items WHERE path=? AND type=? ORDER BY datetime(created_at) DESC`
      : `SELECT * FROM media_items WHERE path=? ORDER BY datetime(created_at) DESC`;
    const params = type ? [path, type] : [path];
    
    const rows = this.db.prepare(query).all(...params) as any[];
    console.log(`[SqliteMainDatabase] getMediaItemsByPath(${path}, ${type || 'ANY'}) ->`, rows.length, 'rows');
    
    return rows.map(r => ({
      id: r.id, sourceId: r.source_id, name: r.name, path: r.path, size: r.size, type: r.type, mimeType: r.mime_type,
      createdAt: new Date(r.created_at), modifiedAt: new Date(r.modified_at), description: r.caption || undefined,
      embedding: r.embedding ? new Float32Array((r.embedding as Buffer).buffer, (r.embedding as Buffer).byteOffset, (r.embedding as Buffer).byteLength / 4) : undefined,
      metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
    }));
  }

  // Get media items with cursor-based pagination (efficient and consistent)
  async getMediaItemsPaginated(params: {
    sourceIds?: string[];
    types?: string[];
    limit?: number;
    cursor?: string; // ISO timestamp cursor for pagination
    orderBy?: 'created_at' | 'modified_at' | 'name' | 'size';
    orderDirection?: 'ASC' | 'DESC';
  }): Promise<{ items: MediaItem[]; nextCursor?: string; hasMore: boolean }> {
    const { sourceIds, types, limit = 50, cursor, orderBy = 'created_at', orderDirection = 'DESC' } = params;
    
    // Build WHERE clause
    const whereClauses: string[] = [];
    const whereParams: any[] = [];
    
    if (sourceIds?.length) {
      whereClauses.push(`source_id IN (${sourceIds.map(() => '?').join(', ')})`);
      whereParams.push(...sourceIds);
    }
    
    if (types?.length) {
      // Handle type filtering by mime type
      const typeConditions: string[] = [];
      for (const type of types) {
        switch (type) {
          case 'video':
            typeConditions.push(`mime_type LIKE 'video/%'`);
            break;
          case 'audio':
            typeConditions.push(`mime_type LIKE 'audio/%'`);
            break;
          case 'image':
            typeConditions.push(`(mime_type LIKE 'image/%' OR mime_type IS NULL OR mime_type = '')`);
            break;
        }
      }
      if (typeConditions.length > 0) {
        whereClauses.push(`(${typeConditions.join(' OR ')})`);
      }
    }
    
    // Add cursor-based pagination
    if (cursor && (orderBy === 'created_at' || orderBy === 'modified_at')) {
      const operator = orderDirection === 'DESC' ? '<' : '>';
      whereClauses.push(`datetime(${orderBy}) ${operator} datetime(?)`);
      whereParams.push(cursor);
    }
    
    const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    
    // Build ORDER BY clause
    const orderColumn = orderBy === 'created_at' || orderBy === 'modified_at' 
      ? `datetime(${orderBy})` 
      : orderBy;
    const orderClause = `ORDER BY ${orderColumn} ${orderDirection}`;
    
    // Get items with one extra to check if there are more
    const itemsQuery = `SELECT * FROM media_items ${whereClause} ${orderClause} LIMIT ?`;
    const rows = this.db.prepare(itemsQuery).all(...whereParams, limit + 1) as any[];
    
    // Check if there are more items
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    
    // Generate next cursor from the last item
    let nextCursor: string | undefined;
    if (hasMore && items.length > 0) {
      const lastItem = items[items.length - 1];
      if (orderBy === 'created_at' || orderBy === 'modified_at') {
        nextCursor = lastItem[orderBy];
      }
    }
    
    console.log(`[SqliteMainDatabase] getMediaItemsPaginated -> ${items.length} items (cursor: ${cursor || 'none'}, hasMore: ${hasMore})`);
    
    const mappedItems = items.map(r => ({
      id: r.id, sourceId: r.source_id, name: r.name, path: r.path, size: r.size, type: r.type, mimeType: r.mime_type,
      createdAt: new Date(r.created_at), modifiedAt: new Date(r.modified_at), description: r.caption || undefined,
      embedding: r.embedding ? new Float32Array((r.embedding as Buffer).buffer, (r.embedding as Buffer).byteOffset, (r.embedding as Buffer).byteLength / 4) : undefined,
      metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
    }));
    
    return { items: mappedItems, nextCursor, hasMore };
  }

  // Legacy method for backward compatibility (still uses offset but warns)
  async getMediaItemsWithOffset(params: {
    sourceIds?: string[];
    types?: string[];
    limit?: number;
    offset?: number;
    orderBy?: 'created_at' | 'modified_at' | 'name' | 'size';
    orderDirection?: 'ASC' | 'DESC';
  }): Promise<{ items: MediaItem[]; hasMore: boolean }> {
    console.warn(`[SqliteMainDatabase] getMediaItemsWithOffset is deprecated - use cursor-based getMediaItemsPaginated instead`);
    
    const { sourceIds, types, limit = 50, offset = 0, orderBy = 'created_at', orderDirection = 'DESC' } = params;
    
    // Build WHERE clause (same as before)
    const whereClauses: string[] = [];
    const whereParams: any[] = [];
    
    if (sourceIds?.length) {
      whereClauses.push(`source_id IN (${sourceIds.map(() => '?').join(', ')})`);
      whereParams.push(...sourceIds);
    }
    
    if (types?.length) {
      const typeConditions: string[] = [];
      for (const type of types) {
        switch (type) {
          case 'video':
            typeConditions.push(`mime_type LIKE 'video/%'`);
            break;
          case 'audio':
            typeConditions.push(`mime_type LIKE 'audio/%'`);
            break;
          case 'image':
            typeConditions.push(`(mime_type LIKE 'image/%' OR mime_type IS NULL OR mime_type = '')`);
            break;
        }
      }
      if (typeConditions.length > 0) {
        whereClauses.push(`(${typeConditions.join(' OR ')})`);
      }
    }
    
    const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const orderColumn = orderBy === 'created_at' || orderBy === 'modified_at' ? `datetime(${orderBy})` : orderBy;
    const orderClause = `ORDER BY ${orderColumn} ${orderDirection}`;
    
    // No more COUNT() query - use LIMIT + 1 approach
    const itemsQuery = `SELECT * FROM media_items ${whereClause} ${orderClause} LIMIT ? OFFSET ?`;
    const rows = this.db.prepare(itemsQuery).all(...whereParams, limit + 1, offset) as any[];
    
    // Check if there are more items
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    
    console.log(`[SqliteMainDatabase] getMediaItemsWithOffset -> ${items.length} items (hasMore: ${hasMore}, offset: ${offset})`);
    
    const mappedItems = items.map(r => ({
      id: r.id, sourceId: r.source_id, name: r.name, path: r.path, size: r.size, type: r.type, mimeType: r.mime_type,
      createdAt: new Date(r.created_at), modifiedAt: new Date(r.modified_at), description: r.caption || undefined,
      embedding: r.embedding ? new Float32Array((r.embedding as Buffer).buffer, (r.embedding as Buffer).byteOffset, (r.embedding as Buffer).byteLength / 4) : undefined,
      metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
    }));
    
    return { items: mappedItems, hasMore };
  }

  // Update embedding blob in main items table
  async updateItemEmbedding(itemId: string, embedding: Float32Array): Promise<void> {
    const buffer = Buffer.alloc(embedding.length * 4);
    for (let i = 0; i < embedding.length; i++) buffer.writeFloatLE(embedding[i], i * 4);
    this.db.prepare(`UPDATE media_items SET embedding=? WHERE id=?`).run(buffer, itemId);
    console.log(`[SqliteMainDatabase] Updated embedding blob for item ${itemId} (${embedding.length} dims)`);
  }

  // Search (simple LIKE-based for now)
  async searchMediaItems(q: string, limit = 50): Promise<MediaItem[]> {
    const like = `%${q.toLowerCase()}%`;
    const rows = this.db.prepare(`
      SELECT * FROM media_items
      WHERE lower(name) LIKE ? OR lower(path) LIKE ? OR lower(caption) LIKE ?
      ORDER BY datetime(created_at) DESC
      LIMIT ?
    `).all(like, like, like, limit) as any[];
    return rows.map(r => ({
      id: r.id, sourceId: r.source_id, name: r.name, path: r.path, size: r.size, type: r.type, mimeType: r.mime_type,
      createdAt: new Date(r.created_at), modifiedAt: new Date(r.modified_at), description: r.caption || undefined,
      embedding: r.embedding ? new Float32Array((r.embedding as Buffer).buffer, (r.embedding as Buffer).byteOffset, (r.embedding as Buffer).byteLength / 4) : undefined,
      metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
    }));
  }

  // Jobs
  async createJob(job: { 
    sourceId: string; 
    config?: Record<string, any>;
    title?: string;
    description?: string;
    operationType?: string;
    targetFile?: string;
    totalItems?: number;
    processedItems?: number;
  }): Promise<string> {
    const id = crypto.randomUUID();
    this.db.prepare(`
      INSERT INTO indexing_jobs(
        id, source_id, status, progress, started_at, 
        job_title, job_description, operation_type, target_file,
        total_items, processed_items
      ) VALUES(?,?,?,?,NULL,?,?,?,?,?,?)
    `).run(
      id, job.sourceId, 'pending', 0,
      job.title || 'Processing',
      job.description || 'Processing media files',
      job.operationType || 'media_scan',
      job.targetFile || null,
      job.totalItems || null,
      job.processedItems || 0
    );
    return id;
  }
  async updateJobStatus(jobId: string, status: IndexingJob['status'], progress?: number): Promise<void> {
    const sets: string[] = ['status=?']; const vals: any[] = [status];
    if (typeof progress === 'number') { sets.push('progress=?'); vals.push(progress); }
    if (status === 'running') { sets.push('started_at=?'); vals.push(new Date().toISOString()); }
    if (status === 'completed' || status === 'failed' || status === 'cancelled') { sets.push('completed_at=?'); vals.push(new Date().toISOString()); }
    vals.push(jobId);
    this.db.prepare(`UPDATE indexing_jobs SET ${sets.join(', ')} WHERE id=?`).run(...vals);
    if (status === 'completed') {
      const r = this.db.prepare(`SELECT source_id FROM indexing_jobs WHERE id=?`).get(jobId) as any;
      if (r?.source_id) this.db.prepare(`UPDATE media_sources SET last_indexed=? WHERE id=?`).run(new Date().toISOString(), r.source_id);
    }
  }
  async getActiveJobs(): Promise<IndexingJob[]> {
    // Get regular running jobs (scans, etc.)
    const rows = this.db.prepare(`
      SELECT * FROM indexing_jobs 
      WHERE status IN ('running') 
      AND (job_type IS NULL OR job_type = 'scan' OR job_type = 'media_scan')
      ORDER BY datetime(started_at) DESC
    `).all() as any[];
    
    // Get aggregate stats for image processing jobs (background jobs)
    const imageJobStats = this.db.prepare(`
      SELECT 
        source_id,
        COUNT(*) as total,
        SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) as pending,
        MIN(created_at) as started_at
      FROM indexing_jobs
      WHERE job_type = 'image_processing'
      GROUP BY source_id
      HAVING pending > 0 OR (completed + failed < total)
    `).all() as any[];
    
    // [DEBUG] Log raw database rows
    console.log(`[DB-ACTIVE-JOBS-DEBUG] Found ${rows.length} running jobs, ${imageJobStats.length} image processing groups`);
    
    // Map regular jobs
    const regularJobs = rows.map(r => ({ 
      id: r.id, 
      sourceId: r.source_id, 
      status: r.status, 
      progress: r.progress, 
      totalItems: r.total_items || undefined, 
      processedItems: r.processed_items || undefined, 
      startedAt: r.started_at ? new Date(r.started_at) : undefined, 
      completedAt: r.completed_at ? new Date(r.completed_at) : undefined,
      title: r.job_title || 'Processing',
      description: r.job_description || 'Processing media files',
      operationType: r.operation_type || 'media_scan',
      targetFile: r.target_file || undefined
    }));
    
    // Create synthetic aggregate jobs for image processing
    const imageJobs = imageJobStats.map((stats: any) => ({
      id: `image_processing_${stats.source_id}`,
      sourceId: stats.source_id,
      status: 'running' as const,
      progress: Math.floor(((stats.completed || 0) / (stats.total || 1)) * 100),
      totalItems: stats.total,
      processedItems: stats.completed || 0,
      startedAt: stats.started_at ? new Date(stats.started_at) : undefined,
      completedAt: undefined,
      title: 'Processing Images',
      description: `${stats.completed || 0}/${stats.total} images indexed (${stats.failed || 0} failed)`,
      operationType: 'image_processing',
      targetFile: undefined
    }));
    
    console.log(`[DB-ACTIVE-JOBS-DEBUG] Returning ${regularJobs.length} regular + ${imageJobs.length} image jobs`);
    
    return [...regularJobs, ...imageJobs];
  }
  async getJobs(sourceId?: string): Promise<IndexingJob[]> {
    const rows = sourceId ? (this.db.prepare(`SELECT * FROM indexing_jobs WHERE source_id=?`).all(sourceId) as any[]) : (this.db.prepare(`SELECT * FROM indexing_jobs`).all() as any[]);
    return rows.map(r => ({ 
      id: r.id, 
      sourceId: r.source_id, 
      status: r.status, 
      progress: r.progress, 
      totalItems: r.total_items || undefined, 
      processedItems: r.processed_items || undefined, 
      startedAt: r.started_at ? new Date(r.started_at) : undefined, 
      completedAt: r.completed_at ? new Date(r.completed_at) : undefined,
      title: r.job_title || 'Processing',
      description: r.job_description || 'Processing media files',
      operationType: r.operation_type || 'media_scan',
      targetFile: r.target_file || undefined
    }));
  }

  async getStalledJobs(): Promise<IndexingJob[]> {
    // Realistic stall detection based on available fields:
    // 1. Jobs 'pending' created more than 5 minutes ago (never started)
    // 2. Jobs 'running' for more than 20 minutes (likely stuck - no progress tracking available)
    // Note: We can't track "no recent progress update" because there's no updated_at field
    
    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
    const twentyMinutesAgo = new Date(now.getTime() - 20 * 60 * 1000).toISOString();
    
    const rows = this.db.prepare(`
      SELECT * FROM indexing_jobs 
      WHERE 
        -- Case 1: Pending jobs that never started (>5 min old)
        (status = 'pending' AND created_at < ?) OR
        -- Case 2: Running jobs that have been active for >20 min (likely stuck)
        (status = 'running' AND started_at IS NOT NULL AND started_at < ?)
      ORDER BY created_at DESC
    `).all(fiveMinutesAgo, twentyMinutesAgo) as any[];
    
    console.log(`[JOB-RECOVERY-DEBUG] Stall detection criteria:`);
    console.log(`[JOB-RECOVERY-DEBUG] - Pending jobs older than 5 min (never started)`);
    console.log(`[JOB-RECOVERY-DEBUG] - Running jobs active for >20 min (likely stuck)`);
    console.log(`[JOB-RECOVERY-DEBUG] - Note: No progress update tracking available in schema`);
    console.log(`[JOB-RECOVERY-DEBUG] Found ${rows.length} potentially stalled jobs`);
    
    return rows.map(r => ({ 
      id: r.id, 
      sourceId: r.source_id, 
      status: r.status, 
      progress: r.progress, 
      totalItems: r.total_items || undefined, 
      processedItems: r.processed_items || undefined, 
      startedAt: r.started_at ? new Date(r.started_at) : undefined, 
      completedAt: r.completed_at ? new Date(r.completed_at) : undefined,
      title: r.job_title || 'Processing',
      description: r.job_description || 'Processing media files',
      operationType: r.operation_type || 'media_scan',
      targetFile: r.target_file || undefined
    }));
  }

  async resetStalledJobs(): Promise<{ resetCount: number; jobIds: string[] }> {
    const stalledJobs = await this.getStalledJobs();
    const jobIds: string[] = [];
    
    for (const job of stalledJobs) {
      console.log(`[JOB-RECOVERY] Resetting stalled job: ${job.id} - was ${job.status}`);
      await this.updateJobStatus(job.id, 'pending', 0);
      jobIds.push(job.id);
    }
    
    return { resetCount: stalledJobs.length, jobIds };
  }
  async removeJob(jobId: string): Promise<void> {
    this.db.prepare(`DELETE FROM indexing_jobs WHERE id=?`).run(jobId);
  }

  // Image Processing Jobs
  async createImageProcessingJob(job: {
    id: string;
    sourceId: string;
    filePath: string;
    fileName: string;
    fileSize: number;
    status: string;
    jobType: string;
    retryCount?: number;
  }): Promise<void> {
    this.db.prepare(`
      INSERT INTO indexing_jobs(
        id, source_id, status, job_type, file_path, file_name, file_size, retry_count, created_at
      ) VALUES(?,?,?,?,?,?,?,?,?)
    `).run(
      job.id,
      job.sourceId,
      job.status,
      job.jobType,
      job.filePath,
      job.fileName,
      job.fileSize,
      job.retryCount || 0,
      new Date().toISOString()
    );
  }

  async updateJobStatusWithError(jobId: string, status: string, progress: number, error?: string): Promise<void> {
    const sets: string[] = ['status=?', 'progress=?'];
    const vals: any[] = [status, progress];
    
    if (error) {
      sets.push('last_error=?');
      vals.push(error);
    }
    
    if (status === 'running') {
      sets.push('started_at=?');
      vals.push(new Date().toISOString());
    }
    
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      sets.push('completed_at=?');
      vals.push(new Date().toISOString());
    }
    
    vals.push(jobId);
    this.db.prepare(`UPDATE indexing_jobs SET ${sets.join(', ')} WHERE id=?`).run(...vals);
  }

  // NOTE: getPendingImageJobs moved to ImageJobCoordinator
  // The coordinator now handles atomic job assignment to prevent race conditions

  async getItemIdByPath(filePath: string): Promise<string | null> {
    const row = this.db.prepare('SELECT id FROM media_items WHERE path = ?').get(filePath) as any;
    return row ? row.id : null;
  }

  // Stats
  async getStats(): Promise<{ totalSources: number; totalItems: number; activeJobs: number }> {
    const s = this.db.prepare(`SELECT COUNT(*) as count FROM media_sources`).get() as any;
    const i = this.db.prepare(`SELECT COUNT(*) as count FROM media_items`).get() as any;
    const a = this.db.prepare(`SELECT COUNT(*) as count FROM indexing_jobs WHERE status='running'`).get() as any;
    return { totalSources: Number(s?.count || 0), totalItems: Number(i?.count || 0), activeJobs: Number(a?.count || 0) };
  }

  close(): void { this.db.close(); }
}
