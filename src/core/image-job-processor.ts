import { SqliteMainDatabase } from './sqlite-main-database';
import { SqliteVecDatabase } from './sqlite-vec-database';
import { LLMProvider, LLMProviderFactory } from './llm-provider';
import { ImageCompressor } from './image-compressor';
import { ConfigManager } from './config';
import path from 'path';
import os from 'os';

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
 * Pulls jobs in batches and processes them concurrently
 */
export class ImageJobProcessor {
  private db: SqliteMainDatabase;
  private vecDb: SqliteVecDatabase;
  private llm: LLMProvider | null = null;
  private isRunning: boolean = false;
  private processingLoopPromise: Promise<void> | null = null;
  private batchSize: number = 8;
  private concurrency: number = 4;

  constructor(db: SqliteMainDatabase, vecDb: SqliteVecDatabase) {
    this.db = db;
    this.vecDb = vecDb;
    
    // Initialize LLM service if available
    try {
      this.llm = LLMProviderFactory.createProvider('ollama');
      console.log('[IMAGE-JOB-PROCESSOR] ✅ LLM service initialized');
    } catch (error) {
      console.warn('[IMAGE-JOB-PROCESSOR] ⚠️ LLM service not available:', error);
    }
  }

  /**
   * Start the background job processor
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('[IMAGE-JOB-PROCESSOR] Already running');
      return;
    }

    console.log('[IMAGE-JOB-PROCESSOR] Starting background image job processor...');
    this.isRunning = true;

    // Start the processing loop
    this.processingLoopPromise = this.runProcessingLoop().catch(err => {
      console.error('[IMAGE-JOB-PROCESSOR] Processing loop crashed:', err);
      // Restart the loop if it crashes
      if (this.isRunning) {
        console.log('[IMAGE-JOB-PROCESSOR] Restarting processing loop...');
        setTimeout(() => {
          this.processingLoopPromise = this.runProcessingLoop().catch(err => {
            console.error('[IMAGE-JOB-PROCESSOR] Processing loop crashed again:', err);
          });
        }, 5000);
      }
    });
  }

  /**
   * Stop the background job processor
   */
  async stop(): Promise<void> {
    console.log('[IMAGE-JOB-PROCESSOR] Stopping...');
    this.isRunning = false;
    
    if (this.processingLoopPromise) {
      await this.processingLoopPromise;
    }
    
    console.log('[IMAGE-JOB-PROCESSOR] Stopped');
  }

  /**
   * Main processing loop - runs continuously while isRunning is true
   */
  private async runProcessingLoop(): Promise<void> {
    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    
    console.log('[IMAGE-JOB-PROCESSOR] Processing loop started');
    
    let iteration = 0;
    while (this.isRunning) {
      try {
        iteration++;
        await this.processNextBatch();
      } catch (error) {
        console.error('[IMAGE-JOB-PROCESSOR] Error in processing loop:', error);
      }
      
      // Wait 5 seconds before next check
      await sleep(5000);
    }
    
    console.log('[IMAGE-JOB-PROCESSOR] Processing loop stopped');
  }

  /**
   * Process the next batch of pending jobs
   */
  private async processNextBatch(): Promise<void> {
    if (!this.llm) {
      // No LLM service available, skip processing
      return;
    }

    // Pull pending jobs
    const jobs = await this.getPendingImageJobs(this.batchSize);
    
    if (jobs.length === 0) {
      return; // No jobs to process
    }

    console.log(`[IMAGE-BATCH] 🔄 Processing ${jobs.length} images...`);
    
    // Process batch concurrently
    const results = await this.processConcurrent(jobs, this.concurrency);
    
    // Update job statuses
    for (const result of results) {
      if (result.success) {
        await this.db.updateJobStatus(result.jobId, 'completed', 100);
        console.log(`[IMAGE-BATCH] ✅ ${result.fileName} completed`);
      } else {
        await this.db.updateJobStatusWithError(result.jobId, 'failed', 0, result.error);
        console.log(`[IMAGE-BATCH] ❌ ${result.fileName} failed: ${result.error}`);
      }
    }
    
    console.log(`[IMAGE-BATCH] ✅ Batch complete: ${results.filter(r => r.success).length}/${results.length} succeeded`);
  }

  /**
   * Get pending image processing jobs from database
   */
  private async getPendingImageJobs(limit: number): Promise<ImageJob[]> {
    const rows = await this.db.getPendingImageJobs(limit);
    
    return rows.map(row => ({
      id: row.id,
      sourceId: row.source_id,
      filePath: row.file_path,
      fileName: row.file_name,
      fileSize: row.file_size,
      status: row.status,
      retryCount: row.retry_count
    }));
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

    // 2. Generate caption
    console.log(`[IMAGE-PROCESS] 💬 Generating caption for ${job.fileName}...`);
    const caption = await this.llm!.generateImageDescription(inferencePath, job.filePath);
    
    // 3. Generate embedding
    console.log(`[IMAGE-PROCESS] 🔢 Generating embedding for ${job.fileName}...`);
    const embedding = await this.llm!.generateImageEmbedding(inferencePath);
    
    // 4. Update vector DB
    const itemId = await this.db.getItemIdByPath(job.filePath);
    if (itemId) {
      await this.vecDb.updateCaption(itemId, caption, 'completed');
      await this.vecDb.updateEmbedding(itemId, embedding, 'completed');
      console.log(`[IMAGE-PROCESS] ✅ ${job.fileName} indexed successfully`);
    } else {
      throw new Error(`Item not found in vector DB for path: ${job.filePath}`);
    }
  }

  /**
   * Retry failed jobs
   */
  async retryFailedJobs(): Promise<void> {
    const stmt = this.db.db.prepare(`
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
      const updateStmt = this.db.db.prepare(`
        UPDATE indexing_jobs 
        SET status = 'pending', retry_count = retry_count + 1
        WHERE id = ?
      `);
      updateStmt.run(job.id);
    }
    
    console.log(`[IMAGE-RETRY] ✅ ${failedJobs.length} jobs queued for retry`);
  }
}
