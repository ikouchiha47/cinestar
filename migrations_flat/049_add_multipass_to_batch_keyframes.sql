-- sql: db:jobs
-- Migration 049: Add multi-pass captioning fields to batch_keyframes in jobs.db
-- This is the CORRECT location for video processing data going forward

-- Add new columns for multi-pass analysis
ALTER TABLE batch_keyframes ADD COLUMN caption_elements TEXT;
ALTER TABLE batch_keyframes ADD COLUMN caption_spatial TEXT;
ALTER TABLE batch_keyframes ADD COLUMN caption_temporal TEXT;
ALTER TABLE batch_keyframes ADD COLUMN caption_tokens TEXT;

-- Add index for querying by elements
CREATE INDEX IF NOT EXISTS idx_batch_keyframes_has_elements 
ON batch_keyframes(caption_elements) 
WHERE caption_elements IS NOT NULL;
