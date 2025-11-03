import { VideoDatabase } from '../video-database';
import { CanonicalMediaDatabase } from '../canonical-media-database';
import { AVSearchWriter } from '../av-search-writer';
import { SqliteJobsDatabase } from '../sqlite-jobs-database';
import { VideoJobAdapter } from '../video-job-adapter';
import { VideoJobCoordinator } from '../video-job-coordinator';
import { BatchManager } from './BatchManager';
import { VideoPersistenceService } from './VideoPersistenceService';
import { VideoSearchService } from './VideoSearchService';
import { CaptioningCoordinator } from './CaptioningCoordinator';
import { EmbeddingCoordinator } from './EmbeddingCoordinator';
import { ProgressTracker } from './ProgressTracker';
import { VideoProcessingContext } from './types';
import { ProviderManager } from '../llm/provider-manager';
import { ConfigManager } from '../config';
import { randomUUID } from 'crypto';

/**
 * VideoJobOrchestrator
 * 
 * Main coordinator for video processing jobs.
 * 
 * Responsibilities:
 * - Job lifecycle management (start, stop, error handling)
 * - Coordination between all sub-components
 * - Progress reporting to UI
 * - Job recovery on startup
 * - Pull-based job processing with backpressure
 */
export class VideoJobOrchestrator {
  private videoDb: VideoDatabase;
  private providerManager: ProviderManager;
  private batchManager: BatchManager;
  private persistenceService: VideoPersistenceService;
  private searchService: VideoSearchService;
  private progressTracker: ProgressTracker;
  private coordinator: VideoJobCoordinator;
  private videoJobAdapter?: VideoJobAdapter;
  private workerId: string;
  private isRunning: boolean = false;
  private isProcessing: boolean = false;
  private processingLoopPromise: Promise<void> | null = null;
  private currentJobId: string | null = null;

  constructor(
    videoDb: VideoDatabase,
    mediaDb: CanonicalMediaDatabase,
    avSearchWriter: AVSearchWriter,
    jobsDb?: SqliteJobsDatabase,
    workerId?: string
  ) {
    this.workerId = workerId || `video-worker-${randomUUID().slice(0, 8)}`;
    this.videoDb = videoDb;
    
    // Initialize coordinator
    this.coordinator = VideoJobCoordinator.getInstance(videoDb, jobsDb);
    
    // Initialize VideoJobAdapter if jobsDb is available
    if (jobsDb) {
      this.videoJobAdapter = new VideoJobAdapter(jobsDb, videoDb);
      console.log(`[ORCHESTRATOR-${this.workerId}] ✅ Using VideoJobAdapter for job tracking (jobs.db)`);
    } else {
      console.log(`[ORCHESTRATOR-${this.workerId}] ⚠️  Using legacy VideoDatabase for job tracking (video-rag.db)`);
    }

    // Initialize ProviderManager from config
    const config = ConfigManager.getConfig();
    const llmConfig = (config as any).llm || ProviderManager.getDefaultConfig();
    this.providerManager = new ProviderManager(llmConfig);
    
    const activeProvider = this.providerManager.getActiveProvider();
    console.log(`[ORCHESTRATOR-${this.workerId}] 🤖 Using LLM provider: ${activeProvider.name}`);

    // Initialize sub-components with ProviderManager
    const captioningCoordinator = new CaptioningCoordinator(this.providerManager);
    const embeddingCoordinator = new EmbeddingCoordinator(this.providerManager);

    this.batchManager = new BatchManager(
      videoDb,
      captioningCoordinator,
      embeddingCoordinator,
      jobsDb
    );

    this.persistenceService = new VideoPersistenceService(
      mediaDb,
      avSearchWriter,
      videoDb
    );

    this.searchService = new VideoSearchService(
      avSearchWriter,
      embeddingCoordinator
    );

    this.progressTracker = new ProgressTracker(videoDb, jobsDb);

    console.log(`[ORCHESTRATOR-${this.workerId}] 🏗️  Orchestrator created with all components initialized`);
  }

