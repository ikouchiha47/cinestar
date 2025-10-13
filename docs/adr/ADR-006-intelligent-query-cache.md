# ADR-006: Intelligent Query Cache with Semantic Similarity

**Status:** Proposed  
**Date:** 2025-10-12  
**Decision Makers:** Engineering Team  
**Related:** ADR-002 (Enhanced Search), Hybrid Search Implementation

---

## Context

The current search system performs well but has opportunities for optimization:

### Current Search Flow
```
User Query → Query Classification → Embedding Generation → Vector Search + FTS → Hybrid Ranking → Results
                                      ↓ 500-1000ms        ↓ 7-50ms        ↓ ~100ms
```

### Problems:
1. **Repeated embedding generation** - Same/similar queries regenerate embeddings (500-1000ms overhead)
2. **No query deduplication** - "romantic scene" vs "romantic scenes" both generate new embeddings
3. **Cold start penalty** - First search after app launch is always slow
4. **Resource waste** - Popular queries (e.g., "presentation", "meeting") recomputed constantly
5. **No learning** - System doesn't benefit from query patterns over time

### Observed Patterns:
- **Query repetition:** Users often search same terms multiple times (e.g., refining results)
- **Query similarity:** "cat playing" vs "cat is playing" should share cache
- **Temporal locality:** Recent queries likely to be repeated within session
- **Popular queries:** Certain queries (project names, common terms) searched frequently

---

## Decision

**Implement a semantic query cache using SQLite with embedding-based similarity matching.**

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         Search Request                          │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│                    Query Cache Layer (NEW)                      │
│                                                                 │
│  1. Normalize query (lowercase, trim, stemming)                │
│  2. Check exact match cache (O(1) lookup)                      │
│  3. If miss: Generate query embedding                          │
│  4. Check semantic similarity cache (vector search)            │
│  5. If similarity > threshold: Return cached results           │
│  6. If miss: Execute full search pipeline                      │
│  7. Cache results with TTL and metadata                        │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│                   Full Search Pipeline                          │
│         (Only executed on cache miss)                           │
└─────────────────────────────────────────────────────────────────┘
```

### Database Schema: `query-cache.db`

```sql
-- Exact query cache (fast O(1) lookup)
CREATE TABLE query_cache (
  id TEXT PRIMARY KEY,
  normalized_query TEXT NOT NULL UNIQUE,
  original_query TEXT NOT NULL,
  query_type TEXT, -- spatial, temporal, audio, action, mixed
  query_embedding BLOB, -- 1024D float32 array
  result_ids TEXT, -- JSON array of result IDs
  result_count INTEGER,
  result_metadata TEXT, -- JSON: types, scores, etc.
  hit_count INTEGER DEFAULT 1,
  last_hit_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME, -- TTL-based expiration
  INDEX idx_normalized (normalized_query),
  INDEX idx_expires (expires_at)
);

-- Semantic similarity cache (embedding-based)
CREATE VIRTUAL TABLE query_embeddings USING vec0(
  query_id TEXT PRIMARY KEY,
  embedding FLOAT[1024]
);

-- Cache statistics for monitoring
CREATE TABLE cache_stats (
  date TEXT PRIMARY KEY, -- YYYY-MM-DD
  total_queries INTEGER DEFAULT 0,
  cache_hits INTEGER DEFAULT 0,
  cache_misses INTEGER DEFAULT 0,
  avg_hit_latency_ms REAL,
  avg_miss_latency_ms REAL,
  popular_queries TEXT -- JSON: top 10 queries
);

-- Query patterns for learning
CREATE TABLE query_patterns (
  pattern_id TEXT PRIMARY KEY,
  pattern_type TEXT, -- session_repeat, similar_queries, temporal_cluster
  query_ids TEXT, -- JSON array of related query IDs
  frequency INTEGER,
  last_seen_at DATETIME,
  metadata TEXT -- JSON: additional pattern info
);
```

---

## Implementation Strategy

### Phase 1: Exact Match Cache (Week 1)
**Goal:** Eliminate redundant work for identical queries

```typescript
class QueryCache {
  private db: Database; // query-cache.db
  
  async get(query: string): Promise<CachedResult | null> {
    const normalized = this.normalize(query);
    
    // Check exact match
    const cached = await this.db.get(
      'SELECT * FROM query_cache WHERE normalized_query = ? AND expires_at > datetime("now")',
      normalized
    );
    
    if (cached) {
      // Update hit stats
      await this.db.run(
        'UPDATE query_cache SET hit_count = hit_count + 1, last_hit_at = datetime("now") WHERE id = ?',
        cached.id
      );
      
      return this.hydrateCachedResult(cached);
    }
    
    return null;
  }
  
