# Multi-Pass Caption Data: Search Strategy for Production

## Current Architecture

The app uses **hybrid search** combining:
1. **Vector similarity** (embeddings) - semantic understanding
2. **FTS (Full-Text Search)** - keyword matching
3. **Weighted fusion** - `score = α × vector_score + (1-α) × fts_score`

Default: `α = 0.7` (70% vector, 30% FTS)

## The Question

With multi-pass captioning, we now have:
- `caption` - Primary description
- `caption_spatial` - Spatial arrangement
- `caption_temporal` - Temporal/motion analysis
- `caption_elements` - Structured metadata (objects, people, colors, etc.)

**How should these be used together with vector embeddings for optimal search?**

## Recommended Strategy: Multi-Modal Hybrid Search

### Option 1: Enhanced FTS Index (Recommended for Production)

**Approach**: Concatenate all caption fields into FTS index

```sql
-- When storing multi-pass data
INSERT INTO transcripts_fts(segment_id, transcript) 
VALUES (?, 
  caption || ' ' || 
  COALESCE(caption_spatial, '') || ' ' || 
  COALESCE(caption_temporal, '')
);
```

**Pros**:
- ✅ Simple implementation
- ✅ Leverages existing hybrid search
- ✅ No query-time overhead
- ✅ Works with current architecture
- ✅ Scales to 1000s MB of media

**Cons**:
- ❌ Can't weight different caption types separately
- ❌ Increases FTS index size

**Best for**: General-purpose search where all caption data is equally important

---

### Option 2: Weighted Multi-Field Search (Advanced)

**Approach**: Create separate FTS indexes for each caption type, combine with weights

```typescript
async searchMultiPass(query: string, options: {
  limit: number;
  weights?: {
    vector: number;      // 0.5 - semantic similarity
    caption: number;     // 0.2 - primary description
    spatial: number;     // 0.15 - spatial keywords
    temporal: number;    // 0.1 - temporal keywords
    elements: number;    // 0.05 - structured metadata
  }
}) {
  const weights = options.weights || {
    vector: 0.5,
    caption: 0.2,
    spatial: 0.15,
    temporal: 0.1,
    elements: 0.05
  };

  // Generate embedding for vector search
  const embedding = await this.llm.generateEmbedding(query);
  
  // Parallel searches
  const [vecResults, captionResults, spatialResults, temporalResults] = 
    await Promise.all([
      this.searchVector(embedding, limit * 2),
      this.searchCaptionFTS(query, limit * 2),
      this.searchSpatialFTS(query, limit * 2),
      this.searchTemporalFTS(query, limit * 2)
    ]);
  
  // Merge with weighted scores
  const scoreMap = new Map<string, number>();
  
  for (const r of vecResults) {
    scoreMap.set(r.id, (scoreMap.get(r.id) || 0) + weights.vector * r.score);
  }
  for (const r of captionResults) {
    scoreMap.set(r.id, (scoreMap.get(r.id) || 0) + weights.caption * r.score);
  }
  for (const r of spatialResults) {
    scoreMap.set(r.id, (scoreMap.get(r.id) || 0) + weights.spatial * r.score);
  }
  for (const r of temporalResults) {
    scoreMap.set(r.id, (scoreMap.get(r.id) || 0) + weights.temporal * r.score);
  }
  
  // Sort by combined score
  return Array.from(scoreMap.entries())
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
```

**Pros**:
- ✅ Fine-grained control over relevance
- ✅ Can tune weights per query type
- ✅ Better for specialized searches (e.g., "find videos with people in foreground")

**Cons**:
- ❌ More complex implementation
- ❌ Higher query-time overhead (4-5 parallel searches)
- ❌ Requires separate FTS indexes

**Best for**: Advanced search features with query-type detection

---

### Option 3: Query-Adaptive Weighting (AI-Powered)

**Approach**: Use LLM to analyze query intent, adjust weights dynamically

```typescript
async searchAdaptive(query: string, limit: number) {
  // Analyze query intent
  const intent = await this.analyzeQueryIntent(query);
  // Examples:
  // "person walking" → high temporal weight
  // "red car in background" → high spatial + elements weight
  // "sunset scene" → high caption + elements weight
  
  // Adjust weights based on intent
  const weights = this.calculateWeights(intent);
  
  // Execute weighted search
  return this.searchMultiPass(query, { limit, weights });
}

private analyzeQueryIntent(query: string): QueryIntent {
  // Use llama3.2 to classify query
  const prompt = `Classify this search query:
