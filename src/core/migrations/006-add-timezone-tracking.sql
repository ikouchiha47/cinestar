-- Migration 006: Add timezone tracking to video_processing_jobs
-- This helps track what timezone jobs were created in for debugging

-- Add timezone column to track the timezone when job was created
ALTER TABLE video_processing_jobs ADD COLUMN created_timezone TEXT DEFAULT 'UTC';

-- Add timezone column to track the timezone when job was scheduled
ALTER TABLE video_processing_jobs ADD COLUMN scheduled_timezone TEXT DEFAULT 'UTC';

-- Update existing jobs to have UTC timezone
UPDATE video_processing_jobs SET created_timezone = 'UTC', scheduled_timezone = 'UTC';

-- Add index for timezone-based queries
CREATE INDEX IF NOT EXISTS idx_jobs_timezone ON video_processing_jobs(created_timezone, scheduled_timezone);
