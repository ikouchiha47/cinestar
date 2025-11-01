import { SqliteJobsDatabase } from './sqlite-jobs-database';
import { VideoDatabase } from './video-database';
import { randomUUID } from 'crypto';

/**
 * VideoJobAdapter
 * 
 * Bridge between video job operations and SqliteJobsDatabase.
 * Provides a unified interface for video job tracking that works with jobs.db
 * while maintaining backward compatibility with video-rag.db.
 * 
 * This adapter is part of the migration strategy to move video job tracking
 * from video-rag.db to the unified jobs.db.
 */
export class VideoJobAdapter {
  private jobsDb: SqliteJobsDatabase;
  private videoDb: VideoDatabase; // Fallback for video-specific queries

  constructor(jobsDb: SqliteJobsDatabase, videoDb: VideoDatabase) {
    this.jobsDb = jobsDb;
    this.videoDb = videoDb;
  }

  /**
   * Create a new video processing job
   * Stores job in jobs.db with video-specific metadata
   */
  async createVideoJob(jobData: {
    videoPath: string;
    fileName: string;
    refinementPass?: number;
    threshold?: number;
    parentJobId?: string;
    triggerCondition?: string;
  }): Promise<string> {
    const jobId = randomUUID();

    // Create job in indexing_jobs table (jobs.db)
    await this.jobsDb.db.prepare(`
      INSERT INTO indexing_jobs (
        id, source_id, status, progress, job_type, file_path, file_name,
        created_at, job_title, job_description
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      jobId,
      jobData.videoPath,
      'pending',
      0,
      'video_processing',
      jobData.videoPath,
      jobData.fileName,
      new Date().toISOString(),
      'Processing Video',
      `Processing ${jobData.fileName}`
    );

    console.log(`[VIDEO-JOB-ADAPTER] ✅ Created video job ${jobId} in jobs.db`);
    return jobId;
  }

  /**
   * Update video job status and progress
   */
  async updateVideoJob(jobId: string, updates: {
    status?: string;
    progress?: number;
    currentPhase?: string;
    phase0Complete?: number;
    phase1Complete?: number;
    totalBatches?: number;
    statusMessage?: string;
    error?: string;
    retry_count?: number;
    last_error?: string;
    startedAt?: Date;
    completedAt?: Date;
  }): Promise<void> {
    const sets: string[] = [];
    const vals: any[] = [];

    if (updates.status !== undefined) {
      sets.push('status = ?');
      vals.push(updates.status);
    }

    if (updates.progress !== undefined) {
      sets.push('progress = ?');
      vals.push(updates.progress);
    }

    if (updates.statusMessage !== undefined) {
      sets.push('job_description = ?');
      vals.push(updates.statusMessage);
    }

    if (updates.error !== undefined) {
      sets.push('last_error = ?');
      vals.push(updates.error);
    }

    if (updates.retry_count !== undefined) {
      sets.push('retry_count = ?');
      vals.push(updates.retry_count);
    }

    if (updates.last_error !== undefined) {
      sets.push('last_error = ?');
      vals.push(updates.last_error);
    }

    // Handle explicit timestamp updates or auto-set based on status
    if (updates.startedAt !== undefined) {
      sets.push('started_at = ?');
      vals.push(updates.startedAt.toISOString());
    } else if (updates.status === 'running' || updates.status === 'processing') {
      sets.push('started_at = ?');
      vals.push(new Date().toISOString());
    }

    if (updates.completedAt !== undefined) {
      sets.push('completed_at = ?');
      vals.push(updates.completedAt.toISOString());
    } else if (updates.status === 'completed' || updates.status === 'failed' || updates.status === 'cancelled') {
      sets.push('completed_at = ?');
      vals.push(new Date().toISOString());
    }

    if (sets.length === 0) {
      console.warn(`[VIDEO-JOB-ADAPTER] No updates provided for job ${jobId}`);
      return;
    }

    vals.push(jobId);

    await this.jobsDb.db.prepare(`
      UPDATE indexing_jobs 
      SET ${sets.join(', ')} 
      WHERE id = ?
    `).run(...vals);

    console.log(`[VIDEO-JOB-ADAPTER] ✅ Updated job ${jobId}: ${JSON.stringify(updates)}`);
  }

  /**
   * Get video job by ID
   * Returns job data from jobs.db
   */
  async getVideoJob(jobId: string): Promise<any | null> {
    const row = await this.jobsDb.db.prepare(`
      SELECT * FROM indexing_jobs WHERE id = ?
    `).get(jobId) as any;

    if (!row) {
      console.warn(`[VIDEO-JOB-ADAPTER] Job ${jobId} not found in jobs.db`);
      return null;
    }

    return {
      id: row.id,
      videoPath: row.file_path,
      fileName: row.file_name,
      status: row.status,
      progress: row.progress,
      createdAt: row.created_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      error: row.last_error,
      statusMessage: row.job_description
    };
  }

  /**
   * Get pending video jobs (for worker pull pattern)
   * Returns jobs with status 'pending' or 'scheduled', limited by count
   */
  async getPendingJobs(limit: number = 1): Promise<any[]> {
    const rows = await this.jobsDb.db.prepare(`
      SELECT * FROM indexing_jobs 
      WHERE job_type = 'video_processing' 
        AND status IN ('pending', 'scheduled')
      ORDER BY created_at ASC
      LIMIT ?
    `).all(limit) as any[];

    return rows.map(row => ({
      id: row.id,
      videoPath: row.file_path,
      fileName: row.file_name,
      status: row.status,
      progress: row.progress,
      createdAt: row.created_at,
      startedAt: row.started_at,
      statusMessage: row.job_description
    }));
  }

  /**
   * Get all active video jobs
   * Returns jobs with status 'pending' or 'running'
   */
  async getActiveVideoJobs(): Promise<any[]> {
    const rows = await this.jobsDb.db.prepare(`
      SELECT * FROM indexing_jobs 
      WHERE job_type = 'video_processing' 
        AND status IN ('pending', 'running', 'processing')
      ORDER BY created_at DESC
    `).all() as any[];

    return rows.map(row => ({
      id: row.id,
      videoPath: row.file_path,
      fileName: row.file_name,
      status: row.status,
      progress: row.progress,
      createdAt: row.created_at,
      startedAt: row.started_at,
      statusMessage: row.job_description
    }));
  }

  /**
   * Delete a video job
   */
  async deleteVideoJob(jobId: string): Promise<void> {
    await this.jobsDb.db.prepare(`
      DELETE FROM indexing_jobs WHERE id = ?
    `).run(jobId);

    console.log(`[VIDEO-JOB-ADAPTER] ✅ Deleted job ${jobId}`);
  }

  /**
   * Get job count by status
   */
  async getJobCountByStatus(status: string): Promise<number> {
    const row = await this.jobsDb.db.prepare(`
      SELECT COUNT(*) as count FROM indexing_jobs 
      WHERE job_type = 'video_processing' AND status = ?
    `).get(status) as { count: number };

    return row?.count || 0;
  }

  /**
   * Get jobs by video path
   */
  async getJobsByVideoPath(videoPath: string): Promise<any[]> {
    const rows = await this.jobsDb.db.prepare(`
      SELECT * FROM indexing_jobs 
      WHERE job_type = 'video_processing' AND file_path = ?
      ORDER BY created_at DESC
    `).all(videoPath) as any[];

    return rows.map(row => ({
      id: row.id,
      videoPath: row.file_path,
      fileName: row.file_name,
      status: row.status,
      progress: row.progress,
      createdAt: row.created_at,
      startedAt: row.started_at,
      statusMessage: row.job_description
    }));
  }

  /**
   * Get all active video processing jobs
   */
  async getActiveJobs(): Promise<any[]> {
    const rows = await this.jobsDb.db.prepare(`
      SELECT * FROM indexing_jobs 
      WHERE job_type = 'video_processing' 
        AND status IN ('processing', 'running', 'scheduled')
      ORDER BY created_at DESC
    `).all() as any[];

    console.log(`[VIDEO-JOB-ADAPTER] 📊 Found ${rows.length} active video jobs in jobs.db`);

    // Map to VideoProcessingJob format
    return rows.map(row => ({
      id: row.id,
      videoPath: row.file_path,
      fileName: row.file_name,
      status: row.status,
      progress: row.progress,
      createdAt: row.created_at,
      startedAt: row.started_at,
      statusMessage: row.job_description
    }));
  }

  /**
   * Check if jobs.db is available and initialized
   */
  isAvailable(): boolean {
    try {
      // Try a simple query to check if the table exists
      this.jobsDb.db.prepare('SELECT 1 FROM indexing_jobs LIMIT 1').get();
      return true;
    } catch (error) {
      console.warn('[VIDEO-JOB-ADAPTER] jobs.db not available:', error);
      return false;
    }
  }
}
