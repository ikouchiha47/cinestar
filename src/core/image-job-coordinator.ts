import { SqliteJobsDatabase } from './sqlite-jobs-database';

/**
 * GenStage-like coordinator for image job processing
 * Atomically assigns jobs to multiple worker processors
 * Prevents duplicate processing through centralized job distribution
 */
export class ImageJobCoordinator {
  private db: SqliteJobsDatabase;
  private static instance: ImageJobCoordinator | null = null;

  private constructor(db: SqliteJobsDatabase) {
    this.db = db;
  }

  /**
   * Get singleton instance of the coordinator
   */
  static getInstance(db: SqliteJobsDatabase): ImageJobCoordinator {
    if (!ImageJobCoordinator.instance) {
      ImageJobCoordinator.instance = new ImageJobCoordinator(db);
      console.log('[IMAGE-COORDINATOR] ✅ Coordinator instance created');
    }
    return ImageJobCoordinator.instance;
  }

  /**
   * PULL-BASED: Worker requests jobs when ready (natural backpressure)
   * Atomically marks them as 'running' before returning to prevent duplicate assignment
   * 
   * @param workerId - Unique identifier for the requesting worker
   * @param batchSize - Number of jobs to request
   * @returns Array of jobs assigned to this worker
   */
  async requestJobs(workerId: string, batchSize: number): Promise<any[]> {
    // CRITICAL: Atomic transaction = SELECT + UPDATE in one operation
    // Multiple workers can safely call this concurrently
    const transaction = this.db.db.transaction(() => {
      // 1. Select pending jobs
      const rows = this.db.db.prepare(`
        SELECT id, source_id, file_path, file_name, file_size, status, retry_count
        FROM indexing_jobs
        WHERE job_type = 'image_processing'
          AND status = 'pending'
          AND retry_count < 3
        ORDER BY priority DESC, created_at ASC
        LIMIT ?
      `).all(batchSize) as any[];
      
      // Map snake_case to camelCase for ImageJob interface
      const jobs = rows.map((row: any) => ({
        id: row.id,
        sourceId: row.source_id,
        filePath: row.file_path,
        fileName: row.file_name,
        fileSize: row.file_size,
        status: row.status,
        retryCount: row.retry_count
      }));
      
      // 2. Immediately mark as running (prevents other workers from taking them)
      if (jobs.length > 0) {
        const ids = jobs.map(j => j.id);
        const placeholders = ids.map(() => '?').join(',');
        
        this.db.db.prepare(`
          UPDATE indexing_jobs 
          SET status = 'running', started_at = ?
          WHERE id IN (${placeholders})
        `).run(new Date().toISOString(), ...ids);
        
        const fileNames = jobs.map(j => j.fileName).slice(0, 2).join(', ');
        console.log(`[COORDINATOR] ✅ ${workerId} pulled ${jobs.length} jobs: ${fileNames}${jobs.length > 2 ? '...' : ''}`);
      }
      
      return jobs;
    });
    
    return transaction();
  }

  /**
   * Report job completion back to coordinator
   */
  async reportJobComplete(workerId: string, jobId: string, success: boolean, error?: string): Promise<void> {
    if (success) {
      await this.db.updateJobStatus(jobId, 'completed', 100);
      console.log(`[IMAGE-COORDINATOR] ✅ Worker ${workerId} completed job ${jobId}`);
    } else {
      // Get current retry count to determine if we should retry
      const job = this.db.db.prepare(`
        SELECT retry_count FROM indexing_jobs WHERE id = ?
      `).get(jobId) as any;
      
      const maxRetries = 3;
      
      if (job && job.retry_count < maxRetries) {
        // Re-enqueue for retry - set status back to 'pending' and increment retry_count
        this.db.db.prepare(`
          UPDATE indexing_jobs 
          SET status = 'pending', 
              retry_count = retry_count + 1,
              last_error = ?
          WHERE id = ?
        `).run(error || 'Unknown error', jobId);
        
        console.log(`[IMAGE-COORDINATOR] 🔄 Worker ${workerId} job ${jobId} failed, re-enqueued for retry (attempt ${job.retry_count + 1}/${maxRetries}): ${error}`);
      } else {
        // Max retries exceeded or job not found - mark as permanently failed
        await this.db.updateJobStatusWithError(jobId, 'failed', 0, error);
        console.error(`[IMAGE-COORDINATOR] ❌ Worker ${workerId} job ${jobId} permanently failed after ${maxRetries} attempts: ${error}`);
      }
    }
  }

  /**
   * Get statistics about job distribution
   */
  async getStats(): Promise<{
    pending: number;
    running: number;
    completed: number;
    failed: number;
  }> {
    const stats = this.db.db.prepare(`
      SELECT 
        status,
        COUNT(*) as count
      FROM indexing_jobs
      WHERE job_type = 'image_processing'
      GROUP BY status
    `).all() as any[];
    
    const result = {
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0
    };
    
    stats.forEach(s => {
      if (s.status in result) {
        result[s.status as keyof typeof result] = s.count;
      }
    });
    
    return result;
  }
}