Query: "${query}"

Does it focus on:
- SPATIAL: Location, position, arrangement (foreground/background/left/right)
- TEMPORAL: Motion, action, time, sequence
- OBJECTS: Specific things, people, colors
- GENERAL: Overall scene description

Return: SPATIAL, TEMPORAL, OBJECTS, or GENERAL`;

  // Parse response and return intent
}
```

**Pros**:
- ✅ Optimal relevance per query
- ✅ No manual weight tuning needed
- ✅ Handles diverse query types

**Cons**:
- ❌ Adds LLM call overhead (~50-100ms)
- ❌ Most complex implementation
- ❌ Requires careful prompt engineering

**Best for**: Premium search experience with AI-powered relevance

---

## Production Recommendation

### Phase 1: Enhanced FTS (Immediate)

**Implement Option 1** - concatenate all caption fields into FTS index.

**Implementation**:

```typescript
// In av-search-writer.ts
updateMultiPassCaption(data: {
  itemId: string;
  segmentId: string;
  mediaType: 'video' | 'audio';
  caption: string;
  elements?: any;
  spatial?: string;
  temporal?: string;
  tokens?: any;
}): void {
  // Update av_meta_cache
  this.db.prepare(`...`).run(...);
  
  // Update FTS with combined text
  const combinedText = [
    data.caption,
    data.spatial || '',
    data.temporal || '',
    // Optionally include structured elements as keywords
    data.elements ? this.elementsToKeywords(data.elements) : ''
  ].filter(Boolean).join(' ');
  
  this.updateTranscription(data.segmentId, combinedText);
}

private elementsToKeywords(elements: any): string {
  // Convert structured elements to searchable keywords
  return [
    ...elements.objects,
    ...elements.people,
    ...elements.colors,
    elements.lighting,
    elements.time,
    elements.setting,
    elements.mood
  ].filter(Boolean).join(' ');
}
```

**Why this first**:
- ✅ Minimal code changes
- ✅ Immediate benefit
- ✅ No performance impact
- ✅ Works with existing hybrid search

---

### Phase 2: Weighted Multi-Field (After Testing)

Once Phase 1 is validated with real usage data:

1. **Analyze query patterns** - What do users search for?
2. **Measure field importance** - Which fields contribute most to relevant results?
3. **Implement Option 2** - Separate FTS indexes with tuned weights

**Migration**:
```sql
-- Create separate FTS tables
CREATE VIRTUAL TABLE caption_fts USING fts5(segment_id, text, content='');
CREATE VIRTUAL TABLE spatial_fts USING fts5(segment_id, text, content='');
CREATE VIRTUAL TABLE temporal_fts USING fts5(segment_id, text, content='');
```

---

### Phase 3: AI-Adaptive (Future Enhancement)

After Phase 2 is stable and you have usage metrics:

1. **Collect query logs** - Understand query diversity
2. **Build intent classifier** - Train or prompt-engineer LLM
3. **Implement Option 3** - Dynamic weight adjustment

---

## Handling 1000s MB of Media

### Scalability Considerations

1. **Index Size**
   - FTS indexes grow with text volume
   - Multi-pass adds ~3x text (caption + spatial + temporal)
   - **Solution**: Use FTS5 with `content=''` (contentless) to save space

2. **Query Performance**
   - Hybrid search requires 2 queries (vector + FTS)
   - Multi-field adds more queries
   - **Solution**: 
     - Use Phase 1 (single FTS) initially
     - Add indexes on frequently queried fields
     - Consider query caching for common searches

3. **Vector Index Size**
   - Embeddings are fixed size (1024 dims × 4 bytes = 4KB per item)
   - 1000 MB media ≈ 100-1000 segments ≈ 400KB-4MB embeddings
   - **Solution**: sqlite-vec handles this efficiently

4. **Write Performance**
   - Multi-pass adds ~3x write operations
   - **Solution**: Use batch updates and transactions

### Recommended Limits

