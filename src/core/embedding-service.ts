import fetch from 'node-fetch';
import { ConfigManager } from './config.js';
import { ProviderManager } from './llm/provider-manager';

export interface EmbeddingRequest {
  input: string | string[];
  model?: string;
}

export interface EmbeddingResponse {
  object: string;
  data: Array<{
    object: string;
    embedding: number[];
    index: number;
  }>;
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

export interface RerankRequest {
  model: string;
  query: string;
  documents: string[];
  top_k?: number;
}

export interface RerankResponse {
  object: string;
  data: Array<{
    index: number;
    relevance_score: number;
    document: string;
  }>;
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

export class EmbeddingService {
  private providerManager: ProviderManager;
  private rerankModel: string;
  private rerankBaseUrl?: string;

  constructor(providerManager: ProviderManager, rerankModel?: string, rerankBaseUrl?: string) {
    this.providerManager = providerManager;
    this.rerankModel = rerankModel || 'BAAI/bge-reranker-large';
    this.rerankBaseUrl = rerankBaseUrl;
    
    const activeProvider = providerManager.getActiveProvider();
    const model = providerManager.getModelForTask('embedding');
    console.log(`[EMBEDDING-SERVICE] Using provider: ${activeProvider.name}, model: ${model}`);
  }

  private debugEnabled(): boolean {
    try {
      const cfg = ConfigManager.getConfig();
      if (cfg?.debug?.enabled) return true;
    } catch {}
    return process.env.DEBUG_EMBED === 'true';
  }

  private logDebug(...args: any[]) {
    if (this.debugEnabled()) {
      // eslint-disable-next-line no-console
      console.debug('[EmbeddingService]', ...args);
    }
  }



  /**
   * Generate embeddings for text input
   */
  async embed(input: string | string[]): Promise<Float32Array[]> {
    try {
      // Handle batch embedding
      if (Array.isArray(input)) {
        const results: Float32Array[] = [];
        for (const text of input) {
          results.push(await this.embedSingle(text));
        }
        return results;
      }
      
      return [await this.embedSingle(input)];
    } catch (error) {
      console.error('[EMBEDDING-SERVICE] Failed to generate embeddings:', error);
      throw error;
    }
  }

  /**
   * Generate single embedding for text
   */
  async embedSingle(text: string): Promise<Float32Array> {
    try {
      const adapter = this.providerManager.getProviderForTask('embedding');
      const model = this.providerManager.getModelForTask('embedding');
      
      this.logDebug('embedSingle request', { 
        provider: this.providerManager.getActiveProvider().name, 
        model, 
        inputPreview: String(text).slice(0, 80) 
      });

      const response = await adapter.embed(text, { model });
      
      this.logDebug('embedSingle response', { 
        dimensions: response.dimensions,
        model: response.model 
      });

      return new Float32Array(response.embedding);
    } catch (error) {
      console.error('[EMBEDDING-SERVICE] embedSingle failed:', error);
      throw error;
    }
  }

  /**
   * Rerank documents based on query relevance
   * Note: This uses a separate rerank service, not the LLM provider
   */
  async rerank(query: string, documents: string[], topK?: number): Promise<RerankResponse> {
    if (!this.rerankBaseUrl) {
      throw new Error('Rerank service URL not configured');
    }
    
    try {
      const response = await fetch(`${this.rerankBaseUrl}/rerank`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.rerankModel,
          query,
          documents,
          top_k: topK,
        } as RerankRequest),
      });

      if (!response.ok) {
        throw new Error(`Rerank API error: ${response.status} ${response.statusText}`);
      }

      return await response.json() as RerankResponse;
    } catch (error) {
      console.error('[EMBEDDING-SERVICE] Failed to rerank documents:', error);
      throw error;
    }
  }

  /**
   * Calculate cosine similarity between two embeddings
   */
  static cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) {
      throw new Error('Embeddings must have the same dimension');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (normA * normB);
  }

  /**
   * Find most similar embeddings using cosine similarity
   */
  static findSimilar(
    queryEmbedding: Float32Array,
    candidateEmbeddings: Float32Array[],
    topK = 10
  ): Array<{ index: number; similarity: number }> {
    const similarities = candidateEmbeddings.map((embedding, index) => ({
      index,
      similarity: EmbeddingService.cosineSimilarity(queryEmbedding, embedding),
    }));

    return similarities
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);
  }

  /**
   * Test connection to embedding service
   */
  async testConnection(): Promise<boolean> {
    try {
      const embedding = await this.embedSingle('test');
      return embedding.length > 0;
    } catch (error) {
      console.error('Embedding service connection test failed:', error);
      return false;
    }
  }

  /**
   * Get embedding model info
   */
  getModelInfo(): { embeddingModel: string; rerankModel: string; provider: string } {
    const activeProvider = this.providerManager.getActiveProvider();
    const model = this.providerManager.getModelForTask('embedding');
    
    return {
      embeddingModel: model,
      rerankModel: this.rerankModel,
      provider: activeProvider.name,
    };
  }
}

/**
 * Reciprocal Rank Fusion (RRF) for combining multiple ranked lists
 */
export class RRFFusion {
  /**
   * Combine multiple ranked lists using RRF
   * @param rankedLists Array of ranked lists, each containing items with scores
   * @param k RRF parameter (default: 60)
   */
  static fuse<T>(
    rankedLists: Array<Array<{ item: T; score: number }>>,
    k = 60
  ): Array<{ item: T; score: number }> {
    const itemScores = new Map<T, number>();

    // Calculate RRF scores
    for (const rankedList of rankedLists) {
      rankedList.forEach((entry, rank) => {
        const rrfScore = 1 / (k + rank + 1);
        const currentScore = itemScores.get(entry.item) || 0;
        itemScores.set(entry.item, currentScore + rrfScore);
      });
    }

    // Convert to array and sort by RRF score
    return Array.from(itemScores.entries())
      .map(([item, score]) => ({ item, score }))
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Combine text search and vector search results using RRF
   */
  static combineSearchResults<T>(
    textResults: Array<{ item: T; score: number }>,
    vectorResults: Array<{ item: T; score: number }>,
    k = 60
  ): Array<{ item: T; score: number; sources: string[] }> {
    const itemSources = new Map<T, Set<string>>();
    const itemScores = new Map<T, number>();

    // Process text results
    textResults.forEach((entry, rank) => {
      const rrfScore = 1 / (k + rank + 1);
      itemScores.set(entry.item, (itemScores.get(entry.item) || 0) + rrfScore);
      
      if (!itemSources.has(entry.item)) {
        itemSources.set(entry.item, new Set());
      }
      itemSources.get(entry.item)!.add('text');
    });

    // Process vector results
    vectorResults.forEach((entry, rank) => {
      const rrfScore = 1 / (k + rank + 1);
      itemScores.set(entry.item, (itemScores.get(entry.item) || 0) + rrfScore);
      
      if (!itemSources.has(entry.item)) {
        itemSources.set(entry.item, new Set());
      }
      itemSources.get(entry.item)!.add('vector');
    });

    // Convert to array and sort by RRF score
    return Array.from(itemScores.entries())
      .map(([item, score]) => ({
        item,
        score,
        sources: Array.from(itemSources.get(item) || []),
      }))
      .sort((a, b) => b.score - a.score);
  }
}
