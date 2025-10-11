-- Migration 019: Image Job Processing
-- Add columns to indexing_jobs table for individual image processing jobs
-- sql: db:vector

-- Add new columns for image processing jobs
ALTER TABLE indexing_jobs ADD COLUMN job_type TEXT DEFAULT 'scan';
ALTER TABLE indexing_jobs ADD COLUMN file_path TEXT;
ALTER TABLE indexing_jobs ADD COLUMN file_name TEXT;
ALTER TABLE indexing_jobs ADD COLUMN file_size INTEGER;
ALTER TABLE indexing_jobs ADD COLUMN retry_count INTEGER DEFAULT 0;
ALTER TABLE indexing_jobs ADD COLUMN last_error TEXT;
ALTER TABLE indexing_jobs ADD COLUMN priority INTEGER DEFAULT 0;

-- Indexes for efficient batch pulls
CREATE INDEX IF NOT EXISTS idx_jobs_type_status 
ON indexing_jobs(job_type, status, priority DESC);

-- Index for retry queries
CREATE INDEX IF NOT EXISTS idx_jobs_retry 
ON indexing_jobs(job_type, status, retry_count);

-- Index for source-specific queries
CREATE INDEX IF NOT EXISTS idx_jobs_source_type 
ON indexing_jobs(source_id, job_type, status);
