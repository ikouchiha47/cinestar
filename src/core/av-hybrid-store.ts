import { IAVSearchStore, SearchCursor, SearchItem } from './interfaces/search-store';
import { LLMProvider } from './llm-provider';
import { AVModalityVecDatabase } from './av-modality-vec-database';
import path from 'path';

interface SearchConfig {
  maxSearchDepth: number;
  minResultsThreshold: number;
  cleanedQueryWeight: number;
  stepBackQueryWeight: number;
}

interface ParsedQuery {
  cleanedQuery: string;
  stepBackQuery: string;
  ftsKeywords: string;
}

export class AVHybridStore implements IAVSearchStore {
  private moddb: AVModalityVecDatabase;
  private llm: LLMProvider;
  private alpha: number;

  constructor(modDb: AVModalityVecDatabase, llm: LLMProvider, alpha: number = 0.7) {
    this.moddb = modDb;
    this.llm = llm;
    this.alpha = alpha;
  }

  /**
   * Parse the multi-query format: "cleanedQuery|stepBackQuery|ftsKeywords"
   */
  private parseQuery(q: string): ParsedQuery {
    const parts = q.split('|');
    return {
      cleanedQuery: parts[0] || q,
      stepBackQuery: parts[1] || parts[0] || q,
      ftsKeywords: parts[2] || parts[1] || parts[0] || q
    };
  }

  /**
   * Execute a single search with given embedding and FTS queries
   */
  private async executeSearch(
    embeddingQuery: string,
    ftsQuery: string,
    limit: number,
    cursor?: SearchCursor
  ): Promise<{ items: SearchItem[]; total: number; nextCursor?: SearchCursor }> {
    const embedding = await this.llm.generateEmbedding(embeddingQuery);
    const cutoff = cursor?.ts && cursor?.id ? { tsISO: cursor.ts, id: cursor.id } : undefined;

    const res = await this.moddb.searchHybrid(ftsQuery, new Float32Array(embedding), {
      limit,
      alpha: this.alpha,
      cutoff,
      minSimilarity: 0.5,
      maxDistance: 0.4
    });

    const items: SearchItem[] = [];
    for (const r of res.results) {
      const meta = this.moddb.getSegmentMeta(r.id);
      items.push({
        id: String(r.id),
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
    if (items.length === limit && res.hasMore) {
      const last = items[items.length - 1];
      if (last && last.createdAt) {
        nextCursor = { ts: last.createdAt.toISOString(), id: String(last.id) };
      }
    }

    return { items, total: res.total, nextCursor };
  }

  /**
   * Merge results from multiple queries with weighted scoring
   */
  private mergeResults(
    depth1Items: SearchItem[],
    depth2Items: SearchItem[],
    weight1: number,
    weight2: number,
    limit: number
  ): SearchItem[] {
    const seen = new Set<string>();
    const merged: SearchItem[] = [];

    // Add depth 1 results with weighted score
    for (const item of depth1Items) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        merged.push({
          ...item,
          score: (item.score || 0) * weight1
        });
      }
    }

    // Add depth 2 results with weighted score, merge if duplicate
    for (const item of depth2Items) {
      if (seen.has(item.id)) {
        // Already exists, boost score
        const existing = merged.find(m => m.id === item.id);
        if (existing) {
          existing.score = (existing.score || 0) + (item.score || 0) * weight2;
        }
      } else {
        seen.add(item.id);
        merged.push({
          ...item,
          score: (item.score || 0) * weight2
        });
      }
    }

    // Sort by score descending and limit
    merged.sort((a, b) => (b.score || 0) - (a.score || 0));
    return merged.slice(0, limit);
  }

  async search(
    q: string, 
    limit: number, 
    cursor?: SearchCursor,
    config?: SearchConfig
  ): Promise<{ 
    items: SearchItem[]; 
    total: number; 
    nextCursor?: SearchCursor;
    searchDepth: number;
  }> {
    console.log(`[AV-STORE] search() called: query="${q}", limit=${limit}, cursor=${cursor ? JSON.stringify(cursor) : 'none'}, config=`, config);
    if (!q || !q.trim()) return { items: [], total: 0, searchDepth: 1 };

    // Parse the multi-query format: "cleanedQuery|stepBackQuery|ftsKeywords"
    const parsed = this.parseQuery(q);
    console.log(`[AV-STORE] Parsed queries:`, parsed);

    // Use config or defaults
    const maxDepth = config?.maxSearchDepth ?? 2;
    const minResults = config?.minResultsThreshold ?? 5;
    const cleanedWeight = config?.cleanedQueryWeight ?? 0.7;
    const stepBackWeight = config?.stepBackQueryWeight ?? 0.3;

    // Try cleaned query first (depth 1)
    console.log(`[AV-STORE] 🔍 Depth 1: Trying cleaned query: "${parsed.cleanedQuery}"`);
    const depth1Results = await this.executeSearch(
      parsed.cleanedQuery,
      parsed.ftsKeywords,
      limit,
      cursor
    );

    console.log(`[AV-STORE] Depth 1 results: ${depth1Results.items.length} items`);

    // If we have enough results, return them
    if (depth1Results.items.length >= minResults || maxDepth < 2) {
      console.log(`[AV-STORE] ✅ Sufficient results at depth 1, returning`);
      return { ...depth1Results, searchDepth: 1 };
    }

    // Try step-back query (depth 2)
    console.log(`[AV-STORE] 🔍 Depth 2: Trying step-back query: "${parsed.stepBackQuery}"`);
    const depth2Results = await this.executeSearch(
      parsed.stepBackQuery,
      parsed.ftsKeywords,
      limit,
      cursor
    );

    console.log(`[AV-STORE] Depth 2 results: ${depth2Results.items.length} items`);

    // Merge and deduplicate results with weighted scoring
    const merged = this.mergeResults(
      depth1Results.items,
      depth2Results.items,
      cleanedWeight,
      stepBackWeight,
      limit
    );

    console.log(`[AV-STORE] ✅ Merged results: ${merged.length} items from depth 2`);

    // Determine next cursor from merged results
    let nextCursor: SearchCursor | undefined;
    if (merged.length === limit && (depth1Results.nextCursor || depth2Results.nextCursor)) {
      const last = merged[merged.length - 1];
      if (last && last.createdAt) {
        nextCursor = { ts: last.createdAt.toISOString(), id: String(last.id) };
      }
    }

    return {
      items: merged,
      total: Math.max(depth1Results.total, depth2Results.total),
      nextCursor,
      searchDepth: 2
    };
  }
}
