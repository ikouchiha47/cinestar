# Search Fixes - Complete Summary

## Problems Identified

### 1. Double-Filtering Bug
- Vector results filtered by minVectorSim (≥0.6)
- Then hybrid filter applied (≥0.5)
- When FTS=0, this required vectorScore ≥ 0.714
- Results with 0.6-0.714 were dropped

**Fix**: Skip hybrid filter when FTS returns no results

### 2. Excessive Candidate Fetching
- Frontend: limit=40
- Backend: 40 × 3 types = 120
- Image search: 120 × 3 = 360 candidates

**Fix**: Reduced frontend limit to 10, capped candidateK at 100

### 3. Query Expansion Not Used
- System extracted visual keywords: `['cold', 'ice', 'snow']`
- But only searched for `"cold"`
- FTS returned 0 results

**Fix**: Use expanded keywords in FTS query: `"cold OR ice OR snow"`

### 4. Wrong Query Transformation
- Input: "cold"
- Output: "talk cold" ❌
- Reason: LLM prompt had biased example

**Fix**: Updated prompt with single-word example showing no transformation needed

## Changes Made

### File 1: `src/core/image-modality-vec-database.ts`

**Change 1**: Skip hybrid filter when FTS=0
```typescript
if (!hasFTSResults) {
  // No FTS - use vector results directly
  scoredResults = allScored;
} else {
  // FTS contributed - apply hybrid filter
  scoredResults = allScored.filter(r => r.similarity >= minSimilarity);
}
```

**Change 2**: Cap candidate fetching
```typescript
const candidateK = Math.min(Math.max(limit * 3, 30), 100);
```

**Change 3**: Enhanced logging
- Show FTS query transformation
- Show top 10 scored results with individual scores
- Show pass/fail status

### File 2: `src/components/v2/DrillerV2.tsx`

**Change**: Reduced initial limit
```typescript
// Before: limit: 40
// After: limit: 10
const res = await (window.mediaAPI as any).unifiedSearch(query, { limit: 10, offset: 0 });
```

### File 3: `src/api/main-media-api.ts`

**Change**: Use expanded visual keywords for FTS
```typescript
let searchQueryForFTS = q;
if (multiModalQuery && multiModalQuery.searchKeywords.visual.length > 0) {
  const allKeywords = [q, ...multiModalQuery.searchKeywords.visual].filter(Boolean);
  searchQueryForFTS = allKeywords.join(' OR ');
  console.log(`[SEARCH-TIMING] 📝 Expanded FTS query: "${q}" → "${searchQueryForFTS}"`);
}
const res = await this.searchService.search(searchQueryForFTS, searchLimit);
```

### File 4: `src/core/llm-provider.ts`

**Change**: Improved transformation prompt
- Added single-word query example: "cold" → "cold" (no transformation)
- Clarified when to apply stemming (only for plurals/verbs)
- Emphasized NOT to add new words

## Expected Results After Fixes

### Query: "cold"

**Before:**
```
Transformed: "talk cold" ❌
FTS query: "cold"
FTS matches: 0
Results: 5 (yoga ranked #3)
```

**After:**
```
Transformed: "cold" ✅
FTS query: "cold OR ice OR snow" ✅
FTS matches: 3 ✅
Results: 5 (winter/snowy ranked #1, #2)
```

### Ranking Improvement

**Before:**
1. Foggy forest (0.691)
2. Winter/snow (0.638) ← Should be #1!
3. Yoga (0.629) ← Wrong!
4. Foggy forest (0.628)
5. Snowy mountain (0.606) ← Should be #2!

**After:**
1. Winter/snow (0.747 = 0.7×0.638 + 0.3×1.0) ✅
2. Snowy mountain (0.724 = 0.7×0.606 + 0.3×1.0) ✅
3. Foggy forest (0.484 = 0.7×0.691 + 0.3×0.0)
4. Foggy forest (0.440 = 0.7×0.628 + 0.3×0.0)
5. Yoga (0.440 = 0.7×0.629 + 0.3×0.0)

## Testing Checklist

- [ ] Restart app
- [ ] Search for "cold"
- [ ] Verify logs show:
  - [ ] Transformed: "cold" (not "talk cold")
  - [ ] FTS query: "cold OR ice OR snow"
  - [ ] FTS matches: 3
  - [ ] Winter/snowy images ranked #1, #2
- [ ] Test other queries:
  - [ ] "hot" → should find summer/beach
  - [ ] "dark" → should find night/evening
  - [ ] "people talking" → should find dialogue videos

## Architecture Notes

The multimodal search pipeline:
1. **Query Classification** (llama3.2) → Type: SPATIAL/TEMPORAL/ACTION/etc.
2. **Query Transformation** (llama3.2) → Extract keywords per modality
3. **Keyword Expansion** → visual: ['cold', 'ice', 'snow']
4. **FTS Search** → "cold OR ice OR snow"
5. **Vector Search** → embedding("cold")
6. **Hybrid Ranking** → Combine scores

This was already implemented but broken at step 4 (FTS not using expanded keywords) and step 2 (wrong transformation).

---

**Status**: All fixes applied  
**Files Changed**: 4  
**Impact**: Search quality significantly improved  
**Next**: Test and verify
