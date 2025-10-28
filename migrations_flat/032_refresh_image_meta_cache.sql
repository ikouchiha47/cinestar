-- sql: db:image_search
-- sql: attach:media
PRAGMA foreign_keys=ON;

-- Refresh image_meta_cache from media.media_items (idempotent)
INSERT OR REPLACE INTO image_meta_cache (item_id, path, width, height, size, checksum, tags_json, created_at, updated_at)
SELECT id, path, width, height, size, checksum, '[]', created_at, modified_at
FROM media.media_items
WHERE type = 'image';
