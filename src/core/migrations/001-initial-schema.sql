-- Migration 001: Initial Database Schema
-- Create the core tables for video processing and storage

-- Video files table
CREATE TABLE IF NOT EXISTS video_files (
  id TEXT PRIMARY KEY,
  file_path TEXT UNIQUE NOT NULL,
  file_name TEXT NOT NULL,
  file_size INTEGER,
  duration REAL,
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
  progress REAL DEFAULT 0.0,
  error TEXT,
  start_time DATETIME,
  end_time DATETIME,
  segment_count INTEGER DEFAULT 0,
  total_segments INTEGER,
  current_stage TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_video_files_path ON video_files(file_path);
CREATE INDEX IF NOT EXISTS idx_video_files_status ON video_files(processing_status);
CREATE INDEX IF NOT EXISTS idx_segments_video_id ON video_segments(video_id);
CREATE INDEX IF NOT EXISTS idx_segments_time ON video_segments(start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_segments_scene ON video_segments(scene_index);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON video_processing_jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_video_path ON video_processing_jobs(video_path);

-- Full-text search table for segments
CREATE VIRTUAL TABLE IF NOT EXISTS segments_fts USING fts5(
  segment_id UNINDEXED,
  transcription,
  caption,
  ocr_text,
  content='',
  contentless_delete=1
);

-- Triggers to keep FTS table in sync
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
