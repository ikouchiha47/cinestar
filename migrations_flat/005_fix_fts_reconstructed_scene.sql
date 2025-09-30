-- Fix FTS table to include reconstructed_scene column
-- Handle case where reconstructed_scene column already exists

-- Drop existing FTS table and triggers to recreate with reconstructed_scene support
DROP TRIGGER IF EXISTS segments_fts_insert;
DROP TRIGGER IF EXISTS segments_fts_update;
DROP TRIGGER IF EXISTS segments_fts_delete;
DROP TABLE IF EXISTS segments_fts;

-- Recreate FTS table with reconstructed_scene column (without content dependency)
CREATE VIRTUAL TABLE segments_fts USING fts5(
  segment_id,
  transcription,
  caption,
  ocr_text,
  reconstructed_scene
);

-- Recreate triggers to include reconstructed_scene
CREATE TRIGGER segments_fts_insert AFTER INSERT ON video_segments
BEGIN
  INSERT INTO segments_fts(segment_id, transcription, caption, ocr_text, reconstructed_scene)
  VALUES (NEW.id, NEW.transcription, NEW.caption, NEW.ocr_text, NEW.reconstructed_scene);
END;

CREATE TRIGGER segments_fts_update AFTER UPDATE ON video_segments
BEGIN
  UPDATE segments_fts SET
    transcription = NEW.transcription,
    caption = NEW.caption,
    ocr_text = NEW.ocr_text,
    reconstructed_scene = NEW.reconstructed_scene
  WHERE segment_id = NEW.id;
END;

CREATE TRIGGER segments_fts_delete AFTER DELETE ON video_segments
BEGIN
  DELETE FROM segments_fts WHERE segment_id = OLD.id;
END;

-- Rebuild FTS index from existing data
INSERT INTO segments_fts(segment_id, transcription, caption, ocr_text, reconstructed_scene)
SELECT id, transcription, caption, ocr_text, reconstructed_scene FROM video_segments;
