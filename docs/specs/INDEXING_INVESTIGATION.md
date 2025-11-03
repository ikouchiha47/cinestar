# Video Indexing Investigation - Nov 1, 2025

## Database Verification Results

### ✅ What's Working

1. **Video Segment Embeddings** (`av_search.db`)
   - 10 embeddings stored correctly
   - Vector size: 4096 bytes (1024 dimensions × 4 bytes)
   - Model: "default"

2. **AV Meta Cache** (`av_search.db`)
   - 10 entries with proper segment metadata
   - Visual captions present and stored correctly:
     - "The image shows the face of a young boy with brown hair, wearing a black shirt"
     - "The image depicts two people standing in the foreground..."
     - "The image depicts an industrial scene with a group of people..."

3. **Batch Processing** (`jobs.db`)
   - 5 batches created (all marked as `status='enhanced'`)
   - Time ranges: 0-300s, 300-600s, 600-900s, 900-1200s, 1200-1309.845s

4. **Keyframe Extraction** (`jobs.db`)
   - 20 keyframes extracted (4 per batch × 5 batches)
   - Timestamps properly distributed

5. **Database Split Architecture**
   - New modality databases (av_search.db, image_search.db) in use
   - Workers using AVSearchWriter and ImageSearchWriter
   - Split architecture working correctly

---

## 🔴 Critical Issues Found

### Issue 1: Transcriptions Not in FTS Table

**Symptom:**
- `transcripts_fts` table is empty (0 rows)
- Logs show transcription completed successfully
- Text search on transcriptions won't work

**Root Cause:**
The code path exists but `updateTranscription()` is either:
1. Not being called during Phase 0
2. Being called but silently failing
3. Being called with empty/truncated text

**Code Path:**
```typescript
// Phase 0 (line 1797 in video-job-processor-v2.ts)
caption: result.result.text.substring(0, 500) // First 500 chars

// writeVideoSegment() (line 178)
this.avSearchWriter.updateTranscription(segmentId, segmentData.caption);

// AVSearchWriter.updateTranscription() (line 115)
// Should write to transcripts_fts table
```

**Fix Applied:**
Added comprehensive logging to `AVSearchWriter.updateTranscription()` to trace:
- When method is called
- Segment ID and transcription length
- DELETE and INSERT operations
- Success/failure status

---

### Issue 2: Keyframe Captions Not Stored

**Symptom:**
- 20 keyframes extracted successfully
- All `caption`, `caption_spatial`, `caption_temporal` columns are NULL
- Logs show scene reconstruction completed
- Visual search context missing from keyframes

**Root Cause:**
Captions are generated but not persisted to `batch_keyframes` table. Either:
1. `updateKeyframeCaption()` not being called
2. Being called with empty captions
3. Keyframe IDs don't match between extraction and caption update

**Code Path:**
```typescript
// Phase 1 (line 2906 in video-job-processor-v2.ts)
await this.batchProcessor.updateKeyframeCaption(
  keyframe.id,
  caption,
  confidence
);

// BatchProcessor.updateKeyframeCaption() (line 765)
// Should UPDATE batch_keyframes table
```

**Fix Applied:**
Added comprehensive logging to `BatchProcessor.updateKeyframeCaption()` to trace:
- When method is called
- Keyframe ID and caption length
- SQL UPDATE result (rows affected)
- Warning if no rows updated (keyframe doesn't exist)

---

## Next Steps

### 1. Rebuild and Reprocess Video
```bash
npm run build
# Then upload a new video or reprocess existing one
```

### 2. Monitor Logs for New Prefixes
Look for these new log messages:
- `[AV-SEARCH-WRITER] 📝 updateTranscription called`
- `[AV-SEARCH-WRITER] ✅ Transcription written to FTS`
- `[BATCH-PROCESSOR] 📝 updateKeyframeCaption called`
- `[BATCH-PROCESSOR] ✅ Updated keyframe with caption`

### 3. Verify Database After Processing
```bash
# Check transcripts_fts
sqlite3 data/av_search.db "SELECT COUNT(*) FROM transcripts_fts;"

# Check keyframe captions
sqlite3 data/jobs.db "SELECT COUNT(*) FROM batch_keyframes WHERE caption IS NOT NULL;"

# Sample transcription
sqlite3 data/av_search.db "SELECT segment_id, SUBSTR(transcript, 1, 100) FROM transcripts_fts LIMIT 1;"

# Sample keyframe caption
sqlite3 data/jobs.db "SELECT keyframe_index, SUBSTR(caption, 1, 60) FROM batch_keyframes WHERE caption IS NOT NULL LIMIT 1;"
```

---

## Potential Root Causes

### Hypothesis 1: Caption Truncation Issue
The code truncates transcription to 500 chars:
```typescript
caption: result.result.text.substring(0, 500)
```

If `result.result.text` is empty or undefined, this becomes an empty string, which the new logging will catch.

### Hypothesis 2: Keyframe ID Mismatch
Keyframes are created with ID format:
```typescript
keyframeId: `keyframe_${batch.id}_${i + 1}`  // Phase 1 extraction
```

But might be stored with different ID:
```typescript
id: `${batch.id}_keyframe_${i}`  // BatchProcessor storage
```

The new logging will show the actual IDs being used.

### Hypothesis 3: Silent Exceptions
Both methods might be throwing exceptions that are caught and logged but don't fail the process. The new try-catch blocks will make this explicit.

---

## Files Modified

1. `/Users/darksied/dev/pocs/drillbit/src/core/av-search-writer.ts`
   - Added logging to `updateTranscription()` method
   - Added empty string check
   - Added try-catch with detailed error logging

2. `/Users/darksied/dev/pocs/drillbit/src/core/processors/batch-processor.ts`
   - Added logging to `updateKeyframeCaption()` method
   - Added empty string check
   - Added rows affected check
   - Added try-catch with detailed error logging

---

## Success Criteria

After rebuild and reprocessing:

✅ **Transcriptions:**
- `transcripts_fts` table has 5 entries (one per batch)
- Each entry has full transcription text
- Text search on transcriptions returns results

✅ **Keyframe Captions:**
- `batch_keyframes` table has 20 entries with non-NULL captions
- Captions contain visual descriptions
- Spatial/temporal captions populated (if multi-pass enabled)

✅ **Logs:**
- `[AV-SEARCH-WRITER]` messages show successful FTS writes
- `[BATCH-PROCESSOR]` messages show successful caption updates
- No warnings about empty captions or missing keyframes
