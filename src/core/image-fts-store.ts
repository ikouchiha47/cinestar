import { IImageSearchStore, SearchCursor, SearchItem } from './interfaces/search-store';
import { SqliteVecDatabase } from './sqlite-vec-database';
import path from 'path';

export class ImageFtsStore implements IImageSearchStore {
  private vec: SqliteVecDatabase;
  constructor(vecDb: SqliteVecDatabase) { this.vec = vecDb; }

  async search(q: string, limit: number, _cursor?: SearchCursor): Promise<{ items: SearchItem[]; total: number; nextCursor?: SearchCursor }> {
    if (!q || !q.trim()) return { items: [], total: 0 };
    const res = await this.vec.searchFTS(q, limit, 0);
    const items: SearchItem[] = [];
    for (const r of res.results) {
      const type = (r.type || '').toLowerCase();
      if (!type.startsWith('image')) continue;
      const meta = this.vec.getMediaItem(r.id);
      items.push({
        id: r.id,
        type: 'image',
        path: r.path,
        name: r.name || path.basename(r.path || ''),
        sourceId: (r as any).sourceId,
        size: (r as any).size,
        mimeType: null,
        score: r.similarity,
        createdAt: meta?.createdAt,
      });
    }
    let nextCursor: SearchCursor | undefined;
    if (items.length === limit) {
      const last = items[items.length - 1];
      if (last && last.createdAt) nextCursor = { ts: last.createdAt.toISOString(), id: String(last.id) };
    }
    return { items, total: res.total, nextCursor };
  }
}
