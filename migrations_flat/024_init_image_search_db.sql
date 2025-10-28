-- sql: db:image_search
PRAGMA foreign_keys=ON;

-- image_search.db schema
CREATE TABLE IF NOT EXISTS image_embeddings (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  model TEXT NOT NULL,
  vector BLOB NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_img_emb_item ON image_embeddings(item_id);

-- Optional FTS for captions/ocr
CREATE VIRTUAL TABLE IF NOT EXISTS image_fts USING fts5(
  text,
  content=''
);

-- Denormalized cache for search result rendering
CREATE TABLE IF NOT EXISTS image_meta_cache (
  item_id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  size INTEGER,
  checksum TEXT,
  tags_json TEXT,
  created_at TEXT,
  updated_at TEXT
);
