-- Migration 002: Create media database tables and indexes
-- TARGET: Media Database (~/.clipwise/vector.db)
-- Main Media Database Schema

-- Media sources table
CREATE TABLE IF NOT EXISTS media_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  path TEXT NOT NULL,
  enabled BOOLEAN DEFAULT 1,
  config TEXT, -- JSON config
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_indexed DATETIME
);

-- Media items table
CREATE TABLE IF NOT EXISTS media_items (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  type TEXT NOT NULL,
  mime_type TEXT,
  size INTEGER,
  width INTEGER,
  height INTEGER,
  duration REAL,
  caption TEXT,
  caption_generated_at TEXT,
  caption_status TEXT NOT NULL DEFAULT 'pending',
  embedding BLOB,
  embedding_generated_at TEXT,
  embedding_status TEXT NOT NULL DEFAULT 'pending',
  metadata TEXT, -- JSON metadata
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  modified_at DATETIME,
  indexed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (source_id) REFERENCES media_sources (id) ON DELETE CASCADE
);

-- Indexing jobs table
CREATE TABLE IF NOT EXISTS indexing_jobs (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  progress INTEGER DEFAULT 0,
  total_items INTEGER DEFAULT 0,
  processed_items INTEGER DEFAULT 0,
  error TEXT,
  config TEXT, -- JSON config
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  started_at DATETIME,
  completed_at DATETIME,
  FOREIGN KEY (source_id) REFERENCES media_sources (id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_media_items_source_id ON media_items(source_id);
CREATE INDEX IF NOT EXISTS idx_media_items_type ON media_items(type);
CREATE INDEX IF NOT EXISTS idx_media_items_path ON media_items(path);
CREATE INDEX IF NOT EXISTS idx_media_items_indexed_at ON media_items(indexed_at);
CREATE INDEX IF NOT EXISTS idx_media_sources_type ON media_sources(type);
CREATE INDEX IF NOT EXISTS idx_media_sources_enabled ON media_sources(enabled);
CREATE INDEX IF NOT EXISTS idx_indexing_jobs_status ON indexing_jobs(status);
CREATE INDEX IF NOT EXISTS idx_indexing_jobs_source_id ON indexing_jobs(source_id);

-- Triggers to update timestamps
CREATE TRIGGER IF NOT EXISTS media_sources_update_timestamp AFTER UPDATE ON media_sources
BEGIN
  UPDATE media_sources SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS indexing_jobs_update_timestamp AFTER UPDATE ON indexing_jobs
BEGIN
  UPDATE indexing_jobs SET 
    started_at = CASE WHEN NEW.status = 'running' AND OLD.status != 'running' THEN CURRENT_TIMESTAMP ELSE OLD.started_at END,
    completed_at = CASE WHEN NEW.status IN ('completed', 'failed', 'cancelled') AND OLD.status NOT IN ('completed', 'failed', 'cancelled') THEN CURRENT_TIMESTAMP ELSE OLD.completed_at END
  WHERE id = NEW.id;
END;
