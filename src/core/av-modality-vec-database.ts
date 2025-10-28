import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { distanceToSimilarity } from './similarity-scorers';

export interface AVHybridResult {
  id: string; // segment_id
  itemId: string;
  path: string;
  mediaType: 'video'|'audio';
  startMs: number | null;
  endMs: number | null;
  similarity: number;
  distance: number;
  createdAt?: string;
}

export class AVModalityVecDatabase {
  private db: Database.Database;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');

    // Load sqlite-vec extension
    const platform = process.platform;
    const arch = process.arch;
    const isDev = !!process.env.VITE_DEV_SERVER_URL;
    const basePath = isDev 
      ? '.'
      : path.join((process as any).resourcesPath || path.dirname(process.execPath), 'app.asar.unpacked');

    let extensionPath: string;
    if (platform === 'darwin' && arch === 'arm64') {
      extensionPath = path.resolve(basePath, 'node_modules/sqlite-vec-darwin-arm64/vec0.dylib');
    } else if (platform === 'darwin' && arch === 'x64') {
      extensionPath = path.resolve(basePath, 'node_modules/sqlite-vec-darwin-x64/vec0.dylib');
    } else if (platform === 'linux' && arch === 'x64') {
      extensionPath = path.resolve(basePath, 'node_modules/sqlite-vec-linux-x64/vec0.so');
    } else if (platform === 'linux' && arch === 'arm64') {
      extensionPath = path.resolve(basePath, 'node_modules/sqlite-vec-linux-arm64/vec0.so');
    } else if (platform === 'win32' && arch === 'x64') {
      extensionPath = path.resolve(basePath, 'node_modules/sqlite-vec-windows-x64/vec0.dll');
    } else {
      throw new Error(`Unsupported platform: ${platform}-${arch}`);
    }
    this.db.loadExtension(extensionPath);
  }

  getSegmentMeta(segmentId: string): { itemId: string; path: string; mediaType: 'video'|'audio'; startMs: number|null; endMs: number|null; createdAt?: string } | null {
    const stmt = this.db.prepare(`
      SELECT item_id as itemId, path, media_type as mediaType, start_ms as startMs, end_ms as endMs, created_at as createdAt
      FROM av_meta_cache WHERE segment_id = ?`);
    const row = stmt.get(segmentId) as any;
    return row || null;
  }

  private ensureBuffer(embedding: Float32Array): Buffer {
    const qbuf = Buffer.alloc(embedding.length * 4);
    for (let i = 0; i < embedding.length; i++) qbuf.writeFloatLE(embedding[i], i * 4);
    return qbuf;
  }

  async searchSimilar(embedding: Float32Array, limit: number, cutoff?: { tsISO: string; id: string }): Promise<{ results: AVHybridResult[]; total: number; hasMore: boolean }> {
    const qbuf = this.ensureBuffer(embedding);

    const countStmt = this.db.prepare(`
      SELECT (
        (SELECT COUNT(1) FROM video_segment_vec) + (SELECT COUNT(1) FROM audio_segment_vec)
      ) AS total;
    `);

    const stmt = this.db.prepare(`
      WITH vid AS (
        SELECT m.segment_id as id, m.item_id as itemId, m.path, m.media_type as mediaType, m.start_ms as startMs, m.end_ms as endMs, m.created_at as createdAt, v.distance
        FROM video_segment_vec v
        JOIN av_meta_cache m ON m.segment_id = v.segment_id AND m.media_type = 'video'
        WHERE v.embedding MATCH ? AND k = ?
      ),
      aud AS (
        SELECT m.segment_id as id, m.item_id as itemId, m.path, m.media_type as mediaType, m.start_ms as startMs, m.end_ms as endMs, m.created_at as createdAt, a.distance
        FROM audio_segment_vec a
        JOIN av_meta_cache m ON m.segment_id = a.segment_id AND m.media_type = 'audio'
        WHERE a.embedding MATCH ? AND k = ?
      ),
      unioned AS (
        SELECT * FROM vid
        UNION ALL
        SELECT * FROM aud
      )
      SELECT * FROM unioned
      ${cutoff ? `WHERE (datetime(createdAt) < datetime(?) OR (datetime(createdAt) = datetime(?) AND id < ?))` : ''}
      ORDER BY distance ASC, id ASC
      LIMIT ?;
    `);

    const total = (countStmt.get() as any)?.total || 0;
    const kVal = Math.min(Math.max(limit * 4, 50), 1000);
    const args = cutoff ? [qbuf, kVal, qbuf, kVal, cutoff.tsISO, cutoff.tsISO, cutoff.id, limit] : [qbuf, kVal, qbuf, kVal, limit];
    const rows = stmt.all(...args) as any[];

    const results: AVHybridResult[] = rows.map(r => ({
      id: r.id,
      itemId: r.itemId,
      path: r.path,
      mediaType: r.mediaType,
      startMs: r.startMs ?? null,
      endMs: r.endMs ?? null,
      similarity: distanceToSimilarity(r.distance),
      distance: r.distance,
      createdAt: r.createdAt
    }));

    return { results, total, hasMore: results.length > 0 && results.length <= total };
  }

  async searchFTS(query: string, limit: number, cutoff?: { tsISO: string; id: string }): Promise<{ results: AVHybridResult[]; total: number; hasMore: boolean }> {
    const ftsQuery = query.trim().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean).join(' OR ');

    const countStmt = this.db.prepare(`SELECT COUNT(1) as total FROM transcripts_fts WHERE transcripts_fts MATCH ?`);
    const total = (countStmt.get(ftsQuery) as any)?.total || 0;

    const stmt = this.db.prepare(`
      WITH ranked AS (
        SELECT m.segment_id as id, m.item_id as itemId, m.path, m.media_type as mediaType, m.start_ms as startMs, m.end_ms as endMs, m.created_at as createdAt, bm25(transcripts_fts) as fts_score
        FROM transcripts_fts f
        JOIN av_meta_cache m ON f.rowid = m.segment_id
        WHERE transcripts_fts MATCH ?
      )
      SELECT * FROM ranked
      ${cutoff ? `WHERE (datetime(createdAt) < datetime(?) OR (datetime(createdAt) = datetime(?) AND id < ?))` : ''}
      ORDER BY fts_score ASC, id ASC
      LIMIT ?
    `);

    const rows = cutoff ? stmt.all(ftsQuery, cutoff.tsISO, cutoff.tsISO, cutoff.id, limit) : stmt.all(ftsQuery, limit);

    // Normalize fts_score to [0,1] with 1 best
    const results: AVHybridResult[] = [];
    if (rows.length > 0) {
      const scores = rows.map((r: any) => r.fts_score);
      const minScore = Math.min(...scores);
      const maxScore = Math.max(...scores);
      const range = maxScore - minScore || 1;
      for (const r of rows as any[]) {
        const sim = 1 - ((r.fts_score - minScore) / range);
        results.push({ id: r.id, itemId: r.itemId, path: r.path, mediaType: r.mediaType, startMs: r.startMs ?? null, endMs: r.endMs ?? null, similarity: sim, distance: 0, createdAt: r.createdAt });
      }
    }

    return { results, total, hasMore: results.length > 0 && results.length <= total };
  }

  async searchHybrid(query: string, embedding: Float32Array, options: { limit?: number; alpha?: number; cutoff?: { tsISO: string; id: string } } = {}) {
    const limit = options.limit || 20;
    const alpha = options.alpha ?? 0.7;
    const [vec, fts] = await Promise.all([
      this.searchSimilar(embedding, limit * 2, options.cutoff),
      this.searchFTS(query, limit * 2, options.cutoff)
    ]);

    const map = new Map<string, { item: AVHybridResult; vs: number; fs: number }>();
    for (const it of vec.results) map.set(it.id, { item: it, vs: it.similarity, fs: 0 });
    for (const it of fts.results) {
      const ex = map.get(it.id);
      if (ex) ex.fs = it.similarity; else map.set(it.id, { item: it, vs: 0, fs: it.similarity });
    }

    const merged = Array.from(map.values())
      .map(({ item, vs, fs }) => ({ ...item, similarity: alpha * vs + (1 - alpha) * fs }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    return { results: merged, total: map.size, hasMore: merged.length > 0 && map.size > merged.length };
  }
}
