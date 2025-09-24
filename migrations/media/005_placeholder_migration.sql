-- Migration 005: Placeholder migration
-- This migration was moved to video database as it referenced video_segments table
-- Keeping this placeholder to maintain migration sequence numbering

-- No changes needed for media database in this migration
-- The FTS fixes are now in video/003_fix_fts_reconstructed_scene.sql

-- Update schema version
PRAGMA user_version = 5;
