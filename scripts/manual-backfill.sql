-- Manual backfill script to copy data from vector.db to media.db
-- Run with: sqlite3 data/media.db < scripts/manual-backfill.sql

.print ''
.print '🔄 Starting manual backfill from vector.db to media.db...'
.print ''

PRAGMA foreign_keys=ON;

-- Attach vector.db
ATTACH DATABASE 'data/vector.db' AS vector;

.print '1️⃣  Checking source data...'
SELECT '  vector.db has ' || COUNT(*) || ' media items' FROM vector.media_items;
SELECT '  media.db has ' || COUNT(*) || ' media items' FROM media_items;
.print ''

.print '2️⃣  Backfilling media_items...'
INSERT OR IGNORE INTO media_items (
  id,
  source_id,
  type,
  path,
  checksum,
  size,
  mime,
  created_at,
  modified_at,
  duration_ms,
  width,
  height,
  fps,
  exif_json,
  status,
  deleted_at
)
SELECT 
  id,
  source_id,
  type,
  path,
  NULL AS checksum,
  size,
  mime_type AS mime,
  COALESCE(created_at, CURRENT_TIMESTAMP) AS created_at,
  modified_at,
  ROUND(COALESCE(duration, 0) * 1000.0) AS duration_ms,
  width,
  height,
  NULL AS fps,
  NULL AS exif_json,
  'indexed' AS status,
  NULL AS deleted_at
FROM vector.media_items;

SELECT '  ✅ Inserted ' || changes() || ' items';
.print ''

.print '3️⃣  Verifying backfill...'
SELECT '  media.db now has ' || COUNT(*) || ' media items' FROM media_items;
SELECT '  Images: ' || COUNT(*) FROM media_items WHERE type='image';
SELECT '  Videos: ' || COUNT(*) FROM media_items WHERE type='video';
.print ''

.print '4️⃣  Checking for duplicates...'
SELECT 
  '  Found ' || COUNT(*) || ' duplicate paths'
FROM (
  SELECT path, COUNT(*) as count 
  FROM media_items 
  GROUP BY path 
  HAVING count > 1
);
.print ''

DETACH DATABASE vector;

.print '✅ Manual backfill complete!'
.print ''
