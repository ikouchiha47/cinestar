# Memory: Cursor-Based Pagination Migration

**Date:** 2025-10-10  
**Status:** In Progress  
**Priority:** High

---

## Context

We are migrating from offset-based pagination (`getItems()`) to cursor-based pagination (`getRecentItems()`) throughout the application to improve performance and scalability.

### Why Cursor Pagination?

**Problems with Offset Pagination:**
- `SELECT COUNT(*) FROM media_items` - Full table scans on every request
- `LIMIT 50 OFFSET 10000` - Database scans 10,000 rows to skip them
- Performance degrades linearly with dataset size
- Inconsistent results when data changes during pagination

**Benefits of Cursor Pagination:**
- No COUNT() queries - Use `LIMIT + 1` approach
- Constant performance regardless of dataset size
- Consistent results even with concurrent updates
- Database uses indexes efficiently

---

## Implementation Status

### ✅ Backend Implementation (COMPLETE)

#### Database Layer (`src/core/sqlite-main-database.ts`)

**New Methods Added:**
```typescript
// Cursor-based pagination (RECOMMENDED)
async getMediaItemsPaginated(params: {
  cursor?: string;           // ISO timestamp cursor
  sourceIds?: string[];
  types?: string[];
  limit?: number;
  orderBy?: 'created_at' | 'modified_at' | 'name' | 'size';
  orderDirection?: 'ASC' | 'DESC';
}): Promise<{ 
  items: MediaItem[]; 
  nextCursor?: string;       // Cursor for next page
  hasMore: boolean           // More items available
}>

// Legacy offset pagination (DEPRECATED)
async getMediaItemsWithOffset(params: {
  offset?: number;
  limit?: number;
  sourceIds?: string[];
  types?: string[];
  orderBy?: 'created_at' | 'modified_at' | 'name' | 'size';
  orderDirection?: 'ASC' | 'DESC';
}): Promise<{ 
  items: MediaItem[]; 
  hasMore: boolean           // Uses LIMIT + 1 trick
}>

// Targeted video queries (NO MORE SELECT *)
async getMediaItemsByPath(path: string, type?: string): Promise<MediaItem[]>
```

**SQL Query Improvements:**
```sql
-- OLD (Terrible):
SELECT COUNT(*) FROM media_items WHERE source_id IN (?,?);
SELECT * FROM media_items WHERE source_id IN (?,?) LIMIT 50 OFFSET 10000;

-- NEW (Efficient):
SELECT * FROM media_items 
WHERE datetime(created_at) < ? 
  AND source_id IN (?,?)
ORDER BY created_at DESC 
LIMIT 51;  -- LIMIT + 1 to check hasMore
```

#### API Layer (`src/api/main-media-api.ts`)

**New Primary Method:**
```typescript
static async getRecentItems(params?: { 
  sourceIds?: string[]; 
  types?: Array<'image'|'video'|'audio'>; 
  limit?: number; 
  cursor?: string;                    // NEW: Cursor for pagination
  orderBy?: 'createdAt' | 'modifiedAt' | 'name' | 'size';
  orderDirection?: 'asc' | 'desc';
}): Promise<{ 
  success: boolean; 
  items?: any[]; 
  nextCursor?: string;                // NEW: Next page cursor
  hasMore?: boolean;                  // NEW: More items available
  error?: string 
}>
```

**Legacy Method (Deprecated):**
```typescript
static async getRecentItemsWithOffset(params?: { 
  sourceIds?: string[]; 
  types?: Array<'image'|'video'|'audio'>; 
  limit?: number; 
  offset?: number;
  orderBy?: 'createdAt' | 'modifiedAt' | 'name' | 'size';
  orderDirection?: 'asc' | 'desc';
}): Promise<{ 
  success: boolean; 
  items?: any[]; 
  hasMore?: boolean; 
  error?: string 
}>
```

**Backward Compatible Wrapper:**
```typescript
static async getItems(sourceId?: string): Promise<{ 
  success: boolean; 
  items?: any[]; 
  total?: number;        // Estimated for compatibility
  error?: string 
}> {
  // Internally uses getRecentItemsWithOffset
  // Returns estimated total for backward compatibility
}
```

---

### 🔄 Frontend Migration (IN PROGRESS)

#### Components Using `getItems()` (Need Migration)

**File:** `src/components/v2/DrillerV2.tsx`

**Current Usage Locations:**
1. **Line 75** - Initial library load
2. **Line 131** - Place counts calculation
3. **Line 173** - Sources and items parallel load
4. **Line 762** - Refresh after upload
5. **Line 865** - ExpandedVirtualOverlay initial load
6. **Line 929** - ExpandedVirtualOverlay pagination

**Migration Strategy:**

