import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { SearchItem, IImageSearchStore, SearchCursor } from './interfaces/search-store';

export class ImageSearchStoreSqlite implements IImageSearchStore {
  private db: Database.Database;

  constructor(dbFilePath: string) {
    const dir = path.dirname(dbFilePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(dbFilePath);
    this.db.pragma('journal_mode = wal');
    this.db.pragma('foreign_keys = ON');
  }

  async search(
    q: string, 
    limit: number, 
    cursor?: SearchCursor,
    config?: any
  ): Promise<{ 
    items: SearchItem[]; 
    total: number; 
    nextCursor?: SearchCursor;
    searchDepth: number;
  }> {
    const like = `%${(q || '').toLowerCase()}%`;
    const params: any[] = [like];
    let cursorClause = '';
    if (cursor && cursor.ts) {
      cursorClause = `AND (datetime(created_at) < datetime(?) OR (datetime(created_at) = datetime(?) AND item_id < ?))`;
      params.push(cursor.ts, cursor.ts, cursor.id);
    }
    params.push(limit);

    const rows = this.db.prepare(
      `SELECT item_id AS id, path, width, height, size, checksum, created_at
       FROM image_meta_cache
       WHERE lower(path) LIKE ? ${cursorClause}
       ORDER BY datetime(created_at) DESC, id DESC
       LIMIT ?`
    ).all(...params) as any[];

    const totalRow = this.db.prepare(
      `SELECT COUNT(1) AS c FROM image_meta_cache WHERE lower(path) LIKE ?`
    ).get(like) as any;

    const items: SearchItem[] = rows.map(r => ({
      id: String(r.id),
      type: 'image',
      path: r.path,
      name: path.basename(r.path),
      size: r.size,
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

    return { items, total: Number(totalRow?.c || 0), nextCursor, searchDepth: 1 };
  }
}
