import { IImageSearchStore, SearchCursor, SearchItem } from './interfaces/search-store';
import { LLMProvider } from './llm-provider';
import { ImageModalityVecDatabase } from './image-modality-vec-database';
import path from 'path';

export class ImageHybridStore implements IImageSearchStore {
  private moddb: ImageModalityVecDatabase;
  private llm: LLMProvider;
  private alpha: number;

  constructor(modalityDb: ImageModalityVecDatabase, llm: LLMProvider, alpha: number = 0.7) {
    this.moddb = modalityDb;
    this.llm = llm;
    this.alpha = alpha;
  }

  async search(q: string, limit: number, cursor?: SearchCursor): Promise<{ items: SearchItem[]; total: number; nextCursor?: SearchCursor }> {
    if (!q || !q.trim()) return { items: [], total: 0 };

    const embedding = await this.llm.generateEmbedding(q);
    const cutoff = cursor?.ts && cursor?.id ? { tsISO: cursor.ts, id: cursor.id } : undefined;
    const res = await this.moddb.searchHybrid(q, new Float32Array(embedding), { limit, alpha: this.alpha, cutoff });

    const items: SearchItem[] = [];
    for (const r of res.results) {
      const meta = this.moddb.getImageMeta(r.id);
      items.push({
        id: r.id,
        type: 'image',
        path: r.path,
        name: r.name || path.basename(r.path || ''),
        sourceId: undefined,
        size: undefined,
        mimeType: null,
        score: r.similarity,
        createdAt: meta?.created_at ? new Date(meta.created_at) : undefined,
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
