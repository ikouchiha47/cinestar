# VideoJobProcessor-v2 Manual Fixes Required

## Issues Found During Review

### ✅ FIXED:
1. Removed unused `VideoSegmentIndexer` import and property
2. Removed `this.segmentIndexer` initialization

### ⚠️ NEEDS MANUAL FIX:

## 1. Invalid Parameters in writeVideoSegment() Calls

The migration script replaced `vectorDb.addMediaItemAsync()` calls but kept invalid parameters.

### Helper Method Signature:
```typescript
private async writeVideoSegment(segmentData: {
  id?: string;
  sourceId: string;
  name: string;
  path: string;
  type: 'video' | 'video_segment';
  size?: number;
  duration?: number;
  width?: number;
  height?: number;
  caption?: string;
  embedding?: Float32Array;
  mimeType?: string;
}): Promise<string>
```

### Invalid Parameters to Remove:
- `createdAt` - Handled internally
- `updatedAt` - Handled internally
- `captionStatus` - Not needed
- `embeddingStatus` - Not needed

### Locations to Fix:

#### Line ~1123-1134: Parent video creation
**BEFORE:**
```typescript
const parentVideoId = await this.writeVideoSegment({
  name: videoName,
  path: videoPath,
  type: 'video' as const,
  size: 0,
  sourceId: videoPath,
  createdAt: new Date(),          // ❌ Remove
  updatedAt: new Date(),          // ❌ Remove
  caption: '',                     // ❌ Remove (empty)
  captionStatus: 'pending' as const,  // ❌ Remove
  embeddingStatus: 'pending' as const // ❌ Remove
});
```

**AFTER:**
```typescript
const parentVideoId = await this.writeVideoSegment({
  name: videoName,
  path: videoPath,
  type: 'video' as const,
  size: videoSize || 0,
  sourceId: videoPath,
  duration: videoDuration,
  width: videoWidth,
  height: videoHeight
});
```

#### Line ~1768: Immediate batch index
**BEFORE:**
```typescript
await this.writeVideoSegment({ 
  id: segmentId,
  sourceId: parentVideo.sourceId,
  name: `${job?.fileName || 'video'} - ${batch.startTime}s-${batch.endTime}s`,
  path: `${job?.videoPath}#t=${batch.startTime},${batch.endTime}`,
  type: 'video_segment' as const,
  size: 0,
  createdAt: new Date(),          // ❌ Remove
  updatedAt: new Date(),          // ❌ Remove
  caption: batch.caption || '',
  captionStatus: 'completed' as const,  // ❌ Remove
  embedding: batch.embedding,
  embeddingStatus: batch.embedding ? 'completed' as const : 'pending' as const  // ❌ Remove
});
```

**AFTER:**
```typescript
await this.writeVideoSegment({ 
  id: segmentId,
  sourceId: parentVideo.sourceId,
  name: `${job?.fileName || 'video'} - ${batch.startTime}s-${batch.endTime}s`,
  path: `${job?.videoPath}#t=${batch.startTime},${batch.endTime}`,
  type: 'video_segment' as const,
  size: 0,
  duration: batch.endTime - batch.startTime,
  caption: batch.caption || undefined,  // Only if present
  embedding: batch.embedding || undefined  // Only if present
});
```

#### Line ~2492: Enhanced batch update
Similar pattern - remove `createdAt`, `updatedAt`, `captionStatus`, `embeddingStatus`

## 2. Verify segmentData Parameter Mapping

When calling `await this.writeVideoSegment(segmentData)`, ensure `segmentData` object has correct properties:

**Required:**
- `sourceId` ✅
- `name` ✅
- `path` ✅
- `type` ✅

**Optional but recommended:**
- `size`
- `duration`
- `width`
- `height`
- `caption` (if available)
- `embedding` (if available)
- `mimeType`

## 3. Search for All Invalid Parameters

Run this to find all occurrences:
```bash
grep -n "captionStatus\|embeddingStatus\|createdAt.*new Date\|updatedAt.*new Date" src/core/video-job-processor-v2.ts
```

## 4. Test After Fixes

1. Compile TypeScript to check for type errors
2. Test video upload
3. Verify segments are written to:
   - `media.db` (basic metadata)
   - `av_search.db` (embeddings, transcriptions, cache)
4. Check logs for proper split DB writes

## Quick Fix Script

You can use this sed command to remove the most common invalid parameters:
```bash
# Backup first!
cp src/core/video-job-processor-v2.ts src/core/video-job-processor-v2.ts.backup2

# Remove invalid parameters (review changes after!)
sed -i '' '/createdAt: new Date(),/d' src/core/video-job-processor-v2.ts
sed -i '' '/updatedAt: new Date(),/d' src/core/video-job-processor-v2.ts
sed -i '' '/captionStatus:/d' src/core/video-job-processor-v2.ts
sed -i '' '/embeddingStatus:/d' src/core/video-job-processor-v2.ts
```

**⚠️ WARNING:** Review all changes manually after running sed commands!
