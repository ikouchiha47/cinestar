import { VideoDatabase } from '../video-database';
import { SqliteJobsDatabase } from '../sqlite-jobs-database';
import { VideoJobAdapter } from '../video-job-adapter';
import { ProgressUpdate, BatchCompletionStats } from './types';

/**
 * ProgressTracker
 * 
 * Responsibilities:
 * - Calculate phase-specific progress (Phase 0 vs Phase 1)
 * - Update job progress in database (jobs.db or video-rag.db)
 * - Track batch completion statistics
 * - Emit progress events for UI updates
 */
export class ProgressTracker {
  private videoDb: VideoDatabase;
  private jobsDb?: SqliteJobsDatabase;
  private videoJobAdapter?: VideoJobAdapter;

  constructor(videoDb: VideoDatabase, jobsDb?: SqliteJobsDatabase) {
    this.videoDb = videoDb;
    this.jobsDb = jobsDb;
    
    if (jobsDb) {
      this.videoJobAdapter = new VideoJobAdapter(jobsDb, videoDb);
      console.log('[PROGRESS-TRACKER] Using VideoJobAdapter for progress tracking (jobs.db)');
    } else {
      console.log('[PROGRESS-TRACKER] Using VideoDatabase for progress tracking (video-rag.db)');
    }
  }

  /**
   * Update job progress based on completed batches
   * Calculates phase-specific progress and updates database
   */
  async updateProgress(jobId: string): Promise<void> {
    try {
      console.log(`[PROGRESS-TRACKER] Updating progress for job ${jobId}...`);

      // Get batch completion statistics
      const stats = await this.getCompletedBatches(jobId);

      // Calculate phase-specific progress
      const progressUpdate = this.calculatePhaseProgress(
        stats.phase0,
        stats.phase1,
        stats.totalBatches
      );

      // Update job in database
      await this.writeProgressUpdate(jobId, progressUpdate);

      console.log(`[PROGRESS-TRACKER] ✅ Progress: ${progressUpdate.progress}% (${progressUpdate.currentPhase})`);
    } catch (error) {
      console.error(`[PROGRESS-TRACKER] Failed to update progress for job ${jobId}:`, error);
      // Don't throw - progress updates are non-critical
    }
  }

  /**
   * Get completed batch statistics for a job
   * Counts batches that completed Phase 0 and Phase 1
   */
  async getCompletedBatches(jobId: string): Promise<BatchCompletionStats> {
    try {
      // Try to get job to determine which database to query
      const job = await this.getJob(jobId);
      if (!job) {
        console.warn(`[PROGRESS-TRACKER] Job ${jobId} not found`);
        return { phase0: 0, phase1: 0, totalBatches: 0 };
      }

      // Get the parent video ID from the job's video path
      const parentVideo = await this.videoDb.getVideoFileByPath(job.videoPath);
      if (!parentVideo || !parentVideo.id) {
        console.warn(`[PROGRESS-TRACKER] No parent video found for ${job.videoPath}`);
        return { phase0: 0, phase1: 0, totalBatches: 0 };
      }

      // Count batches that completed Phase 0 (transcription) - status = 'audio_only' or higher
      const phase0Batches = await this.videoDb.database.prepare(`
        SELECT COUNT(1) as count FROM processing_batches 
        WHERE video_id = ? AND status IN ('audio_only', 'enhanced', 'complete')
      `).get(parentVideo.id) as { count: number };

      // Count batches that completed Phase 1 (keyframes/captions) - status = 'enhanced' or 'complete'
      const phase1Batches = await this.videoDb.database.prepare(`
        SELECT COUNT(1) as count FROM processing_batches 
        WHERE video_id = ? AND status IN ('enhanced', 'complete')
      `).get(parentVideo.id) as { count: number };

      // Get total batches that exist for this video
      const totalBatches = await this.videoDb.database.prepare(`
        SELECT COUNT(1) as count FROM processing_batches 
        WHERE video_id = ?
      `).get(parentVideo.id) as { count: number };

      const stats = {
        phase0: phase0Batches?.count || 0,
        phase1: phase1Batches?.count || 0,
        totalBatches: totalBatches?.count || 0
      };

      console.log(`[PROGRESS-TRACKER] Batch stats for ${jobId}: Phase0=${stats.phase0}/${stats.totalBatches}, Phase1=${stats.phase1}/${stats.totalBatches}`);

      return stats;
    } catch (error) {
      console.error(`[PROGRESS-TRACKER] Failed to get completed batches for ${jobId}:`, error);
      return { phase0: 0, phase1: 0, totalBatches: 0 };
    }
  }

