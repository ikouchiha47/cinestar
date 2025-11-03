# Search Query Expansion Fix

## Problem
The multimodal query transformation was extracting visual keywords but NOT using them in the search!

## Evidence from Logs

```
[MULTIMODAL-SEARCH] Classified as: SPATIAL (0.9)
[MULTIMODAL-SEARCH] Keywords by modality: {
  text: [ 'cold' ],
  visual: [ 'cold', 'ice', 'snow' ],  ← EXTRACTED!
  audio: [ 'cold', 'speech', 'talk' ],
  ...
}

[IMAGE-FTS] Original query: "cold" → FTS query: "cold"  ← NOT USED!
[IMAGE-FTS] Total FTS matches: 0  ← FAILED!
```

**The system extracted `['cold', 'ice', 'snow']` but only searched for `"cold"`!**

## Root Cause

In `src/api/main-media-api.ts`, the code was:

```typescript
// Extract visual keywords
multiModalQuery = await this.llm!.transformMultiModalQuery(q, queryClassification);
// multiModalQuery.searchKeywords.visual = ['cold', 'ice', 'snow']

// But then only use original query!
const res = await this.searchService.search(q, searchLimit);  // ← BUG!
```

The expanded keywords were extracted but never passed to the search!

## Fix Applied

```typescript
// Use expanded visual keywords for better FTS matching
let searchQueryForFTS = q;
if (multiModalQuery && multiModalQuery.searchKeywords.visual.length > 0) {
  // Combine original query with visual keywords for FTS
  const allKeywords = [q, ...multiModalQuery.searchKeywords.visual].filter(Boolean);
  searchQueryForFTS = allKeywords.join(' OR ');
  console.log(`[SEARCH-TIMING] 📝 Expanded FTS query: "${q}" → "${searchQueryForFTS}"`);
}

const res = await this.searchService.search(searchQueryForFTS, searchLimit);
```

## Expected Behavior After Fix

### Query: "cold"

**Before:**
```
FTS query: "cold"
FTS matches: 0
Results: 5 (vector only, yoga ranked #3)
```

**After:**
```
FTS query: "cold OR ice OR snow"
FTS matches: 3 (winter/snowy images)
Results: 5 (hybrid, winter/snowy ranked higher)
```

### Hybrid Scoring Impact

**Before (FTS=0):**
- fabien-maurin (winter/snow): hybrid = 0.7 × 0.638 = 0.447
- prateek-jaiswal (yoga): hybrid = 0.7 × 0.629 = 0.440
- seiya-maeda (snowy): hybrid = 0.7 × 0.606 = 0.424

**After (FTS finds "snow"):**
- fabien-maurin (winter/snow): hybrid = 0.7 × 0.638 + 0.3 × 1.0 = **0.747** ✅
- seiya-maeda (snowy): hybrid = 0.7 × 0.606 + 0.3 × 1.0 = **0.724** ✅
- prateek-jaiswal (yoga): hybrid = 0.7 × 0.629 + 0.3 × 0.0 = **0.440** ✅

**Correct ranking**: Winter/snowy images ranked #1 and #2!

## System Architecture

The multimodal search pipeline:

```
User Query: "cold"
     ↓
1. Query Classification (llama3.2:3b)
   → Type: SPATIAL (0.9)
     ↓
2. Query Transformation (llama3.2:3b)
   → Transformed: "talk cold"
   → Visual keywords: ['cold', 'ice', 'snow']
     ↓
3. Search Execution
   → Vector: embedding("cold")
   → FTS: "cold OR ice OR snow"  ← NOW FIXED!
     ↓
4. Hybrid Ranking
   → Combine vector + FTS scores
   → Boost results with keyword matches
```

## Testing

1. Restart the app
2. Search for "cold"
3. Check logs for:
   ```
   [SEARCH-TIMING] 📝 Expanded FTS query: "cold" → "cold OR ice OR snow"
   [IMAGE-FTS] Total FTS matches: 3
   ```
4. Verify winter/snowy images ranked higher than yoga

## Related Systems

This same pattern should be applied to:
- **Video search**: Use temporal/action keywords
- **Audio search**: Use audio-specific keywords
- **Text search**: Use text-specific keywords

The multimodal query transformation extracts modality-specific keywords for a reason - we need to USE them!

---

**Status**: Fixed  
**Impact**: FTS will now find relevant results using expanded keywords  
**Next**: Test and verify improved ranking
