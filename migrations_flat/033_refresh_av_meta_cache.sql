-- sql: db:av_search
-- sql: attach:media
PRAGMA foreign_keys=ON;

-- Refresh av_meta_cache from media (idempotent)
-- Item-level rows
INSERT INTO av_meta_cache(item_id, segment_id, media_type, path, start_ms, end_ms, duration_ms, title, tags_json, created_at, updated_at)
SELECT id, NULL, type, path, NULL, NULL, duration_ms, NULL, '[]', created_at, modified_at
FROM media.media_items
WHERE type IN ('video','audio')
ON CONFLICT(item_id, segment_id, media_type) DO UPDATE SET
  path=excluded.path,
  duration_ms=excluded.duration_ms,
  title=excluded.title,
  created_at=excluded.created_at,
  updated_at=excluded.updated_at;

-- Segment-level rows
INSERT INTO av_meta_cache(item_id, segment_id, media_type, path, start_ms, end_ms, duration_ms, title, tags_json, created_at, updated_at)
SELECT s.item_id, s.id AS segment_id, 'video' AS media_type, i.path, s.start_ms, s.end_ms, (s.end_ms - s.start_ms) AS duration_ms, NULL, '[]', i.created_at, i.modified_at
FROM media.segments s
JOIN media.media_items i ON i.id = s.item_id
ON CONFLICT(item_id, segment_id, media_type) DO UPDATE SET
  path=excluded.path,
  start_ms=excluded.start_ms,
  end_ms=excluded.end_ms,
  duration_ms=excluded.duration_ms,
  title=excluded.title,
  created_at=excluded.created_at,
  updated_at=excluded.updated_at;
