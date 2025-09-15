import Database from 'better-sqlite3';
type DatabaseType = Database.Database;
import path from 'path';
import { EventEmitter } from 'events';

export interface SceneReconstructionJob {
  id: string;
  videoId: string;
  segmentId: string;
  videoPath: string;
  startTime: number;
  endTime: number;
  jobType: 'coarse' | 'fine';
  priority: number;
  weight: number;
  status: 'pending' | 'queued' | 'processing' | 'completed' | 'failed' | 'delayed';
  transcription?: string;
  caption?: string;
  ocrText?: string;
  temporalContext?: string[];
  scheduledAt?: Date;
  createdAt: Date;
  retryCount: number;
  maxRetries: number;
  reconstructedScene?: string;
  processingTimeMs?: number;
  videoLengthSeconds: number;
  segmentIndex: number;
  lastError?: string;
}

export interface SchedulingConfig {
  coarseQueueBatchSize: number;
  fineQueueBatchSize: number;
  coarsePriority: number;
  finePriority: number;
  checkIntervalSeconds: number;
  maxCoarseConcurrent: number;
  maxFineConcurrent: number;
  timeBasedCheckEnabled: boolean;
  fineDelayMinutes: number;
}

export class SceneReconstructionJobQueue extends EventEmitter {
  private db: DatabaseType;
  private config: SchedulingConfig;
  private isProcessing = false;
  private processingInterval?: NodeJS.Timeout;
  private activeJobs = new Map<string, Date>();

  constructor(dbPath: string = './data/scene-reconstruction.db') {
    super();
    
    const dbDir = path.dirname(dbPath);
    const fs = require('fs');
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    
    this.db = new Database(dbPath);
    this.config = this.loadConfig();
    this.startProcessingLoop();
  }

  private loadConfig(): SchedulingConfig {
    const stmt = this.db.prepare('SELECT key, value FROM scheduling_config');
    const rows = stmt.all() as {key: string, value: string}[];
    const config: any = {};
    
    for (const row of rows) {
      config[row.key] = isNaN(Number(row.value)) ? row.value : Number(row.value);
    }
    
    return {
      coarseQueueBatchSize: config.coarse_queue_batch_size || 5,
      fineQueueBatchSize: config.fine_queue_batch_size || 3,
      coarsePriority: config.coarse_priority || 10,
      finePriority: config.fine_priority || 100,
      checkIntervalSeconds: config.check_interval_seconds || 300,
      maxCoarseConcurrent: config.max_coarse_concurrent || 2,
      maxFineConcurrent: config.max_fine_concurrent || 1,
      timeBasedCheckEnabled: config.time_based_check_enabled || true,
      fineDelayMinutes: config.fine_delay_minutes || 15
    };
  }

  addJob(job: Omit<SceneReconstructionJob, 'id' | 'createdAt' | 'retryCount'> & { maxRetries?: number }): string {
    const id = `sr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const stmt = this.db.prepare(`
      INSERT INTO scene_reconstruction_jobs (
        id, video_id, segment_id, video_path, start_time, end_time,
        job_type, priority, weight, status, transcription, caption, ocr_text,
        temporal_context, video_length_seconds, segment_index, max_retries
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      job.videoId,
      job.segmentId,
      job.videoPath,
      job.startTime,
      job.endTime,
      job.jobType,
      job.jobType === 'coarse' ? this.config.coarsePriority : this.config.finePriority,
      job.weight,
      job.jobType === 'fine' ? 'delayed' : 'pending',
      job.transcription,
      job.caption,
      job.ocrText,
      JSON.stringify(job.temporalContext || []),
      job.videoLengthSeconds,
      job.segmentIndex,
      job.maxRetries || 3
    );

    if (job.jobType === 'fine') {
      this.scheduleFinePass(id);
    }

    this.emit('jobAdded', { id, jobType: job.jobType });
    return id;
  }

  private scheduleFinePass(jobId: string) {
    const scheduledAt = new Date(Date.now() + this.config.fineDelayMinutes * 60 * 1000);
    
    const stmt = this.db.prepare('UPDATE scene_reconstruction_jobs SET scheduled_at = ?, status = ? WHERE id = ?');
    stmt.run(scheduledAt.toISOString(), 'delayed', jobId);
  }

