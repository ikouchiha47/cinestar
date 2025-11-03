# Search Fix Summary

## Problem
Searching for "cold" returned 0 results despite having 43 images and 5 passing the vector similarity threshold.

## Root Cause
**Double-filtering bug** when FTS returns no results:

1. Vector results filtered by `minVectorSim ≥ 0.6` → 5 results
2. FTS returns 0 results
3. Hybrid score = `0.7 × vectorScore + 0.3 × 0` = `0.7 × vectorScore`
4. Applied `minSimilarity ≥ 0.5` filter
5. This requires `0.7 × vectorScore ≥ 0.5` → `vectorScore ≥ 0.714`
6. Results with 0.6 ≤ vectorScore < 0.714 were dropped!

**Example:**
- Image with vectorScore = 0.65 (passed minVectorSim)
- Hybrid score = 0.7 × 0.65 = 0.455
- Failed minSimilarity filter (0.455 < 0.5)
- Result: Dropped even though it was a good vector match!

## Fix Applied

Changed the filtering logic to avoid double-filtering:

```typescript
if (!hasFTSResults) {
  // No FTS results - use all vector results that passed minVectorSim
  // Skip hybrid quality filter to avoid double-filtering
  scoredResults = allScored;
} else {
  // FTS contributed - apply hybrid quality filter
  scoredResults = allScored.filter(r => r.similarity >= minSimilarity);
}
```

**Logic:**
- **When FTS has results**: Apply hybrid quality filter (makes sense - we're combining two signals)
- **When FTS has NO results**: Skip hybrid filter, use vector-filtered results directly (avoid double-filtering)

## Expected Behavior After Fix

For the "cold" query:
- ✅ 43 vector results fetched
- ✅ 5 pass minVectorSim (≥ 0.6)
- ✅ 0 FTS results (okay - no text match)
- ✅ Skip hybrid filter (no FTS to combine)
- ✅ **Return all 5 vector results**

## Additional Improvements

### Enhanced Logging
Added detailed logging to show:
- FTS query transformation
- FTS match count
- Top 10 scored results with individual scores
- Pass/fail status for each result
- Suggestions when filters are too strict

### Example Log Output
```
[IMAGE-HYBRID] Starting hybrid search for: "cold"
[IMAGE-HYBRID] Fetching candidateK=360 vector results (limit×3, max 1000)
[IMAGE-FTS] Original query: "cold" → FTS query: "cold"
[IMAGE-FTS] Total FTS matches: 0
[IMAGE-HYBRID] Raw results - Vector: 43/360, FTS: 0
[IMAGE-HYBRID] After vector cutoff (≥0.6): 5 vector results
[IMAGE-HYBRID] ⚠️  No FTS results, skipping hybrid quality filter
[IMAGE-HYBRID] 📊 Top 10 scored results:
  ✅ 1. image1.jpg: hybrid=0.700 (α=0.70×vec=1.000 + 0.30×fts=0.000)
  ✅ 2. image2.jpg: hybrid=0.490 (α=0.70×vec=0.700 + 0.30×fts=0.000)
  ...
```

## Testing

1. Restart the app
2. Search for "cold"
3. Should now return 5 results (the vector matches)
4. Check logs to verify:
   - FTS returns 0 (expected)
   - Hybrid filter is skipped
   - All 5 vector results are returned

## Future Improvements

### 1. FTS Index Population
Investigate why FTS returns 0 results:
- Check if captions are being indexed
- Verify `image_fts` table has data
- Consider re-indexing images

### 2. Multi-Pass Captioning for Images
Currently:
- Images: Single-pass captioning
- Videos: Multi-pass (spatial, temporal, elements)

Consider adding multi-pass for images to improve search quality.

### 3. Configurable Thresholds
Make thresholds configurable per query:
```typescript
{
  minVectorSim: 0.5,      // Lower for broader results
  minSimilarity: 0.4,     // Lower hybrid threshold
  alpha: 0.75             // Adjust vector/FTS weighting
}
```

---

**Status**: Fixed  
**Impact**: Search now returns results when FTS is empty  
**Next**: Test and verify fix works
