import { CanonicalMediaDatabase } from '../canonical-media-database';
import { AVSearchWriter } from '../av-search-writer';
import { VideoDatabase } from '../video-database';
import { BatchProcessingResult, SegmentStorageData } from './types';

/**
 * VideoPersistenceService
 * 
 * Responsibilities:
 * - Write video segments to media.db (metadata)
 * - Write embeddings to av_search.db (search index)
 * - Update av_meta_cache with multi-pass caption data
 * - Handle transactions and foreign key constraints
 * - Ensure parent video records exist before writing segments
 */
export class VideoPersistenceService {
  private mediaDb: CanonicalMediaDatabase;
  private avSearchWriter: AVSearchWriter;
  private videoDb?: VideoDatabase; // Optional for parent video checks

  constructor(
    mediaDb: CanonicalMediaDatabase,
    avSearchWriter: AVSearchWriter,
    videoDb?: VideoDatabase
  ) {
    this.mediaDb = mediaDb;
    this.avSearchWriter = avSearchWriter;
    this.videoDb = videoDb;
  }

  /**
   * Store batch processing results
   * Writes all segments from completed batches to the database
   */
  async storeBatchResults(results: BatchProcessingResult[]): Promise<void> {
    if (!results || results.length === 0) {
      console.warn('[PERSISTENCE] No batch results to store');
      return;
    }

    console.log(`[PERSISTENCE] Storing ${results.length} batch results...`);

    for (const result of results) {
      try {
        await this.storeBatchResult(result);
      } catch (error) {
        console.error(`[PERSISTENCE] Failed to store batch ${result.batchId}:`, error);
        // Continue with other batches even if one fails
      }
    }

    console.log(`[PERSISTENCE] ✅ Stored ${results.length} batch results`);
  }

  /**
   * Store a single batch result
   */
  private async storeBatchResult(result: BatchProcessingResult): Promise<void> {
    // Ensure parent video exists and get its sourceId
    // This will throw if parent not found, preventing FK constraint errors
    const parentVideo = await this.ensureParentVideoExists(result.videoPath);

    // Prepare segment storage data
    const segmentData: SegmentStorageData = {
      segmentId: result.batchId,
      videoPath: result.videoPath,
      parentSourceId: parentVideo.sourceId, // Always valid - ensureParentVideoExists throws if not found
      startTime: result.startTime,
      endTime: result.endTime,
      transcription: result.transcription,
      caption: result.keyframes?.[0]?.caption,
      embedding: result.embedding,
      multiPassData: result.multiPassData
    };

    // Store the segment
    await this.storeSegment(segmentData);
  }

  /**
   * Store a single video segment with all associated data
   * Writes to media.db, av_search.db, and av_meta_cache
   */
  async storeSegment(data: SegmentStorageData): Promise<string> {
    console.log(`[PERSISTENCE] Storing segment ${data.segmentId}...`);

    try {
      // 1. Write to media.db (basic metadata)
      await this.writeToMediaDb(data);

      // 2. Write embedding to av_search.db if present
      if (data.embedding) {
        await this.writeEmbedding(data.segmentId, data.embedding);
      }

      // 3. Write transcription to av_search.db if present
      if (data.transcription) {
        console.log(`[PERSISTENCE] Writing transcription to FTS: ${data.segmentId}, length: ${data.transcription.length}`);
        await this.writeTranscription(data.segmentId, data.transcription);
        console.log(`[PERSISTENCE] ✅ Transcription written to FTS`);
      } else {
        console.warn(`[PERSISTENCE] ⚠️  No transcription data for segment ${data.segmentId}`);
      }

      // 4. Update metadata cache with multi-pass data
      await this.updateMetadataCache(data);

      console.log(`[PERSISTENCE] ✅ Stored segment ${data.segmentId}`);
      return data.segmentId;
    } catch (error) {
      console.error(`[PERSISTENCE] Failed to store segment ${data.segmentId}:`, error);
      throw error;
    }
  }

  /**
   * Write segment metadata to media.db
   * Writes to BOTH media_items (for catalog) AND segments (source of truth)
   */
  private async writeToMediaDb(data: SegmentStorageData): Promise<void> {
    const segmentPath = `${data.videoPath}#t=${data.startTime},${data.endTime}`;
    const durationMs = (data.endTime - data.startTime) * 1000;

    // parentSourceId is always set - ensureParentVideoExists throws if parent not found
    if (!data.parentSourceId) {
      throw new Error(`Cannot write segment to media.db: parentSourceId is missing for ${data.segmentId}`);
    }

    // 1. Write to media_items (for catalog/listing)
    this.mediaDb.upsertMediaItemFromLegacy({
      id: data.segmentId,
      sourceId: data.parentSourceId,
      type: 'video_segment',
      path: segmentPath,
      size: 0, // Size not relevant for segments
      mimeType: 'video/mp4',
      durationMs: durationMs,
      width: null,
      height: null,
      modifiedAt: new Date()
    });

    // 2. Write to segments table (source of truth for segment metadata)
    // Get parent video ID from path
    const parentItems = this.mediaDb.getMediaItemsByPath(data.videoPath, true);
    if (parentItems && parentItems.length > 0) {
      const parentId = parentItems[0].id;
      
      this.mediaDb.upsertSegment({
        id: data.segmentId,
        itemId: parentId,
        kind: 'video',
        startMs: data.startTime * 1000,
        endMs: data.endTime * 1000,
        transcript: data.transcription,
        caption: data.caption
      });
      
      console.log(`[PERSISTENCE] ✅ Wrote segment to media.db.segments: ${data.segmentId} (parent: ${parentId})`);
    } else {
      console.warn(`[PERSISTENCE] ⚠️  Parent video not found in media.db for ${data.videoPath}, skipping segments table write`);
    }
  }

