import { EmbeddingService } from '../embedding-service';
import { KeyframeData } from './types';

/**
 * EmbeddingCoordinator
 * 
 * Responsibilities:
 * - Generate embeddings (audio, visual, combined)
 * - Cache embeddings to avoid redundant generation
 * - Batch embedding requests for optimization
 * - Validate embedding dimensions
 */
export class EmbeddingCoordinator {
  private embeddingService: EmbeddingService;
  private cache: Map<string, Float32Array> = new Map();
  private readonly CACHE_SIZE_LIMIT = 1000; // Prevent unbounded memory growth

  constructor() {
    this.embeddingService = new EmbeddingService();
  }

  /**
   * Generate embedding from audio transcription only
   * Used in Phase 0 for immediate searchability
   */
  async generateAudioEmbedding(transcription: string): Promise<Float32Array> {
    if (!transcription || transcription.trim().length === 0) {
      console.warn('[EMBEDDING-COORDINATOR] Empty transcription, returning zero embedding');
      return new Float32Array(1024).fill(0); // BGE-large dimension
    }

    const cacheKey = `audio:${this.hashString(transcription)}`;
    
    // Check cache
    if (this.cache.has(cacheKey)) {
      console.log('[EMBEDDING-COORDINATOR] Cache hit for audio embedding');
      return this.cache.get(cacheKey)!;
    }

    // Generate new embedding
    console.log('[EMBEDDING-COORDINATOR] Generating audio embedding...');
    const embedding = await this.embeddingService.embedSingle(transcription);
    
    // Validate dimension
    this.validateEmbedding(embedding);
    
    // Cache with size limit
    this.cacheEmbedding(cacheKey, embedding);
    
    return embedding;
  }

  /**
   * Generate enhanced embedding combining transcription, visual captions, and scene reconstruction
   * Used in Phase 1 for rich multi-modal search
   */
  async generateEnhancedEmbedding(
    transcription: string,
    keyframes: KeyframeData[],
    sceneReconstruction: string
  ): Promise<Float32Array> {
    // Build combined text with all available context
    const visualCaptions = keyframes.map(k => k.caption).filter(c => c).join(', ');
    const spatialContext = keyframes
      .map(k => k.spatial)
      .filter(s => s)
      .join(' | ');
    const temporalContext = keyframes
      .map(k => k.temporal)
      .filter(t => t)
      .join(' | ');

    let combinedText = transcription || '';
    
    if (visualCaptions) {
      combinedText += `\n\nVisual: ${visualCaptions}`;
    }
    
    if (spatialContext) {
      combinedText += `\n\nSpatial Context: ${spatialContext}`;
    }
    
    if (temporalContext) {
      combinedText += `\n\nTemporal Context: ${temporalContext}`;
    }
    
    if (sceneReconstruction) {
      combinedText += `\n\nScene: ${sceneReconstruction}`;
    }

    if (!combinedText.trim()) {
      console.warn('[EMBEDDING-COORDINATOR] No content for enhanced embedding, returning zero embedding');
      return new Float32Array(1024).fill(0); // BGE-large dimension
    }

    const cacheKey = `enhanced:${this.hashString(combinedText)}`;
    
    // Check cache
    if (this.cache.has(cacheKey)) {
      console.log('[EMBEDDING-COORDINATOR] Cache hit for enhanced embedding');
      return this.cache.get(cacheKey)!;
    }

    // Generate new embedding
    console.log('[EMBEDDING-COORDINATOR] Generating enhanced embedding with multi-modal context...');
    const embedding = await this.embeddingService.embedSingle(combinedText);
    
    // Validate dimension
    this.validateEmbedding(embedding);
    
    // Cache with size limit
    this.cacheEmbedding(cacheKey, embedding);
    
    return embedding;
  }

  /**
   * Generate search-optimized embedding
   * Currently same as enhanced, but could be optimized differently in the future
   * (e.g., using different models, weighting strategies, or query-specific optimization)
   */
  async generateSearchEmbedding(
    transcription: string,
    keyframes: KeyframeData[],
    sceneReconstruction: string
  ): Promise<Float32Array> {
    // For now, use the same logic as enhanced embedding
    // In the future, this could use a different model or optimization strategy
    return await this.generateEnhancedEmbedding(transcription, keyframes, sceneReconstruction);
  }

  /**
   * Validate embedding dimensions
   * Ensures embeddings match expected dimensions for the database
   */
  private validateEmbedding(embedding: Float32Array): void {
    // Accept any dimension from the embedding service
    // Common dimensions: 384 (MiniLM), 768 (BERT), 1024 (BGE-large), 1536 (OpenAI)
    const validDimensions = [384, 768, 1024, 1536, 3072];
    
    if (!validDimensions.includes(embedding.length)) {
      console.warn(`[EMBEDDING-COORDINATOR] Unusual embedding dimension: ${embedding.length}`);
    }

    // Check for NaN or Infinity values
    for (let i = 0; i < embedding.length; i++) {
      if (!isFinite(embedding[i])) {
        throw new Error(`Invalid embedding value at index ${i}: ${embedding[i]}`);
      }
    }
  }

  /**
   * Cache embedding with size limit to prevent unbounded memory growth
   */
  private cacheEmbedding(key: string, embedding: Float32Array): void {
    // If cache is full, remove oldest entry (FIFO)
    if (this.cache.size >= this.CACHE_SIZE_LIMIT) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
        console.log('[EMBEDDING-COORDINATOR] Cache full, removed oldest entry');
      }
    }

    this.cache.set(key, embedding);
  }

  /**
   * Simple hash function for cache keys
   * Uses first 100 chars to keep keys manageable
   */
  private hashString(str: string): string {
    const truncated = str.substring(0, 100);
    let hash = 0;
    for (let i = 0; i < truncated.length; i++) {
      const char = truncated.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(36);
  }

  /**
   * Clear the embedding cache
   * Useful for testing or memory management
   */
  clearCache(): void {
    this.cache.clear();
    console.log('[EMBEDDING-COORDINATOR] Cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; limit: number; hitRate?: number } {
    return {
      size: this.cache.size,
      limit: this.CACHE_SIZE_LIMIT
    };
  }
}
