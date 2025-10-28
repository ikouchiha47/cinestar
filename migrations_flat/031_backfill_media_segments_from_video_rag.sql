-- sql: db:media
-- sql: attach:vector
-- sql: attach:video_rag
PRAGMA foreign_keys=ON;

-- Backfill segments from legacy video_rag.video_segments -> media.segments (idempotent)
-- Map by path or via video_files.file_path when path differs
INSERT OR IGNORE INTO segments (
  id,
  item_id,
  kind,
  start_ms,
  end_ms,
  transcript,
  caption,
  created_at,
  updated_at
)
SELECT 
  vs.id,
  COALESCE(mi1.id, mi2.id) AS item_id,
  'video' AS kind,
  ROUND(vs.start_time * 1000.0) AS start_ms,
  ROUND(vs.end_time * 1000.0) AS end_ms,
  vs.transcription AS transcript,
  vs.caption AS caption,
  COALESCE(mi1.created_at, mi2.created_at, CURRENT_TIMESTAMP) AS created_at,
  COALESCE(mi1.updated_at, mi2.updated_at, mi1.modified_at, mi2.modified_at, CURRENT_TIMESTAMP) AS updated_at
FROM video_rag.video_segments vs
LEFT JOIN vector.media_items mi1 ON mi1.path = vs.video_path
LEFT JOIN video_rag.video_files vf ON vf.id = vs.video_id
LEFT JOIN vector.media_items mi2 ON mi2.path = vf.file_path
WHERE COALESCE(mi1.id, mi2.id) IS NOT NULL;

-- Update existing rows to match source
UPDATE segments SET
  item_id = (
    SELECT COALESCE(mi1.id, mi2.id)
    FROM video_rag.video_segments vs
    LEFT JOIN vector.media_items mi1 ON mi1.path = vs.video_path
    LEFT JOIN video_rag.video_files vf ON vf.id = vs.video_id
    LEFT JOIN vector.media_items mi2 ON mi2.path = vf.file_path
    WHERE vs.id = segments.id
  ),
  kind = 'video',
  start_ms = (
    SELECT ROUND(vs.start_time * 1000.0)
    FROM video_rag.video_segments vs WHERE vs.id = segments.id
  ),
  end_ms = (
    SELECT ROUND(vs.end_time * 1000.0)
    FROM video_rag.video_segments vs WHERE vs.id = segments.id
  ),
  transcript = (
    SELECT vs.transcription FROM video_rag.video_segments vs WHERE vs.id = segments.id
  ),
  caption = (
    SELECT vs.caption FROM video_rag.video_segments vs WHERE vs.id = segments.id
  ),
  created_at = COALESCE(created_at, CURRENT_TIMESTAMP),
  updated_at = CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM video_rag.video_segments vs WHERE vs.id = segments.id);
