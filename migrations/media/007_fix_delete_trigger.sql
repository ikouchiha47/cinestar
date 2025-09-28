-- Migration 007: Fix media_fts_delete trigger to remove vec_embeddings dependency
-- This fixes the issue where the main database trigger tries to access vec_embeddings
-- which requires sqlite-vec extension that may not be loaded in the main database context

-- Drop the old trigger that tries to access vec_embeddings
DROP TRIGGER IF EXISTS media_fts_delete;

-- Create new trigger that only handles FTS cleanup
-- vec_embeddings cleanup will be handled by SqliteVecDatabase class
CREATE TRIGGER media_fts_delete AFTER DELETE ON media_items
BEGIN
  DELETE FROM media_fts WHERE rowid = OLD.rowid;
END;
