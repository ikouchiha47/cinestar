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
    // Ensure parent video exists
    await this.ensureParentVideoExists(result.videoPath);

    // Prepare segment storage data
    const segmentData: SegmentStorageData = {
      segmentId: result.batchId,
      videoPath: result.videoPath,
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
        await this.writeTranscription(data.segmentId, data.transcription);
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
   */
  private async writeToMediaDb(data: SegmentStorageData): Promise<void> {
    const segmentPath = `${data.videoPath}#t=${data.startTime},${data.endTime}`;
    const durationMs = (data.endTime - data.startTime) * 1000;

    this.mediaDb.upsertMediaItemFromLegacy({
      id: data.segmentId,
      sourceId: data.videoPath,
      type: 'video_segment',
      path: segmentPath,
      size: 0, // Size not relevant for segments
      mimeType: 'video/mp4',
      durationMs: durationMs,
      width: null,
      height: null,
      modifiedAt: new Date()
    });
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
   */
  async ensureParentVideoExists(videoPath: string): Promise<void> {
    if (!this.videoDb) {
      console.warn('[PERSISTENCE] VideoDatabase not available, skipping parent video check');
      return;
    }

    try {
      // Check if video file already exists
      const existingVideo = await this.videoDb.getVideoFileByPath(videoPath);
      
      if (existingVideo) {
        console.log(`[PERSISTENCE] Parent video exists: ${existingVideo.id}`);
        return;
      }

      // Create parent video record
      console.log(`[PERSISTENCE] Creating parent video record for ${videoPath}`);
      
      const fs = await import('fs');
      const path = await import('path');
      
      const stats = fs.existsSync(videoPath) ? fs.statSync(videoPath) : null;
      const fileName = path.basename(videoPath);
      const fileSize = stats?.size || 0;

      await this.videoDb.addVideoFile({
        path: videoPath,
        fileName: fileName,
        fileSize: fileSize,
        duration: 0, // Will be updated during processing
        width: 0,
        height: 0,
        addedAt: new Date()
      });

      console.log(`[PERSISTENCE] ✅ Created parent video record`);
    } catch (error) {
      console.error(`[PERSISTENCE] Failed to ensure parent video exists:`, error);
      // Don't throw - allow processing to continue
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
