import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { SearchItem, IAVSearchStore, SearchCursor } from './interfaces/search-store';

export class AVSearchStoreSqlite implements IAVSearchStore {
  private db: Database.Database;

  constructor(dbFilePath: string) {
    const dir = path.dirname(dbFilePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.db = new Database(dbFilePath);
    this.db.pragma('journal_mode = wal');
    this.db.pragma('foreign_keys = ON');
  }

  async search(q: string, limit: number, cursor?: SearchCursor): Promise<{ items: SearchItem[]; total: number; nextCursor?: SearchCursor }> {
    const like = `%${(q || '').toLowerCase()}%`;
    const params: any[] = [like];
    let cursorClause = '';
    if (cursor && cursor.ts) {
      cursorClause = `AND (datetime(created_at) < datetime(?) OR (datetime(created_at) = datetime(?) AND item_id < ?))`;
      params.push(cursor.ts, cursor.ts, cursor.id);
    }
    params.push(limit);

    const rows = this.db.prepare(
      `SELECT item_id AS id,
              segment_id,
              media_type,
              path,
              start_ms,
              end_ms,
              duration_ms,
              title,
              created_at
       FROM av_meta_cache
       WHERE lower(path) LIKE ? ${cursorClause}
       ORDER BY datetime(created_at) DESC, id DESC
       LIMIT ?`
    ).all(...params) as any[];

    const totalRow = this.db.prepare(
      `SELECT COUNT(1) AS c FROM av_meta_cache WHERE lower(path) LIKE ?`
    ).get(like) as any;

    const items: SearchItem[] = rows.map(r => ({
      id: String(r.id),
      type: (r.media_type === 'audio' ? 'audio' : 'video'),
      path: r.path,
      name: r.title || path.basename(r.path),
      startMs: r.start_ms ?? null,
      endMs: r.end_ms ?? null,
      mimeType: null,
      createdAt: r.created_at ? new Date(r.created_at) : undefined,
    }));

    let nextCursor: SearchCursor | undefined;
    if (items.length === limit) {
      const last = rows[rows.length - 1];
      if (last && last.created_at) {
        nextCursor = { ts: String(last.created_at), id: String(last.id) };
      }
    }

    return { items, total: Number(totalRow?.c || 0), nextCursor };
  }
}
