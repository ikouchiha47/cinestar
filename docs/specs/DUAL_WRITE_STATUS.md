# Dual Write Status

## ✅ Dual Writes Are DISABLED

As of the latest changes, **all workers use split database architecture** and do NOT write to `vector.db` for media items.

## Current Architecture

### Image Workers (`ImageJobProcessor`)
**File:** `src/core/image-job-processor.ts`

**Constructor:**
```typescript
constructor(
  jobsDb: SqliteMainDatabase,      // vector.db - job queue only
  mediaDb: CanonicalMediaDatabase,  // media.db - metadata
  searchWriter: ImageSearchWriter,  // image_search.db - search index
  workerId?: string
)
```

**Writes:**
- ❌ NO writes to `vector.db` media_items
- ✅ Writes to `media.db` via `mediaDb.upsertMediaItemFromLegacy()`
- ✅ Writes to `image_search.db` via `searchWriter.updateCaption()`, `updateEmbedding()`, `updateMetaCache()`

### Video Workers (`VideoJobProcessorV2`)
**File:** `src/core/video-job-processor-v2.ts`

**Constructor:**
```typescript
constructor(
  videoDb: VideoDatabase,           // video-rag.db - rich metadata
  mediaDb: CanonicalMediaDatabase,  // media.db - basic catalog
  avSearchWriter: AVSearchWriter,   // av_search.db - search index
  sharedPipeline?: VideoPipeline,
  workerId?: string
)
```

**Writes:**
- ❌ NO writes to `vector.db` media_items
- ✅ Writes to `media.db` via `mediaDb.upsertMediaItemFromLegacy()`
- ✅ Writes to `video-rag.db` via `videoDb` (segments, keyframes, transcriptions)
- ✅ Writes to `av_search.db` via `avSearchWriter.updateVideoSegmentEmbedding()`, `updateTranscription()`, `updateAVMetaCache()`

## Database Responsibilities

### `vector.db` (Legacy - Read-Only for Workers)
- ✅ `indexing_jobs` table - Job queue (still used)
- ❌ `media_items` table - **NO LONGER WRITTEN TO**
- ❌ `vec_embeddings` table - **NO LONGER WRITTEN TO**
- 📋 Status: Legacy database, only used for job queue and backfill source

### `media.db` (Canonical Media Database)
- ✅ `media_items` - **Single source of truth** for all media metadata
- ✅ `sources` - Source directories
- ✅ `segments` - Media segments (videos)
- 📋 Status: **Primary metadata store**

### `image_search.db` (Image Search Index)
- ✅ `image_meta_cache` - Cached metadata for search
- ✅ `image_fts` - Full-text search (captions)
- ✅ `image_embeddings` - Embedding vectors
- ✅ `image_vec_embeddings` - vec0 virtual table
- 📋 Status: **Search-optimized index**

### `av_search.db` (Audio/Video Search Index)
- ✅ `av_meta_cache` - Cached metadata for search
- ✅ `video_segment_vec` - Video embeddings (vec0)
- ✅ `audio_segment_vec` - Audio embeddings (vec0)
- ✅ `transcripts_fts` - Full-text search (transcriptions)
- 📋 Status: **Search-optimized index**

### `video-rag.db` (Video Rich Metadata)
- ✅ `video_files` - Video-specific metadata
- ✅ `video_segments` - Segmented clips
- ✅ `video_keyframes` - Extracted keyframes
- ✅ `transcription_segments` - Transcriptions
- ✅ `scene_reconstruction_jobs` - Scene analysis
- ✅ `refinement_passes`, `refinement_metrics` - Progressive refinement
- 📋 Status: **Video processing metadata**

## Verification

### Check Workers in main.ts:
```typescript
// Line 482: Video workers use V2
const { VideoJobProcessor: VideoJobProcessorV2 } = await import('../src/core/video-job-processor-v2');

// Line 485: V2 constructor with split DBs
const worker = new VideoJobProcessorV2(
  videoDb,        // video-rag.db
  mediaDb,        // media.db
  avSearchWriter, // av_search.db
  undefined,
  `video-worker-${i + 1}`
);
```

### Check for Dual Writes:
```bash
# Should return NO matches in active files
grep -r "vectorDb.addMediaItem\|vecDb.addMediaItem" src/core/*.ts --exclude="*.backup.ts"
```

## Migration Path

### Old Architecture (Dual Writes):
```
Worker → vector.db (media_items + vec_embeddings)
       → media.db (via MainMediaAPI)
Result: Duplicates, race conditions
```

### New Architecture (Split DBs):
```
ImageWorker → media.db (metadata)
           → image_search.db (search index)

VideoWorker → media.db (basic metadata)
           → video-rag.db (rich metadata)
           → av_search.db (search index)

Result: Single source of truth, no duplicates
```

## Backfill Process

The `modality-backfill.ts` handles one-time migration:

1. **Media Items:** `vector.db` → `media.db` (if media.db is empty)
2. **Image Cache:** `media.db` → `image_search.db` (meta_cache)
3. **AV Cache:** `media.db` → `av_search.db` (meta_cache)
4. **Embeddings:** `vector.db` → `image_search.db` (if empty)
5. **Transcripts:** `video-rag.db` → `av_search.db` (if empty)

This runs on every app start but is idempotent (fast no-op if already done).

## Status Summary

✅ **Image Workers:** Split DB architecture, no dual writes  
✅ **Video Workers:** Split DB architecture, no dual writes  
✅ **Backfill:** Automatic migration from legacy vector.db  
✅ **Single Source of Truth:** media.db for all metadata  
✅ **No Duplicates:** INSERT OR IGNORE prevents duplicates  
✅ **Production Ready:** All workers migrated  

## Files to Ignore

These files contain old dual-write code but are NOT used:
- `src/core/video-job-processor.ts` (old version)
- `src/core/video-job-processor.backup.ts` (backup)
- `src/core/video-job-processor-v2.ts.backup2` (backup)

Only `video-job-processor-v2.ts` is active.
