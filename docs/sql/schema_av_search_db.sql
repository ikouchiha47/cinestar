-- av_search.db schema
PRAGMA foreign_keys=ON;

-- Video segment embeddings
CREATE TABLE IF NOT EXISTS video_segment_embeddings (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  segment_id TEXT NOT NULL,
  model TEXT NOT NULL,
  vector BLOB NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vid_emb_item_seg ON video_segment_embeddings(item_id, segment_id);

-- Audio segment embeddings
CREATE TABLE IF NOT EXISTS audio_segment_embeddings (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  segment_id TEXT NOT NULL,
  model TEXT NOT NULL,
  vector BLOB NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_aud_emb_item_seg ON audio_segment_embeddings(item_id, segment_id);

-- Transcripts FTS (contentless)
CREATE VIRTUAL TABLE IF NOT EXISTS transcripts_fts USING fts5(
  transcript,
  content=''
);

-- Denormalized cache for rendering
CREATE TABLE IF NOT EXISTS av_meta_cache (
  item_id TEXT NOT NULL,
  segment_id TEXT,
  media_type TEXT NOT NULL CHECK(media_type IN ('video','audio')),
  path TEXT NOT NULL,
  start_ms INTEGER,
  end_ms INTEGER,
  duration_ms INTEGER,
  title TEXT,
  tags_json TEXT,
  created_at TEXT,
  updated_at TEXT,
  PRIMARY KEY (item_id, segment_id, media_type)
);
CREATE INDEX IF NOT EXISTS idx_av_meta_path ON av_meta_cache(path);