For optimal performance with 1000s MB:

```typescript
const PRODUCTION_LIMITS = {
  // Search
  maxSearchResults: 100,
  searchTimeout: 5000, // 5s
  
  // Indexing
  batchSize: 50, // segments per batch
  maxConcurrency: 4, // parallel workers
  
  // FTS
  ftsRankFunction: 'bm25', // Better than default
  ftsTokenizer: 'unicode61', // Good for most languages
  
  // Vector
  vectorDimensions: 1024, // BGE-large
  vectorMetric: 'L2', // Euclidean distance
  
  // Hybrid
  alpha: 0.7, // 70% vector, 30% FTS
  
  // Multi-pass
  enableSpatial: true,
  enableTemporal: true,
  enableElements: true
};
```

---

## Unbiased Evaluation Metrics

To measure search quality objectively:

### 1. Relevance Metrics

```typescript
interface SearchMetrics {
  // Precision: % of results that are relevant
  precision: number;
  
  // Recall: % of relevant items found
  recall: number;
  
  // F1 Score: Harmonic mean of precision and recall
  f1Score: number;
  
  // Mean Reciprocal Rank: Position of first relevant result
  mrr: number;
  
  // Normalized Discounted Cumulative Gain
  ndcg: number;
}
```

### 2. Performance Metrics

```typescript
interface PerformanceMetrics {
  // Query latency (p50, p95, p99)
  latencyMs: { p50: number; p95: number; p99: number };
  
  // Index size
  indexSizeMB: number;
  
  // Throughput (queries per second)
  qps: number;
  
  // Memory usage
  memoryMB: number;
}
```

### 3. A/B Testing Framework

```typescript
async compareSearchStrategies(queries: string[]) {
  const results = {
    baseline: [], // Current hybrid search
    enhanced: [], // With multi-pass FTS
    weighted: [], // Multi-field weighted
    adaptive: []  // AI-adaptive
  };
  
  for (const query of queries) {
    results.baseline.push(await this.searchBaseline(query));
    results.enhanced.push(await this.searchEnhanced(query));
    results.weighted.push(await this.searchWeighted(query));
    results.adaptive.push(await this.searchAdaptive(query));
  }
  
  // Calculate metrics for each strategy
  return {
    baseline: this.calculateMetrics(results.baseline),
    enhanced: this.calculateMetrics(results.enhanced),
    weighted: this.calculateMetrics(results.weighted),
    adaptive: this.calculateMetrics(results.adaptive)
  };
}
```

---

## Implementation Checklist

### Phase 1: Enhanced FTS (Week 1)

- [ ] Update `AVSearchWriter.updateMultiPassCaption()` to combine caption fields
- [ ] Add `elementsToKeywords()` helper method
- [ ] Update `ImageSearchWriter.updateMultiPassCaption()` similarly
- [ ] Test with sample queries
- [ ] Measure index size increase
- [ ] Benchmark query performance

### Phase 2: Metrics & Monitoring (Week 2)

- [ ] Add query logging
- [ ] Implement relevance metrics
- [ ] Create A/B testing framework
- [ ] Collect baseline metrics
- [ ] Analyze query patterns

### Phase 3: Optimization (Week 3-4)

- [ ] Tune FTS weights based on data
- [ ] Add query caching for common searches
- [ ] Optimize batch indexing
- [ ] Consider multi-field indexes if needed

---

## Conclusion

**For production with 1000s MB of media:**

1. **Start with Phase 1** (Enhanced FTS) - Simple, effective, scalable
2. **Measure everything** - Collect metrics before optimizing
3. **Iterate based on data** - Let usage patterns guide optimization
4. **Keep it simple** - Don't over-engineer until you have proof it's needed

The current hybrid search architecture is solid. Multi-pass caption data enhances it by providing richer text for FTS matching, which complements vector similarity perfectly.

**Key insight**: Vector embeddings capture semantic meaning, FTS captures specific keywords. Multi-pass captions give you more keywords (spatial, temporal, elements) without changing the semantic embedding. This is the right balance for production.

---

**Status**: Recommendation  
**Next Step**: Implement Phase 1 (Enhanced FTS)  
**Timeline**: 1 week for Phase 1, 2-3 weeks for full optimization
