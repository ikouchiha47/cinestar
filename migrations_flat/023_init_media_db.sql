-- sql: db:media
PRAGMA foreign_keys=ON;

-- media.db schema
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL, -- local, external_drive, network, etc.
  root_path TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS media_items (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('image','video','audio')),
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
CREATE INDEX IF NOT EXISTS idx_media_items_source_type ON media_items(source_id, type);
CREATE INDEX IF NOT EXISTS idx_media_items_path ON media_items(path);

CREATE TABLE IF NOT EXISTS segments (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('video','audio')),
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  transcript TEXT,
  caption TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_segments_item ON segments(item_id);
CREATE INDEX IF NOT EXISTS idx_segments_range ON segments(item_id, start_ms, end_ms);

CREATE TABLE IF NOT EXISTS thumbnails (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  segment_id TEXT REFERENCES segments(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_thumbnails_item ON thumbnails(item_id);
CREATE INDEX IF NOT EXISTS idx_thumbnails_segment ON thumbnails(segment_id);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS item_tags (
  item_id TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, tag_id)
);
