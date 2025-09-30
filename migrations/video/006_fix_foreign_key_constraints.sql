-- Migration 006: Fix foreign key constraint issues in video processing
-- The issue is that video segments are being inserted without corresponding video_files records

-- First, ensure all processing jobs have corresponding video_files records
INSERT OR IGNORE INTO video_files (id, file_path, file_name, duration, created_at, updated_at)
SELECT 
  'video_' || SUBSTR(id, 5) || '_auto',
  video_path,
  file_name,
  0,
  datetime('now'),
  datetime('now')
FROM video_processing_jobs 
WHERE video_path NOT IN (SELECT file_path FROM video_files);

-- Reset failed jobs to pending so they can be retried
UPDATE video_processing_jobs 
SET status = 'pending', error = NULL, updated_at = datetime('now')
WHERE status = 'failed' AND error = 'FOREIGN KEY constraint failed';
