import { IImageSearchStore, IAVSearchStore, SearchItem, SearchCursor } from './interfaces/search-store';

export class SearchService {
  private imageStores: IImageSearchStore[];
  private avStores: IAVSearchStore[];

  constructor(imageStores: IImageSearchStore[] = [], avStores: IAVSearchStore[] = []) {
    this.imageStores = imageStores;
    this.avStores = avStores;
  }

  // Dual-read merge with cursor pagination.
  // Each store supports (created_at DESC, id DESC) cursor.
  async search(query: string, limit: number, cursor?: SearchCursor): Promise<{ items: SearchItem[]; total: number; nextCursor?: SearchCursor; hasMore: boolean }> {
    const q = (query || '').trim();
    const imgResults = await Promise.all(this.imageStores.map(s => s.search(q, limit, cursor)));
    const avResults = await Promise.all(this.avStores.map(s => s.search(q, limit, cursor)));

    const imgItems = imgResults.flatMap(r => r.items || []);
    const avItems = avResults.flatMap(r => r.items || []);
    const merged = this.mergeItems(imgItems, avItems);
    const items = merged.slice(0, limit);
    const total = imgResults.reduce((acc, r) => acc + (r.total || 0), 0) + avResults.reduce((acc, r) => acc + (r.total || 0), 0);

    let nextCursor: SearchCursor | undefined;
    if (items.length === limit) {
      const last = items[items.length - 1];
      if (last && last.createdAt) {
        nextCursor = { ts: last.createdAt.toISOString(), id: String(last.id) };
      }
    }
    const hasMore = !!nextCursor && total > 0; // heuristic; exact per-store hasMore requires deeper coordination

    return { items, total, nextCursor, hasMore };
  }

  private mergeItems(a: SearchItem[], b: SearchItem[]): SearchItem[] {
    const cmp = (x: SearchItem, y: SearchItem) => {
      const sx = typeof x.score === 'number' ? x.score : null;
      const sy = typeof y.score === 'number' ? y.score : null;
      if (sx !== null || sy !== null) {
        // Prefer higher scores; if one missing score, treat missing as lower
        const vx = sx !== null ? sx : -Infinity;
        const vy = sy !== null ? sy : -Infinity;
        if (vy !== vx) return vy - vx;
      }
      // Fallback to createdAt desc
      return this.ts(y) - this.ts(x);
    };

    const arrA = [...a].sort(cmp);
    const arrB = [...b].sort(cmp);
    const out: SearchItem[] = [];
    let i = 0, j = 0;
    while (i < arrA.length || j < arrB.length) {
      const left = i < arrA.length ? arrA[i] : null;
      const right = j < arrB.length ? arrB[j] : null;
      if (left && !right) { out.push(left); i++; continue; }
      if (right && !left) { out.push(right); j++; continue; }
      if (!left && !right) break;
      if (cmp(left!, right!) <= 0) { out.push(left!); i++; } else { out.push(right!); j++; }
    }
    return out;
  }

  private ts(x: SearchItem): number {
    return x.createdAt ? x.createdAt.getTime() : 0;
  }
}
