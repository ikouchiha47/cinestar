# Search Root Cause Analysis - "cold" Query

## Problem Summary
Searching for "cold" returns irrelevant results, including a yoga image ranked higher than snowy mountain images.

## Search Results Analysis

Query: "cold"

| Rank | Image | Caption Summary | Contains "cold"? | Relevant? | Vector Score |
|------|-------|-----------------|------------------|-----------|--------------|
| 1 | balaji-malliswamy | Foggy forest scene | ❌ No | ❌ No | 0.691 |
| 2 | fabien-maurin | **Winter scene with snow-covered trees** | ❌ No | ✅ YES! | 0.638 |
| 3 | prateek-jaiswal | **Three people doing yoga** | ❌ No | ❌ NO! | 0.629 |
| 4 | spruce | Foggy forest scene | ❌ No | ❌ No | 0.628 |
| 5 | seiya-maeda | **Snowy mountain road** | ❌ No | ✅ YES! | 0.606 |

**Expected ranking**: #2 (winter/snow) and #5 (snowy) should be ranked higher than #3 (yoga)!

## Root Cause

### Issue 1: FTS Returns 0 Results
- **Why**: None of the captions contain the word "cold"
- **Evidence**: `SELECT COUNT(*) FROM image_fts WHERE image_fts MATCH 'cold'` → 0
- **But**: Captions DO contain related words: "winter" (3 results), "snow" (3 results), "snowy" (3 results)

### Issue 2: Vector Embeddings Mismatch Semantics
The embedding model (`qllama/bge-large-en-v1.5:latest`) thinks:
- "cold" is MORE similar to "three people engaged in yoga poses" (0.629)
- "cold" is LESS similar to "snowy mountain road" (0.606)

**This is semantically wrong!**

### Issue 3: Image Embedding Process
Images are embedded in two steps:
1. **Caption generation**: `moondream:v2` describes the image
2. **Text embedding**: `bge-large-en-v1.5` embeds the caption

**Problem**: The captions are verbose and don't always include semantic keywords:
- ❌ "serene winter scene with snow-covered trees" (doesn't say "cold")
- ❌ "snowy mountain road" (doesn't say "cold")
- ✅ But these ARE cold scenes!

## Why FTS Would Fix This

If FTS worked, it would:
1. Find "winter" → boost fabien-maurin (#2)
2. Find "snowy" → boost seiya-maeda (#5)
3. Hybrid score = 0.7 × vector + 0.3 × FTS
4. Results with "winter"/"snow" would rank higher

**Example with FTS:**
- fabien-maurin: hybrid = 0.7 × 0.638 + 0.3 × 1.0 = 0.747 ✅
- prateek-jaiswal: hybrid = 0.7 × 0.629 + 0.3 × 0.0 = 0.440 ✅
- seiya-maeda: hybrid = 0.7 × 0.606 + 0.3 × 1.0 = 0.724 ✅

**Correct ranking**: #2, #5, #3 ✅

## Solutions

### Solution 1: Query Expansion (Recommended)
Expand "cold" to include related terms:
```typescript
const queryExpansion = {
  'cold': ['cold', 'winter', 'snow', 'snowy', 'ice', 'frozen', 'frost'],
  'hot': ['hot', 'summer', 'warm', 'heat', 'sunny'],
  'dark': ['dark', 'night', 'evening', 'dim', 'shadow'],
  // ...
};

const expandedQuery = queryExpansion[query] || [query];
const ftsQuery = expandedQuery.join(' OR ');
```

**Impact**: FTS would find 3 results instead of 0, fixing the ranking!

### Solution 2: Use LLM for Query Expansion
Use `llama3.2:3b` to expand the query:
```typescript
const prompt = `Given the search query "${query}", list 5-7 related words or synonyms that would help find relevant images. Return only the words, comma-separated.`;
const expanded = await llm.generate(prompt);
// "cold" → "winter, snow, ice, frozen, snowy, frost, chilly"
```

**Pros**: Dynamic, handles any query
**Cons**: Slower (LLM call), might hallucinate

### Solution 3: Better Embedding Model
Use a model trained for semantic search:
- Current: `bge-large-en-v1.5` (general purpose)
- Better: `bge-m3` or `gte-large` (semantic search optimized)

**Pros**: Better semantic matching
**Cons**: Requires re-indexing all images

### Solution 4: Multi-Pass Captioning for Images
Add spatial/temporal/element extraction to image captions:
```
Caption: "serene winter scene with snow-covered trees"
Elements: ["trees", "snow", "winter", "cold", "forest"]
Temporal: "winter season, daytime"
```

**Pros**: Richer captions with more keywords
**Cons**: Slower indexing, requires multi-pass implementation

## Recommended Approach

**Phase 1: Quick Fix (Query Expansion)**
1. Create a dictionary of common query expansions
2. Expand queries before FTS search
3. Test with "cold" → should find 3 results

**Phase 2: LLM-Based Expansion**
1. Use `llama3.2:3b` to expand queries dynamically
2. Cache expansions for common queries
3. Fallback to dictionary if LLM fails

**Phase 3: Better Captions**
1. Implement multi-pass captioning for images
2. Extract keywords/elements during indexing
3. Include in FTS index

## Testing

### Test Case 1: "cold"
- Expected: Winter/snow images ranked highest
- Current: Yoga image in top 3 ❌
- After fix: Winter/snow images in top 3 ✅

### Test Case 2: "hot"
- Expected: Summer/beach/sun images
- Test with: "summer", "warm", "heat"

### Test Case 3: "dark"
- Expected: Night/evening images
- Test with: "night", "evening", "shadow"

---

**Status**: Root cause identified  
**Priority**: HIGH - Search quality is poor  
**Next Action**: Implement query expansion
