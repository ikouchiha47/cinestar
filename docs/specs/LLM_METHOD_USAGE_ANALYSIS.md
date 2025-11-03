# LLM Method Usage Analysis

## Current Search Flow (main-media-api.ts)

### Active Methods (USED in production)

1. **`classifyQueryType(question)`** ✅ USED
   - **Where**: Line 1782 in main-media-api.ts
   - **Purpose**: Classify query as spatial/temporal/audio/action/mixed
   - **Output**: QueryClassification object with type, confidence, elements
   - **Example**: "cold" → spatial (visual intent)

2. **`transformMultiModalQuery(question, classification)`** ✅ USED
   - **Where**: Line 1786 in main-media-api.ts
   - **Purpose**: Transform query into modality-specific keywords
   - **Output**: MultiModalQuery with keywords for text/visual/audio/temporal/action
   - **Example**: "cold" → visual: ["cold", "snow", "ice", "winter", "frozen"]

3. **`extractSearchEntities(question)`** ✅ USED (fallback)
   - **Where**: Line 1813 in main-media-api.ts
   - **Purpose**: Fallback if classification/transformation fails
   - **Output**: Array of keyword strings
   - **Example**: "cold weather" → ["cold", "weather"]

### Unused Methods (NOT in production flow)

4. **`transformQuestionToQuery(question)`** ❌ NOT USED
   - **Where**: Only in tests (test-qa-search-db.ts, test-question-transform.ts)
   - **Purpose**: Simple query transformation (remove filler words)
   - **Output**: Simplified string
   - **Example**: "show me cold weather" → "cold weather"
   - **Status**: SUPERSEDED by transformMultiModalQuery

## Current Production Flow

```
User Query: "cold"
    ↓
1. classifyQueryType("cold")
    → type: "spatial", confidence: 0.9
    → spatialElements: ["cold", "snow", "ice"]
    ↓
2. transformMultiModalQuery("cold", classification)
    → transformed: "cold"
    → searchKeywords: {
         visual: ["cold", "snow", "ice", "winter", "frozen"],
         text: ["cold"],
         audio: [],
         temporal: [],
         action: []
       }
    ↓
3. Use visual keywords for FTS search
    → searchQueryForFTS: "cold OR snow OR ice OR winter OR frozen"
    ↓
4. Hybrid search (vector + FTS)
    → Returns ranked results
```

## Recommendation: Remove transformQuestionToQuery?

**YES** - This method is redundant:

1. **Not used in production**: Only in test files
2. **Superseded**: `transformMultiModalQuery` does everything it does + more
3. **Less powerful**: Just removes filler words, doesn't understand intent
4. **Maintenance burden**: Extra code to maintain

### What to do:

1. **Keep**: `classifyQueryType`, `transformMultiModalQuery`, `extractSearchEntities`
2. **Remove**: `transformQuestionToQuery` (or mark as deprecated)
3. **Update tests**: Use `transformMultiModalQuery` instead

### Migration for tests:

```typescript
// OLD (transformQuestionToQuery)
const transformed = await llm.transformQuestionToQuery("show me cold");
// Returns: "cold"

// NEW (transformMultiModalQuery)
const classification = await llm.classifyQueryType("show me cold");
const multiModal = await llm.transformMultiModalQuery("show me cold", classification);
const transformed = multiModal.transformed;
// Returns: "cold" + full keyword breakdown
```

## Summary

The search system now uses a **2-step intent-based approach**:
1. Classify intent (spatial/temporal/audio/action)
2. Transform into modality-specific keywords

The old `transformQuestionToQuery` was a simple string transformation that didn't understand intent, so it's been replaced by the more sophisticated multi-modal approach.
