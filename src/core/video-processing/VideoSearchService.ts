import { AVSearchWriter } from '../av-search-writer';
import { EmbeddingCoordinator } from './EmbeddingCoordinator';
import { BatchProcessingResult } from './types';

/**
 * VideoSearchService
 * 
 * Responsibilities:
 * - Index video segments for vector search
 * - Generate search-optimized embeddings
 * - Handle multi-pass caption data for enhanced search
 * - Calculate search relevance scores
 */
export class VideoSearchService {
  private avSearchWriter: AVSearchWriter;
  private embeddingCoordinator: EmbeddingCoordinator;

  constructor(
    avSearchWriter: AVSearchWriter,
    embeddingCoordinator: EmbeddingCoordinator
  ) {
    this.avSearchWriter = avSearchWriter;
    this.embeddingCoordinator = embeddingCoordinator;
  }

  /**
   * Index multiple batches for search
   * Generates search-optimized embeddings and writes to search index
   */
  async indexBatches(results: BatchProcessingResult[]): Promise<void> {
    if (!results || results.length === 0) {
      console.warn('[SEARCH-SERVICE] No batches to index');
      return;
    }

    console.log(`[SEARCH-SERVICE] Indexing ${results.length} batches for search...`);

    let successCount = 0;
    for (const result of results) {
      try {
        await this.indexSegment(result);
        successCount++;
      } catch (error) {
        console.error(`[SEARCH-SERVICE] Failed to index batch ${result.batchId}:`, error);
        // Continue with other batches
      }
    }

    console.log(`[SEARCH-SERVICE] ✅ Indexed ${successCount}/${results.length} batches`);
  }

  /**
   * Index a single segment for search
   * Generates search-optimized embedding and writes to av_search.db
   */
  async indexSegment(result: BatchProcessingResult): Promise<void> {
    console.log(`[SEARCH-SERVICE] Indexing segment ${result.batchId}...`);

    try {
      // Generate search-optimized embedding
      const searchEmbedding = await this.embeddingCoordinator.generateSearchEmbedding(
        result.transcription || '',
        result.keyframes || [],
        result.sceneReconstruction || ''
      );

      // Write to search index
      this.avSearchWriter.updateVideoSegmentEmbedding(
        result.batchId,
        result.batchId,
        searchEmbedding
      );

      // Update search metadata with multi-pass caption data
      await this.updateSearchMetadata(result);

      console.log(`[SEARCH-SERVICE] ✅ Indexed segment ${result.batchId}`);
    } catch (error) {
      console.error(`[SEARCH-SERVICE] Failed to index segment ${result.batchId}:`, error);
      throw error;
    }
  }

  /**
   * Update search metadata with multi-pass caption data
   * Enhances search with spatial, temporal, and element information
   */
  private async updateSearchMetadata(result: BatchProcessingResult): Promise<void> {
    // Extract multi-pass data from keyframes
    const spatialContext = result.keyframes
      ?.map(k => k.spatial)
      .filter(s => s)
      .join(' | ');

    const temporalContext = result.keyframes
      ?.map(k => k.temporal)
      .filter(t => t)
      .join(' | ');

    const elements = result.keyframes
      ?.flatMap(k => k.elements || [])
      .filter((e, i, arr) => arr.indexOf(e) === i); // Unique elements

    // Update av_meta_cache with enhanced search data
    const segmentPath = `${result.videoPath}#t=${result.startTime},${result.endTime}`;
    
    this.avSearchWriter.updateAVMetaCache({
      itemId: result.batchId,
      segmentId: result.batchId,
      mediaType: 'video',
      path: segmentPath,
      startMs: result.startTime * 1000,
      endMs: result.endTime * 1000,
      durationMs: (result.endTime - result.startTime) * 1000,
      title: `Video Segment ${result.startTime}s-${result.endTime}s`,
      createdAt: new Date().toISOString(),
      caption: result.keyframes?.[0]?.caption,
      captionElements: elements,
      captionSpatial: spatialContext,
      captionTemporal: temporalContext,
      captionTokens: result.multiPassData?.tokens
    });
  }

  /**
   * Reindex a segment with updated data
   * Useful for refinement passes or corrections
   */
  async reindexSegment(segmentId: string, result: BatchProcessingResult): Promise<void> {
    console.log(`[SEARCH-SERVICE] Reindexing segment ${segmentId}...`);
    
    // Same as indexSegment, but explicitly for updates
    await this.indexSegment(result);
    
    console.log(`[SEARCH-SERVICE] ✅ Reindexed segment ${segmentId}`);
  }

  /**
   * Calculate search relevance score for a segment
   * Considers multiple factors: transcription quality, visual richness, temporal coherence
   */
  calculateRelevanceScore(result: BatchProcessingResult): number {
    let score = 0.0;

    // Transcription quality (0-0.4)
    if (result.transcription && result.transcription.length > 0) {
      const transcriptionScore = Math.min(result.transcription.length / 500, 1.0) * 0.4;
      score += transcriptionScore;
    }

    // Visual richness (0-0.3)
    if (result.keyframes && result.keyframes.length > 0) {
      const avgConfidence = result.keyframes.reduce((sum, k) => sum + (k.confidence || 0), 0) / result.keyframes.length;
      const visualScore = avgConfidence * 0.3;
      score += visualScore;
    }

    // Scene reconstruction quality (0-0.2)
    if (result.sceneReconstruction && result.sceneReconstruction.length > 50) {
      score += 0.2;
    }

    // Multi-pass data bonus (0-0.1)
    const hasSpatial = result.keyframes?.some(k => k.spatial);
    const hasTemporal = result.keyframes?.some(k => k.temporal);
    if (hasSpatial && hasTemporal) {
      score += 0.1;
    }

    return Math.min(score, 1.0);
  }

  /**
   * Batch reindex multiple segments
   * Useful for bulk updates or refinement passes
   */
  async reindexBatches(results: BatchProcessingResult[]): Promise<void> {
    console.log(`[SEARCH-SERVICE] Reindexing ${results.length} batches...`);
    
    let successCount = 0;
    for (const result of results) {
      try {
        await this.reindexSegment(result.batchId, result);
        successCount++;
      } catch (error) {
        console.error(`[SEARCH-SERVICE] Failed to reindex batch ${result.batchId}:`, error);
      }
    }

    console.log(`[SEARCH-SERVICE] ✅ Reindexed ${successCount}/${results.length} batches`);
  }

  /**
   * Get search statistics
   */
  getStats(): { indexed: number; failed: number } {
    // TODO: Track statistics during indexing
    return {
      indexed: 0,
      failed: 0
    };
  }
}
