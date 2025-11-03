# VideoJobProcessor Split Database Migration Plan

## Current Architecture

**VideoJobProcessor uses:**
- `this.videoDb` (VideoDatabase) → `video-rag.db` ✅ Keep as-is
- `this.vectorDb` (SqliteVecDatabase) → `vector.db` ❌ Remove/Replace

## Target Architecture

**VideoJobProcessor should use:**
1. `this.videoDb` (VideoDatabase) → `video-rag.db` - Rich video metadata
2. `this.mediaDb` (CanonicalMediaDatabase) → `media.db` - Basic media catalog
3. `this.avSearchWriter` (AVSearchWriter) → `av_search.db` - Search index

## VectorDb Usage Analysis

Found 9 uses of `this.vectorDb`:

### 1. Line 1016: `searchByPath()` - READ operation
```typescript
const existingVideos = this.vectorDb.searchByPath(videoPath);
```
**Migration:** Query `media.db` instead
```typescript
const existingVideos = await this.mediaDb.getMediaItemsByPath(videoPath);
```

### 2. Line 1049: `addMediaItemAsync()` - Parent video creation
```typescript
const parentVideoId = await this.vectorDb.addMediaItemAsync({
  name: videoName,
  path: videoPath,
  type: 'video',
  sourceId: videoPath,
  size: videoSize,
  duration: videoDuration,
  width: videoWidth,
  height: videoHeight
});
```
**Migration:** Write to `media.db`
```typescript
this.mediaDb.upsertMediaItemFromLegacy({
  id: parentVideoId,
  sourceId: sourceId,
  type: 'video',
  path: videoPath,
  size: videoSize,
  durationMs: videoDuration * 1000,
  width: videoWidth,
  height: videoHeight,
  createdAt: new Date(),
  modifiedAt: new Date()
});
```

### 3. Line 1144: `addMediaItemAsync()` - Video segment
```typescript
const segmentItemId = await this.vectorDb.addMediaItemAsync(segmentData);
```
**Migration:** 
- Write metadata to `media.db`
- Write embedding to `av_search.db` via `AVSearchWriter`

### 4. Line 1506: `addMediaItemAsync()` - Incremental segment storage
```typescript
await this.vectorDb.addMediaItemAsync(segmentItem);
```
**Migration:** Same as #3

### 5. Line 1684: `addMediaItemWithIdAsync()` - Immediate batch index
```typescript
await this.vectorDb.addMediaItemWithIdAsync(segmentId, {...});
```
**Migration:** 
- Write to `media.db` with specific ID
- Write embedding to `av_search.db`

### 6. Line 2389: `getMediaItem()` - READ operation
```typescript
const existingEntry = this.vectorDb.getMediaItem(batchId);
```
**Migration:** Query `media.db`

### 7. Line 2392: `addMediaItemWithIdAsync()` - Enhanced batch update
```typescript
await this.vectorDb.addMediaItemWithIdAsync(batchId, {...});
```
**Migration:** Update in `media.db` + `av_search.db`

### 8. Line 2408: `addMediaItemWithIdAsync()` - Enhanced batch create
```typescript
await this.vectorDb.addMediaItemWithIdAsync(batchId, {...});
```
**Migration:** Same as #7

### 9. Line 2494: `getMediaItem()` - READ operation
```typescript
const existingSegment = this.vectorDb.getMediaItem(segmentId);
```
**Migration:** Query `media.db`

## Migration Strategy

### Phase 1: Add new dependencies to constructor
```typescript
constructor(
  videoDb: VideoDatabase,
  mediaDb: CanonicalMediaDatabase,
  avSearchWriter: AVSearchWriter,
  sharedPipeline?: VideoPipeline,
  workerId?: string
)
```

### Phase 2: Replace vectorDb operations

**READ operations (3 instances):**
- Replace `vectorDb.searchByPath()` → Query `media.db`
- Replace `vectorDb.getMediaItem()` → Query `media.db`

**WRITE operations (6 instances):**
- Replace `vectorDb.addMediaItemAsync()` → Write to `media.db` + `av_search.db`
- Replace `vectorDb.addMediaItemWithIdAsync()` → Write to `media.db` + `av_search.db`

### Phase 3: Update embedding writes

When writing segments with embeddings:
```typescript
// 1. Write metadata to media.db
this.mediaDb.upsertMediaItemFromLegacy({...});

// 2. Write embedding to av_search.db
if (embedding) {
  this.avSearchWriter.updateVideoSegmentEmbedding(segmentId, embedding);
}

// 3. Write transcription to av_search.db
if (transcription) {
  this.avSearchWriter.updateTranscription(segmentId, transcription);
}

// 4. Update metadata cache in av_search.db
this.avSearchWriter.updateAVMetaCache({
  itemId: segmentId,
  segmentId: segmentId,
  mediaType: 'video',
  path: segmentPath,
  startMs: startTime * 1000,
  endMs: endTime * 1000,
  durationMs: duration * 1000,
  title: segmentName,
  createdAt: new Date().toISOString()
});
```

## Implementation Plan

1. ✅ Create `AVSearchWriter` class
2. ⏳ Create `video-job-processor-v2.ts` with split DB architecture
3. ⏳ Test with single video
4. ⏳ Update `main.ts` to use new processor
5. ⏳ Remove old `video-job-processor.ts` after verification

## Notes

- Keep `video-rag.db` (VideoDatabase) as-is - it has rich video-specific data
- `media.db` only stores basic catalog info (path, size, type, timestamps)
- `av_search.db` stores embeddings and search indexes
- All 3 databases work together for complete video processing
