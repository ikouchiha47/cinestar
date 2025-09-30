-- Migration 010: Fix FTS table configuration to resolve T.item_id error
-- The issue is that FTS5 content table mapping is incorrect

-- Drop the existing FTS table and recreate with correct configuration
DROP TABLE IF EXISTS media_fts;

-- Create FTS table without content table (external content management)
-- This avoids the column mapping issues between FTS columns and content table columns
CREATE VIRTUAL TABLE media_fts USING fts5(
  item_id UNINDEXED,
  name,
  caption
);

-- Recreate triggers with correct mapping
DROP TRIGGER IF EXISTS media_fts_insert;
DROP TRIGGER IF EXISTS media_fts_update;
DROP TRIGGER IF EXISTS media_fts_delete;

CREATE TRIGGER media_fts_insert AFTER INSERT ON media_items
BEGIN
  INSERT INTO media_fts(rowid, item_id, name, caption)
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

-- Repopulate FTS table with existing data
INSERT INTO media_fts(rowid, item_id, name, caption)
SELECT rowid, id, name, COALESCE(caption, '') FROM media_items;
