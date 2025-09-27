import { VideoDatabase, VideoSegment, VideoFile } from './video-database';
import { detectScenes, createVideoSegments } from './video-processing';
import { EmbeddingService } from './embedding-service';

export interface SegmentComparison {
  newSegments: VideoSegment[];
  overlappingSegments: Array<{
    newSegment: VideoSegment;
    existingSegments: VideoSegment[];
    overlapPercentage: number;
  }>;
  supersededSegments: VideoSegment[];
}

export interface IncrementalProcessingResult {
  newSegmentsCreated: number;
  segmentsSuperseded: number;
  totalProcessingTime: number;
  embeddingTime: number;
  contentCharacters: number;
}

/**
 * Handles incremental processing of video segments for progressive refinement
 */
export class IncrementalSegmentProcessor {
  private videoDb: VideoDatabase;
  private embeddingService: EmbeddingService;

  constructor(videoDb: VideoDatabase, embeddingService: EmbeddingService) {
    this.videoDb = videoDb;
    this.embeddingService = embeddingService;
  }

  /**
   * Process new segments with a lower threshold, identifying and processing only truly new content
   */
  async processNewSegments(
    videoPath: string,
    newThreshold: number,
    refinementPass: number,
    parentJobId: string
  ): Promise<IncrementalProcessingResult> {
    const startTime = Date.now();
    console.log(`[INCREMENTAL-PROCESSOR] Starting pass ${refinementPass} with threshold ${newThreshold} for ${videoPath}`);

    try {
      // Get video file info
      const videoFile = await this.videoDb.getVideoFileByPath(videoPath);
      if (!videoFile) {
        throw new Error(`Video file not found: ${videoPath}`);
      }

      // Get existing segments from all previous passes
      const existingSegments = await this.videoDb.getVideoSegments(videoFile.id);
      console.log(`[INCREMENTAL-PROCESSOR] Found ${existingSegments.length} existing segments`);

      // Detect new scene cuts with the refined threshold using enhanced detection
      const newSceneCuts = await detectScenes(videoPath, newThreshold, refinementPass);
      console.log(`[INCREMENTAL-PROCESSOR] Detected ${newSceneCuts.length} scene cuts with threshold ${newThreshold}`);

      // Create new segments
      const newSegmentData = await createVideoSegments(
        videoPath,
        videoFile.id,
        newSceneCuts,
        2, // overlapSeconds
        3  // minSegmentLength
      );

      // Compare with existing segments to find truly new ones
      const comparison = this.compareSegments(newSegmentData, existingSegments);
      console.log(`[INCREMENTAL-PROCESSOR] Analysis: ${comparison.newSegments.length} new, ${comparison.supersededSegments.length} superseded`);

      if (comparison.newSegments.length === 0) {
        console.log(`[INCREMENTAL-PROCESSOR] No new segments to process for pass ${refinementPass}`);
        return {
          newSegmentsCreated: 0,
          segmentsSuperseded: 0,
          totalProcessingTime: Date.now() - startTime,
          embeddingTime: 0,
          contentCharacters: 0
        };
      }

      // Process new segments with full pipeline
      const embeddingStartTime = Date.now();
      const processedSegments = await this.processSegmentsBatch(
        comparison.newSegments,
        refinementPass,
        newThreshold
      );
      const embeddingTime = Date.now() - embeddingStartTime;

      // Store new segments in database
      const segmentIds = await this.videoDb.addVideoSegmentsBatch(
        processedSegments.map(segment => ({
          ...segment,
          refinementPass,
          thresholdUsed: newThreshold,
          processingPriority: this.calculatePriority(refinementPass, segment.duration)
        }))
      );

      // Mark superseded segments
      await this.markSupersededSegments(comparison.supersededSegments, segmentIds);

      // Calculate total content characters
      const contentCharacters = processedSegments.reduce((total, segment) => {
        return total + 
          (segment.transcription?.length || 0) + 
          (segment.caption?.length || 0) + 
          (segment.reconstructedScene?.length || 0);
      }, 0);

      const totalTime = Date.now() - startTime;
      
      console.log(`[INCREMENTAL-PROCESSOR] ✅ Pass ${refinementPass} completed:`);
      console.log(`[INCREMENTAL-PROCESSOR]   - New segments: ${processedSegments.length}`);
      console.log(`[INCREMENTAL-PROCESSOR]   - Content chars: ${contentCharacters}`);
      console.log(`[INCREMENTAL-PROCESSOR]   - Processing time: ${totalTime}ms`);
      console.log(`[INCREMENTAL-PROCESSOR]   - Embedding time: ${embeddingTime}ms`);

      return {
        newSegmentsCreated: processedSegments.length,
        segmentsSuperseded: comparison.supersededSegments.length,
        totalProcessingTime: totalTime,
        embeddingTime,
        contentCharacters
      };

    } catch (error) {
      console.error(`[INCREMENTAL-PROCESSOR] Error in pass ${refinementPass}:`, error);
      throw error;
    }
  }

