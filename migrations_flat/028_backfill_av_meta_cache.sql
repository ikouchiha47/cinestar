-- sql: db:av_search
-- sql: attach:media
PRAGMA foreign_keys=ON;

-- Idempotent backfill of av_meta_cache (items + segments) from canonical media.db
-- Item-level rows for video/audio items
INSERT OR REPLACE INTO av_meta_cache(item_id, segment_id, media_type, path, start_ms, end_ms, duration_ms, title, tags_json, created_at, updated_at)
SELECT id, NULL, type, path, NULL, NULL, duration_ms, NULL, '[]', created_at, modified_at
FROM media.media_items
WHERE type IN ('video','audio');

-- Segment-level rows joined from media.segments
INSERT OR REPLACE INTO av_meta_cache(item_id, segment_id, media_type, path, start_ms, end_ms, duration_ms, title, tags_json, created_at, updated_at)
SELECT s.item_id, s.id AS segment_id, s.kind, i.path, s.start_ms, s.end_ms,
       (s.end_ms - s.start_ms) AS duration_ms, NULL, '[]', i.created_at, i.modified_at
FROM media.segments s
JOIN media.media_items i ON i.id = s.item_id;