  private normalize(query: string): string {
    return query.toLowerCase().trim().replace(/\s+/g, ' ');
  }
}
```

**Benefits:**
- ✅ Zero-cost cache hits (no embedding generation)
- ✅ Instant results for repeated queries
- ✅ Simple implementation

**Metrics:**
- Expected hit rate: 20-30% (based on query repetition patterns)
- Latency reduction: 500-1000ms → <5ms

### Phase 2: Semantic Similarity Cache (Week 2-3)
**Goal:** Cache hits for similar queries

```typescript
async getSemanticMatch(
  query: string, 
  queryEmbedding: Float32Array
): Promise<CachedResult | null> {
  // Search for similar cached queries
  const similar = await this.db.all(`
    SELECT 
      qc.*, 
      distance
    FROM query_embeddings qe
    JOIN query_cache qc ON qe.query_id = qc.id
    WHERE qe.embedding MATCH ?
      AND k = 10
      AND qc.expires_at > datetime("now")
    ORDER BY distance ASC
    LIMIT 1
  `, serializeEmbedding(queryEmbedding));
  
  if (similar.length > 0) {
    const similarity = distanceToSimilarity(similar[0].distance);
    
    // Threshold: 0.95+ similarity = cache hit
    if (similarity >= 0.95) {
      console.log(`[CACHE] Semantic hit: "${query}" → "${similar[0].original_query}" (${similarity.toFixed(3)})`);
      return this.hydrateCachedResult(similar[0]);
    }
  }
  
  return null;
}
```

**Benefits:**
- ✅ Handles query variations ("cat playing" = "cat is playing")
- ✅ Reduces embedding generation for similar queries
- ✅ Learns from query patterns

**Metrics:**
- Expected additional hit rate: 15-25%
- Combined hit rate: 35-55%

### Phase 3: Intelligent Cache Management (Week 4)
**Goal:** Optimize cache size and freshness

#### TTL Strategy
```typescript
function calculateTTL(query: string, metadata: QueryMetadata): number {
  const baselineTTL = 3600; // 1 hour
  
  // Longer TTL for popular queries
  if (metadata.hitCount > 10) {
    return baselineTTL * 24; // 24 hours
  }
  
  // Shorter TTL for temporal queries (results change over time)
  if (metadata.queryType === 'temporal') {
    return baselineTTL / 2; // 30 minutes
  }
  
  // Medium TTL for spatial/audio queries
  return baselineTTL;
}
```

#### Eviction Policy
```typescript
async evictStaleEntries(): Promise<void> {
  // Remove expired entries
  await this.db.run('DELETE FROM query_cache WHERE expires_at < datetime("now")');
  
  // LRU eviction if cache size > threshold
  const cacheSize = await this.db.get('SELECT COUNT(*) as count FROM query_cache');
  
  if (cacheSize.count > 10000) {
    // Keep top 8000 by hit_count and recency
    await this.db.run(`
      DELETE FROM query_cache
      WHERE id NOT IN (
        SELECT id FROM query_cache
        ORDER BY hit_count * (julianday('now') - julianday(last_hit_at)) DESC
        LIMIT 8000
      )
    `);
  }
}
```

#### Cache Warming
```typescript
async warmCache(popularQueries: string[]): Promise<void> {
  // Pre-populate cache with common queries on app start
  for (const query of popularQueries) {
    if (!(await this.get(query))) {
      const results = await this.searchService.search(query);
      await this.set(query, results);
    }
  }
}
```

---

## Performance Impact

### Before (No Cache)
```
Query: "presentation about technology"
├── Normalize & classify: 50ms
├── Generate embedding: 800ms ← EXPENSIVE
├── Vector search: 30ms
├── FTS search: 20ms
├── Hybrid ranking: 50ms
└── Total: ~950ms
```

### After (Cache Hit - Exact)
```
Query: "presentation about technology"
├── Normalize: 1ms
├── Exact cache lookup: 2ms ← FAST
└── Total: ~3ms (317× faster)
```

### After (Cache Hit - Semantic)
```
Query: "presentation on technology" (similar)
├── Normalize: 1ms
├── Exact cache miss: 2ms
├── Generate embedding: 800ms (still needed for similarity check)
├── Semantic cache lookup: 5ms
└── Total: ~808ms (saves vector + FTS + ranking)
```

### Expected Performance Gains
- **Exact cache hits:** 95-99% latency reduction (950ms → 3ms)
- **Semantic cache hits:** 15-20% latency reduction (950ms → 808ms)
- **Overall average:** 35-55% hit rate → 300-500ms average latency reduction
- **Cold start:** Pre-warmed cache eliminates first-query penalty

---

## Cache Invalidation Strategy

### Triggers for Invalidation
1. **Media library changes:**
   - New videos/images indexed → Invalidate affected queries
   - Media deleted → Invalidate queries that returned those items

2. **Processing completion:**
   - Video Phase 1 complete → Invalidate queries that might now match better
   - Refinement passes complete → Invalidate related queries

3. **Manual invalidation:**
   - User-triggered cache clear
   - Settings changes (embedding model, search parameters)

### Implementation
```typescript
async invalidateByMediaId(mediaId: string): Promise<void> {
  // Find cached queries that returned this media item
  const affected = await this.db.all(`
    SELECT id FROM query_cache
    WHERE result_ids LIKE '%"${mediaId}"%'
  `);
  
  // Delete affected cache entries
  for (const entry of affected) {
    await this.delete(entry.id);
  }
}

