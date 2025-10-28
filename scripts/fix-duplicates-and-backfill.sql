-- Fix duplicate images in vector.db and backfill to media.db
-- Run this with: sqlite3 ./data/vector.db < scripts/fix-duplicates-and-backfill.sql

-- Step 1: Identify and remove duplicates (keep the oldest entry for each path)
-- This creates a temp table with IDs to delete
CREATE TEMP TABLE IF NOT EXISTS duplicates_to_delete AS
SELECT id
FROM media_items mi1
WHERE EXISTS (
  SELECT 1 
  FROM media_items mi2 
  WHERE mi1.path = mi2.path 
    AND mi1.source_id = mi2.source_id
    AND mi1.created_at > mi2.created_at
);

-- Show what will be deleted
SELECT 'Duplicates to delete:' as action, COUNT(*) as count FROM duplicates_to_delete;
SELECT path, COUNT(*) as duplicates 
FROM media_items 
WHERE id IN (SELECT id FROM duplicates_to_delete)
GROUP BY path;

-- Delete duplicates
DELETE FROM media_items WHERE id IN (SELECT id FROM duplicates_to_delete);

-- Also clean up orphaned embeddings
DELETE FROM vec_embeddings WHERE item_id IN (SELECT id FROM duplicates_to_delete);

-- Show final counts
SELECT 'After cleanup:' as status;
SELECT 'Total items:' as metric, COUNT(*) as count FROM media_items;
SELECT 'Unique paths:' as metric, COUNT(DISTINCT path) as count FROM media_items;
SELECT 'Images:' as metric, COUNT(*) as count FROM media_items WHERE type='image' OR mime_type LIKE 'image/%';

-- Step 2: Verify no more duplicates
SELECT 'Remaining duplicates:' as check, path, COUNT(*) as cnt 
FROM media_items 
GROUP BY path, source_id 
HAVING cnt > 1;
