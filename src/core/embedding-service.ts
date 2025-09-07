import fetch from 'node-fetch';
import { ConfigManager } from './config';

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
  private baseUrl: string;
  private apiKey: string;
  private embeddingModel: string;
  private rerankModel: string;
  private provider: 'ollama' | 'openai';

  constructor(
    baseUrl?: string,
    apiKey?: string,
    embeddingModel?: string,
    rerankModel?: string
  ) {
    // Lock to explicit backend URL and provider (no inference)
    const cfg = ConfigManager.getConfig();
    const envBase = process.env.EMBEDDINGS_BASE_URL;
    const envProvider = (process.env.EMBEDDINGS_PROVIDER || '').toLowerCase();

    const finalBase = (baseUrl || envBase || 'http://localhost:11434/api').replace(/\/$/, '');
    const finalProvider: 'ollama' | 'openai' = envProvider === 'openai' ? 'openai' : 'ollama';

    this.baseUrl = finalBase; // Do not alter
    this.provider = finalProvider; // Do not infer
    this.apiKey = apiKey || process.env.EMBEDDINGS_API_KEY || '';
    this.embeddingModel = embeddingModel || cfg.ai.embeddingModel || 'BAAI/bge-large-en-v1.5';
    this.rerankModel = rerankModel || 'BAAI/bge-reranker-large';
  }

  /**
   * Generate embeddings for text input
   */
  async embed(input: string | string[]): Promise<Float32Array[]> {
    try {
      // For Ollama, call embedSingle for each input to send {prompt}
      if (this.provider === 'ollama') {
        if (Array.isArray(input)) {
          const results: Float32Array[] = [];
          for (const text of input) {
            results.push(await this.embedSingle(text));
          }
          return results;
        }
        return [await this.embedSingle(input)];
      }

      // OpenAI-compatible path (input can be string or string[])
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

      const response = await fetch(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ input, model: this.embeddingModel } as EmbeddingRequest),
      });

      if (!response.ok) {
        throw new Error(`Embedding API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as any;
      if (Array.isArray(data?.data)) {
        return data.data.map((item: any) => new Float32Array(item.embedding));
      }
      throw new Error('Unexpected embeddings response format');
    } catch (error) {
      console.error('Failed to generate embeddings:', error);
      throw error;
    }
  }

  /**
   * Generate single embedding for text
   */
  async embedSingle(text: string): Promise<Float32Array> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

    const body = this.provider === 'ollama'
      ? { model: this.embeddingModel, prompt: text }
      : { model: this.embeddingModel, input: text };

    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Embedding API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as any;
    // Support both OpenAI-style and Ollama-style responses
    if (Array.isArray(data?.data)) {
      return new Float32Array(data.data[0].embedding);
    }
    if (Array.isArray(data?.embedding)) {
      return new Float32Array(data.embedding);
    }
    throw new Error('Unexpected embedding response format');
  }

  /**
   * Rerank documents based on query relevance
   */
  async rerank(query: string, documents: string[], topK?: number): Promise<RerankResponse> {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

      const response = await fetch(`${this.baseUrl}/rerank`, {
        method: 'POST',
        headers,
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
      console.error('Failed to rerank documents:', error);
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
  getModelInfo(): { embeddingModel: string; rerankModel: string; baseUrl: string } {
    return {
      embeddingModel: this.embeddingModel,
      rerankModel: this.rerankModel,
      baseUrl: this.baseUrl,
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
