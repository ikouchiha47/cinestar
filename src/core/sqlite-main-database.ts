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
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS sources (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        path TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        config TEXT,
        createdAt TEXT NOT NULL,
        lastIndexed TEXT
      );
      CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY,
        sourceId TEXT NOT NULL,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        size INTEGER NOT NULL,
        type TEXT NOT NULL,
        mimeType TEXT,
        createdAt TEXT NOT NULL,
        modifiedAt TEXT NOT NULL,
        description TEXT,
        embedding BLOB,
        metadata TEXT,
        FOREIGN KEY (sourceId) REFERENCES sources(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        sourceId TEXT NOT NULL,
        status TEXT NOT NULL,
        progress INTEGER NOT NULL DEFAULT 0,
        totalItems INTEGER,
        processedItems INTEGER,
        startedAt TEXT,
        completedAt TEXT,
        error TEXT,
        phase TEXT,
        FOREIGN KEY (sourceId) REFERENCES sources(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_items_source ON items(sourceId);
      CREATE INDEX IF NOT EXISTS idx_items_path ON items(path);
      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    `);
    // Clean stale jobs
    this.db.prepare(`UPDATE jobs SET status='failed', completedAt=? WHERE status IN ('running','pending')`).run(new Date().toISOString());
    this.initialized = true;
  }

  // Sources
  async addSource(source: Omit<MediaSource, 'id' | 'createdAt'>): Promise<string> {
    const id = crypto.randomUUID();
    this.db.prepare(`INSERT INTO sources(id,name,type,path,enabled,config,createdAt) VALUES(?,?,?,?,?,?,?)`).run(
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
  async getSources(): Promise<MediaSource[]> {
    const rows = this.db.prepare(`SELECT * FROM sources ORDER BY datetime(createdAt) DESC`).all() as any[];
    return rows.map(r => ({
      id: r.id, name: r.name, type: r.type, path: r.path, enabled: !!r.enabled,
      config: r.config ? JSON.parse(r.config) : undefined,
      createdAt: new Date(r.createdAt),
      lastIndexed: r.lastIndexed ? new Date(r.lastIndexed) : undefined
    }));
  }
  async getSource(sourceId: string): Promise<MediaSource | undefined> {
    const r = this.db.prepare(`SELECT * FROM sources WHERE id=?`).get(sourceId) as any;
    if (!r) return undefined;
    return { id: r.id, name: r.name, type: r.type, path: r.path, enabled: !!r.enabled, config: r.config ? JSON.parse(r.config) : undefined, createdAt: new Date(r.createdAt), lastIndexed: r.lastIndexed ? new Date(r.lastIndexed) : undefined };
  }
  async updateSource(sourceId: string, updates: Partial<MediaSource>): Promise<void> {
    const sets: string[] = []; const vals: any[] = [];
    if (updates.name !== undefined) { sets.push('name=?'); vals.push(updates.name); }
    if (updates.enabled !== undefined) { sets.push('enabled=?'); vals.push(updates.enabled ? 1 : 0); }
    if (updates.config !== undefined) { sets.push('config=?'); vals.push(JSON.stringify(updates.config)); }
    if (updates.lastIndexed !== undefined) { sets.push('lastIndexed=?'); vals.push(updates.lastIndexed?.toISOString()); }
    if (!sets.length) return;
    vals.push(sourceId);
    this.db.prepare(`UPDATE sources SET ${sets.join(', ')} WHERE id=?`).run(...vals);
  }
  async removeSource(sourceId: string): Promise<void> {
    this.db.prepare(`DELETE FROM sources WHERE id=?`).run(sourceId);
  }

  // Items
  async addMediaItem(item: Omit<MediaItem, 'id'>): Promise<string> {
    const existing = this.db.prepare(`SELECT id FROM items WHERE sourceId=? AND path=?`).get(item.sourceId, item.path) as any;
    if (existing?.id) {
      this.db.prepare(`UPDATE items SET name=?, size=?, type=?, mimeType=?, modifiedAt=?, description=?, metadata=? WHERE id=?`).run(
        item.name, item.size, item.type, item.mimeType || null, (item.modifiedAt || new Date()).toISOString(), item.description || null, item.metadata ? JSON.stringify(item.metadata) : null, existing.id
      );
      console.log(`[SqliteMainDatabase] Updated item in SQLite (${this.dbFilePath}):`, item.path);
      return existing.id as string;
    }
    const id = crypto.randomUUID();
    this.db.prepare(`INSERT INTO items(id,sourceId,name,path,size,type,mimeType,createdAt,modifiedAt,description,metadata) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, item.sourceId, item.name, item.path, item.size, item.type, item.mimeType || null,
      (item.createdAt || new Date()).toISOString(), (item.modifiedAt || new Date()).toISOString(), item.description || null, item.metadata ? JSON.stringify(item.metadata) : null
    );
    console.log(`[SqliteMainDatabase] Inserted item into SQLite (${this.dbFilePath}):`, item.path);
    return id;
  }
  async getMediaItems(sourceId?: string): Promise<MediaItem[]> {
    const rows = sourceId
      ? (this.db.prepare(`SELECT * FROM items WHERE sourceId=? ORDER BY datetime(createdAt) DESC`).all(sourceId) as any[])
      : (this.db.prepare(`SELECT * FROM items ORDER BY datetime(createdAt) DESC`).all() as any[]);
    console.log(`[SqliteMainDatabase] getMediaItems(${sourceId ?? 'ALL'}) from SQLite (${this.dbFilePath}) ->`, rows.length, 'rows');
    return rows.map(r => ({
      id: r.id, sourceId: r.sourceId, name: r.name, path: r.path, size: r.size, type: r.type, mimeType: r.mimeType,
      createdAt: new Date(r.createdAt), modifiedAt: new Date(r.modifiedAt), description: r.description || undefined,
      embedding: r.embedding ? new Float32Array((r.embedding as Buffer).buffer, (r.embedding as Buffer).byteOffset, (r.embedding as Buffer).byteLength / 4) : undefined,
      metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
    }));
  }

  // Update embedding blob in main items table
  async updateItemEmbedding(itemId: string, embedding: Float32Array): Promise<void> {
    const buffer = Buffer.alloc(embedding.length * 4);
    for (let i = 0; i < embedding.length; i++) buffer.writeFloatLE(embedding[i], i * 4);
    this.db.prepare(`UPDATE items SET embedding=? WHERE id=?`).run(buffer, itemId);
    console.log(`[SqliteMainDatabase] Updated embedding blob for item ${itemId} (${embedding.length} dims)`);
  }

  // Search (simple LIKE-based for now)
  async searchMediaItems(q: string, limit = 50): Promise<MediaItem[]> {
    const like = `%${q.toLowerCase()}%`;
    const rows = this.db.prepare(`
      SELECT * FROM items
      WHERE lower(name) LIKE ? OR lower(path) LIKE ? OR lower(description) LIKE ?
      ORDER BY datetime(createdAt) DESC
      LIMIT ?
    `).all(like, like, like, limit) as any[];
    return rows.map(r => ({
      id: r.id, sourceId: r.sourceId, name: r.name, path: r.path, size: r.size, type: r.type, mimeType: r.mimeType,
      createdAt: new Date(r.createdAt), modifiedAt: new Date(r.modifiedAt), description: r.description || undefined,
      embedding: r.embedding ? new Float32Array((r.embedding as Buffer).buffer, (r.embedding as Buffer).byteOffset, (r.embedding as Buffer).byteLength / 4) : undefined,
      metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
    }));
  }

  // Jobs
  async createJob(job: { sourceId: string; config?: Record<string, any> }): Promise<string> {
    const id = crypto.randomUUID();
    this.db.prepare(`INSERT INTO jobs(id,sourceId,status,progress,startedAt) VALUES(?,?,?,?,NULL)`).run(id, job.sourceId, 'pending', 0);
    return id;
  }
  async updateJobStatus(jobId: string, status: IndexingJob['status'], progress?: number): Promise<void> {
    const sets: string[] = ['status=?']; const vals: any[] = [status];
    if (typeof progress === 'number') { sets.push('progress=?'); vals.push(progress); }
    if (status === 'running') { sets.push('startedAt=?'); vals.push(new Date().toISOString()); }
    if (status === 'completed' || status === 'failed' || status === 'cancelled') { sets.push('completedAt=?'); vals.push(new Date().toISOString()); }
    vals.push(jobId);
    this.db.prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id=?`).run(...vals);
    if (status === 'completed') {
      const r = this.db.prepare(`SELECT sourceId FROM jobs WHERE id=?`).get(jobId) as any;
      if (r?.sourceId) this.db.prepare(`UPDATE sources SET lastIndexed=? WHERE id=?`).run(new Date().toISOString(), r.sourceId);
    }
  }
  async getActiveJobs(): Promise<IndexingJob[]> {
    const rows = this.db.prepare(`SELECT * FROM jobs WHERE status='running' ORDER BY datetime(startedAt) DESC`).all() as any[];
    return rows.map(r => ({ id: r.id, sourceId: r.sourceId, status: r.status, progress: r.progress, totalItems: r.totalItems || undefined, processedItems: r.processedItems || undefined, startedAt: r.startedAt ? new Date(r.startedAt) : undefined, completedAt: r.completedAt ? new Date(r.completedAt) : undefined }));
  }
  async getJobs(sourceId?: string): Promise<IndexingJob[]> {
    const rows = sourceId ? (this.db.prepare(`SELECT * FROM jobs WHERE sourceId=?`).all(sourceId) as any[]) : (this.db.prepare(`SELECT * FROM jobs`).all() as any[]);
    return rows.map(r => ({ id: r.id, sourceId: r.sourceId, status: r.status, progress: r.progress, totalItems: r.totalItems || undefined, processedItems: r.processedItems || undefined, startedAt: r.startedAt ? new Date(r.startedAt) : undefined, completedAt: r.completedAt ? new Date(r.completedAt) : undefined }));
  }
  async removeJob(jobId: string): Promise<void> {
    this.db.prepare(`DELETE FROM jobs WHERE id=?`).run(jobId);
  }

  // Stats
  async getStats(): Promise<{ totalSources: number; totalItems: number; activeJobs: number }> {
    const s = this.db.prepare(`SELECT COUNT(*) as count FROM sources`).get() as any;
    const i = this.db.prepare(`SELECT COUNT(*) as count FROM items`).get() as any;
    const a = this.db.prepare(`SELECT COUNT(*) as count FROM jobs WHERE status='running'`).get() as any;
    return { totalSources: Number(s?.count || 0), totalItems: Number(i?.count || 0), activeJobs: Number(a?.count || 0) };
  }

  close(): void { this.db.close(); }
}
