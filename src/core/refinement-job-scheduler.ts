import { VideoDatabase, VideoProcessingJob } from './video-database';
import path from 'path';

export interface RefinementPass {
  passNumber: number;
  threshold: number;
  delaySeconds: number;
  triggerCondition: 'immediate' | 'delayed' | 'conditional';
  enabled: boolean;
  description: string;
}

export interface RefinementMetrics {
  id: string;
  videoId: string;
  jobId: string;
  refinementPass: number;
  segmentsBefore: number;
  segmentsAfter: number;
  newSegmentsCreated: number;
  processingTimeMs: number;
  embeddingTimeMs: number;
  totalContentChars: number;
  searchQualityScore: number;
  createdAt: Date;
}

/**
 * Manages the scheduling and coordination of progressive video refinement jobs
 */
export class RefinementJobScheduler {
  private videoDb: VideoDatabase;
  private schedulerInterval: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(videoDb: VideoDatabase) {
    this.videoDb = videoDb;
  }

  /**
   * Start the refinement job scheduler
   */
  async start(intervalMs: number = 30000): Promise<void> {
    if (this.isRunning) {
      console.log('[REFINEMENT-SCHEDULER] Already running');
      return;
    }

    this.isRunning = true;
    console.log('[REFINEMENT-SCHEDULER] Starting scheduler...');

    // Process any immediately scheduled jobs
    await this.processScheduledJobs();

    // Set up periodic processing
    this.schedulerInterval = setInterval(async () => {
      try {
        await this.processScheduledJobs();
      } catch (error) {
        console.error('[REFINEMENT-SCHEDULER] Error processing scheduled jobs:', error);
      }
    }, intervalMs);

    console.log(`[REFINEMENT-SCHEDULER] Scheduler started with ${intervalMs}ms interval`);
  }

