# ADR: Search Request Cancellation and Race Condition Prevention

## Status
Proposed

## Context

### Problem
The current search implementation has a critical race condition where multiple concurrent search requests compete for resources without proper cancellation. This leads to:

1. **Out-of-order results**: Slower searches complete after faster ones, showing stale results
2. **Resource waste**: Multiple searches run in parallel, competing for Ollama embedding generation
3. **Poor UX**: Users see results flickering as old searches complete
4. **Performance degradation**: Each search takes 3-9 seconds during concurrent execution

### Evidence from Logs
```
11061:[IPC-SEARCH] 🔍 Received search request: "sunset"
11326:[IPC-SEARCH] 🔍 Received search request: "sunset"  // 265ms later
12674:[IPC-SEARCH] 🔍 Received search request: "sunset"  // 1348ms later
13420:[IPC-SEARCH] 🔍 Received search request: "sunset"  // 746ms later

[SEARCH-TIMING] ✅ Semantic search completed in 9383ms  // First search
[SEARCH-TIMING] ✅ Semantic search completed in 6072ms  // Second search
[SEARCH-TIMING] ✅ Semantic search completed in 4656ms  // Third search
[SEARCH-TIMING] ✅ Semantic search completed in 3451ms  // Fourth search
```

All 4 searches for "sunset" ran concurrently, with the last one completing first (3.4s) and the first one completing last (9.3s).

### Current Implementation Issues

1. **No cancellation mechanism**: Previous searches continue running when new ones start
2. **No request tracking**: Can't identify which results belong to which search
3. **Debouncing alone insufficient**: Debouncing delays the request but doesn't cancel in-flight ones
4. **Async operations not abortable**: Ollama embedding generation can't be interrupted

## Decision

Implement a multi-layered search cancellation strategy:

### Layer 1: Request ID Tracking (Immediate)
- Assign unique ID to each search request
- Track "current search ID" in UI state
- Ignore results from stale searches

### Layer 2: AbortController for IPC (Medium-term)
- Use AbortController to cancel IPC requests
- Cancel previous search when new one starts
- Propagate cancellation to backend

### Layer 3: Backend Cancellation (Long-term)
- Implement cancellable Ollama requests
- Track active search operations
- Clean up resources when cancelled

## Implementation Plan

### Phase 1: Frontend Request Tracking (Immediate Fix)

**Goal**: Prevent stale results from displaying

**Changes to `DrillerV2.tsx`**:
```typescript
// Add state for tracking current search
const [currentSearchId, setCurrentSearchId] = useState<string | null>(null);

// Modify search handler
const handleSearch = async (query: string) => {
  const searchId = `search_${Date.now()}_${Math.random()}`;
  setCurrentSearchId(searchId);
  setSearching(true);
  
  try {
    const result = await window.mediaAPI.unifiedSearch(query, {
      types: ['image', 'video', 'audio'],
      limit: 40,
      offset: 0
    });
    
    // Only update UI if this is still the current search
    if (currentSearchId === searchId) {
      setSearchResults(result.results);
    } else {
      console.log(`[SEARCH-CANCEL] Ignoring stale results for search ${searchId}`);
    }
  } finally {
    // Only clear searching state if this is still the current search
    if (currentSearchId === searchId) {
      setSearching(false);
    }
  }
};
```

**Benefits**:
- ✅ Immediate fix with minimal code changes
- ✅ Prevents UI flickering from stale results
- ✅ No backend changes required
- ❌ Doesn't save resources (searches still run)

### Phase 2: IPC Cancellation (Medium-term)

**Goal**: Cancel in-flight IPC requests

**Changes to `electron/main.ts`**:
```typescript
// Track active searches
const activeSearches = new Map<string, AbortController>();

ipcMain.handle('search:unified', async (event, { query, searchId, ...options }) => {
  // Cancel previous search if exists
  const prevController = activeSearches.get('current');
  if (prevController) {
    prevController.abort();
    console.log('[SEARCH-CANCEL] Cancelled previous search');
  }
  
  // Create new abort controller
  const controller = new AbortController();
  activeSearches.set('current', controller);
  
  try {
    const result = await mainMediaAPI.unifiedSearch(query, {
      ...options,
      signal: controller.signal
    });
    return result;
  } catch (error) {
    if (error.name === 'AbortError') {
      console.log('[SEARCH-CANCEL] Search aborted');
      return { success: false, cancelled: true };
    }
    throw error;
  } finally {
    activeSearches.delete('current');
  }
});
```

**Changes to `main-media-api.ts`**:
```typescript
async unifiedSearch(
  query: string, 
  options: SearchOptions & { signal?: AbortSignal }
): Promise<SearchResult> {
  const { signal } = options;
  
  // Check cancellation before expensive operations
  if (signal?.aborted) {
    throw new Error('Search cancelled');
  }
  
  // Generate embedding with cancellation support
  const embedding = await this.embeddingService.generateEmbedding(query, {
    signal
  });
  
  if (signal?.aborted) {
    throw new Error('Search cancelled');
  }
  
  // Perform search
  const results = await this.vectorDb.search(embedding, options);
  
  return results;
}
```

