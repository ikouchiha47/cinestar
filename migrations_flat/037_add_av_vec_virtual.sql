-- sql: db:av_search
-- Create sqlite-vec virtual tables for AV segment embeddings in av_search.db
PRAGMA foreign_keys=ON;

-- Video segment embeddings (sqlite-vec virtual)
CREATE VIRTUAL TABLE IF NOT EXISTS video_segment_vec USING vec0(
  segment_id TEXT PRIMARY KEY,
  embedding FLOAT[1024]
);

-- Audio segment embeddings (sqlite-vec virtual)
CREATE VIRTUAL TABLE IF NOT EXISTS audio_segment_vec USING vec0(
  segment_id TEXT PRIMARY KEY,
  embedding FLOAT[1024]
);
