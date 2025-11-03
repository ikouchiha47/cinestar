# Error Handling Improvement - Parent Video Validation

## Date: Nov 1, 2025 3:42am

## Problem

When parent video is not found in `media.db`, the code was returning `null` and falling back to using `videoPath` as `sourceId`:

```typescript
// Before
const parentVideo = await this.ensureParentVideoExists(videoPath);
// Returns null if not found

const sourceId = data.parentSourceId || data.videoPath;  // Fallback to path
// ❌ This causes: SqliteError: FOREIGN KEY constraint failed
```

**Result:** Cryptic FK constraint error with no context about what went wrong.

## Solution

Changed `ensureParentVideoExists()` to **throw an error** instead of returning null:

```typescript
// After
const parentVideo = await this.ensureParentVideoExists(videoPath);
// Throws clear error if not found

const sourceId = data.parentSourceId;  // Always valid UUID
// ✅ No FK errors - parent is guaranteed to exist
```

**Result:** Clear, actionable error message explaining the root cause.

## Changes Made

### 1. Updated Return Type
```typescript
// Before
async ensureParentVideoExists(videoPath: string): Promise<{ id: string; sourceId: string } | null>

// After
async ensureParentVideoExists(videoPath: string): Promise<{ id: string; sourceId: string }>
```

### 2. Added Error Throwing
```typescript
if (!parentVideo) {
  const errorMsg = `Parent video not found in media.db: ${videoPath}. Cannot process segments without parent video. Ensure video is indexed before processing segments.`;
  console.error(`[PERSISTENCE] ❌ ${errorMsg}`);
  throw new Error(errorMsg);
}
```

### 3. Removed Optional Chaining
```typescript
// Before
parentSourceId: parentVideo?.sourceId,  // Could be undefined

// After
parentSourceId: parentVideo.sourceId,  // Always valid
```

### 4. Added Validation in writeToMediaDb
```typescript
if (!data.parentSourceId) {
  throw new Error(`Cannot write segment to media.db: parentSourceId is missing for ${data.segmentId}`);
}
```

## Error Messages

### Before (Cryptic)
```
SqliteError: FOREIGN KEY constraint failed
    at VideoPersistenceService.writeToMediaDb
    at VideoPersistenceService.storeSegment
    ...
```
**Problem:** No context about WHY it failed or HOW to fix it.

### After (Clear)
```
Error: Parent video not found in media.db: /Users/darksied/Downloads/video.mp4. 
Cannot process segments without parent video. 
Ensure video is indexed before processing segments.
    at VideoPersistenceService.ensureParentVideoExists
    at VideoPersistenceService.storeBatchResult
    ...
```
**Benefit:** 
- ✅ Explains WHAT went wrong (parent video missing)
- ✅ Explains WHERE (specific file path)
- ✅ Explains HOW to fix (ensure video is indexed first)

## Files Modified

**`src/core/video-processing/VideoPersistenceService.ts`:**
1. `ensureParentVideoExists()` - Lines 187-219
   - Changed return type (removed `| null`)
   - Added error throwing when parent not found
   - Added JSDoc `@throws` annotation

2. `storeBatchResult()` - Lines 58-77
   - Removed optional chaining (`?.`)
   - Added comment explaining error behavior

3. `writeToMediaDb()` - Lines 115-136
   - Removed fallback logic
   - Added validation check
   - Throws error if parentSourceId missing

## Benefits

### 1. Fail Fast
Errors occur at the lookup stage, not during database write. This makes debugging much easier.

### 2. Clear Error Messages
Developers and logs clearly show:
- What failed (parent video lookup)
- Why it failed (video not in media.db)
- How to fix it (index video first)

### 3. No Silent Failures
Previously, the code would try to continue with invalid data. Now it stops immediately.

### 4. Prevents FK Constraint Errors
By validating parent existence upfront, we prevent cryptic FK errors downstream.

## Edge Cases Handled

### Case 1: Parent Video Exists
```
[PERSISTENCE] Parent video in media.db: abc-123, sourceId: xyz-789
[PERSISTENCE] Storing segment batch-456...
[AV-SEARCH-WRITER] ✅ Transcription written to FTS
[PERSISTENCE] ✅ Stored segment batch-456
```
✅ Normal flow - everything works

### Case 2: Parent Video Missing
```
[PERSISTENCE] ❌ Parent video not found in media.db: /path/to/video.mp4. 
Cannot process segments without parent video. Ensure video is indexed before processing segments.
[PERSISTENCE] Failed to store batch batch-456: Error: Parent video not found...
```
✅ Clear error - processing stops with actionable message

### Case 3: Database Error During Lookup
```
[PERSISTENCE] Failed to lookup parent video: SqliteError: database is locked
Error: Failed to lookup parent video in media.db for /path/to/video.mp4: database is locked
```
✅ Error wrapped with context - shows both what we were trying to do and the underlying error

## Testing Recommendations

### Test 1: Normal Flow
1. Upload video → Gets indexed in media.db
2. Process segments → Should work normally
3. Verify: No errors, segments in av_search.db

### Test 2: Missing Parent
1. Manually delete parent video from media.db
2. Try to process segments
3. Verify: Clear error message, no FK constraint errors

### Test 3: Database Lock
1. Lock media.db (simulate concurrent access)
2. Try to process segments
3. Verify: Error message includes both context and underlying error

## Backward Compatibility

✅ **No breaking changes for normal flow**
- If parent video exists, behavior is identical
- Only difference is when parent is missing (now fails with clear error instead of cryptic FK error)

## Future Improvements

### 1. Auto-Create Parent Video
If parent missing, could automatically create it:
```typescript
if (!parentVideo) {
  console.warn(`[PERSISTENCE] Parent video missing, creating entry...`);
  const newParent = await this.createParentVideoEntry(videoPath);
  return { id: newParent.id, sourceId: newParent.sourceId };
}
```

### 2. Retry Logic
Add retry for transient errors:
```typescript
const parentVideo = await this.retryWithBackoff(() => 
  this.ensureParentVideoExists(videoPath)
);
```

### 3. Batch Validation
Validate all parent videos before processing any segments:
```typescript
async validateAllParentVideos(results: BatchProcessingResult[]): Promise<void> {
  const uniquePaths = [...new Set(results.map(r => r.videoPath))];
  for (const path of uniquePaths) {
    await this.ensureParentVideoExists(path);
  }
}
```

## Summary

**Before:** Silent failure → Cryptic FK error → Hard to debug
**After:** Immediate failure → Clear error message → Easy to fix

This change makes the system more robust and easier to maintain by failing fast with clear, actionable error messages.
