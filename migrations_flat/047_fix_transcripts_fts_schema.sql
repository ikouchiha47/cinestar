-- sql: db:av_search
-- Migration 047: Fix transcripts FTS schema issues
-- Include segment_id column for proper linking

DROP TABLE IF EXISTS transcripts_fts;

-- Recreate with segment_id column (UNINDEXED for linking, not searching)
CREATE VIRTUAL TABLE transcripts_fts USING fts5(
  segment_id UNINDEXED,
  transcript,
  content=''
);