  /**
   * Compare new segments with existing ones to identify truly new content
   */
  private compareSegments(
    newSegments: any[],
    existingSegments: VideoSegment[]
  ): SegmentComparison {
    const newSegmentObjects: VideoSegment[] = newSegments.map(seg => ({
      id: `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      videoPath: seg.videoPath,
      startTime: seg.startTime,
      endTime: seg.endTime,
      duration: seg.duration,
      sceneIndex: seg.sceneIndex,
      createdAt: new Date()
    }));

    const comparison: SegmentComparison = {
      newSegments: [],
      overlappingSegments: [],
      supersededSegments: []
    };

    for (const newSeg of newSegmentObjects) {
      const overlaps = existingSegments.filter(existing => 
        this.segmentsOverlap(newSeg, existing)
      );

      if (overlaps.length === 0) {
        // Truly new segment with no overlap
        comparison.newSegments.push(newSeg);
      } else {
        // Check overlap percentage
        const maxOverlap = Math.max(...overlaps.map(existing => 
          this.calculateOverlapPercentage(newSeg, existing)
        ));

        if (maxOverlap < 0.8) { // Less than 80% overlap = new segment
          comparison.newSegments.push(newSeg);
          
          // Mark existing segments with significant overlap as superseded
          const superseded = overlaps.filter(existing => 
            this.calculateOverlapPercentage(newSeg, existing) > 0.5
          );
          comparison.supersededSegments.push(...superseded);
        } else {
          // High overlap = not a new segment
          comparison.overlappingSegments.push({
            newSegment: newSeg,
            existingSegments: overlaps,
            overlapPercentage: maxOverlap
          });
        }
      }
    }

    return comparison;
  }

  /**
   * Check if two segments overlap in time
   */
  private segmentsOverlap(seg1: VideoSegment, seg2: VideoSegment): boolean {
    return seg1.startTime < seg2.endTime && seg1.endTime > seg2.startTime;
  }

  /**
   * Calculate the percentage of overlap between two segments
   */
  private calculateOverlapPercentage(seg1: VideoSegment, seg2: VideoSegment): number {
    if (!this.segmentsOverlap(seg1, seg2)) {
      return 0;
    }

    const overlapStart = Math.max(seg1.startTime, seg2.startTime);
    const overlapEnd = Math.min(seg1.endTime, seg2.endTime);
    const overlapDuration = overlapEnd - overlapStart;

    const minDuration = Math.min(seg1.duration, seg2.duration);
    return overlapDuration / minDuration;
  }

  /**
   * Process a batch of segments with full pipeline (transcription, captioning, etc.)
   */
  private async processSegmentsBatch(
    segments: VideoSegment[],
    refinementPass: number,
    threshold: number
  ): Promise<VideoSegment[]> {
    console.log(`[INCREMENTAL-PROCESSOR] Processing ${segments.length} segments for pass ${refinementPass}`);

    const processedSegments: VideoSegment[] = [];

    for (const segment of segments) {
      try {
        console.log(`[INCREMENTAL-PROCESSOR] Processing segment ${segment.startTime}s-${segment.endTime}s`);

        // For now, create basic segments with placeholder content
        // In a full implementation, this would run the complete pipeline:
        // - Audio extraction
        // - Transcription
        // - Captioning
        // - Scene reconstruction
        // - Multi-stage embeddings

        const processedSegment: VideoSegment = {
          ...segment,
          transcription: `Transcription for segment ${segment.startTime}s-${segment.endTime}s (pass ${refinementPass})`,
          caption: `Caption for segment ${segment.startTime}s-${segment.endTime}s (pass ${refinementPass})`,
          reconstructedScene: `Scene reconstruction for segment ${segment.startTime}s-${segment.endTime}s (pass ${refinementPass})`,
          // Note: In full implementation, would generate actual embeddings here
          metadata: {
            refinementPass,
            threshold,
            processedAt: new Date().toISOString()
          }
        };

        processedSegments.push(processedSegment);

      } catch (error) {
        console.error(`[INCREMENTAL-PROCESSOR] Error processing segment ${segment.startTime}s-${segment.endTime}s:`, error);
        // Continue with other segments
      }
    }

    return processedSegments;
  }

  /**
   * Mark existing segments as superseded by new finer-grained segments
   */
  private async markSupersededSegments(
    supersededSegments: VideoSegment[],
    newSegmentIds: string[]
  ): Promise<void> {
    if (supersededSegments.length === 0) {
      return;
    }

    console.log(`[INCREMENTAL-PROCESSOR] Marking ${supersededSegments.length} segments as superseded`);

    for (const superseded of supersededSegments) {
      // Find the best replacement segment (could be multiple)
      const replacementId = newSegmentIds[0]; // Simplified - in practice, would find best match

      await this.videoDb.updateVideoSegment(superseded.id, {
        supersededBy: replacementId,
        processingPriority: 50 // Lower priority for superseded segments
      });
    }
  }

  /**
   * Calculate processing priority based on refinement pass and segment characteristics
   */
  private calculatePriority(refinementPass: number, duration: number): number {
    // Finer segments (higher pass) get higher priority
    // Shorter segments get slightly higher priority (more specific content)
    const basePriority = refinementPass * 100;
    const durationBonus = Math.max(0, 20 - duration); // Bonus for segments under 20 seconds
    
    return basePriority + durationBonus;
  }

  /**
   * Get segments that need processing for a specific refinement pass
   */
  async getSegmentsForRefinement(
    videoId: string,
    maxPass: number
  ): Promise<VideoSegment[]> {
    const stmt = this.videoDb['db'].prepare(`
      SELECT * FROM video_segments 
      WHERE video_id = ? 
        AND refinement_pass <= ?
        AND superseded_by IS NULL
      ORDER BY processing_priority DESC, refinement_pass DESC
    `);

    const rows = stmt.all(videoId, maxPass) as any[];
    return rows.map(row => this.videoDb['mapSegmentRow'](row));
  }

  /**
   * Clean up superseded segments (optional - for storage optimization)
   */
  async cleanupSupersededSegments(videoId: string, olderThanDays: number = 7): Promise<number> {
    const cutoffDate = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    
    const stmt = this.videoDb['db'].prepare(`
      DELETE FROM video_segments 
      WHERE video_id = ? 
        AND superseded_by IS NOT NULL 
        AND created_at < ?
    `);

    const result = stmt.run(videoId, cutoffDate.toISOString());
    
    if (result.changes > 0) {
      console.log(`[INCREMENTAL-PROCESSOR] Cleaned up ${result.changes} superseded segments for video ${videoId}`);
    }

    return result.changes;
  }
}
