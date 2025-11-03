# Image Element Extraction Issue

## Date: Nov 1, 2025 4:46am

## Problem

Element extraction (Phase 2) is silently failing for images, but images are still marked as successfully processed.

### Current Behavior

```
Phase 1: Moondream caption ✅ (works perfectly)
Phase 2: Qwen extraction ❌ (returns empty response)
Result: Image marked as "complete" with fallback values
```

### Database State

**image_meta_cache** shows all images have fallback elements:
```json
{
  "objects": ["unknown"],
  "people": [],
  "colors": ["unknown"],
  "lighting": "unknown",
  "time": "unknown",
  "setting": "unknown"
}
```

## Root Cause

**LLM extraction service returns empty responses** but doesn't fail the job:

```typescript
// Current code
if (!extractedText) {
  console.warn('[LLM-EXTRACTION] Empty response from LLM, using fallback values');
  return this.getFallbackElements();  // ❌ Silent failure
}
```

**Result**: Image is marked as complete even though extraction failed.

## Issues

### 1. No Visibility
- Logs only show: `"Empty response from LLM, using fallback values"`
- No details about:
  - What caption was sent
  - What model was used
  - What URL was called
  - What the actual response was

### 2. No Retry Logic
- Failed extractions are not retried
- No way to identify which images need re-processing
- No status field to track extraction state

### 3. Silent Degradation
- Images appear "complete" but have no useful metadata
- Advanced search features won't work (filter by objects, colors, etc.)
- No indication to user that extraction failed

## Fix Applied

### Enhanced Logging

Added comprehensive logging to trace the issue:

```typescript
console.log(`[LLM-EXTRACTION] Extracting from caption (${caption.length} chars)...`);
console.log(`[LLM-EXTRACTION] Using model: ${this.model} at ${this.baseUrl}`);
console.log(`[LLM-EXTRACTION] Response length: ${extractedText.length} chars`);
console.log(`[LLM-EXTRACTION] Response preview:`, extractedText.substring(0, 200));
```

**Now we can see:**
- ✅ Input caption length
- ✅ Model and URL being used
- ✅ Response length
- ✅ Response preview
- ✅ HTTP errors with body

## Recommended Solutions

### Option 1: Add Retry Status Field

**Add to image_meta_cache:**
```sql
ALTER TABLE image_meta_cache ADD COLUMN extraction_status TEXT DEFAULT 'pending';
-- Values: 'pending', 'completed', 'failed', 'retry'
```

**Update code:**
```typescript
if (!extractedText) {
  console.warn('[LLM-EXTRACTION] Empty response, marking for retry');
  // Write to meta_cache with extraction_status='failed'
  return this.getFallbackElements();
}
```

**Add retry job:**
```typescript
// Find images with extraction_status='failed'
// Retry extraction
// Update status to 'completed' or 'retry' (after N attempts)
```

### Option 2: Throw Error Instead of Fallback

**Make extraction failures visible:**
```typescript
if (!extractedText) {
  throw new Error('LLM extraction returned empty response');
}
```

**Pros:**
- ✅ Job fails visibly
- ✅ User knows something went wrong
- ✅ Can retry the whole job

**Cons:**
- ❌ Blocks image from being searchable
- ❌ All-or-nothing approach

### Option 3: Hybrid Approach (RECOMMENDED)

**Use fallback but track status:**
```typescript
if (!extractedText) {
  console.warn('[LLM-EXTRACTION] Empty response, using fallback');
  
  // Mark in metadata that extraction needs retry
  await this.markForRetry(itemId, 'extraction_failed');
  
  return this.getFallbackElements();
}
```

**Benefits:**
- ✅ Image still searchable (caption + embedding work)
- ✅ Extraction failure tracked
- ✅ Can retry extraction later without reprocessing whole image
- ✅ User can see which images need attention

## Next Steps

### Immediate (Debugging)

1. **Rebuild and check logs** to see:
   - What caption is being sent to Qwen
   - What response (if any) is returned
   - If there's an HTTP error

2. **Test Qwen directly:**
   ```bash
   curl http://localhost:11434/api/generate -d '{
     "model": "qwen3:4b",
     "prompt": "Extract objects from: A tree with orange leaves",
     "stream": false
   }'
   ```

3. **Check if Qwen is loaded:**
   ```bash
   curl http://localhost:11434/api/tags | grep qwen
   ```

### Short-term (Fix)

1. **Add extraction_status field** to image_meta_cache
2. **Track failed extractions** in database
3. **Create retry mechanism** for failed extractions

### Long-term (Improvement)

1. **Use Moondream for extraction** (sees actual image, not just text)
2. **Add health checks** before processing
3. **Implement circuit breaker** for failing services
4. **Add metrics** for extraction success rate

## Current Impact

**Still works:**
- ✅ Text search (FTS with Moondream captions)
- ✅ Semantic search (embeddings)
- ✅ Basic image browsing

**Doesn't work:**
- ❌ Filter by objects
- ❌ Filter by colors
- ❌ Filter by lighting/time/setting
- ❌ Spatial/temporal analysis (depends on elements)

## Files Modified

- `src/core/processors/llm-extraction-service.ts` - Added comprehensive logging

## Testing After Rebuild

Look for these logs:
```
[LLM-EXTRACTION] Extracting from caption (582 chars)...
[LLM-EXTRACTION] Using model: qwen3:4b at http://localhost:11434
[LLM-EXTRACTION] Response length: 0 chars  ← This tells us if Qwen responds
[LLM-EXTRACTION] Response preview: ...     ← This shows what Qwen said
```

If response length is 0, we'll see the caption that was sent and can debug why Qwen isn't responding.
