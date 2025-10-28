-- Migration 042: DEPRECATED - DO NOT USE
-- This migration targeted video-rag.db which is now read-only in production
-- Multi-pass fields are now added to batch_keyframes in jobs.db via migration 049
-- sql: db:video-rag

-- DEPRECATED: Keeping for version tracking only
-- Add new columns for multi-pass analysis
-- ALTER TABLE video_keyframes ADD COLUMN caption_elements TEXT;
-- ALTER TABLE video_keyframes ADD COLUMN caption_spatial TEXT;
-- ALTER TABLE video_keyframes ADD COLUMN caption_temporal TEXT;
-- ALTER TABLE video_keyframes ADD COLUMN caption_tokens TEXT;

-- Add index for querying by elements
-- CREATE INDEX IF NOT EXISTS idx_keyframes_has_elements 
-- ON video_keyframes(caption_elements) 
-- WHERE caption_elements IS NOT NULL;
