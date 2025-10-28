-- Migration 015: Add Job Metadata Fields for Batch Processing Notifications
-- Adds metadata and statusMessage fields to video_processing_jobs table
-- sql: db:video-rag

-- Add metadata field for storing batch processing information
-- Note: This will fail if column already exists, which is fine for idempotency
ALTER TABLE video_processing_jobs ADD COLUMN metadata TEXT;

-- Add statusMessage field for UI notifications  
ALTER TABLE video_processing_jobs ADD COLUMN status_message TEXT;
