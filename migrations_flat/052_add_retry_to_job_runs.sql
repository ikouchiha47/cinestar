-- sql: db:jobs
-- Migration: Add retry fields to job_runs table for automatic retry support
-- Date: 2025-11-01

-- Note: Columns were added via manual migration, this migration just creates indexes
-- For fresh installs, columns should be added to 026_init_jobs_db.sql

-- Create indexes for efficient retry queries
CREATE INDEX IF NOT EXISTS idx_job_runs_retry 
ON job_runs(status, retry_count) 
WHERE retry_count > 0;

CREATE INDEX IF NOT EXISTS idx_job_runs_pending_retry 
ON job_runs(status, retry_count, max_retries) 
WHERE status = 'pending' AND retry_count > 0;
