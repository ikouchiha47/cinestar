import { SqliteJobsDatabase } from './sqlite-jobs-database';
import { CanonicalMediaDatabase } from './canonical-media-database';
import { ImageSearchWriter } from './image-search-writer';
import { LLMProvider, LLMProviderFactory } from './llm-provider';
import { ImageCompressor } from './image-compressor';
import { ConfigManager } from './config';
import { ImageJobCoordinator } from './image-job-coordinator';
import { MultiPassCaptioningService } from './processors/multi-pass-captioning-service';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';

interface ImageJob {
  id: string;
  sourceId: string;
  filePath: string;
  fileName: string;
  fileSize: number;
  status: string;
  retryCount: number;
}

interface ProcessingResult {
  jobId: string;
  fileName: string;
  success: boolean;
  error?: string;
}

/**
 * Background processor for image captioning and embedding jobs
 * PULL-BASED WORKER: Requests jobs from coordinator when ready
 * Multiple workers can run concurrently without duplicate processing
 */
export class ImageJobProcessor {
  private jobsDb: SqliteJobsDatabase;  // For indexing_jobs table (jobs.db)
  private mediaDb: CanonicalMediaDatabase;  // For media_items (metadata)
  private searchWriter: ImageSearchWriter;  // For embeddings/captions in image_search.db
  private coordinator: ImageJobCoordinator;
  private workerId: string;
  private llm: LLMProvider | null = null;
  private multiPassService: MultiPassCaptioningService | null = null;
  private isRunning: boolean = false;
  private processingLoopPromise: Promise<void> | null = null;
  private batchSize: number = 8;
  private concurrency: number = 4;

  constructor(
    jobsDb: SqliteJobsDatabase,
    mediaDb: CanonicalMediaDatabase,
    searchWriter: ImageSearchWriter,
    workerId?: string
  ) {
    this.jobsDb = jobsDb;
    this.mediaDb = mediaDb;
    this.searchWriter = searchWriter;
    this.workerId = workerId || `worker-${randomUUID().slice(0, 8)}`;
    this.coordinator = ImageJobCoordinator.getInstance(jobsDb);
    
    console.log(`[WORKER-${this.workerId}] 🏗️  Worker created`);
    
    // Initialize LLM service if available
    try {
      this.llm = LLMProviderFactory.createProvider('ollama');
      console.log(`[WORKER-${this.workerId}] ✅ LLM service initialized`);
    } catch (error) {
      console.warn(`[WORKER-${this.workerId}] ⚠️ LLM service not available:`, error);
    }
    
    // Initialize multi-pass captioning service if enabled
    const config = ConfigManager.getConfig();
    if (config.multiPass?.enabled) {
      try {
        this.multiPassService = new MultiPassCaptioningService();
        console.log(`[WORKER-${this.workerId}] ✅ Multi-pass captioning service initialized`);
      } catch (error) {
        console.warn(`[WORKER-${this.workerId}] ⚠️ Multi-pass service not available:`, error);
      }
    }
  }

  /**
   * Start the background job processor
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log(`[WORKER-${this.workerId}] Already running`);
      return;
    }

    console.log(`[WORKER-${this.workerId}] 🚀 Starting worker...`);
    this.isRunning = true;

    // Start the processing loop
    this.processingLoopPromise = this.runProcessingLoop().catch(err => {
      console.error(`[WORKER-${this.workerId}] Processing loop crashed:`, err);
      // Restart the loop if it crashes
      if (this.isRunning) {
        console.log(`[WORKER-${this.workerId}] Restarting processing loop...`);
        setTimeout(() => {
          this.processingLoopPromise = this.runProcessingLoop().catch(err => {
            console.error(`[WORKER-${this.workerId}] Processing loop crashed again:`, err);
          });
        }, 5000);
      }
    });
  }

  /**
   * Stop the background job processor
   */
  async stop(): Promise<void> {
    console.log(`[WORKER-${this.workerId}] Stopping...`);
    this.isRunning = false;
    
    if (this.processingLoopPromise) {
      await this.processingLoopPromise;
    }
    
    console.log(`[WORKER-${this.workerId}] Stopped`);
  }

  /**
   * Main processing loop - runs continuously while isRunning is true
   */
  private async runProcessingLoop(): Promise<void> {
    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    
    console.log(`[WORKER-${this.workerId}] 🔄 Processing loop started`);
    
    while (this.isRunning) {
      try {
        await this.processNextBatch();
      } catch (error) {
        console.error(`[WORKER-${this.workerId}] Error in processing loop:`, error);
      }
      
      // Wait before requesting more work (natural backpressure)
      await sleep(5000);
    }
    
    console.log(`[WORKER-${this.workerId}] Processing loop stopped`);
  }

  /**
   * Process the next batch of pending jobs
   */
  private async processNextBatch(): Promise<void> {
    if (!this.llm) {
      return; // No LLM service available
    }

    // PULL from coordinator (atomic assignment, no duplicates)
    const jobs = await this.coordinator.requestJobs(this.workerId, this.batchSize);
    
    if (jobs.length === 0) {
      return; // No work available
    }

    console.log(`[WORKER-${this.workerId}] 🔄 Processing ${jobs.length} images...`);
    
    // Process batch concurrently
    const results = await this.processConcurrent(jobs, this.concurrency);
    
    // Report results back to coordinator
    for (const result of results) {
      await this.coordinator.reportJobComplete(
        this.workerId,
        result.jobId,
        result.success,
        result.error
      );
    }
    
    console.log(`[WORKER-${this.workerId}] ✅ Batch complete: ${results.filter(r => r.success).length}/${results.length} succeeded`);
  }

