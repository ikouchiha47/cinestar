-- sql: db:config
-- sql: attach:media
PRAGMA foreign_keys=ON;

-- Map each source to specific partitions (catalog/image/av)
CREATE TABLE IF NOT EXISTS source_partition_map (
  source_id TEXT PRIMARY KEY,
  catalog_partition_id TEXT NOT NULL,
  image_partition_id TEXT NOT NULL,
  av_partition_id TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

-- Backfill defaults for all existing sources
INSERT OR IGNORE INTO source_partition_map (source_id, catalog_partition_id, image_partition_id, av_partition_id)
SELECT s.id, 'default_media', 'default_image', 'default_av'
FROM media.sources s;
