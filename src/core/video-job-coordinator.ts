import { VideoDatabase } from './video-database';
import { SqliteJobsDatabase } from './sqlite-jobs-database';
import { VideoJobAdapter } from './video-job-adapter';

/**
 * GenStage-like coordinator for video job processing
 * Atomically assigns jobs to multiple worker processors
 * Prevents duplicate processing through centralized job distribution
 */
export class VideoJobCoordinator {
  private videoDb: VideoDatabase;
  private videoJobAdapter?: VideoJobAdapter;
  private static instance: VideoJobCoordinator | null = null;

  private constructor(videoDb: VideoDatabase, jobsDb?: SqliteJobsDatabase) {
    this.videoDb = videoDb;
    if (jobsDb) {
      this.videoJobAdapter = new VideoJobAdapter(jobsDb, videoDb);
      console.log('[VIDEO-COORDINATOR] ✅ Using VideoJobAdapter for job updates');
    }
  }

  /**
   * Get singleton instance of the coordinator
   */
  static getInstance(videoDb: VideoDatabase, jobsDb?: SqliteJobsDatabase): VideoJobCoordinator {
    if (!VideoJobCoordinator.instance) {
      VideoJobCoordinator.instance = new VideoJobCoordinator(videoDb, jobsDb);
      console.log('[VIDEO-COORDINATOR] ✅ Coordinator instance created');
    }
    return VideoJobCoordinator.instance;
  }

  /**
   * PULL-BASED: Worker requests jobs when ready (natural backpressure)
   * Atomically marks them as 'running' before returning to prevent duplicate assignment
   * 
   * @param workerId - Unique identifier for the requesting worker
   * @param limit - Number of jobs to request
   * @returns Array of jobs assigned to this worker
   */
  async requestJobs(workerId: string, limit: number): Promise<any[]> {
    // CRITICAL: Query jobs.db if adapter available, otherwise fall back to video-rag.db
    // This prevents race conditions where multiple workers grab the same jobs
    const pendingJobs = this.videoJobAdapter 
      ? await this.videoJobAdapter.getPendingJobs(limit)
      : await this.videoDb.getPendingJobs(limit);
    
    if (pendingJobs.length === 0) {
      return [];
    }
    
    // Immediately mark as running to prevent other workers from taking them
    for (const job of pendingJobs) {
      if (this.videoJobAdapter) {
        await this.videoJobAdapter.updateVideoJob(job.id, {
          status: 'processing',
          startedAt: new Date()
        });
      } else {
        await this.videoDb.updateJob(job.id, {
          status: 'processing',
          startTime: new Date()
        });
      }
    }
    
    const videoPaths = pendingJobs.map(j => j.videoPath).slice(0, 2).join(', ');
    console.log(`[VIDEO-COORDINATOR] ✅ ${workerId} pulled ${pendingJobs.length} jobs: ${videoPaths}${pendingJobs.length > 2 ? '...' : ''}`);
    
    return pendingJobs;
  }

  /**
   * Report job completion back to coordinator
   */
  async reportJobComplete(workerId: string, jobId: string, success: boolean, error?: string): Promise<void> {
    if (success) {
      await this.videoJobAdapter!.updateVideoJob(jobId, {
        status: 'completed',
        progress: 100,
        completedAt: new Date()
      });
      console.log(`[VIDEO-COORDINATOR] ✅ Worker ${workerId} completed job ${jobId}`);
    } else {
      await this.videoJobAdapter!.updateVideoJob(jobId, {
        status: 'failed',
        progress: 0,
        error: error,
        completedAt: new Date()
      });
      console.log(`[VIDEO-COORDINATOR] ❌ Worker ${workerId} failed job ${jobId}: ${error}`);
    }
  }
}