```typescript
// BEFORE (Offset-based):
const res = await window.mediaAPI.getItems(placeId);
// Returns: { success, items, total }

// AFTER (Cursor-based):
const res = await window.mediaAPI.getRecentItems({ 
  sourceIds: placeId ? [placeId] : undefined,
  limit: 50,
  cursor: undefined  // First page
});
// Returns: { success, items, nextCursor, hasMore }

// Load more:
const nextRes = await window.mediaAPI.getRecentItems({
  sourceIds: placeId ? [placeId] : undefined,
  limit: 50,
  cursor: res.nextCursor  // Use cursor from previous response
});
```

#### UI Pattern Changes

**Replace Total Count with "Load More":**
```typescript
// BEFORE:
const [total, setTotal] = useState(0);
<div>Showing {items.length} of {total}</div>

// AFTER:
const [hasMore, setHasMore] = useState(false);
const [nextCursor, setNextCursor] = useState<string | undefined>();
<div>Showing {items.length} {hasMore ? '(Load More)' : ''}</div>
```

**Infinite Scroll Implementation:**
```typescript
const loadMore = async () => {
  if (!hasMore || loading || !nextCursor) return;
  
  setLoading(true);
  const res = await window.mediaAPI.getRecentItems({
    sourceIds: placeId ? [placeId] : undefined,
    limit: 50,
    cursor: nextCursor
  });
  
  if (res.success && res.items) {
    setItems(prev => [...prev, ...res.items]);
    setNextCursor(res.nextCursor);
    setHasMore(res.hasMore);
  }
  setLoading(false);
};
```

---

## Video Processing Integration

### Targeted Video Queries

**File:** `src/core/video-job-processor.ts`

**BEFORE (Loads entire database):**
```typescript
const itemsResult = await MainMediaAPI.getItems('ALL');
const videos = itemsResult.items.filter(item => item.path === videoPath);
```

**AFTER (Targeted query):**
```typescript
const itemsResult = await MainMediaAPI.getVideosByPath(videoPath);
const videos = itemsResult.items;  // Already filtered by database
```

**Performance Impact:**
- Before: Load 100K+ items to find 1 video
- After: Load only matching videos with WHERE clause

---

## Migration Checklist

### Backend ✅
- [x] Add `getMediaItemsPaginated()` to database layer
- [x] Add `getMediaItemsWithOffset()` for backward compatibility
- [x] Add `getMediaItemsByPath()` for targeted queries
- [x] Update `MainMediaAPI.getRecentItems()` with cursor support
- [x] Keep `MainMediaAPI.getItems()` as backward-compatible wrapper
- [x] Update `video-job-processor.ts` to use targeted queries

### Frontend 🔄
- [ ] Update `DrillerV2.tsx` initial library load (line 75)
- [ ] Update place counts calculation (line 131)
- [ ] Update sources/items parallel load (line 173)
- [ ] Update post-upload refresh (line 762)
- [ ] Update `ExpandedVirtualOverlay` initial load (line 865)
- [ ] Update `ExpandedVirtualOverlay` pagination (line 929)
- [ ] Replace total count UI with "Load More" pattern
- [ ] Implement infinite scroll with cursor pagination
- [ ] Remove dependencies on `total` property

### Testing 🔄
- [ ] Test cursor pagination with large datasets
- [ ] Test backward compatibility of `getItems()`
- [ ] Test video processing with targeted queries
- [ ] Test infinite scroll behavior
- [ ] Performance benchmarks (before/after)

---

## Performance Metrics

### Expected Improvements

**Database Queries:**
- 50% fewer queries (no COUNT() calls)
- Constant performance regardless of dataset size
- Better index utilization

**Frontend:**
- Faster initial page loads
- Smoother infinite scroll
- No UI blocking on large datasets

**Video Processing:**
- 100x faster parent video lookup
- No more full table scans

---

## Files Modified

### Backend
- `src/core/sqlite-main-database.ts` - Added cursor pagination methods
- `src/api/main-media-api.ts` - Enhanced API with cursor support
- `src/types/global.d.ts` - Updated TypeScript definitions
- `src/core/video-job-processor.ts` - Updated to use targeted queries

### Frontend (Pending)
- `src/components/v2/DrillerV2.tsx` - Needs cursor pagination migration
- `src/components/v2/hooks/useMediaLibrary.ts` - May need updates
- `src/hooks/useMediaState.ts` - May need updates

---

## Next Steps

1. **Update DrillerV2.tsx** to use cursor-based pagination
2. **Implement infinite scroll** with `nextCursor` and `hasMore`
3. **Remove total count dependencies** from UI
4. **Test with large datasets** (100K+ items)
5. **Performance benchmarks** to validate improvements
6. **Update other components** that use `getItems()`

---

## Notes

- **Backward Compatibility:** `getItems()` still works but uses deprecated offset method
- **Gradual Migration:** Can migrate components one at a time
- **No Breaking Changes:** Existing code continues to work
- **Performance Critical:** Video processing already migrated to targeted queries

---

## Related ADRs

- ADR-004: Batch-Concurrent Processing Workflow
- ADR-005: Golang Scheduler with RPC (Future migration)

---

**Last Updated:** 2025-10-10 10:44 IST