  /**
   * Stop the refinement job scheduler
   */
  stop(): void {
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = null;
    }
    this.isRunning = false;
    console.log('[REFINEMENT-SCHEDULER] Scheduler stopped');
  }

  /**
   * Schedule refinement passes for a newly processed video
   */
  async scheduleRefinementPasses(initialJobId: string, videoPath: string): Promise<string[]> {
    console.log(`[REFINEMENT-SCHEDULER] Scheduling refinement passes for ${path.basename(videoPath)}`);

    try {
      // Get refinement pass configuration
      const refinementPasses = await this.getRefinementPasses();
      const scheduledJobIds: string[] = [];

      // Schedule passes 2 and beyond (pass 1 is immediate)
      for (const pass of refinementPasses.filter(p => p.passNumber > 1 && p.enabled)) {
        const scheduledAt = new Date(Date.now() + pass.delaySeconds * 1000);
        
        const jobId = await this.videoDb.createJob({
          videoPath,
          fileName: path.basename(videoPath),
          status: 'scheduled',
          progress: 0,
          refinementPass: pass.passNumber,
          threshold: pass.threshold,
          parentJobId: initialJobId,
          triggerCondition: pass.triggerCondition,
          scheduledAt
        });

        scheduledJobIds.push(jobId);
        
        console.log(`[REFINEMENT-SCHEDULER] Scheduled pass ${pass.passNumber} (threshold=${pass.threshold}) for ${new Date(scheduledAt).toLocaleTimeString()}`);
      }

      return scheduledJobIds;
    } catch (error) {
      console.error('[REFINEMENT-SCHEDULER] Failed to schedule refinement passes:', error);
      throw error;
    }
  }

  /**
   * Process jobs that are scheduled to run now
   */
  private async processScheduledJobs(): Promise<void> {
    try {
      const scheduledJobs = await this.getScheduledJobs();
      
      if (scheduledJobs.length === 0) {
        return;
      }

      console.log(`[REFINEMENT-SCHEDULER] Found ${scheduledJobs.length} scheduled jobs to process`);

      for (const job of scheduledJobs) {
        try {
          // Check if we should actually run this job based on conditions
          const shouldRun = await this.shouldRunRefinementJob(job);
          
          if (shouldRun) {
            console.log(`[REFINEMENT-SCHEDULER] Activating refinement job ${job.id} (pass ${job.refinementPass})`);
            
            // Update job status to pending so it gets picked up by the main processor
            await this.videoDb.updateJob(job.id, {
              status: 'pending',
              scheduledAt: undefined // Clear scheduled time
            });
          } else {
            console.log(`[REFINEMENT-SCHEDULER] Skipping refinement job ${job.id} - conditions not met`);
            
            // Mark as completed without processing
            await this.videoDb.updateJob(job.id, {
              status: 'completed',
              progress: 100,
              endTime: new Date()
            });
          }
        } catch (error) {
          console.error(`[REFINEMENT-SCHEDULER] Error processing job ${job.id}:`, error);
          
          // Mark job as failed
          await this.videoDb.updateJob(job.id, {
            status: 'failed',
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }
    } catch (error) {
      console.error('[REFINEMENT-SCHEDULER] Error in processScheduledJobs:', error);
    }
  }

  /**
   * Get jobs that are scheduled to run now or in the past
   */
  private async getScheduledJobs(): Promise<VideoProcessingJob[]> {
    const stmt = this.videoDb['db'].prepare(`
      SELECT * FROM video_processing_jobs 
      WHERE status = 'scheduled' 
        AND scheduled_at IS NOT NULL 
        AND scheduled_at <= datetime('now')
      ORDER BY scheduled_at ASC
    `);

    const rows = stmt.all() as any[];
    return rows.map(row => this.videoDb['mapJobRow'](row));
  }

  /**
   * Determine if a refinement job should actually run based on conditions
   */
  private async shouldRunRefinementJob(job: VideoProcessingJob): Promise<boolean> {
    try {
      // Always run delayed jobs
      if (job.triggerCondition === 'delayed') {
        return true;
      }

      // For conditional jobs, check various criteria
      if (job.triggerCondition === 'conditional') {
        // Check if previous pass was successful
        if (job.parentJobId) {
          const parentJob = await this.videoDb.getJob(job.parentJobId);
          if (!parentJob || parentJob.status !== 'completed') {
            console.log(`[REFINEMENT-SCHEDULER] Parent job ${job.parentJobId} not completed, skipping conditional job`);
            return false;
          }
        }

        // Check if there's enough content to warrant further refinement
        const videoFile = await this.videoDb.getVideoFileByPath(job.videoPath);
        if (videoFile && videoFile.duration < 60) { // Skip refinement for videos under 1 minute
          console.log(`[REFINEMENT-SCHEDULER] Video too short (${videoFile.duration}s), skipping refinement`);
          return false;
        }

        // Check if we already have enough segments
        if (videoFile) {
          const segmentCount = await this.videoDb.getSegmentCount(videoFile.id);
          if (segmentCount > 20) { // Skip if we already have many segments
            console.log(`[REFINEMENT-SCHEDULER] Already have ${segmentCount} segments, skipping refinement`);
            return false;
          }
        }

        return true;
      }

      return true;
    } catch (error) {
      console.error('[REFINEMENT-SCHEDULER] Error checking job conditions:', error);
      return false;
    }
  }

  /**
   * Get refinement pass configuration from database
   */
  private async getRefinementPasses(): Promise<RefinementPass[]> {
    const stmt = this.videoDb['db'].prepare(`
      SELECT * FROM refinement_passes 
      WHERE enabled = TRUE 
      ORDER BY pass_number ASC
    `);

    const rows = stmt.all() as any[];
    return rows.map(row => ({
      passNumber: row.pass_number,
      threshold: row.threshold,
      delaySeconds: row.delay_seconds,
      triggerCondition: row.trigger_condition,
      enabled: row.enabled,
      description: row.description
    }));
  }

  /**
   * Record metrics for a completed refinement pass
   */
  async recordRefinementMetrics(metrics: Omit<RefinementMetrics, 'id' | 'createdAt'>): Promise<void> {
    const id = `metrics_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const stmt = this.videoDb['db'].prepare(`
      INSERT INTO refinement_metrics (
        id, video_id, job_id, refinement_pass, segments_before, segments_after,
        new_segments_created, processing_time_ms, embedding_time_ms, 
        total_content_chars, search_quality_score
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      metrics.videoId,
      metrics.jobId,
      metrics.refinementPass,
      metrics.segmentsBefore,
      metrics.segmentsAfter,
      metrics.newSegmentsCreated,
      metrics.processingTimeMs,
      metrics.embeddingTimeMs,
      metrics.totalContentChars,
      metrics.searchQualityScore
    );

    console.log(`[REFINEMENT-SCHEDULER] Recorded metrics for pass ${metrics.refinementPass}: ${metrics.newSegmentsCreated} new segments`);
  }

  /**
   * Get refinement metrics for analysis
   */
  async getRefinementMetrics(videoId?: string, passNumber?: number): Promise<RefinementMetrics[]> {
    let query = 'SELECT * FROM refinement_metrics';
    const params: any[] = [];

    if (videoId || passNumber) {
      query += ' WHERE';
      const conditions: string[] = [];
      
      if (videoId) {
        conditions.push('video_id = ?');
        params.push(videoId);
      }
      
      if (passNumber) {
        conditions.push('refinement_pass = ?');
        params.push(passNumber);
      }
      
      query += ' ' + conditions.join(' AND ');
    }

    query += ' ORDER BY created_at DESC';

    const stmt = this.videoDb['db'].prepare(query);
    const rows = stmt.all(...params) as any[];

    return rows.map(row => ({
      id: row.id,
      videoId: row.video_id,
      jobId: row.job_id,
      refinementPass: row.refinement_pass,
      segmentsBefore: row.segments_before,
      segmentsAfter: row.segments_after,
      newSegmentsCreated: row.new_segments_created,
      processingTimeMs: row.processing_time_ms,
      embeddingTimeMs: row.embedding_time_ms,
      totalContentChars: row.total_content_chars,
      searchQualityScore: row.search_quality_score,
      createdAt: new Date(row.created_at)
    }));
  }
}
