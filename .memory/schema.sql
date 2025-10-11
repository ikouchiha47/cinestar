-- Media Items Schema
-- Source: src/core/sqlite-main-database.ts
-- Database: ~/.clipwise/main.db

CREATE TABLE IF NOT EXISTS media_items (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  size INTEGER,
  type TEXT,
  mime_type TEXT,
  created_at TEXT NOT NULL,
  modified_at TEXT NOT NULL,
  caption TEXT,
  embedding BLOB,
  metadata TEXT,
  FOREIGN KEY (source_id) REFERENCES media_sources(id)
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_media_items_source_id ON media_items(source_id);
CREATE INDEX IF NOT EXISTS idx_media_items_type ON media_items(type);
CREATE INDEX IF NOT EXISTS idx_media_items_mime_type ON media_items(mime_type);
CREATE INDEX IF NOT EXISTS idx_media_items_created_at ON media_items(datetime(created_at) DESC);
CREATE INDEX IF NOT EXISTS idx_media_items_modified_at ON media_items(datetime(modified_at) DESC);
CREATE INDEX IF NOT EXISTS idx_media_items_path ON media_items(path);

-- Media Sources Schema
CREATE TABLE IF NOT EXISTS media_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  enabled INTEGER DEFAULT 1,
  config TEXT,
  created_at TEXT NOT NULL,
  last_indexed TEXT
);

CREATE INDEX IF NOT EXISTS idx_media_sources_path ON media_sources(path);
CREATE INDEX IF NOT EXISTS idx_media_sources_created_at ON media_sources(datetime(created_at) DESC);

-- Indexing Jobs Schema
CREATE TABLE IF NOT EXISTS indexing_jobs (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  status TEXT NOT NULL,
  progress REAL DEFAULT 0,
  total_items INTEGER,
  processed_items INTEGER DEFAULT 0,
  started_at TEXT,
  completed_at TEXT,
  error TEXT,
  FOREIGN KEY (source_id) REFERENCES media_sources(id)
);

CREATE INDEX IF NOT EXISTS idx_indexing_jobs_source_id ON indexing_jobs(source_id);
CREATE INDEX IF NOT EXISTS idx_indexing_jobs_status ON indexing_jobs(status);
