# Foreign Key Constraint Fix

## Date: Nov 1, 2025 3:34am

## Issue Found
After uncommenting the `persistenceService.storeBatchResults()` calls, the service was running but failing with:
```
SqliteError: FOREIGN KEY constraint failed
```

## Root Cause
The `VideoPersistenceService.writeToMediaDb()` method was using the **video file path** as the `sourceId`:

```typescript
// Line 119 - WRONG
sourceId: data.videoPath,  // e.g., "/Users/darksied/Downloads/video.mp4"
```

But `media.db` has a foreign key constraint:
```sql
FOREIGN KEY (source_id) REFERENCES sources (id)
```

The `sources` table contains UUIDs like `"27aae168-dbc6-4390-b0ba-40d51f14d771"`, not file paths.

## The Fix

### 1. Updated `ensureParentVideoExists()` to return parent video info
**Before:** `Promise<void>` (returned nothing)
**After:** `Promise<{ id: string; sourceId: string } | null>`

Now it:
- Looks up the parent video in `media.db`
- Returns both the video ID and its `sourceId` (the UUID from `sources` table)
- Returns `null` if not found (with warning)

### 2. Updated `storeBatchResult()` to capture parent info
```typescript
// Get parent video's sourceId
const parentVideo = await this.ensureParentVideoExists(result.videoPath);

// Pass it to segment data
const segmentData: SegmentStorageData = {
  segmentId: result.batchId,
  videoPath: result.videoPath,
  parentSourceId: parentVideo?.sourceId, // ✅ NEW
  // ... other fields
};
```

### 3. Updated `writeToMediaDb()` to use correct sourceId
```typescript
// Use parent video's sourceId if available, otherwise use videoPath as fallback
const sourceId = data.parentSourceId || data.videoPath;

this.mediaDb.upsertMediaItemFromLegacy({
  id: data.segmentId,
  sourceId: sourceId,  // ✅ Now uses UUID from sources table
  type: 'video_segment',
  // ... other fields
});
```

### 4. Added `parentSourceId` to type definition
Updated `SegmentStorageData` interface in `types.ts`:
```typescript
export interface SegmentStorageData {
  segmentId: string;
  videoPath: string;
  parentSourceId?: string; // ✅ NEW - Parent video's sourceId from media.db
  startTime: number;
  endTime: number;
  // ... other fields
}
```

## Files Modified

1. **`src/core/video-processing/VideoPersistenceService.ts`**
   - `ensureParentVideoExists()` - Now returns parent video info
   - `storeBatchResult()` - Captures and passes parentSourceId
   - `writeToMediaDb()` - Uses parentSourceId instead of videoPath

2. **`src/core/video-processing/types.ts`**
   - Added `parentSourceId?: string` to `SegmentStorageData` interface

## How It Works Now

```
storeBatchResult(result)
  ├─> ensureParentVideoExists(videoPath)
  │     ├─> Query media.db for parent video
  │     └─> Return { id: "video-uuid", sourceId: "source-uuid" }
  │
  ├─> Create segmentData with parentSourceId = "source-uuid"
  │
  └─> storeSegment(segmentData)
        └─> writeToMediaDb(data)
              └─> Use data.parentSourceId (UUID) instead of videoPath
                  └─> ✅ Foreign key constraint satisfied!
```

## Expected Result

After rebuild, the persistence service should:
- ✅ Look up parent video in `media.db`
- ✅ Use parent's `sourceId` (UUID) for segments
- ✅ No more FOREIGN KEY constraint errors
- ✅ Transcriptions written to `transcripts_fts`
- ✅ Embeddings written to `video_segment_vec`
- ✅ Metadata written to `av_meta_cache`

## Next Steps

1. **Rebuild**: `npm run build`
2. **Restart app**
3. **Watch logs** for:
   ```
   [PERSISTENCE] Parent video in media.db: ..., sourceId: 27aae168-...
   [PERSISTENCE] Storing segment ...
   [AV-SEARCH-WRITER] ✅ Transcription written to FTS
   [PERSISTENCE] ✅ Stored segment ...
   ```
4. **Verify no FK errors**:
   ```bash
   grep "FOREIGN KEY" logs_6
   # Should return no results
   ```

## Success Criteria

✅ No FOREIGN KEY constraint errors
✅ Segments written to `media.db` with valid `source_id`
✅ Transcriptions written to `transcripts_fts`
✅ Embeddings written to `video_segment_vec`
✅ Full text search working
