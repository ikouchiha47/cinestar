# Query Cleaning and Keyword Expansion

## Overview

This feature implements Google-style query understanding to improve search quality by:
1. **Cleaning queries** for vector embeddings (removes noise, preserves semantics)
2. **Expanding keywords** for full-text search (adds synonyms, maximizes recall)
3. **Separating concerns** between semantic search and keyword matching

## The Problem

When users search with natural language like "search for images with cat jumping from wall", the noise words ("search for", "images with") pollute the vector embedding and reduce semantic search quality.

### Before (Old Approach)
```
User Query: "search for images with cat jumping from wall"
Vector Embedding: "search for images with cat jumping from wall"  ❌ Noise words included
FTS Query: "search for images with cat jumping from wall"          ❌ No synonym expansion
Result: Poor precision and recall
```

### After (New Approach)
```
User Query: "search for images with cat jumping from wall"
Cleaned Query: "cat jumping from wall"                             ✅ Clean semantic intent
Vector Embedding: "cat jumping from wall"                          ✅ Better semantic matching
FTS Query: "cat OR feline OR kitten OR jump OR leap OR wall"       ✅ Synonym expansion
Result: Better precision + recall
```

## How It Works

### 1. Query Cleaning (for Vector Embeddings)

The LLM removes command/noise words while preserving semantic relationships:

**Noise words removed:**
- "search for", "find", "show me", "get"
- "images with/of", "videos with/of", "pictures of"

**Examples:**
```typescript
"search for images with cat" → "cat"
"find pictures of cold weather" → "cold weather"
"show me videos with people dancing" → "people dancing"
"cat" → "cat"  // Single words stay as-is
```

### 2. Keyword Expansion (for FTS)

The LLM expands keywords with synonyms for better recall:

**Examples:**
```typescript
"cat" → ["cat", "feline", "kitten"]
"cold weather" → ["cold", "weather", "snow", "ice", "winter", "frost"]
"dancing" → ["dancing", "moving", "performing", "choreography"]
```

### 3. Search Strategy

```
┌─────────────────────────────────────────────────────────────┐
│ User Query: "search for images with cat jumping from wall" │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
                    ┌───────────────┐
                    │  LLM Analysis │
                    └───────────────┘
                            │
                ┌───────────┴───────────┐
                ▼                       ▼
    ┌──────────────────┐    ┌──────────────────────┐
    │  cleanedQuery    │    │  searchKeywords      │
    │  "cat jumping    │    │  ["cat", "feline",   │
    │   from wall"     │    │   "jump", "leap",    │
    │                  │    │   "wall", "brick"]   │
    └──────────────────┘    └──────────────────────┘
                │                       │
                ▼                       ▼
    ┌──────────────────┐    ┌──────────────────────┐
    │ Vector Embedding │    │   FTS Query          │
    │ (Semantic Search)│    │ (Keyword Matching)   │
    └──────────────────┘    └──────────────────────┘
                │                       │
                └───────────┬───────────┘
                            ▼
                    ┌───────────────┐
                    │ Hybrid Scoring│
                    └───────────────┘
                            │
                            ▼
                    ┌───────────────┐
                    │    Results    │
                    └───────────────┘
```

## API Changes

### MultiModalQuery Interface

```typescript
export interface MultiModalQuery {
  original: string;           // Original user query
  transformed: string;        // Simplified query (backward compatibility)
  cleanedQuery: string;       // NEW: Core semantic intent for embeddings
  classification: QueryClassification;
  searchKeywords: {
    text: string[];
    visual: string[];         // Expanded with synonyms
    audio: string[];
    temporal: string[];
    action: string[];         // Expanded with synonyms
  };
  embeddings: {
    text: string;
    visual?: string;
    audio?: string;
  };
  filters: {
    timeRange?: [number, number];
    confidenceThreshold?: number;
    mediaTypes?: ('video' | 'image' | 'audio')[];
  };
}
```

### Usage Example

```typescript
const provider = LLMProviderFactory.createProvider('ollama');
const result = await provider.classifyAndTransformQuery(
  "search for images with cat jumping from wall"
);

console.log(result.cleanedQuery);  // "cat jumping from wall"
console.log(result.searchKeywords.visual);  
// ["cat", "feline", "kitten", "jump", "jumping", "leap", "wall", "brick"]

// Use cleanedQuery for vector embedding
const embedding = await provider.generateEmbedding(result.cleanedQuery);

// Use expanded keywords for FTS
const ftsQuery = result.searchKeywords.visual.join(' OR ');
```

## Testing

Run the test suite:

```bash
npx ts-node tests/test-query-cleaning.ts
```

The test suite validates:
- ✅ Noise word removal
- ✅ Semantic preservation
- ✅ Keyword expansion
- ✅ Single-word handling
- ✅ Classification accuracy

## What Major Search Engines Do

This feature is inspired by Google's query understanding pipeline:

1. **Query Rewriting**: "cat pics" → "cat pictures"
2. **Spell Correction**: "cta" → "cat"
3. **Entity Recognition**: "Golden Gate Bridge" → [entity: landmark]
4. **Intent Classification**: navigational, informational, transactional
5. **Query Segmentation**: "new york pizza" → ["new york", "pizza"]
6. **Synonym Expansion**: "automobile" → "car", "vehicle"
7. **Stop Word Removal**: "the", "a", "of", "with", "for"

Our implementation focuses on **#7 (stop word removal)** and **#6 (synonym expansion)** as they provide the most value for our use case.

## Future Improvements

**High Priority:**
- [ ] Pass cleanedQuery separately to hybrid stores for embedding generation
- [ ] Add spell correction for common typos

**Medium Priority:**
- [ ] Implement query rewriting for common patterns
- [ ] Add entity recognition for landmarks, people, etc.

**Low Priority:**
- [ ] Query segmentation for complex multi-concept queries
- [ ] Context-aware synonym expansion based on user's media library

## Performance Impact

- **LLM Call**: Same as before (combined classification + transformation)
- **Embedding Generation**: Same as before (one embedding per query)
- **FTS Query**: Slightly larger due to keyword expansion (negligible impact)
- **Overall**: No performance degradation, improved result quality

## References

- [Google Search Quality Guidelines](https://static.googleusercontent.com/media/guidelines.raterhub.com/en//searchqualityevaluatorguidelines.pdf)
- [Query Understanding at Scale](https://research.google/pubs/pub46485/)
- [Semantic Search Best Practices](https://www.pinecone.io/learn/semantic-search/)
