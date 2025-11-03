# Search Limit Optimization

## Problem
Search was fetching way too many candidates:
- Frontend: `limit: 40`
- Backend: `40 × 3 types = 120`
- Image search: `120 × 3 = 360` vector candidates

This was wasteful since:
1. Only 43 images exist in the database
2. Cursor pagination exists for loading more results
3. Initial load doesn't need 40 results per type

## Root Cause
Hardcoded `limit: 40` in the frontend search calls:
```typescript
// src/components/v2/DrillerV2.tsx
const res = await (window.mediaAPI as any).unifiedSearch(query, { limit: 40, offset: 0 });
```

## Fixes Applied

### Fix 1: Reduced Frontend Limit (40 → 10)
```diff
- const res = await (window.mediaAPI as any).unifiedSearch(query, { limit: 40, offset: 0 });
+ const res = await (window.mediaAPI as any).unifiedSearch(query, { limit: 10, offset: 0 });
```

**Impact:**
- Frontend: `limit: 10`
- Backend: `10 × 3 types = 30`
- Image search: `30 × 3 = 90` candidates (was 360)

### Fix 2: Capped Candidate Multiplier (image-modality-vec-database.ts)
```diff
- const candidateK = Math.min(limit * 3, 1000);
+ const candidateK = Math.min(Math.max(limit * 3, 30), 100);
```

**Impact:**
- Minimum 30 candidates (for small limits)
- Maximum 100 candidates (prevents excessive fetching)
- For limit=30: candidateK = 90 (was 90, same)
- For limit=120: candidateK = 100 (was 360, much better!)

## New Flow

### Initial Search
1. User searches for "cold"
2. Frontend requests `limit: 10`
3. Backend calculates `searchLimit = 10 × 3 = 30`
4. Image search fetches `candidateK = 90` vector candidates
5. Returns top 10 results per type

### Pagination
1. User scrolls down
2. Frontend requests more with cursor
3. Backend fetches next batch
4. Seamless infinite scroll

## Benefits

1. **Faster Initial Search**: 75% fewer candidates (360 → 90)
2. **Lower Memory Usage**: Smaller result sets
3. **Better UX**: Quick initial results, load more on demand
4. **Cursor Pagination**: Already implemented, now properly utilized

## Configuration

Current settings after fixes:
```typescript
// Frontend
limit: 10  // Initial results per type

// Backend
searchLimit = limit × types.length  // 10 × 3 = 30

// Image Search
candidateK = min(max(searchLimit × 3, 30), 100)  // 90 candidates
```

## Testing

1. Search for "cold"
2. Should see ~10 results quickly
3. Scroll down to trigger pagination
4. More results load seamlessly
5. Check logs:
   - `limit=10` (not 40)
   - `searchLimit=30` (not 120)
   - `candidateK=90` (not 360)

---

**Status**: Fixed  
**Impact**: 75% reduction in candidate fetching  
**Next**: Test search performance improvement