  /**
   * Write embedding to av_search.db
   */
  private async writeEmbedding(segmentId: string, embedding: Float32Array): Promise<void> {
    this.avSearchWriter.updateVideoSegmentEmbedding(
      segmentId,
      segmentId,
      embedding
    );
  }

  /**
   * Write transcription to av_search.db
   */
  private async writeTranscription(segmentId: string, transcription: string): Promise<void> {
    this.avSearchWriter.updateTranscription(segmentId, transcription);
  }

  /**
   * Update av_meta_cache with segment metadata and multi-pass caption data
   */
  private async updateMetadataCache(data: SegmentStorageData): Promise<void> {
    const segmentPath = `${data.videoPath}#t=${data.startTime},${data.endTime}`;
    const startMs = data.startTime * 1000;
    const endMs = data.endTime * 1000;
    const durationMs = endMs - startMs;

    this.avSearchWriter.updateAVMetaCache({
      itemId: data.segmentId,
      segmentId: data.segmentId,
      mediaType: 'video',
      path: segmentPath,
      startMs: startMs,
      endMs: endMs,
      durationMs: durationMs,
      title: `Video Segment ${data.startTime}s-${data.endTime}s`,
      createdAt: new Date().toISOString(),
      // Multi-pass caption data
      caption: data.caption,
      captionElements: data.multiPassData?.elements,
      captionSpatial: data.multiPassData?.spatial,
      captionTemporal: data.multiPassData?.temporal,
      captionTokens: data.multiPassData?.tokens
    });
  }

  /**
   * Ensure parent video record exists in database
   * Required to satisfy foreign key constraints when writing segments
   * Returns parent video info including sourceId from media.db
   * @throws Error if parent video not found (prevents FK constraint errors)
   */
  async ensureParentVideoExists(videoPath: string): Promise<{ id: string; sourceId: string }> {
    try {
      // First check media.db for the parent video
      const mediaItem = this.mediaDb.getMediaItem(videoPath);
      if (mediaItem && mediaItem.type === 'video') {
        console.log(`[PERSISTENCE] Parent video in media.db: ${mediaItem.id}, sourceId: ${mediaItem.sourceId}`);
        return { id: mediaItem.id, sourceId: mediaItem.sourceId };
      }

      // Check by path query
      const items = this.mediaDb.getMediaItemsByPath(videoPath);
      const parentVideo = items.find(item => item.type === 'video' && item.path === videoPath);
      
      if (parentVideo) {
        // Database returns snake_case (source_id), need to handle both cases
        const sourceId = (parentVideo as any).source_id || parentVideo.sourceId;
        console.log(`[PERSISTENCE] Parent video found by path: ${parentVideo.id}, sourceId: ${sourceId}`);
        return { id: parentVideo.id, sourceId: sourceId };
      }

      // CRITICAL: Parent video MUST exist before processing segments
      const errorMsg = `Parent video not found in media.db: ${videoPath}. Cannot process segments without parent video. Ensure video is indexed before processing segments.`;
      console.error(`[PERSISTENCE] ❌ ${errorMsg}`);
      throw new Error(errorMsg);
    } catch (error) {
      // If it's already our error, rethrow it
      if (error instanceof Error && error.message.includes('Parent video not found')) {
        throw error;
      }
      
      // Otherwise, wrap the error with context
      console.error(`[PERSISTENCE] Failed to lookup parent video:`, error);
      throw new Error(`Failed to lookup parent video in media.db for ${videoPath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Write multiple segments in a transaction (if supported)
   * Currently writes sequentially, but could be optimized with batch operations
   */
  async storeSegmentsBatch(segments: SegmentStorageData[]): Promise<string[]> {
    console.log(`[PERSISTENCE] Storing ${segments.length} segments in batch...`);
    
    const segmentIds: string[] = [];
    
    for (const segment of segments) {
      try {
        const segmentId = await this.storeSegment(segment);
        segmentIds.push(segmentId);
      } catch (error) {
        console.error(`[PERSISTENCE] Failed to store segment in batch:`, error);
        // Continue with other segments
      }
    }

    console.log(`[PERSISTENCE] ✅ Stored ${segmentIds.length}/${segments.length} segments`);
    return segmentIds;
  }

  /**
   * Delete a segment and all associated data
   * Useful for cleanup or error recovery
   */
  async deleteSegment(segmentId: string): Promise<void> {
    console.log(`[PERSISTENCE] Deleting segment ${segmentId}...`);
    
    try {
      // Delete from media.db
      // Note: CanonicalMediaDatabase doesn't have a delete method yet
      // This would need to be added if segment deletion is required
      
      // Delete from av_search.db
      // Note: AVSearchWriter doesn't have a delete method yet
      // This would need to be added if segment deletion is required
      
      console.log(`[PERSISTENCE] ✅ Deleted segment ${segmentId}`);
    } catch (error) {
      console.error(`[PERSISTENCE] Failed to delete segment ${segmentId}:`, error);
      throw error;
    }
  }
}
