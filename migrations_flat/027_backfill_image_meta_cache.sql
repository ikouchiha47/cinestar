-- sql: db:image_search
-- sql: attach:media
PRAGMA foreign_keys=ON;

-- Idempotent backfill of image_meta_cache from canonical media.db
INSERT OR REPLACE INTO image_meta_cache (item_id, path, width, height, size, checksum, tags_json, created_at, updated_at)
SELECT id, path, width, height, size, checksum, '[]', created_at, modified_at
FROM media.media_items
WHERE type = 'image';
