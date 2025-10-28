import { IAVSearchStore, SearchCursor, SearchItem } from './interfaces/search-store';
import { SqliteVecDatabase } from './sqlite-vec-database';
import { LLMProvider } from './llm-provider';
import path from 'path';

export class AVVectorStore implements IAVSearchStore {
  private vec: SqliteVecDatabase;
  private llm: LLMProvider;

  constructor(vecDb: SqliteVecDatabase, llm: LLMProvider) {
    this.vec = vecDb;
    this.llm = llm;
  }

  async search(q: string, limit: number, cursor?: SearchCursor): Promise<{ items: SearchItem[]; total: number; nextCursor?: SearchCursor }> {
    if (!q || !q.trim()) return { items: [], total: 0 };

    const embedding = await this.llm.generateEmbedding(q);
    const cutoff = cursor?.ts && cursor?.id ? { tsISO: cursor.ts, id: cursor.id } : undefined;
    const res = await this.vec.searchSimilar(new Float32Array(embedding), limit, 0, q, cutoff);

    const items: SearchItem[] = [];
    for (const r of res.results) {
      const type = (r.type || '').toLowerCase();
      const isVideo = type.startsWith('video');
      const isAudio = type.startsWith('audio');
      if (!(isVideo || isAudio)) continue;
      const meta = this.vec.getMediaItem(r.id);
      items.push({
        id: r.id,
        type: isAudio ? 'audio' : 'video',
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
