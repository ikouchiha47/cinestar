-- Migration 014: Batch Processing Tables
-- Implements batch-concurrent processing workflow for immediate video searchability
-- sql: db:video-rag

-- Main batch processing table - stores 5-minute batch metadata
CREATE TABLE IF NOT EXISTS processing_batches (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL,
  batch_index INTEGER NOT NULL,
  batch_type TEXT DEFAULT 'audio' CHECK (batch_type IN ('audio', 'visual', 'keyframe')),
  start_time REAL NOT NULL,        -- Start time in seconds
  end_time REAL NOT NULL,          -- End time in seconds
  duration REAL NOT NULL,          -- Duration in seconds
  output_path TEXT,                -- Path to output file (audio/video)
  audio_path TEXT,                 -- Path to extracted audio segment
  transcription TEXT,              -- Full batch transcription text
  embedding BLOB,                  -- Batch-level embedding vector
  visual_captions TEXT,            -- JSON array of visual captions
  scene_context TEXT,              -- JSON scene reconstruction data
  status TEXT DEFAULT 'audio_only' CHECK (status IN ('audio_only', 'enhanced', 'complete')),
  transcription_confidence REAL,   -- Whisper confidence score
  visual_confidence REAL,          -- Average visual caption confidence
  scene_coherence REAL,            -- Scene reconstruction quality score
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (video_id) REFERENCES video_files (id) ON DELETE CASCADE
);

-- Individual transcription segments with precise timing (from Whisper word timestamps)
CREATE TABLE IF NOT EXISTS transcription_segments (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  segment_index INTEGER NOT NULL,
  start_time REAL NOT NULL,        -- Precise start time in seconds
  end_time REAL NOT NULL,          -- Precise end time in seconds
  text TEXT NOT NULL,              -- Segment text content
  confidence REAL,                 -- Whisper confidence for this segment
  speaker TEXT,                    -- Speaker identification
  language TEXT,                   -- Language code
  embedding BLOB,                  -- Individual segment embedding
  metadata TEXT,                   -- JSON metadata
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (batch_id) REFERENCES processing_batches (id) ON DELETE CASCADE
);

-- Keyframes extracted per batch (4 frames per 5-minute batch)
CREATE TABLE IF NOT EXISTS batch_keyframes (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  keyframe_index INTEGER NOT NULL, -- 0-3 for 4 keyframes per batch
  timestamp REAL NOT NULL,         -- Exact timestamp of keyframe
  image_path TEXT NOT NULL,        -- Path to keyframe image
  caption TEXT,                    -- Visual caption for keyframe
  caption_confidence REAL,         -- Caption confidence score
  description TEXT,                -- Additional description
  metadata TEXT,                   -- JSON metadata
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (batch_id) REFERENCES processing_batches (id) ON DELETE CASCADE
);

-- Indexes for efficient querying

-- Primary batch queries
CREATE INDEX IF NOT EXISTS idx_batches_video_time ON processing_batches(video_id, start_time);
CREATE INDEX IF NOT EXISTS idx_batches_status ON processing_batches(status);
CREATE INDEX IF NOT EXISTS idx_batches_video_status ON processing_batches(video_id, status);

-- Segment-level search queries
CREATE INDEX IF NOT EXISTS idx_segments_batch ON transcription_segments(batch_id);
CREATE INDEX IF NOT EXISTS idx_segments_time ON transcription_segments(start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_segments_text_search ON transcription_segments(text);

-- Keyframe queries
CREATE INDEX IF NOT EXISTS idx_keyframes_batch ON batch_keyframes(batch_id);
CREATE INDEX IF NOT EXISTS idx_keyframes_timestamp ON batch_keyframes(timestamp);

-- Composite indexes for common search patterns
CREATE INDEX IF NOT EXISTS idx_batches_search ON processing_batches(video_id, status, start_time) 
  WHERE embedding IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_segments_search ON transcription_segments(batch_id, start_time) 
  WHERE embedding IS NOT NULL;

-- Update trigger to maintain updated_at timestamp
CREATE TRIGGER IF NOT EXISTS update_batch_timestamp 
  AFTER UPDATE ON processing_batches
  FOR EACH ROW
  BEGIN
    UPDATE processing_batches SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
  END;
