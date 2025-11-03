# ADR: Hybrid Search Implementation

**Date**: 2025-01-11  
**Status**: Implemented  
**Decision**: Integrate FTS + Vector hybrid search for better search quality

## Context

Pure vector search was returning false positives (e.g., "sunset" query returning fog/autumn images) because:
1. Visual similarity doesn't always mean semantic match
2. No exact keyword matching
3. Captions sometimes speculative ("possibly sunset")

## Decision

Implement hybrid search combining:
- **Vector similarity** (semantic understanding)
- **FTS BM25** (exact keyword matching)

### Formula

```
final_score = α * vector_similarity + (1 - α) * fts_score
```

Where **α = 0.7** (default): 70% semantic, 30% keywords

## Implementation

### Files Modified

1. **`src/core/sqlite-vec-database.ts`**
   - Added `searchFTS()` method
   - Added `searchHybrid()` method
   - Normalizes BM25 scores to 0-1 range

2. **`src/api/main-media-api.ts`**
   - Changed from `searchSimilar()` to `searchHybrid()`
   - Configurable α parameter (default 0.7)

3. **`migrations_flat/021_add_fts_indexes.sql`**
   - Added indexes for FTS join performance

### How It Works

```typescript
// 1. Run both searches in parallel
const [vectorResults, ftsResults] = await Promise.all([
  searchSimilar(embedding),  // Semantic
  searchFTS(query)           // Keywords
]);

// 2. Merge results
for each item:
  if (in both results):
    hybrid_score = 0.7 * vector_score + 0.3 * fts_score
  else if (only in vector):
    hybrid_score = 0.7 * vector_score
  else if (only in FTS):
    hybrid_score = 0.3 * fts_score

// 3. Sort by hybrid score
```

## Benefits

### Before (Pure Vector)
```
Query: "sunset"
Results:
1. Sunset mountain (vector: 0.96) ✅
2. Sunset field (vector: 0.95) ✅
3. Birds at sunset (vector: 0.86) ✅
4. Ocean (vector: 0.85, caption: "possibly sunset") ❌ False positive
5. Autumn leaves (vector: 0.82) ❌ False positive
6. Foggy forest (vector: 0.79) ❌ False positive
```

### After (Hybrid α=0.7)
```
Query: "sunset"
Results:
1. Sunset mountain (vector: 0.96, fts: 0.95) → 0.957 ✅
2. Sunset field (vector: 0.95, fts: 0.93) → 0.944 ✅
3. Birds at sunset (vector: 0.86, fts: 0.88) → 0.866 ✅
4. Ocean (vector: 0.85, fts: 0.00) → 0.595 ⚠️ Demoted
5. Autumn leaves (vector: 0.82, fts: 0.00) → 0.574 ⚠️ Demoted
6. Foggy forest (vector: 0.79, fts: 0.00) → 0.553 ⚠️ Demoted
```

**Result**: False positives drop in ranking due to missing keywords!

## Configuration

### Adjusting α

```typescript
// In main-media-api.ts, line 1544
const paginatedResults = await this.vecDb.searchHybrid(q, combinedEmbedding, {
  limit: searchLimit,
  offset: 0,
  alpha: 0.7  // ← Adjust this value
});
```

**Recommended values:**
- **α = 0.8-0.9**: Conceptual/creative searches ("happy vibes", "cozy atmosphere")
- **α = 0.7**: General use (default)
- **α = 0.5**: Balanced
- **α = 0.3-0.4**: Technical/exact searches (names, specific terms)

## Performance

- **FTS search**: ~5-10ms (indexed)
- **Vector search**: ~10-50ms (depends on dataset size)
- **Hybrid (parallel)**: ~15-60ms (max of both + merge overhead)
- **Overhead**: ~5ms for merging and scoring

## Future Improvements

1. **Dynamic α**: Adjust based on query type
   - Short queries (1-2 words) → higher α (more semantic)
   - Long queries (3+ words) → lower α (more keyword-focused)

2. **Query-specific weights**: Different α for different query patterns
   - "sunset" → α=0.7
   - "person wearing red shirt" → α=0.5 (more keywords)

3. **User feedback**: Learn optimal α from click-through rates

4. **Configurable via UI**: Add α slider in settings

## Monitoring

Look for these log messages:
```
[HYBRID-SEARCH] Starting hybrid search for: "sunset" (α=0.7)
[HYBRID-SEARCH] Combined 40 vector + 15 FTS results into 45 unique items
[HYBRID-SEARCH] Top 3 hybrid scores: [...]
```

## Tags
#search #hybrid #fts #vector #bm25 #semantic #keywords
