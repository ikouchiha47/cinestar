import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

export class CanonicalMediaDatabase {
  db: Database.Database;
  dbFilePath: string;

  constructor(dbFilePath: string) {
    const dir = path.dirname(dbFilePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.dbFilePath = dbFilePath;
    this.db = new Database(dbFilePath);
    this.db.pragma('journal_mode = wal');
    this.db.pragma('foreign_keys = ON');
  }

  upsertSourceFromLegacy(source: { id: string; name: string; type: string; path: string; enabled?: boolean; createdAt?: Date; updatedAt?: Date }): void {
    const status = source.enabled === false ? 'disabled' : 'active';
    const created = source.createdAt ? source.createdAt.toISOString() : new Date().toISOString();
    const updated = source.updatedAt ? source.updatedAt.toISOString() : new Date().toISOString();
    this.db.prepare(
      `INSERT OR REPLACE INTO sources (id, name, type, root_path, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(source.id, source.name, source.type, source.path, status, created, updated);
  }

  upsertMediaItemFromLegacy(item: {
    id: string;
    sourceId: string;
    type: string;
    path: string;
    size?: number;
    mimeType?: string | null;
    createdAt?: Date;
    modifiedAt?: Date;
    durationMs?: number | null;
    width?: number | null;
    height?: number | null;
    caption?: string | null;
  }): void {
    const created = item.createdAt ? item.createdAt.toISOString() : new Date().toISOString();
    const modified = item.modifiedAt ? item.modifiedAt.toISOString() : created;
    const duration = item.durationMs ?? null;
    const width = item.width ?? null;
    const height = item.height ?? null;
    const mime = item.mimeType || null;
    this.db.prepare(
      `INSERT OR REPLACE INTO media_items (
        id, source_id, type, path, checksum, size, mime, created_at, modified_at,
        duration_ms, width, height, fps, exif_json, status, deleted_at
      ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'indexed', NULL)`
    ).run(
      item.id,
      item.sourceId,
      item.type,
      item.path,
      item.size || 0,
      mime,
      created,
      modified,
      duration,
      width,
      height
    );
  }

  deleteMediaItem(itemId: string): void {
    this.db.prepare(`DELETE FROM media_items WHERE id = ?`).run(itemId);
  }

  deleteSource(sourceId: string): void {
    this.db.prepare(`DELETE FROM sources WHERE id = ?`).run(sourceId);
  }

  /**
   * Get media item by ID
   */
  getMediaItem(itemId: string): any | null {
    const row = this.db.prepare(`
      SELECT id, source_id, type, path, size, mime, created_at, modified_at,
             duration_ms, width, height, status
      FROM media_items
      WHERE id = ?
    `).get(itemId);
    return row || null;
  }

  /**
   * Search media items by path (exact or partial match)
   */
  getMediaItemsByPath(searchPath: string, exactMatch: boolean = true): any[] {
    if (exactMatch) {
      return this.db.prepare(`
        SELECT id, source_id, type, path, size, mime, created_at, modified_at,
               duration_ms, width, height, status
        FROM media_items
        WHERE path = ?
      `).all(searchPath) as any[];
    } else {
      return this.db.prepare(`
        SELECT id, source_id, type, path, size, mime, created_at, modified_at,
               duration_ms, width, height, status
        FROM media_items
        WHERE path LIKE ?
      `).all(`%${searchPath}%`) as any[];
    }
  }

  /**
   * Check if media item exists by path
   */
  mediaItemExists(path: string): boolean {
    const row = this.db.prepare(`
      SELECT 1 FROM media_items WHERE path = ? LIMIT 1
    `).get(path);
    return !!row;
  }

  /**
   * Insert or update a video segment
   */
  upsertSegment(segment: {
    id: string;
    itemId: string;
    kind: 'video' | 'audio';
    startMs: number;
    endMs: number;
    transcript?: string;
    caption?: string;
  }): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO segments (id, item_id, kind, start_ms, end_ms, transcript, caption, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        item_id = excluded.item_id,
        kind = excluded.kind,
        start_ms = excluded.start_ms,
        end_ms = excluded.end_ms,
        transcript = excluded.transcript,
        caption = excluded.caption,
        updated_at = excluded.updated_at
    `).run(
      segment.id,
      segment.itemId,
      segment.kind,
      segment.startMs,
      segment.endMs,
      segment.transcript || null,
      segment.caption || null,
      now,
      now
    );
  }

  /**
   * Get segments for a media item
   */
  getSegments(itemId: string): any[] {
    return this.db.prepare(`
      SELECT id, item_id, kind, start_ms, end_ms, transcript, caption, created_at, updated_at
      FROM segments
      WHERE item_id = ?
      ORDER BY start_ms
    `).all(itemId) as any[];
  }
}
