-- Migration 008: Add job title, description and operation type to indexing_jobs
-- This allows the UI to show meaningful information about what each job is doing

-- Add new columns for better job tracking
ALTER TABLE indexing_jobs ADD COLUMN job_title TEXT;
ALTER TABLE indexing_jobs ADD COLUMN job_description TEXT;
ALTER TABLE indexing_jobs ADD COLUMN operation_type TEXT;
ALTER TABLE indexing_jobs ADD COLUMN target_file TEXT;

-- Update existing jobs with generic titles (for any existing data)
UPDATE indexing_jobs SET 
  job_title = 'Media Processing',
  job_description = 'Processing media files',
  operation_type = 'media_scan'
WHERE job_title IS NULL;
