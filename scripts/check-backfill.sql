-- Diagnostic script to check backfill status
-- Run with: sqlite3 data/media.db < scripts/check-backfill.sql

.mode column
.headers on

-- Attach vector.db to check source data
ATTACH DATABASE 'data/vector.db' AS vector;

.print ''
.print '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
.print '📊 Backfill Status Report'
.print '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
.print ''

.print '1️⃣  Source Data (vector.db):'
.print '─────────────────────────────'
SELECT 
  type,
  COUNT(*) as count
FROM vector.media_items 
GROUP BY type;

.print ''
.print '2️⃣  Target Data (media.db):'
.print '─────────────────────────────'
SELECT 
  type,
  COUNT(*) as count
FROM media_items 
GROUP BY type;

.print ''
.print '3️⃣  Migration Status:'
.print '─────────────────────────────'
SELECT 
  version,
  filename,
  applied_at
FROM schema_migrations 
WHERE filename LIKE '%backfill%'
ORDER BY version;

.print ''
.print '4️⃣  Missing Items (in vector.db but not in media.db):'
.print '─────────────────────────────'
SELECT 
  v.type,
  COUNT(*) as missing_count
FROM vector.media_items v
LEFT JOIN media_items m ON v.id = m.id
WHERE m.id IS NULL
GROUP BY v.type;

.print ''
.print '5️⃣  Sample Items from vector.db:'
.print '─────────────────────────────'
SELECT 
  id,
  type,
  substr(path, -50) as path_end,
  size,
  created_at
FROM vector.media_items
LIMIT 5;

.print ''
.print '6️⃣  Sources Check:'
.print '─────────────────────────────'
.print 'vector.db sources:'
SELECT COUNT(*) as vector_sources FROM vector.media_sources;
.print ''
.print 'media.db sources:'
SELECT COUNT(*) as media_sources FROM sources;

DETACH DATABASE vector;

.print ''
.print '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
.print '✅ Diagnostic Complete'
.print '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
.print ''
