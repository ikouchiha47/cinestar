import { VideoDatabase, VideoSegment } from './video-database';
import { SqliteVecDatabase } from './sqlite-vec-database';

/**
 * VideoSegmentIndexer - Clean Architecture Implementation
 * 
 * Responsibilities:
 * - Store video segments in vector.db for search (with embeddings)
 * - Store video segments in video-rag.db for job tracking (without embeddings)
 * - Maintain proper separation of concerns between search and workflow
 */
export class VideoSegmentIndexer {
  constructor(
    private vectorDb: SqliteVecDatabase,  // For search
    private videoDb: VideoDatabase        // For job tracking
  ) {}

  /**
   * Index a video segment in both databases with proper separation
   */
  async indexSegment(segment: VideoSegment, parentVideo: any): Promise<void> {
    console.log(`[SEGMENT-INDEXER] 📝 Indexing segment ${segment.id} (${segment.startTime}s-${segment.endTime}s)`);
    
    try {
      // 1. Store in vector.db for search (with embeddings and searchable text)
      await this.indexInVectorDb(segment, parentVideo);
      
      // 2. Store in video-rag.db for job tracking (without embeddings)
      await this.storeInVideoDb(segment);
      
      console.log(`[SEGMENT-INDEXER] ✅ Successfully indexed segment ${segment.id} in both databases`);
    } catch (error) {
      console.error(`[SEGMENT-INDEXER] ❌ Failed to index segment ${segment.id}:`, error);
      throw error;
    }
  }

  /**
   * Store segment in vector.db for search with full metadata and embeddings
   */
  private async indexInVectorDb(segment: VideoSegment, parentVideo: any): Promise<void> {
    const searchableText = this.buildSearchableText(segment);
    const segmentName = `${parentVideo.name} - ${this.formatTime(segment.startTime)}`;
    
    // Use addMediaItemWithIdAsync to specify the exact segment ID
    await this.vectorDb.addMediaItemWithIdAsync(segment.id, {
      sourceId: 'video_segments',
      name: segmentName,
      path: `${segment.videoPath}#t=${segment.startTime}`,
      size: 0, // Video segments don't have file size
      type: 'video_segment',
      createdAt: new Date(),
      updatedAt: new Date(),
      caption: searchableText, // Store searchable text as caption
      captionStatus: 'completed',
      embedding: segment.embedding ? new Float32Array(segment.embedding) : undefined,
      embeddingStatus: segment.embedding ? 'completed' : 'pending',
      embeddingGeneratedAt: segment.embedding ? new Date() : undefined
    });
    
    console.log(`[SEGMENT-INDEXER] 🔍 Indexed segment in vector.db for search: ${segmentName}`);
  }

  /**
   * Store segment in video-rag.db for job tracking (no embeddings)
   */
  private async storeInVideoDb(segment: VideoSegment): Promise<void> {
    // Remove embeddings for job tracking database
    const jobTrackingSegment = {
      ...segment,
      embedding: undefined // Remove embedding - not needed for job tracking
    };
    
    await this.videoDb.addVideoSegment(jobTrackingSegment);
    console.log(`[SEGMENT-INDEXER] 📊 Stored segment in video-rag.db for job tracking: ${segment.id}`);
  }

  /**
   * Build searchable text from all segment content
   */
  private buildSearchableText(segment: VideoSegment): string {
    const textParts = [
      segment.transcription,
      segment.caption,
      segment.ocrText,
      segment.reconstructedScene
    ].filter(Boolean);
    
    return textParts.join(' ').trim();
  }

  /**
   * Format time in MM:SS format
   */
  private formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Batch index multiple segments efficiently
   */
  async indexSegmentsBatch(segments: VideoSegment[], parentVideo: any): Promise<void> {
    console.log(`[SEGMENT-INDEXER] 📦 Batch indexing ${segments.length} segments`);
    
    for (const segment of segments) {
      await this.indexSegment(segment, parentVideo);
    }
    
    console.log(`[SEGMENT-INDEXER] ✅ Batch indexing complete: ${segments.length} segments`);
  }

  /**
   * Migrate existing segments from video-rag.db to vector.db for a specific video
   */
  async migrateVideoSegments(videoId: string): Promise<void> {
    console.log(`[SEGMENT-INDEXER] 🔄 Migrating segments for video ${videoId} to vector.db`);
    
    try {
      // Get parent video info
      const parentVideo = await this.videoDb.getVideoFile(videoId);
      if (!parentVideo) {
        console.warn(`[SEGMENT-INDEXER] Parent video not found: ${videoId}`);
        return;
      }
      
      // Get all video segments for this video
      const segments = await this.videoDb.getVideoSegments(videoId);
      console.log(`[SEGMENT-INDEXER] Found ${segments.length} segments to migrate`);
      
      let migratedCount = 0;
      for (const segment of segments) {
        if (segment.embedding) {
          await this.indexInVectorDb(segment, parentVideo);
          migratedCount++;
        }
      }
      
      console.log(`[SEGMENT-INDEXER] ✅ Migration complete: ${migratedCount}/${segments.length} segments migrated`);
    } catch (error) {
      console.error(`[SEGMENT-INDEXER] ❌ Migration failed:`, error);
      throw error;
    }
  }
}