  /**
   * Calculate phase-specific progress and current phase info
   * Returns progress percentage within the current phase (0-100%)
   */
  calculatePhaseProgress(
    phase0Complete: number,
    phase1Complete: number,
    totalBatches: number
  ): ProgressUpdate {
    if (totalBatches === 0) {
      return {
        jobId: '',
        progress: 0,
        currentPhase: 'phase0',
        phase0Complete: 0,
        phase1Complete: 0,
        totalBatches: 0,
        actionTitle: 'Extracting Video Segments',
        actionDescription: 'Preparing video for processing'
      };
    }

    // Validate checkpoint consistency
    if (phase1Complete > phase0Complete) {
      console.warn(`[PROGRESS-TRACKER] ⚠️ Inconsistent state: Phase1 (${phase1Complete}) > Phase0 (${phase0Complete}). Capping Phase1.`);
      phase1Complete = phase0Complete;
    }

    // Determine current phase and phase-specific progress (0-100% within that phase)
    let currentPhase: 'phase0' | 'phase1' | 'completed';
    let phaseProgress: number;
    let actionTitle: string;
    let actionDescription: string;

    if (phase0Complete < totalBatches) {
      // Still in Phase 0 - show Phase 0 progress
      currentPhase = 'phase0';
      phaseProgress = Math.floor((phase0Complete / totalBatches) * 100);
      actionTitle = 'Extracting Video Segments';
      actionDescription = 'Processing audio transcription and basic indexing';
    } else if (phase1Complete < totalBatches) {
      // Phase 0 complete, in Phase 1 - show Phase 1 progress
      currentPhase = 'phase1';
      phaseProgress = Math.floor((phase1Complete / totalBatches) * 100);
      actionTitle = 'Creating Keyframes';
      actionDescription = 'Generating keyframes and enhanced embeddings';
    } else {
      // Both phases complete
      currentPhase = 'completed';
      phaseProgress = 100;
      actionTitle = 'Video Processing Complete';
      actionDescription = 'All processing phases completed successfully';
    }

    console.log(`[PROGRESS-TRACKER] 📊 Phase calculation: Phase0=${phase0Complete}/${totalBatches}, Phase1=${phase1Complete}/${totalBatches} → Current: ${currentPhase} at ${phaseProgress}% within phase`);

    return {
      jobId: '',
      progress: phaseProgress,
      currentPhase,
      phase0Complete,
      phase1Complete,
      totalBatches,
      actionTitle,
      actionDescription
    };
  }

  /**
   * Write progress update to database
   * Uses VideoJobAdapter (jobs.db) - REQUIRED
   */
  private async writeProgressUpdate(jobId: string, progressUpdate: ProgressUpdate): Promise<void> {
    if (!this.videoJobAdapter) {
      throw new Error('[PROGRESS-TRACKER] VideoJobAdapter not available - cannot update progress');
    }
    
    // Write to jobs.db via VideoJobAdapter
    await this.videoJobAdapter.updateVideoJob(jobId, {
      progress: progressUpdate.progress,
      currentPhase: progressUpdate.currentPhase,
      phase0Complete: progressUpdate.phase0Complete,
      phase1Complete: progressUpdate.phase1Complete,
      totalBatches: progressUpdate.totalBatches,
      statusMessage: progressUpdate.actionTitle
    });
  }

  /**
   * Get job from database
   * Tries VideoJobAdapter first, falls back to VideoDatabase
   */
  private async getJob(jobId: string): Promise<any> {
    if (this.videoJobAdapter) {
      return await this.videoJobAdapter.getVideoJob(jobId);
    } else {
      return await this.videoDb.getJob(jobId);
    }
  }

  /**
   * Calculate overall progress across both phases
   * Returns 0-100% representing total completion
   */
  calculateOverallProgress(phase0Complete: number, phase1Complete: number, totalBatches: number): number {
    if (totalBatches === 0) return 0;

    // Phase 0 is 50% of total, Phase 1 is 50% of total
    const phase0Progress = (phase0Complete / totalBatches) * 50;
    const phase1Progress = (phase1Complete / totalBatches) * 50;

    return Math.floor(phase0Progress + phase1Progress);
  }

  /**
   * Get progress statistics for a job
   */
  async getProgressStats(jobId: string): Promise<ProgressUpdate> {
    const stats = await this.getCompletedBatches(jobId);
    return this.calculatePhaseProgress(stats.phase0, stats.phase1, stats.totalBatches);
  }
}
