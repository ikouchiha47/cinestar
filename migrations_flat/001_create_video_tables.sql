-- Migration 001: Create video database tables and triggers
-- TARGET: Video Database (~/.driller/video-rag.db)
-- Video RAG Database Schema

-- Video files table
CREATE TABLE IF NOT EXISTS video_files (
  id TEXT PRIMARY KEY,
  file_path TEXT UNIQUE NOT NULL,
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  duration REAL NOT NULL,
  width INTEGER,
  height INTEGER,
  frame_rate REAL,
  bitrate INTEGER,
  codec TEXT,
  total_segments INTEGER DEFAULT 0,
  processing_status TEXT DEFAULT 'pending',
  processing_error TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Video segments table
CREATE TABLE IF NOT EXISTS video_segments (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL,
  video_path TEXT NOT NULL,
  start_time REAL NOT NULL,
  end_time REAL NOT NULL,
  duration REAL NOT NULL,
  scene_index INTEGER NOT NULL,
  thumbnail_path TEXT,
  keyframe_path TEXT,
  audio_path TEXT,
  transcription TEXT,
  caption TEXT,
  ocr_text TEXT,
  embedding BLOB,
  metadata TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (video_id) REFERENCES video_files (id) ON DELETE CASCADE
);

-- Video processing jobs table
CREATE TABLE IF NOT EXISTS video_processing_jobs (
  id TEXT PRIMARY KEY,
  video_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  progress INTEGER DEFAULT 0,
  error TEXT,
  start_time DATETIME,
  end_time DATETIME,
  segment_count INTEGER DEFAULT 0,
  total_segments INTEGER,
  current_stage TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Full-text search table for segments (without content dependency to avoid "unsafe use" errors)
CREATE VIRTUAL TABLE IF NOT EXISTS segments_fts USING fts5(
  segment_id,
  transcription,
  caption,
  ocr_text
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_segments_video_id ON video_segments(video_id);
CREATE INDEX IF NOT EXISTS idx_segments_time ON video_segments(start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_segments_scene ON video_segments(scene_index);
CREATE INDEX IF NOT EXISTS idx_files_path ON video_files(file_path);
CREATE INDEX IF NOT EXISTS idx_files_status ON video_files(processing_status);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON video_processing_jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_video_path ON video_processing_jobs(video_path);

-- Triggers to keep FTS in sync with video_segments
CREATE TRIGGER IF NOT EXISTS segments_fts_insert AFTER INSERT ON video_segments
BEGIN
  INSERT INTO segments_fts(segment_id, transcription, caption, ocr_text)
  VALUES (NEW.id, NEW.transcription, NEW.caption, NEW.ocr_text);
END;

CREATE TRIGGER IF NOT EXISTS segments_fts_update AFTER UPDATE ON video_segments
BEGIN
  UPDATE segments_fts SET
    transcription = NEW.transcription,
    caption = NEW.caption,
    ocr_text = NEW.ocr_text
  WHERE segment_id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS segments_fts_delete AFTER DELETE ON video_segments
BEGIN
  DELETE FROM segments_fts WHERE segment_id = OLD.id;
END;

-- Trigger to update video_files.updated_at on changes
CREATE TRIGGER IF NOT EXISTS video_files_update_timestamp AFTER UPDATE ON video_files
BEGIN
  UPDATE video_files SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

-- Trigger to update video_processing_jobs.updated_at on changes
CREATE TRIGGER IF NOT EXISTS jobs_update_timestamp AFTER UPDATE ON video_processing_jobs
BEGIN
  UPDATE video_processing_jobs SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

-- Refined keyframe artifacts table (captures delayed/background frames per segment)
CREATE TABLE IF NOT EXISTS video_keyframes (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL,
  segment_id TEXT NOT NULL,
  image_path TEXT NOT NULL,
  label TEXT NOT NULL, -- delayed | background | other labels
  caption TEXT,
  embedding BLOB,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (video_id) REFERENCES video_files (id) ON DELETE CASCADE,
  FOREIGN KEY (segment_id) REFERENCES video_segments (id) ON DELETE CASCADE
);

-- Indexes for video keyframes
CREATE INDEX IF NOT EXISTS idx_keyframes_video_id ON video_keyframes(video_id);
CREATE INDEX IF NOT EXISTS idx_keyframes_segment_id ON video_keyframes(segment_id);
CREATE INDEX IF NOT EXISTS idx_keyframes_label ON video_keyframes(label);
