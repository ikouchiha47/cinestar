-- sql: db:image_search
-- Migration 046: Fix image FTS schema issues
-- Include item_id column for proper lookups

-- Drop old FTS table
DROP TABLE IF EXISTS image_fts;

-- Recreate with item_id column
CREATE VIRTUAL TABLE image_fts USING fts5(
  item_id UNINDEXED,
  text,
  content=''
);
