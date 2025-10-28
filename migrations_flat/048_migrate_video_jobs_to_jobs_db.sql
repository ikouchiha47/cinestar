-- sql: db:jobs
-- Migration: Migrate video job tracking from video-rag.db to jobs.db
-- This creates the schema for unified job tracking across image and video processing

PRAGMA foreign_keys=ON;

-- ============================================================================
-- 1. Create video_job_metadata table
-- ============================================================================
-- Stores video-specific metadata that extends the base job_runs table
CREATE TABLE IF NOT EXISTS video_job_metadata (
  id TEXT PRIMARY KEY,
  job_run_id TEXT NOT NULL,
  video_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  refinement_pass INTEGER DEFAULT 1,
  threshold REAL DEFAULT 0.8,
  parent_job_id TEXT,
  trigger_condition TEXT DEFAULT 'immediate',
  current_phase TEXT CHECK(current_phase IN ('phase0', 'phase1', 'completed')),
  phase0_complete INTEGER DEFAULT 0,
  phase1_complete INTEGER DEFAULT 0,
  total_batches INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_video_job_metadata_job_run ON video_job_metadata(job_run_id);
CREATE INDEX IF NOT EXISTS idx_video_job_metadata_video_path ON video_job_metadata(video_path);
CREATE INDEX IF NOT EXISTS idx_video_job_metadata_phase ON video_job_metadata(current_phase);

-- ============================================================================
-- 2. Create processing_batches table
-- ============================================================================
-- Tracks batch processing state for video segments (5-minute chunks)
CREATE TABLE IF NOT EXISTS processing_batches (
  id TEXT PRIMARY KEY,
  job_run_id TEXT NOT NULL,
  video_id TEXT NOT NULL,
  batch_index INTEGER NOT NULL,
  batch_type TEXT DEFAULT 'audio',
  start_time REAL NOT NULL,
  end_time REAL NOT NULL,
  duration REAL NOT NULL,
  audio_path TEXT,
  transcription TEXT,
  embedding BLOB,
  visual_captions TEXT,
  scene_context TEXT,
  status TEXT CHECK(status IN ('pending', 'processing', 'completed', 'failed', 'audio_only', 'enhanced', 'complete')) DEFAULT 'pending',
  transcription_confidence REAL,
  visual_confidence REAL,
  scene_coherence REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_processing_batches_job_run ON processing_batches(job_run_id);
CREATE INDEX IF NOT EXISTS idx_processing_batches_video ON processing_batches(video_id);
CREATE INDEX IF NOT EXISTS idx_processing_batches_status ON processing_batches(status);
CREATE INDEX IF NOT EXISTS idx_processing_batches_batch_index ON processing_batches(video_id, batch_index);

-- ============================================================================
-- 3. Create batch_keyframes table
-- ============================================================================
-- Stores keyframe metadata for visual processing in Phase 1
CREATE TABLE IF NOT EXISTS batch_keyframes (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  keyframe_index INTEGER NOT NULL,
  timestamp REAL NOT NULL,
  image_path TEXT NOT NULL,
  caption TEXT,
  caption_confidence REAL,
  description TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_batch_keyframes_batch ON batch_keyframes(batch_id);
CREATE INDEX IF NOT EXISTS idx_batch_keyframes_timestamp ON batch_keyframes(timestamp);

-- ============================================================================
-- 4. Performance indexes
-- ============================================================================
-- Additional indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_video_job_metadata_status_lookup ON video_job_metadata(job_run_id, current_phase);
CREATE INDEX IF NOT EXISTS idx_processing_batches_completion ON processing_batches(job_run_id, status);

