-- sql: db:av_search
-- Migration 052: Fix transcripts_fts contentless configuration
-- TARGET: AV Search Database (av_search.db)

-- Drop the broken contentless FTS table
DROP TABLE IF EXISTS transcripts_fts;

-- Recreate as a normal FTS5 table (without content='')
-- This allows direct INSERT and proper full-text search
CREATE VIRTUAL TABLE transcripts_fts USING fts5(
  segment_id UNINDEXED,
  transcript
);

-- Note: Existing transcriptions will need to be re-indexed
-- This will happen automatically when videos are reprocessed
