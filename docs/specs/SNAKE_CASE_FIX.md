# Snake Case vs Camel Case Fix

## Date: Nov 1, 2025 3:47am

## Issue Found in Logs

```
[PERSISTENCE] Parent video found by path: 0a1daef2-7198-5698-12c7-55b9302778b1, sourceId: undefined
[PERSISTENCE] Failed to store segment: Error: Cannot write segment to media.db: parentSourceId is missing
```

## Root Cause

**Database returns snake_case, code expects camelCase:**

```sql
-- Database column name
SELECT id, source_id, type, path FROM media_items
```

```typescript
// Code tries to access camelCase
const sourceId = parentVideo.sourceId;  // ❌ undefined
```

**Actual database value:**
```sql
sqlite> SELECT id, source_id FROM media_items WHERE id = '0a1daef2-7198-5698-12c7-55b9302778b1';
0a1daef2-7198-5698-12c7-55b9302778b1|fb50e0ac-ecf8-cf25-c6f1-15ac6274bbcc
                                     ↑ source_id EXISTS!
```

## The Problem

`CanonicalMediaDatabase.getMediaItemsByPath()` returns raw database rows:

```typescript
getMediaItemsByPath(searchPath: string): any[] {
  return this.db.prepare(`
    SELECT id, source_id, type, path, ...
    FROM media_items
    WHERE path = ?
  `).all(searchPath) as any[];  // Returns { source_id: "...", ... }
}
```

But the code accesses it as camelCase:

```typescript
const parentVideo = items.find(item => item.type === 'video');
const sourceId = parentVideo.sourceId;  // ❌ undefined (should be source_id)
```

## The Fix

Handle both snake_case and camelCase:

```typescript
// Database returns snake_case (source_id), need to handle both cases
const sourceId = (parentVideo as any).source_id || parentVideo.sourceId;
console.log(`[PERSISTENCE] Parent video found by path: ${parentVideo.id}, sourceId: ${sourceId}`);
return { id: parentVideo.id, sourceId: sourceId };
```

## Why This Happened

Different parts of the codebase use different conventions:

1. **Database schema**: Uses `snake_case` (SQL convention)
   - `source_id`, `created_at`, `modified_at`

2. **TypeScript interfaces**: Use `camelCase` (JS convention)
   - `sourceId`, `createdAt`, `modifiedAt`

3. **Some methods map**: Convert snake_case → camelCase
   - `SqliteMainDatabase.getMediaItemsByPath()` does mapping
   - `CanonicalMediaDatabase.getMediaItemsByPath()` does NOT

## Files Modified

**`src/core/video-processing/VideoPersistenceService.ts`** - Line 205:
```typescript
// Before
const sourceId = parentVideo.sourceId;  // ❌ Always undefined

// After  
const sourceId = (parentVideo as any).source_id || parentVideo.sourceId;  // ✅ Works with both
```

## Better Long-Term Solution

The `CanonicalMediaDatabase.getMediaItemsByPath()` method should map column names:

```typescript
getMediaItemsByPath(searchPath: string, exactMatch: boolean = true): MediaItem[] {
  const rows = this.db.prepare(`
    SELECT id, source_id, type, path, size, mime, created_at, modified_at,
           duration_ms, width, height, status
    FROM media_items
    WHERE path = ?
  `).all(searchPath) as any[];
  
  // Map snake_case to camelCase
  return rows.map(row => ({
    id: row.id,
    sourceId: row.source_id,      // ✅ Map to camelCase
    type: row.type,
    path: row.path,
    size: row.size,
    mimeType: row.mime,
    createdAt: row.created_at,    // ✅ Map to camelCase
    modifiedAt: row.modified_at,  // ✅ Map to camelCase
    durationMs: row.duration_ms,  // ✅ Map to camelCase
    width: row.width,
    height: row.height,
    status: row.status
  }));
}
```

But for now, the quick fix handles both cases.

## Expected Result

After rebuild:
```
[PERSISTENCE] Parent video found by path: 0a1daef2-..., sourceId: fb50e0ac-ecf8-cf25-c6f1-15ac6274bbcc
[PERSISTENCE] Storing segment 59899e15-...
[AV-SEARCH-WRITER] 📝 updateTranscription called: segmentId=59899e15-..., transcription length=13613
[AV-SEARCH-WRITER] ✅ Transcription written to FTS
[PERSISTENCE] ✅ Stored segment 59899e15-...
```

## Next Steps

1. **Rebuild**: `npm run build`
2. **Restart app**
3. **Verify logs** show valid sourceId
4. **Check databases**:
   ```bash
   sqlite3 data/av_search.db "SELECT COUNT(*) FROM transcripts_fts;"  # Should be > 0
   ```

## Lesson Learned

When working with raw SQL queries that return `any[]`, always check:
- ✅ Database column names (snake_case)
- ✅ TypeScript interface names (camelCase)  
- ✅ Whether mapping is needed

Or better: Always map database results to proper TypeScript types.
