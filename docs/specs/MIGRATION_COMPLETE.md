# ✅ Multi-Pass Captioning - Database Migration Complete

## What Changed

The multi-pass captioning implementation has been updated to use the **new modality-split database architecture** instead of the old `video-rag.db`.

## New Database Structure

### Before (Old)
- ❌ `video-rag.db` → `video_keyframes` table (deprecated for search metadata)

### After (New)
- ✅ `av_search.db` → `av_meta_cache` table (video/audio search metadata)
- ✅ `image_search.db` → `image_meta_cache` table (image search metadata)

## Files Updated

### New Migrations
1. **`migrations_flat/043_add_multipass_to_av_meta_cache.sql`**
   - Adds multi-pass fields to `av_search.db`
   - Target: `av_meta_cache` table

2. **`migrations_flat/044_add_multipass_to_image_meta_cache.sql`**
   - Adds multi-pass fields to `image_search.db`
   - Target: `image_meta_cache` table

### Updated Code
3. **`src/core/av-search-writer.ts`**
   - Added `updateMultiPassCaption()` method
   - Extended `updateAVMetaCache()` to support multi-pass fields

4. **`src/core/image-search-writer.ts`**
   - Added `updateMultiPassCaption()` method
   - Extended `updateMetaCache()` to support multi-pass fields

5. **`src/core/image-job-processor.ts`**
   - Updated to store multi-pass data in `image_search.db`

6. **`src/core/video-job-processor-v2.ts`**
   - Updated to store multi-pass data in `av_search.db`
   - Modified `storeMultiPassData()` to use AVSearchWriter

### Removed
- ❌ `migrations_flat/042_add_multipass_caption_fields.sql` (old migration for video-rag.db)

## Schema Changes

Both `av_meta_cache` and `image_meta_cache` now have:

```sql
ALTER TABLE [table_name] ADD COLUMN caption TEXT;
ALTER TABLE [table_name] ADD COLUMN caption_elements TEXT;
ALTER TABLE [table_name] ADD COLUMN caption_spatial TEXT;
ALTER TABLE [table_name] ADD COLUMN caption_temporal TEXT;
ALTER TABLE [table_name] ADD COLUMN caption_tokens TEXT;
```

## Why This Change?

Per **ADR-009: Modality Search DB Split**, the application uses:
- `media.db` - Canonical catalog (sources, items, segments)
- `image_search.db` - Image search store (embeddings, FTS, meta cache)
- `av_search.db` - Audio/Video search store (embeddings, transcripts, meta cache)
- `jobs.db` - Job orchestration
- `config.db` - Registry and migrations

Multi-pass caption data is **search metadata**, so it belongs in the modality-specific search databases (`av_search.db` and `image_search.db`), not in the old `video-rag.db`.

## Benefits

1. **Correct Architecture**: Follows the modality-split design
2. **Better Performance**: Search queries hit single database
3. **Cleaner Separation**: Processing metadata vs search metadata
4. **Future-Proof**: Aligns with partitioning/sharding strategy

## Migration Path

The migrations will run automatically on next app start via `UnifiedMigrator`.

To run manually:
```bash
# Video/Audio
sqlite3 data/av_search.db < migrations_flat/043_add_multipass_to_av_meta_cache.sql

# Images
sqlite3 data/image_search.db < migrations_flat/044_add_multipass_to_image_meta_cache.sql
```

## Verification

```bash
# Check av_search.db
sqlite3 data/av_search.db "PRAGMA table_info(av_meta_cache);" | grep caption

# Check image_search.db
sqlite3 data/image_search.db "PRAGMA table_info(image_meta_cache);" | grep caption
```

Expected output: 5 new caption-related columns in each table.

## Status

✅ **Migration Complete**
- All code updated to use new databases
- Old migration removed
- New migrations created
- Documentation updated
- No compilation errors

**Ready for testing!**

---

**Updated**: 2025-10-25  
**ADR Reference**: ADR-009 (Modality Search DB Split)
