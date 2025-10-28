-- sql: db:media
-- Migration: Allow 'video_segment' type in media_items
-- Reason: Video segments need to be distinguished from parent videos in the UI

-- SQLite doesn't support ALTER CONSTRAINT, so we need to recreate the table

-- Step 1: Create new table with updated CHECK constraint
CREATE TABLE media_items_new (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('image','video','audio','video_segment')),
  path TEXT NOT NULL UNIQUE,
  checksum TEXT,
  size INTEGER,
  mime TEXT,
  created_at TEXT NOT NULL,
  modified_at TEXT,
  duration_ms INTEGER,
  width INTEGER,
  height INTEGER,
  fps REAL,
  exif_json TEXT,
  status TEXT DEFAULT 'indexed',
  deleted_at TEXT
);

-- Step 2: Copy all data from old table (all 16 columns)
INSERT INTO media_items_new 
SELECT id, source_id, type, path, checksum, size, mime, created_at, modified_at, 
       duration_ms, width, height, fps, exif_json, status, deleted_at
FROM media_items;

-- Step 3: Drop old table
DROP TABLE media_items;

-- Step 4: Rename new table
ALTER TABLE media_items_new RENAME TO media_items;

-- Step 5: Recreate indexes (if they exist)
CREATE INDEX IF NOT EXISTS idx_media_items_source_id ON media_items(source_id);
CREATE INDEX IF NOT EXISTS idx_media_items_type ON media_items(type);
CREATE INDEX IF NOT EXISTS idx_media_items_path ON media_items(path);
CREATE INDEX IF NOT EXISTS idx_media_items_created_at ON media_items(created_at);