  getNextBatch(jobType: 'coarse' | 'fine', limit: number): SceneReconstructionJob[] {
    const batchSize = jobType === 'coarse' ? this.config.coarseQueueBatchSize : this.config.fineQueueBatchSize;
    const actualLimit = Math.min(limit, batchSize);

    let query: string;
    let params: any[];

    if (jobType === 'coarse') {
      query = `
        SELECT * FROM scene_reconstruction_jobs 
        WHERE job_type = ? AND status = 'pending'
        ORDER BY priority ASC, created_at ASC
        LIMIT ?
      `;
      params = [jobType, actualLimit];
    } else {
      query = `
        SELECT * FROM scene_reconstruction_jobs 
        WHERE job_type = ? AND status = 'delayed' AND scheduled_at <= ?
        ORDER BY priority ASC, created_at ASC
        LIMIT ?
      `;
      params = [jobType, new Date().toISOString(), actualLimit];
    }

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as any[];
    
    return rows.map(row => ({
      ...row,
      temporalContext: row.temporal_context ? JSON.parse(row.temporal_context) : [],
      createdAt: new Date(row.created_at),
      scheduledAt: row.scheduled_at ? new Date(row.scheduled_at) : undefined,
      startedAt: row.started_at ? new Date(row.started_at) : undefined,
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined
    }));
  }

  markJobProcessing(jobId: string) {
    const stmt = this.db.prepare('UPDATE scene_reconstruction_jobs SET status = ?, started_at = ? WHERE id = ?');
    stmt.run('processing', new Date().toISOString(), jobId);
    this.activeJobs.set(jobId, new Date());
  }

  markJobCompleted(jobId: string, reconstructedScene: string, processingTimeMs: number) {
    const stmt = this.db.prepare(`
      UPDATE scene_reconstruction_jobs 
      SET status = ?, completed_at = ?, reconstructed_scene = ?, processing_time_ms = ?
      WHERE id = ?
    `);
    stmt.run('completed', new Date().toISOString(), reconstructedScene, processingTimeMs, jobId);
    this.activeJobs.delete(jobId);
    this.emit('jobCompleted', { id: jobId });
  }

  markJobFailed(jobId: string, error: string) {
    const stmt = this.db.prepare(`
      UPDATE scene_reconstruction_jobs 
      SET status = ?, last_error = ?, retry_count = retry_count + 1
      WHERE id = ?
    `);
    stmt.run('failed', error, jobId);
    this.activeJobs.delete(jobId);
    
    // Check if should retry
    const retryStmt = this.db.prepare('SELECT retry_count, max_retries FROM scene_reconstruction_jobs WHERE id = ?');
    const row = retryStmt.get(jobId) as {retry_count: number, max_retries: number};
    
    if (row.retry_count < row.max_retries) {
      const retryStmt = this.db.prepare('UPDATE scene_reconstruction_jobs SET status = ? WHERE id = ?');
      retryStmt.run('pending', jobId);
    }
    
    this.emit('jobFailed', { id: jobId, error });
  }

  getActiveJobCount(jobType: 'coarse' | 'fine'): number {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM scene_reconstruction_jobs WHERE job_type = ? AND status = ?');
    const result = stmt.get(jobType, 'processing') as {count: number};
    return result.count;
  }

  getQueueStats() {
    const stmt = this.db.prepare(`
      SELECT 
        job_type,
        status,
        COUNT(*) as count
      FROM scene_reconstruction_jobs
      GROUP BY job_type, status
    `);
    
    const rows = stmt.all() as any[];
    const stats = {
      coarse: { pending: 0, processing: 0, completed: 0, failed: 0, delayed: 0 },
      fine: { pending: 0, processing: 0, completed: 0, failed: 0, delayed: 0 }
    };
    
    for (const row of rows) {
      if (row.job_type in stats) {
        stats[row.job_type as keyof typeof stats][row.status as keyof typeof stats.coarse] = row.count;
      }
    }
    
    return stats;
  }

  private startProcessingLoop() {
    this.processingInterval = setInterval(() => {
      this.processQueues();
    }, this.config.checkIntervalSeconds * 1000);
  }

  private processQueues() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      // Process coarse queue first (higher priority)
      const coarseActive = this.getActiveJobCount('coarse');
      if (coarseActive < this.config.maxCoarseConcurrent) {
        const coarseBatch = this.getNextBatch('coarse', this.config.maxCoarseConcurrent - coarseActive);
        this.emit('batchReady', { type: 'coarse', jobs: coarseBatch });
      }

      // Process fine queue only if no coarse jobs are running
      if (coarseActive === 0) {
        const fineActive = this.getActiveJobCount('fine');
        if (fineActive < this.config.maxFineConcurrent) {
          const fineBatch = this.getNextBatch('fine', this.config.maxFineConcurrent - fineActive);
          this.emit('batchReady', { type: 'fine', jobs: fineBatch });
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  stop() {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
    }
    this.db.close();
  }
}
