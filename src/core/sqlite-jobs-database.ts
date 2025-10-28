import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';

export interface IndexingJob {
  id: string;
  sourceId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress?: number;
  totalItems?: number;
  processedItems?: number;
  startedAt?: Date;
  completedAt?: Date;
  title?: string;
  description?: string;
  operationType?: string;
  targetFile?: string;
}

export class SqliteJobsDatabase {
  public db: Database.Database;
  private initialized = false;

  constructor(dbFilePath: string) {
    const dir = path.dirname(dbFilePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.db = new Database(dbFilePath);
    console.log('[SqliteJobsDatabase] Using file:', dbFilePath);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.db.pragma('journal_mode = wal');
    this.db.pragma('foreign_keys = ON');

    // Ensure table exists (new jobs.db)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS indexing_jobs (
        id TEXT PRIMARY KEY,
        source_id TEXT,
        status TEXT,
        progress INTEGER,
        started_at TEXT,
        completed_at TEXT,
        job_title TEXT,
        job_description TEXT,
        operation_type TEXT,
        target_file TEXT,
        total_items INTEGER,
        processed_items INTEGER,
        job_type TEXT,
        file_path TEXT,
        file_name TEXT,
        file_size INTEGER,
        retry_count INTEGER DEFAULT 0,
        last_error TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        priority INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_indexing_jobs_status ON indexing_jobs(status);
      CREATE INDEX IF NOT EXISTS idx_indexing_jobs_job_type ON indexing_jobs(job_type);
      CREATE INDEX IF NOT EXISTS idx_indexing_jobs_created_at ON indexing_jobs(created_at);
    `);

    this.initialized = true;
  }

  async createJob(job: {
    sourceId: string;
    config?: Record<string, any>;
    title?: string;
    description?: string;
    operationType?: string;
    targetFile?: string;
    totalItems?: number;
    processedItems?: number;
  }): Promise<string> {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO indexing_jobs(
        id, source_id, status, progress, started_at,
        job_title, job_description, operation_type, target_file,
        total_items, processed_items
      ) VALUES(?,?,?,?,NULL,?,?,?,?,?,?)
    `).run(
      id, job.sourceId, 'pending', 0,
      job.title || 'Processing',
      job.description || 'Processing media files',
      job.operationType || 'media_scan',
      job.targetFile || null,
      job.totalItems || null,
      job.processedItems || 0
    );
    return id;
  }

  async updateJobStatus(jobId: string, status: IndexingJob['status'], progress?: number): Promise<void> {
    const sets: string[] = ['status=?']; const vals: any[] = [status];
    if (typeof progress === 'number') { sets.push('progress=?'); vals.push(progress); }
    if (status === 'running') { sets.push('started_at=?'); vals.push(new Date().toISOString()); }
    if (status === 'completed' || status === 'failed' || status === 'cancelled') { sets.push('completed_at=?'); vals.push(new Date().toISOString()); }
    vals.push(jobId);
    this.db.prepare(`UPDATE indexing_jobs SET ${sets.join(', ')} WHERE id=?`).run(...vals);
  }

  async updateJobStatusWithError(jobId: string, status: string, progress: number, error?: string): Promise<void> {
    const sets: string[] = ['status=?', 'progress=?'];
    const vals: any[] = [status, progress];
    if (error) { sets.push('last_error=?'); vals.push(error); }
    if (status === 'running') { sets.push('started_at=?'); vals.push(new Date().toISOString()); }
    if (status === 'completed' || status === 'failed' || status === 'cancelled') { sets.push('completed_at=?'); vals.push(new Date().toISOString()); }
    vals.push(jobId);
    this.db.prepare(`UPDATE indexing_jobs SET ${sets.join(', ')} WHERE id=?`).run(...vals);
  }