  /**
   * Start the video job orchestrator
   * Begins processing loop and recovers any stalled jobs
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log(`[ORCHESTRATOR-${this.workerId}] Already running`);
      return;
    }

    console.log(`[ORCHESTRATOR-${this.workerId}] 🚀 Starting orchestrator...`);
    this.isRunning = true;

    // Recover any stalled jobs on startup
    try {
      await this.recoverStalledJobs();
    } catch (error) {
      console.error(`[ORCHESTRATOR-${this.workerId}] Failed to recover stalled jobs:`, error);
    }

    console.log(`[ORCHESTRATOR-${this.workerId}] ✅ Orchestrator started`);

    // Start the processing loop
    this.processingLoopPromise = this.runProcessingLoop().catch(err => {
      console.error(`[ORCHESTRATOR-${this.workerId}] Processing loop crashed:`, err);
      // Restart the loop if it crashes
      if (this.isRunning) {
        console.log(`[ORCHESTRATOR-${this.workerId}] Restarting processing loop...`);
        setTimeout(() => {
          this.processingLoopPromise = this.runProcessingLoop().catch(err => {
            console.error(`[ORCHESTRATOR-${this.workerId}] Processing loop crashed again:`, err);
          });
        }, 5000);
      }
    });
  }

  /**
   * Stop the video job orchestrator
   */
  async stop(): Promise<void> {
    console.log(`[ORCHESTRATOR-${this.workerId}] Stopping orchestrator...`);
    this.isRunning = false;
    console.log(`[ORCHESTRATOR-${this.workerId}] ✅ Orchestrator stopped`);
  }

  /**
   * Main processing loop
   * Continuously pulls jobs from coordinator and processes them
   */
  private async runProcessingLoop(): Promise<void> {
    console.log(`[ORCHESTRATOR-${this.workerId}] Starting processing loop...`);

    let iteration = 0;
    while (this.isRunning) {
      try {
        iteration++;
        await this.processNextJob();
      } catch (error) {
        console.error(`[ORCHESTRATOR-${this.workerId}] Error in processing loop:`, error);
      }

      // Wait 5 seconds before next check
      await this.sleep(5000);
    }

    console.log(`[ORCHESTRATOR-${this.workerId}] Processing loop stopped`);
  }

  /**
   * Process the next pending job
   * Pulls job from coordinator and delegates to processVideoJob
   */
  private async processNextJob(): Promise<void> {
    if (this.isProcessing) {
      return; // Already processing a job
    }

    try {
      this.isProcessing = true;

      // PULL from coordinator (atomic assignment, no duplicates)
      const jobs = await this.coordinator.requestJobs(this.workerId, 1);

      if (jobs.length === 0) {
        // No pending jobs
        return;
      }

      const job = jobs[0];
      console.log(`[ORCHESTRATOR-${this.workerId}] 🎯 Processing job ${job.id} for ${job.videoPath}`);

      this.currentJobId = job.id;

      // Process the video
      try {
        await this.processVideoJob(job);
        // Report success to coordinator
        await this.coordinator.reportJobComplete(this.workerId, job.id, true);
      } catch (error) {
        // Report failure to coordinator
        const errorMsg = error instanceof Error ? error.message : String(error);
        await this.coordinator.reportJobComplete(this.workerId, job.id, false, errorMsg);
        throw error;
      }
    } catch (error) {
      console.error(`[ORCHESTRATOR-${this.workerId}] Failed to process job:`, error);
    } finally {
      this.isProcessing = false;
      this.currentJobId = null;
    }
  }

