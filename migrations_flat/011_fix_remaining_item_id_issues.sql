-- Migration 009: Fix any remaining T.item_id issues in triggers and queries
-- This migration ensures all references to item_id use the correct column names

-- First, let's check if there are any problematic triggers
-- Drop and recreate any triggers that might have T.item_id issues

-- Ensure media_fts triggers are correct (they should reference NEW.id, not NEW.item_id)
DROP TRIGGER IF EXISTS media_fts_insert;
DROP TRIGGER IF EXISTS media_fts_update;
DROP TRIGGER IF EXISTS media_fts_delete;

-- Recreate FTS triggers with correct column references
CREATE TRIGGER media_fts_insert AFTER INSERT ON media_items
BEGIN
  INSERT OR REPLACE INTO media_fts(rowid, item_id, name, caption)
  VALUES (NEW.rowid, NEW.id, NEW.name, COALESCE(NEW.caption, ''));
END;

CREATE TRIGGER media_fts_update AFTER UPDATE ON media_items
BEGIN
  INSERT OR REPLACE INTO media_fts(rowid, item_id, name, caption)
  VALUES (NEW.rowid, NEW.id, NEW.name, COALESCE(NEW.caption, ''));
END;

CREATE TRIGGER media_fts_delete AFTER DELETE ON media_items
BEGIN
  DELETE FROM media_fts WHERE rowid = OLD.rowid;
END;

-- Note: The media_fts table has item_id column (correct)
-- The media_items table has id column (correct)
-- The triggers map media_items.id -> media_fts.item_id (correct)
-- The vec_embeddings table has item_id column that references media_items.id (correct)
