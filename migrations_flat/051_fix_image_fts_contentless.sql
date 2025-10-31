-- Migration 051: Fix image_fts contentless table issue
-- The contentless FTS table prevents proper text indexing
-- Recreate as a normal FTS5 table
-- sql: db:image_search

-- Drop the broken contentless FTS table
DROP TABLE IF EXISTS image_fts;

-- Recreate as a normal FTS5 table (without content='')
CREATE VIRTUAL TABLE image_fts USING fts5(
  item_id UNINDEXED,
  text
);

-- Populate from existing captions in image_meta_cache
INSERT INTO image_fts(item_id, text)
SELECT item_id, caption 
FROM image_meta_cache 
WHERE caption IS NOT NULL AND caption != '';
