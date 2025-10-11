-- Migration: Add indexes to FTS table for better performance
-- Created: 2025-01-11
-- Purpose: Optimize FTS search performance with proper indexing

-- FTS5 tables automatically create their own indexes, but we can optimize
-- the join performance by indexing the item_id column in media_fts

-- Note: FTS5 virtual tables have built-in indexes for full-text search
-- We're adding an index on the join column for better performance

-- Create index on media_items for FTS joins
CREATE INDEX IF NOT EXISTS idx_media_items_id_type 
ON media_items(id, type);

-- Create index on media_items for embedding status queries
CREATE INDEX IF NOT EXISTS idx_media_items_embedding_status 
ON media_items(embedding_status);

-- Create index on media_items for combined queries
CREATE INDEX IF NOT EXISTS idx_media_items_status_type 
ON media_items(embedding_status, type);

-- Note: FTS5 tables (media_fts) automatically maintain their own indexes
-- for full-text search. No additional indexing needed on the virtual table.

-- Verify indexes
SELECT 
  name, 
  tbl_name, 
  sql 
FROM sqlite_master 
WHERE type = 'index' 
  AND tbl_name = 'media_items'
  AND name LIKE 'idx_%';