async invalidateByQueryType(queryType: string): Promise<void> {
  // Invalidate all queries of a specific type
  await this.db.run('DELETE FROM query_cache WHERE query_type = ?', queryType);
}
```

---

## Monitoring & Analytics

### Key Metrics
```typescript
interface CacheMetrics {
  hitRate: number; // cache_hits / total_queries
  avgHitLatency: number; // ms
  avgMissLatency: number; // ms
  cacheSize: number; // number of entries
  popularQueries: Array<{ query: string; hitCount: number }>;
  semanticHitRate: number; // semantic_hits / total_hits
}
```

### Dashboard
```
Cache Performance (Last 24h)
├── Hit Rate: 42% (1,234 hits / 2,940 queries)
├── Avg Latency: 320ms (vs 950ms without cache)
├── Cache Size: 3,456 entries (34% of max)
├── Top Queries:
│   1. "presentation" (234 hits)
│   2. "meeting notes" (187 hits)
│   3. "project demo" (156 hits)
└── Semantic Matches: 18% of hits
```

---

## Risks & Mitigations

### Risk 1: Stale Results
**Problem:** Cached results may not reflect latest media library state

**Mitigation:**
- TTL-based expiration (1-24 hours based on query type)
- Invalidation on media changes
- Cache version tracking (invalidate all on schema changes)

### Risk 2: Memory Overhead
**Problem:** Cache database grows unbounded

**Mitigation:**
- Max cache size: 10,000 entries (~50MB)
- LRU eviction policy
- Periodic cleanup of low-hit entries

### Risk 3: Cache Poisoning
**Problem:** Bad results cached and served repeatedly

**Mitigation:**
- User feedback: "Report incorrect results" → invalidate cache entry
- Quality scoring: Low-quality results (few matches) get shorter TTL
- Manual cache inspection tools

---

## Success Metrics

### Phase 1 (Exact Match)
- ✅ 20-30% hit rate
- ✅ <5ms latency for cache hits
- ✅ Zero false positives

### Phase 2 (Semantic Similarity)
- ✅ 35-55% combined hit rate
- ✅ >0.95 similarity threshold (no false positives)
- ✅ 15-20% latency reduction on semantic hits

### Phase 3 (Intelligent Management)
- ✅ <50MB cache size
- ✅ <1% stale result rate
- ✅ 300-500ms average latency reduction

---

## Implementation Timeline

**Week 1:** Exact match cache + basic TTL
**Week 2:** Semantic similarity cache + embedding storage
**Week 3:** Cache invalidation + monitoring
**Week 4:** Intelligent eviction + cache warming
**Week 5:** Testing + performance tuning
**Week 6:** Production rollout + analytics

---

## Future Enhancements

### Query Pattern Learning
- Detect common query sequences (e.g., "presentation" → "presentation 2024")
- Pre-fetch likely next queries
- Suggest query refinements based on patterns

### Distributed Cache
- Share cache across multiple app instances
- Sync popular queries to cloud (optional, privacy-preserving)
- Collaborative filtering for query suggestions

### Adaptive TTL
- Machine learning model to predict optimal TTL per query
- Based on: query type, hit frequency, result stability, user behavior

---

## Conclusion

Implementing an intelligent query cache will significantly improve search performance while maintaining result freshness. The embedding-based semantic matching ensures cache hits even for query variations, maximizing the benefit of cached results. Combined with smart invalidation and eviction policies, this system will provide a responsive search experience that learns from usage patterns over time.

**Expected Impact:**
- 35-55% cache hit rate
- 300-500ms average latency reduction
- Better user experience with instant results for common queries
- Foundation for future query intelligence features
