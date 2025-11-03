# Backfill Debugging Checklist

## What Backfill Does

The `runModalityBackfillIfNeeded()` function:
1. **Creates metadata caches** from `media.db` → `image_search.db` and `av_search.db`
2. **Backfills embeddings** from `vector.db` → `image_search.db` (if empty)
3. **Backfills transcriptions** from `video-rag.db` → `av_search.db` (if empty)

## When It Runs

- **Once** during `MainMediaAPI.initialize()` (line 240 in main-media-api.ts)
- **Idempotent** - Only fills empty tables
- **Non-fatal** - Errors are logged but don't stop initialization

## Debug Steps

### 1. Check if Backfill Runs

**Look for these logs on app startup:**
```
[MainMediaAPI] Modality backfill checked (idempotent, post-migration)
```

**Or warning:**
```
[MainMediaAPI] Modality backfill failed (non-fatal): <error>
```

### 2. Check Database Files Exist

```bash
ls -lh data/*.db
```

**Expected:**
- `media.db` - Should have data
- `image_search.db` - May be empty
- `av_search.db` - May be empty
- `vector.db` - Legacy, may have embeddings
- `video-rag.db` - May have transcriptions

### 3. Check media.db Has Data

```bash
sqlite3 data/media.db "SELECT COUNT(*), type FROM media_items GROUP BY type;"
```

**Expected output:**
```
43|image
5|video
```

If empty → **Problem**: Workers aren't writing to media.db

### 4. Check image_meta_cache

```bash
sqlite3 data/image_search.db "SELECT COUNT(*) FROM image_meta_cache;"
```

**Expected:** Same count as images in media.db

**If 0:**
- Backfill didn't run
- Or media.db has no images

### 5. Check av_meta_cache

```bash
sqlite3 data/av_search.db "SELECT COUNT(*) FROM av_meta_cache;"
```

**Expected:** Count of videos + video segments

**If 0:**
- Backfill didn't run
- Or media.db has no videos

### 6. Check Embeddings Backfill

```bash
# Check if vector.db has embeddings
sqlite3 data/vector.db "SELECT COUNT(*) FROM vec_embeddings WHERE item_id IN (SELECT id FROM media_items WHERE type='image');"

# Check if they were copied to image_search.db
sqlite3 data/image_search.db "SELECT COUNT(*) FROM image_vec_embeddings;"
```

**If vector.db has embeddings but image_search.db doesn't:**
- Backfill failed
- Check logs for `[WARN] Failed to backfill image_vec_embeddings`

### 7. Check Transcriptions Backfill

```bash
# Check if video-rag.db has transcriptions
sqlite3 data/video-rag.db "SELECT COUNT(*) FROM transcription_segments WHERE transcript IS NOT NULL;"

# Check if they were copied to av_search.db
sqlite3 data/av_search.db "SELECT COUNT(*) FROM transcripts_fts;"
```

## Common Issues

### Issue 1: Backfill Doesn't Run
**Symptoms:** No backfill logs, caches empty

**Causes:**
- Database files don't exist
- Backfill threw exception early

**Fix:** Check for error logs, ensure databases exist

### Issue 2: Caches Empty But media.db Has Data
**Symptoms:** 
- `media.db` has 43 images
- `image_meta_cache` has 0 rows

**Causes:**
- Backfill runs but `count === 0` check fails
- SQL query returns no rows

**Debug:**
```bash
# Check if table exists
sqlite3 data/image_search.db ".schema image_meta_cache"

# Check count
sqlite3 data/image_search.db "SELECT COUNT(*) FROM image_meta_cache;"

# Try manual insert
sqlite3 data/image_search.db "INSERT INTO image_meta_cache(item_id, path, width, height, size, checksum, tags_json, created_at, updated_at) SELECT id, path, width, height, size, checksum, '[]', created_at, modified_at FROM media.media_items WHERE type='image' LIMIT 1;"
```

### Issue 3: Workers Write to vector.db Instead of Split DBs
**Symptoms:**
- `vector.db` has new data
- `media.db` is empty or stale

**Causes:**
- Workers still using old architecture
- main.ts not updated to use V2 processors

**Fix:** Verify main.ts uses:
- `ImageJobProcessor(jobsDb, mediaDb, searchWriter, ...)`
- `VideoJobProcessorV2(videoDb, mediaDb, avSearchWriter, ...)`

### Issue 4: Embeddings Not Backfilled
**Symptoms:**
- `vector.db` has embeddings
- `image_vec_embeddings` is empty
- No error logs

**Causes:**
- `maybeBackfillImageEmbeddings()` exits early
- Table doesn't exist
- Count > 0 (already has data)

**Debug:**
```bash
# Check if table exists
sqlite3 data/image_search.db "SELECT name FROM sqlite_master WHERE type='table' AND name='image_vec_embeddings';"

# Check count
sqlite3 data/image_search.db "SELECT COUNT(*) FROM image_vec_embeddings;"

# Check vector.db structure
sqlite3 data/vector.db ".schema vec_embeddings"
```

## Manual Backfill Commands

### Force Backfill image_meta_cache
```bash
sqlite3 data/image_search.db << 'EOF'
DELETE FROM image_meta_cache;
ATTACH DATABASE 'data/media.db' AS media;
INSERT INTO image_meta_cache(item_id, path, width, height, size, checksum, tags_json, created_at, updated_at)
SELECT id, path, width, height, size, checksum, '[]', created_at, modified_at 
FROM media.media_items WHERE type='image';
DETACH DATABASE media;
EOF
```

### Force Backfill av_meta_cache
```bash
sqlite3 data/av_search.db << 'EOF'
DELETE FROM av_meta_cache;
ATTACH DATABASE 'data/media.db' AS media;
INSERT INTO av_meta_cache(item_id, segment_id, media_type, path, start_ms, end_ms, duration_ms, title, tags_json, created_at, updated_at)
SELECT id, NULL, type, path, NULL, NULL, duration_ms, NULL, '[]', created_at, modified_at
FROM media.media_items WHERE type IN ('video','audio');
DETACH DATABASE media;
EOF
```

### Force Backfill Embeddings
```bash
sqlite3 data/image_search.db << 'EOF'
DELETE FROM image_vec_embeddings;
ATTACH DATABASE 'data/vector.db' AS vec;
ATTACH DATABASE 'data/media.db' AS media;
INSERT INTO image_vec_embeddings(item_id, embedding)
SELECT v.item_id, v.embedding 
FROM vec.vec_embeddings v
WHERE v.item_id IN (SELECT id FROM media.media_items WHERE type='image');
DETACH DATABASE vec;
DETACH DATABASE media;
EOF
```

## Enhanced Logging

Add this to `modality-backfill.ts` for better debugging:

```typescript
console.log('[BACKFILL-DEBUG] Starting backfill...');
console.log('[BACKFILL-DEBUG] media.db path:', mediaDbPath);
console.log('[BACKFILL-DEBUG] image_search.db path:', imageDbPath);
console.log('[BACKFILL-DEBUG] av_search.db path:', avDbPath);

// After opening databases
const imageCount = mediaDb.prepare("SELECT COUNT(*) as c FROM media_items WHERE type='image'").get();
const videoCount = mediaDb.prepare("SELECT COUNT(*) as c FROM media_items WHERE type='video'").get();
console.log('[BACKFILL-DEBUG] media.db has:', imageCount, 'images,', videoCount, 'videos');

const cacheCount = imageDb.prepare("SELECT COUNT(*) as c FROM image_meta_cache").get();
console.log('[BACKFILL-DEBUG] image_meta_cache has:', cacheCount, 'rows');
```
