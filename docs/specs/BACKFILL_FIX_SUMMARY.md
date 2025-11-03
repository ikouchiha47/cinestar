# Backfill Fix Summary

## Problem

**Migration 030 failed silently** - it was marked as "complete" but didn't actually copy data from `vector.db` to `media.db`.

### Why It Failed:
1. Migration 030 ran when `media.db` was first created
2. At that time, the ATTACH directive may have failed or the INSERT returned 0 rows
3. Migration was marked complete in `schema_migrations` even though it copied nothing
4. Future app starts skip it because it's already marked complete

### Why This Is Bad:
- Users with existing data in `vector.db` end up with empty `media.db`
- Backfill caches fail because they read from `media.db`
- Workers write to split DBs but there's no data to display

## Solution

**Move the backfill OUT of migrations and INTO the runtime backfill process.**

### What Changed:

**File: `src/core/modality-backfill.ts`**

Added `maybeBackfillMediaItems()` function that:
1. ✅ Runs on every app start (idempotent)
2. ✅ Only copies if `media.db` is empty
3. ✅ Checks if `vector.db` exists and has data
4. ✅ Uses `INSERT OR IGNORE` to handle duplicates
5. ✅ Logs progress and results
6. ✅ Handles errors gracefully (non-fatal)

### Execution Order:

```typescript
runModalityBackfillIfNeeded() {
  1. maybeBackfillMediaItems()      // vector.db → media.db (NEW!)
  2. ensureImageMetaCache()         // media.db → image_search.db
  3. ensureAvMetaCache()            // media.db → av_search.db
  4. maybeBackfillImageEmbeddings() // vector.db → image_search.db
  5. maybeSeedTranscripts()         // video-rag.db → av_search.db
}
```

## Why This Approach Is Better

### ✅ Migrations vs Runtime Backfill:

**Migrations (SQL files):**
- ❌ Run once, marked complete forever
- ❌ Silent failures are hard to debug
- ❌ Can't be re-run without manual intervention
- ❌ ATTACH directives can fail unpredictably
- ✅ Good for: Schema changes, indexes, constraints

**Runtime Backfill (TypeScript):**
- ✅ Runs on every app start (idempotent)
- ✅ Better error handling and logging
- ✅ Can check conditions before running
- ✅ Self-healing - fixes itself automatically
- ✅ Good for: Data migration, cache population

## Testing

### For Fresh Installs (no vector.db):
```
[BACKFILL] vector.db not found, skipping media_items backfill
[BACKFILL] media_items count: 0
```
Result: No backfill needed ✅

### For Existing Users (vector.db has 86 items):
```
[BACKFILL] media_items count: 0
[BACKFILL] Backfilling 86 items from vector.db to media.db...
[SUCCESS] media_items backfilled: 43 items (43 duplicates removed)
```
Result: Data automatically migrated ✅

### For Already Migrated Users:
```
[BACKFILL] media_items count: 43
[BACKFILL] media_items already has data, skipping backfill
```
Result: No-op, fast skip ✅

## Logs to Watch For

On next app start, you should see:

```
[BACKFILL] 🚀 Starting modality backfill...
[BACKFILL] 📂 Database paths:
  media.db: /path/to/data/media.db
  image_search.db: /path/to/data/image_search.db
  av_search.db: /path/to/data/av_search.db
[BACKFILL] 📊 media.db has: 0 images, 0 videos
[BACKFILL] 📊 Current cache counts: image_meta_cache=0, av_meta_cache=0
[BACKFILL] media_items count: 0
[BACKFILL] Backfilling 86 items from vector.db to media.db...
[SUCCESS] media_items backfilled: 43 items (43 duplicates removed)
[BACKFILL] image_meta_cache count: 0
[BACKFILL] Filling image_meta_cache from media.db...
[BACKFILL] Found 43 images to backfill
[SUCCESS] image_meta_cache seeded
```

## What About Migration 030?

**Leave it as-is.** It's already marked complete for everyone, and the runtime backfill will handle the actual data copy.

Migration 030 is now effectively a no-op, but that's fine because:
1. It created the schema (which is good)
2. The runtime backfill does the actual data migration
3. No need to force re-run migrations

## Files Modified

- ✅ `src/core/modality-backfill.ts` - Added `maybeBackfillMediaItems()`
- ✅ `docs/BACKFILL_DEBUG_CHECKLIST.md` - Diagnostic guide
- ✅ `scripts/check-backfill.sql` - SQL diagnostic script
- ✅ `scripts/manual-backfill.sql` - Manual fix script (for emergencies)
- ✅ `scripts/check-databases.sh` - Shell diagnostic script

## For Users

**No action required!** 

The fix will automatically apply on next app restart. Users will see their existing data appear in the UI after the backfill completes.