  async getActiveJobs(): Promise<IndexingJob[]> {
    const rows = this.db.prepare(`
      SELECT * FROM indexing_jobs
      WHERE status IN ('running')
      AND (job_type IS NULL OR job_type = 'scan' OR job_type = 'media_scan')
      ORDER BY datetime(started_at) DESC
    `).all() as any[];

    const imageJobStats = this.db.prepare(`
      SELECT 
        source_id,
        COUNT(*) as total,
        SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) as pending,
        MIN(created_at) as started_at
      FROM indexing_jobs
      WHERE job_type = 'image_processing'
      GROUP BY source_id
      HAVING pending > 0 OR (completed + failed < total)
    `).all() as any[];

    const regularJobs = rows.map(r => ({
      id: r.id,
      sourceId: r.source_id,
      status: r.status,
      progress: r.progress,
      totalItems: r.total_items || undefined,
      processedItems: r.processed_items || undefined,
      startedAt: r.started_at ? new Date(r.started_at) : undefined,
      completedAt: r.completed_at ? new Date(r.completed_at) : undefined,
      title: r.job_title || 'Processing',
      description: r.job_description || 'Processing media files',
      operationType: r.operation_type || 'media_scan',
      targetFile: r.target_file || undefined,
    })) as IndexingJob[];

    const imageJobs = imageJobStats.map((stats: any) => ({
      id: `image_processing_${stats.source_id}`,
      sourceId: stats.source_id,
      status: 'running' as const,
      progress: Math.floor(((stats.completed || 0) / (stats.total || 1)) * 100),
      totalItems: stats.total,
      processedItems: stats.completed || 0,
      startedAt: stats.started_at ? new Date(stats.started_at) : undefined,
      completedAt: undefined,
      title: 'Processing Images',
      description: `${stats.completed || 0}/${stats.total} images indexed (${stats.failed || 0} failed)`,
      operationType: 'image_processing',
      targetFile: undefined,
    })) as IndexingJob[];

    return [...regularJobs, ...imageJobs];
  }

  async getJobs(sourceId?: string): Promise<IndexingJob[]> {
    const rows = sourceId
      ? (this.db.prepare(`SELECT * FROM indexing_jobs WHERE source_id=?`).all(sourceId) as any[])
      : (this.db.prepare(`SELECT * FROM indexing_jobs`).all() as any[]);
    return rows.map(r => ({
      id: r.id,
      sourceId: r.source_id,
      status: r.status,
      progress: r.progress,
      totalItems: r.total_items || undefined,
      processedItems: r.processed_items || undefined,
      startedAt: r.started_at ? new Date(r.started_at) : undefined,
      completedAt: r.completed_at ? new Date(r.completed_at) : undefined,
      title: r.job_title || 'Processing',
      description: r.job_description || 'Processing media files',
      operationType: r.operation_type || 'media_scan',
      targetFile: r.target_file || undefined,
    })) as IndexingJob[];
  }

  async getStalledJobs(): Promise<IndexingJob[]> {
    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
    const twentyMinutesAgo = new Date(now.getTime() - 20 * 60 * 1000).toISOString();
    const rows = this.db.prepare(`
      SELECT * FROM indexing_jobs 
      WHERE 
        (status = 'pending' AND created_at < ?) OR
        (status = 'running' AND started_at IS NOT NULL AND started_at < ?)
      ORDER BY created_at DESC
    `).all(fiveMinutesAgo, twentyMinutesAgo) as any[];
    return rows.map(r => ({
      id: r.id,
      sourceId: r.source_id,
      status: r.status,
      progress: r.progress,
      totalItems: r.total_items || undefined,
      processedItems: r.processed_items || undefined,
      startedAt: r.started_at ? new Date(r.started_at) : undefined,
      completedAt: r.completed_at ? new Date(r.completed_at) : undefined,
      title: r.job_title || 'Processing',
      description: r.job_description || 'Processing media files',
      operationType: r.operation_type || 'media_scan',
      targetFile: r.target_file || undefined,
    })) as IndexingJob[];
  }

  async resetStalledJobs(): Promise<{ resetCount: number; jobIds: string[] }> {
    const stalledJobs = await this.getStalledJobs();
    const jobIds: string[] = [];
    for (const job of stalledJobs) {
      await this.updateJobStatus(job.id, 'pending', 0);
      jobIds.push(job.id);
    }
    return { resetCount: stalledJobs.length, jobIds };
  }

  async removeJob(jobId: string): Promise<void> {
    this.db.prepare(`DELETE FROM indexing_jobs WHERE id=?`).run(jobId);
  }

  async createImageProcessingJob(job: {
    id: string;
    sourceId: string;
    filePath: string;
    fileName: string;
    fileSize: number;
    status: string;
    jobType: string;
    retryCount?: number;
  }): Promise<void> {
    this.db.prepare(`
      INSERT INTO indexing_jobs(
        id, source_id, status, job_type, file_path, file_name, file_size, retry_count, created_at
      ) VALUES(?,?,?,?,?,?,?,?,?)
    `).run(
      job.id,
      job.sourceId,
      job.status,
      job.jobType,
      job.filePath,
      job.fileName,
      job.fileSize,
      job.retryCount || 0,
      new Date().toISOString()
    );
  }
}
