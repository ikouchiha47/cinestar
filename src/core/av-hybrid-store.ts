import { IAVSearchStore, SearchCursor, SearchItem } from './interfaces/search-store';
import { LLMProvider } from './llm-provider';
import { AVModalityVecDatabase } from './av-modality-vec-database';
import path from 'path';

export class AVHybridStore implements IAVSearchStore {
  private moddb: AVModalityVecDatabase;
  private llm: LLMProvider;
  private alpha: number;

  constructor(modDb: AVModalityVecDatabase, llm: LLMProvider, alpha: number = 0.7) {
    this.moddb = modDb;
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
      const meta = this.moddb.getSegmentMeta(r.id);
      items.push({
        id: r.id,
        type: (meta?.mediaType === 'audio') ? 'audio' : 'video',
        path: r.path,
        name: path.basename(r.path || ''),
        sourceId: meta?.itemId,
        size: undefined,
        mimeType: null,
        startMs: meta?.startMs ?? null,
        endMs: meta?.endMs ?? null,
        score: r.similarity,
        createdAt: meta?.createdAt ? new Date(meta.createdAt) : undefined,
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
