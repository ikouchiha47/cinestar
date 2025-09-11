-- Migration 003: Setup vector extensions and embeddings tables
-- Vector Database Extensions and Tables

-- Load sqlite-vec extension (if available)
-- .load ./sqlite-vec

-- Vector embeddings table for media items
CREATE TABLE IF NOT EXISTS vec_embeddings (
  rowid INTEGER PRIMARY KEY,
  item_id TEXT NOT NULL,
  embedding BLOB NOT NULL,
  FOREIGN KEY (item_id) REFERENCES media_items (id) ON DELETE CASCADE
);

-- Vector metadata table
CREATE TABLE IF NOT EXISTS vector_meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Insert vector configuration
INSERT OR REPLACE INTO vector_meta (key, value) VALUES 
  ('embedding_model', 'bge-large-en-v1.5'),
  ('embedding_dimensions', '1024'),
  ('version', '1.0');

-- Indexes for vector operations
CREATE INDEX IF NOT EXISTS idx_vec_embeddings_item_id ON vec_embeddings(item_id);

-- Vector search helper views (for when sqlite-vec is available)
-- CREATE VIRTUAL TABLE IF NOT EXISTS vec_search USING vec0(
--   embedding float[1024]
-- );

-- Fallback text search for when vector search is not available
CREATE VIRTUAL TABLE IF NOT EXISTS media_fts USING fts5(
  item_id,
  name,
  caption,
  content='media_items',
  content_rowid='rowid'
);

-- Triggers to keep FTS in sync with media_items
-- Note: Using INSERT OR REPLACE to avoid FTS virtual table safety issues
CREATE TRIGGER IF NOT EXISTS media_fts_insert AFTER INSERT ON media_items
BEGIN
  INSERT OR REPLACE INTO media_fts(rowid, item_id, name, caption)
  VALUES (NEW.rowid, NEW.id, NEW.name, COALESCE(NEW.caption, ''));
END;

CREATE TRIGGER IF NOT EXISTS media_fts_update AFTER UPDATE ON media_items
BEGIN
  INSERT OR REPLACE INTO media_fts(rowid, item_id, name, caption)
  VALUES (NEW.rowid, NEW.id, NEW.name, COALESCE(NEW.caption, ''));
END;

CREATE TRIGGER IF NOT EXISTS media_fts_delete AFTER DELETE ON media_items
BEGIN
  DELETE FROM media_fts WHERE rowid = OLD.rowid;
  DELETE FROM vec_embeddings WHERE item_id = OLD.id;
END;
