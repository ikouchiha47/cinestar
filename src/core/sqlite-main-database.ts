import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { MediaItem, MediaSource, IndexingJob } from './types';

export class SqliteMainDatabase {
  private db: Database.Database;
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
    const rows = this.db.prepare(`SELECT * FROM indexing_jobs WHERE status IN ('running') ORDER BY datetime(started_at) DESC`).all() as any[];
    
    // [DEBUG] Log raw database rows
    console.log(`[DB-ACTIVE-JOBS-DEBUG] Found ${rows.length} active jobs in database:`);
    rows.forEach((row, index) => {
      console.log(`[DB-ACTIVE-JOBS-DEBUG] Row ${index + 1}:`, {
        id: row.id,
        status: row.status,
        job_title: row.job_title,
        job_description: row.job_description,
        operation_type: row.operation_type,
        target_file: row.target_file
      });
    });
    
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
  async removeJob(jobId: string): Promise<void> {
    this.db.prepare(`DELETE FROM indexing_jobs WHERE id=?`).run(jobId);
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
