-- Trigger modality backfill by clearing caches
-- This will force the backfill to run on next app start

.print ''
.print '🔄 Clearing search caches to trigger backfill...'
.print ''

-- Clear image_search.db cache
.open data/image_search.db
.print '1️⃣  Clearing image_meta_cache...'
DELETE FROM image_meta_cache;
SELECT '  Deleted ' || changes() || ' rows';
.print ''

-- Clear av_search.db cache  
.open data/av_search.db
.print '2️⃣  Clearing av_meta_cache...'
DELETE FROM av_meta_cache;
SELECT '  Deleted ' || changes() || ' rows';
.print ''

.print '✅ Caches cleared!'
.print '   Restart the app to trigger backfill'
.print ''