  /**
   * Process jobs concurrently with worker pool pattern
   */
  private async processConcurrent(jobs: ImageJob[], concurrency: number): Promise<ProcessingResult[]> {
    const results: ProcessingResult[] = [];
    const queue = [...jobs];
    
    const worker = async () => {
      while (queue.length > 0) {
        const job = queue.shift()!;
        
        try {
          await this.processImage(job);
          results.push({ 
            jobId: job.id, 
            fileName: job.fileName, 
            success: true 
          });
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          results.push({ 
            jobId: job.id, 
            fileName: job.fileName, 
            success: false, 
            error: errorMsg 
          });
        }
      }
    };
    
    // Spawn N concurrent workers
    const workers = Array(concurrency).fill(0).map(() => worker());
    await Promise.all(workers);
    
    return results;
  }

  /**
   * Process a single image: compress, caption, embed
   */
  private async processImage(job: ImageJob): Promise<void> {
    console.log(`[IMAGE-PROCESS] 🖼️  Processing ${job.fileName}...`);
    
    // 1. Optional compression for vision models
    let inferencePath = job.filePath;
    try {
      const cfg = ConfigManager.getConfig();
      if (cfg.compression.enabled && ImageCompressor.shouldCompress(job.filePath, job.fileSize)) {
        const tempDir = path.join(os.tmpdir(), 'driller-compressed');
        const settings = ImageCompressor.getOptimalSettings(
          job.filePath, 
          job.fileSize, 
          cfg.ai.visionModelDims
        );
        const res = await ImageCompressor.compressImage(job.filePath, tempDir, settings);
        inferencePath = res.compressedPath;
        console.log(`[IMAGE-PROCESS] 📦 Using compressed image: ${path.basename(inferencePath)}`);
      }
    } catch (e) {
      console.warn('[IMAGE-PROCESS] ⚠️ Compression failed, using original:', e);
    }

    // 2. Generate caption (with optional multi-pass analysis)
    let caption: string;
    let multiPassData: any = null;
    
    const cfg = ConfigManager.getConfig();
    if (cfg.multiPass?.enabled && this.multiPassService) {
      console.log(`[IMAGE-PROCESS] 💬 Generating multi-pass caption for ${job.fileName}...`);
      const multiPassResult = await this.multiPassService.analyzeImage(inferencePath);
      
      caption = multiPassResult.caption;
      multiPassData = {
        caption: multiPassResult.caption,
        captionElements: multiPassResult.elements,
        captionSpatial: multiPassResult.spatial,
        captionTemporal: multiPassResult.temporal,
        captionTokens: multiPassResult.tokens
      };
      
      console.log(`[IMAGE-PROCESS] 📊 Multi-pass complete: ${multiPassResult.tokens.total} tokens (${multiPassResult.tokens.moondreamOnly} moondream)`);
    } else {
      console.log(`[IMAGE-PROCESS] 💬 Generating caption for ${job.fileName}...`);
      caption = await this.llm!.generateImageDescription(inferencePath, job.filePath);
    }
    
    // 3. Generate embedding
    console.log(`[IMAGE-PROCESS] 🔢 Generating embedding for ${job.fileName}...`);
    const embedding = await this.llm!.generateImageEmbedding(inferencePath);
    
    // 4. Update search database (embeddings + captions)
    const items = this.mediaDb.getMediaItemsByPath(job.filePath, true);
    const itemId = items && items.length > 0 ? items[0].id : null;
    if (itemId) {
      // Write to image_search.db
      this.searchWriter.updateCaption(itemId, caption);
      this.searchWriter.updateEmbedding(itemId, embedding);
      
      // Update metadata cache in image_search.db (include multi-pass metadata if available)
      this.searchWriter.updateMetaCache(itemId, {
        path: job.filePath,
        size: job.fileSize,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...(multiPassData || {})
      });
      
      console.log(`[IMAGE-PROCESS] ✅ ${job.fileName} indexed successfully`);
    } else {
      throw new Error(`Item not found in media DB for path: ${job.filePath}`);
    }
  }

  /**
   * Retry failed jobs
   */
  async retryFailedJobs(): Promise<void> {
    const stmt = this.jobsDb.db.prepare(`
      SELECT id, retry_count
      FROM indexing_jobs
      WHERE job_type = 'image_processing'
        AND status = 'failed'
        AND retry_count < 3
    `);
    
    const failedJobs = stmt.all() as any[];
    
    if (failedJobs.length === 0) {
      console.log('[IMAGE-RETRY] No failed jobs to retry');
      return;
    }
    
    console.log(`[IMAGE-RETRY] 🔄 Retrying ${failedJobs.length} failed jobs...`);
    
    for (const job of failedJobs) {
      // Reset status to pending and increment retry count
      const updateStmt = this.jobsDb.db.prepare(`
        UPDATE indexing_jobs 
        SET status = 'pending', retry_count = retry_count + 1
        WHERE id = ?
      `);
      updateStmt.run(job.id);
    }
    
    console.log(`[IMAGE-RETRY] ✅ ${failedJobs.length} jobs queued for retry`);
  }
}
