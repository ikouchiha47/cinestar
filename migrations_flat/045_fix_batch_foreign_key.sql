-- Migration 045: Fix batch processing foreign key constraint
-- The processing_batches table was referencing 'videos' table instead of 'video_files'
-- sql: db:video-rag

-- COMMENTED OUT: This migration was already applied via 014_batch_processing.sql
-- The table already exists with correct schema, no need to recreate
-- Keeping this file for version tracking only

-- Drop the existing table (this will cascade delete all related data)
-- DROP TABLE IF EXISTS processing_batches;

-- Recreate with correct foreign key
-- CREATE TABLE IF NOT EXISTS processing_batches (
--   id TEXT PRIMARY KEY,
--   video_id TEXT NOT NULL,
--   batch_index INTEGER NOT NULL,
--   batch_type TEXT DEFAULT 'audio' CHECK (batch_type IN ('audio', 'visual', 'keyframe')),
--   start_time REAL NOT NULL,        -- Start time in seconds
--   end_time REAL NOT NULL,          -- End time in seconds
--   duration REAL NOT NULL,          -- Duration in seconds
--   output_path TEXT,                -- Path to output file (audio/video)
--   audio_path TEXT,                 -- Path to extracted audio segment
--   transcription TEXT,              -- Full batch transcription text
--   embedding BLOB,                  -- Batch-level embedding vector
--   visual_captions TEXT,            -- JSON array of visual captions
--   scene_context TEXT,              -- JSON scene reconstruction data
--   status TEXT DEFAULT 'audio_only' CHECK (status IN ('audio_only', 'enhanced', 'complete')),
--   transcription_confidence REAL,   -- Whisper confidence score
--   visual_confidence REAL,          -- Average visual caption confidence
--   scene_coherence REAL,            -- Scene reconstruction quality score
--   created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
--   updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
--   FOREIGN KEY (video_id) REFERENCES video_files (id) ON DELETE CASCADE
-- );

-- Recreate indexes
-- CREATE INDEX IF NOT EXISTS idx_batches_video_time ON processing_batches(video_id, start_time);
-- CREATE INDEX IF NOT EXISTS idx_batches_status ON processing_batches(status);
-- CREATE INDEX IF NOT EXISTS idx_batches_video_status ON processing_batches(video_id, status);
-- CREATE INDEX IF NOT EXISTS idx_batches_search ON processing_batches(video_id, status, start_time) 
--   WHERE embedding IS NOT NULL;

-- Recreate update trigger
-- CREATE TRIGGER IF NOT EXISTS update_batch_timestamp 
--   AFTER UPDATE ON processing_batches
--   FOR EACH ROW
--   BEGIN
--     UPDATE processing_batches SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
--   END;