  /**
   * Process a single video job
   * Coordinates Phase 0 and Phase 1 processing
   */
  private async processVideoJob(job: any): Promise<void> {
    try {
      console.log(`[ORCHESTRATOR-${this.workerId}] Starting video processing for ${job.videoPath}`);

      // Build processing context
      const context: VideoProcessingContext = {
        jobId: job.id,
        videoPath: job.videoPath,
        videoId: await this.getVideoId(job.videoPath),
        refinementPass: job.refinementPass || 1,
        threshold: job.threshold || 0.8
      };

      // Update job status to processing
      await this.updateJobStatus(job.id, 'processing', 0);

      // PHASE 0: Transcription and audio-only indexing
      console.log(`[ORCHESTRATOR-${this.workerId}] 🚀 Starting Phase 0...`);
      const phase0Results = await this.batchManager.processPhase0(context);
      
      // Store batch results to search databases (av_search.db)
      // This writes transcriptions to FTS and embeddings to vec tables
      await this.persistenceService.storeBatchResults(phase0Results);
      
      // Update progress
      await this.progressTracker.updateProgress(job.id);
      
      console.log(`[ORCHESTRATOR-${this.workerId}] ✅ Phase 0 complete - Video is now searchable!`);

      // PHASE 1: Keyframes and enhanced indexing
      console.log(`[ORCHESTRATOR-${this.workerId}] 🎨 Starting Phase 1...`);
      const phase1Results = await this.batchManager.processPhase1(context);
      
      // Store enhanced batch results with keyframe captions to search databases
      await this.persistenceService.storeBatchResults(phase1Results);
      
      // Index for search
      await this.searchService.indexBatches(phase1Results);
      
      // Update progress
      await this.progressTracker.updateProgress(job.id);
      
      console.log(`[ORCHESTRATOR-${this.workerId}] ✅ Phase 1 complete - Enhanced visual processing!`);

      // Complete job
      await this.updateJobStatus(job.id, 'completed', 100);

      console.log(`[ORCHESTRATOR-${this.workerId}] 🎉 Job ${job.id} completed successfully`);
    } catch (error) {
      console.error(`[ORCHESTRATOR-${this.workerId}] ❌ Job ${job.id} failed:`, error);

      // Update job as failed
      await this.updateJobStatus(job.id, 'failed', 0, error instanceof Error ? error.message : String(error));

      throw error;
    }
  }

  /**
   * Update job status in database
   */
  private async updateJobStatus(
    jobId: string,
    status: 'processing' | 'completed' | 'failed' | 'pending' | 'scheduled',
    progress: number,
    error?: string
  ): Promise<void> {
    if (!this.videoJobAdapter) {
      throw new Error('[ORCHESTRATOR] VideoJobAdapter not available - cannot update job status');
    }
    
    await this.videoJobAdapter.updateVideoJob(jobId, {
      status,
      progress,
      error,
      ...(status === 'processing' && { startedAt: new Date() }),
      ...(status === 'completed' && { completedAt: new Date() }),
      ...(status === 'failed' && { completedAt: new Date() })
    });
  }

  /**
   * Recover stalled jobs on startup
   * Resets jobs stuck in 'processing' status back to 'scheduled'
   */
  private async recoverStalledJobs(): Promise<void> {
    console.log(`[ORCHESTRATOR-${this.workerId}] 🔧 Recovering stalled jobs...`);

    try {
      // Get jobs stuck in 'processing' status
      const stalledJobs = await this.videoDb.database.prepare(`
        SELECT id, file_name FROM video_processing_jobs 
        WHERE status = 'processing'
      `).all() as Array<{ id: string, file_name: string }>;

      if (stalledJobs.length > 0) {
        console.log(`[ORCHESTRATOR-${this.workerId}] Found ${stalledJobs.length} stalled jobs, calculating resume progress...`);

        for (const job of stalledJobs) {
          // Calculate actual progress based on completed batches
          const stats = await this.progressTracker.getProgressStats(job.id);

          await this.updateJobStatus(job.id, 'scheduled', stats.progress);

          console.log(`[ORCHESTRATOR-${this.workerId}] 🔄 Resumed stalled job: ${job.id} (${job.file_name}) at ${stats.progress}% in ${stats.currentPhase}`);
        }
      } else {
        console.log(`[ORCHESTRATOR-${this.workerId}] No stalled jobs found`);
      }
    } catch (error) {
      console.error(`[ORCHESTRATOR-${this.workerId}] Failed to recover stalled jobs:`, error);
    }
  }

  /**
   * Get video ID from video path
   */
  private async getVideoId(videoPath: string): Promise<string> {
    const videoFile = await this.videoDb.getVideoFileByPath(videoPath);
    return videoFile?.id || '';
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get orchestrator status
   */
  getStatus(): {
    workerId: string;
    isRunning: boolean;
    isProcessing: boolean;
    currentJobId: string | null;
  } {
    return {
      workerId: this.workerId,
      isRunning: this.isRunning,
      isProcessing: this.isProcessing,
      currentJobId: this.currentJobId
    };
  }
}