**Benefits**:
- ✅ Saves resources by cancelling IPC calls
- ✅ Prevents unnecessary database queries
- ❌ Ollama requests still complete (can't be cancelled mid-flight)

### Phase 3: Backend Operation Cancellation (Long-term)

**Goal**: Cancel expensive backend operations

**Challenges**:
1. Ollama HTTP requests can't be cancelled mid-generation
2. Database queries are synchronous (sqlite3)
3. Need to check cancellation between operations

**Approach**:
```typescript
class EmbeddingService {
  async generateEmbedding(
    text: string, 
    options: { signal?: AbortSignal }
  ): Promise<number[]> {
    const { signal } = options;
    
    // Check cache first (fast path)
    const cached = this.cache.get(text);
    if (cached) return cached;
    
    if (signal?.aborted) {
      throw new Error('Cancelled before Ollama request');
    }
    
    // Make Ollama request (can't cancel mid-flight)
    // But we can avoid starting if already cancelled
    const embedding = await this.ollamaClient.embed(text);
    
    if (signal?.aborted) {
      // Don't cache or return - operation was cancelled
      throw new Error('Cancelled after Ollama request');
    }
    
    this.cache.set(text, embedding);
    return embedding;
  }
}
```

**Benefits**:
- ✅ Prevents starting new expensive operations
- ✅ Avoids caching results from cancelled searches
- ❌ Can't interrupt Ollama mid-generation

## Alternative Considered: Request Coalescing

Instead of cancellation, coalesce multiple identical requests:

```typescript
const pendingSearches = new Map<string, Promise<SearchResult>>();

async function search(query: string): Promise<SearchResult> {
  // If same query is already in flight, return that promise
  if (pendingSearches.has(query)) {
    return pendingSearches.get(query)!;
  }
  
  const promise = performSearch(query);
  pendingSearches.set(query, promise);
  
  try {
    return await promise;
  } finally {
    pendingSearches.delete(query);
  }
}
```

**Rejected because**:
- Doesn't solve the "typing fast" problem (each character is a different query)
- Adds complexity without addressing root cause
- Still wastes resources on outdated searches

## Consequences

### Positive
- ✅ **Better UX**: No flickering from stale results
- ✅ **Resource efficiency**: Cancelled searches don't waste CPU/GPU
- ✅ **Faster searches**: No competition for Ollama resources
- ✅ **Predictable behavior**: Latest search always wins

### Negative
- ❌ **Code complexity**: Need to track search IDs and handle cancellation
- ❌ **Testing complexity**: Need to test race conditions and cancellation
- ❌ **Partial solution**: Can't cancel Ollama mid-generation (HTTP limitation)

### Neutral
- ⚠️ **Debouncing still needed**: Cancellation complements but doesn't replace debouncing
- ⚠️ **Error handling**: Need to distinguish between real errors and cancellations

## Implementation Priority

### Phase 1 (Immediate - 30 min)
- ✅ Add search ID tracking to frontend
- ✅ Ignore stale results in UI
- ✅ Add logging for cancelled searches

### Phase 2 (This week - 2 hours)
- ⏳ Add AbortController to IPC layer
- ⏳ Propagate cancellation to backend
- ⏳ Add cancellation checks in search pipeline

### Phase 3 (Future - 4 hours)
- ⏳ Implement cancellable embedding generation
- ⏳ Add cancellation to all expensive operations
- ⏳ Optimize for early cancellation detection

## Monitoring

Add metrics to track:
- Number of cancelled searches
- Time saved by cancellation
- Frequency of race conditions
- Search completion order vs start order

**Log format**:
```
[SEARCH-CANCEL] Search ${searchId} cancelled (age: ${age}ms)
[SEARCH-CANCEL] Ignoring stale results for search ${searchId}
[SEARCH-TIMING] Search ${searchId} completed in ${duration}ms (cancelled: ${wasCancelled})
```

## Related Issues

- **Ollama queuing**: Separate Ollama instances for search vs indexing (already implemented)
- **Debouncing**: 300ms debounce on search input (already implemented)
- **Search performance**: Embedding generation takes 500-1000ms (acceptable)

## References

- [AbortController MDN](https://developer.mozilla.org/en-US/docs/Web/API/AbortController)
- [Electron IPC Best Practices](https://www.electronjs.org/docs/latest/tutorial/ipc)
- Memory: IPC_EVENT_DEBUGGING_SESSION.md
- Memory: MEMORY[53411ce8-679e-422e-9189-be1b36615055] (Ollama instance separation)

## Tags
#search #race-condition #cancellation #performance #ux #async
