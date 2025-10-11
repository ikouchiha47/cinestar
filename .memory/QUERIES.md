# Media Database Queries

**Database:** `~/.clipwise/main.db`  
**Schema:** See `./memory/schema.sql`

---

## Schema

```sql
-- Core tables
media_items (id, source_id, name, path, type, mime_type, created_at, modified_at, caption, embedding, metadata)
media_sources (id, name, type, path, enabled, config, created_at, last_indexed)
indexing_jobs (id, source_id, status, progress, total_items, processed_items, started_at, completed_at, error)

-- Key indexes
idx_media_items_created_at ON media_items(datetime(created_at) DESC)
idx_media_items_source_id ON media_items(source_id)
idx_media_items_mime_type ON media_items(mime_type)
```

---

## Queries

### GetRecentItems

**Purpose:** Get most recent media items (cursor-based pagination)

```sql
SELECT * FROM media_items 
ORDER BY datetime(created_at) DESC 
LIMIT 51;  -- LIMIT + 1 to check hasMore
```

### GetRecentItemsWithCursor

**Purpose:** Get next page using cursor

```sql
SELECT * FROM media_items 
WHERE datetime(created_at) < datetime(?)  -- cursor from previous page
ORDER BY datetime(created_at) DESC 
LIMIT 51;
```

### GetRecentItemsBySource

**Purpose:** Filter items by source with cursor pagination

```sql
SELECT * FROM media_items 
WHERE source_id = ?
  AND datetime(created_at) < datetime(?)  -- cursor (optional)
ORDER BY datetime(created_at) DESC 
LIMIT 51;
```

### GetRecentItemsByType

**Purpose:** Filter items by media type (video/audio/image)

```sql
-- For videos
SELECT * FROM media_items 
WHERE mime_type LIKE 'video/%'
  AND datetime(created_at) < datetime(?)  -- cursor (optional)
ORDER BY datetime(created_at) DESC 
LIMIT 51;

-- For audio
SELECT * FROM media_items 
WHERE mime_type LIKE 'audio/%'
  AND datetime(created_at) < datetime(?)
ORDER BY datetime(created_at) DESC 
LIMIT 51;

-- For images
SELECT * FROM media_items 
WHERE (mime_type LIKE 'image/%' OR mime_type IS NULL OR mime_type = '')
  AND datetime(created_at) < datetime(?)
ORDER BY datetime(created_at) DESC 
LIMIT 51;
```

### GetRecentItemsBySourceAndType

**Purpose:** Combined filter (source + type + cursor)

```sql
SELECT * FROM media_items 
WHERE source_id IN (?, ?, ?)  -- multiple sources
  AND mime_type LIKE 'video/%'
  AND datetime(created_at) < datetime(?)  -- cursor
ORDER BY datetime(created_at) DESC 
LIMIT 51;
```

### GetVideosByPath

**Purpose:** Find specific video by path (for video processing)

```sql
SELECT * FROM media_items 
WHERE path = ? 
  AND type = 'video'
ORDER BY datetime(created_at) DESC
LIMIT 10;
```

### GetMediaItemsByPath

**Purpose:** Find all media items at a specific path

```sql
SELECT * FROM media_items 
WHERE path = ?
ORDER BY datetime(created_at) DESC;
```

### GetSources

**Purpose:** Get all media sources

```sql
SELECT * FROM media_sources 
ORDER BY datetime(created_at) DESC;
```

### GetSourceByPath

**Purpose:** Check if source exists for a path

```sql
SELECT id FROM media_sources 
WHERE path = ?;
```

### GetActiveJobs

**Purpose:** Get currently running indexing jobs

```sql
SELECT * FROM indexing_jobs 
WHERE status IN ('running', 'pending')
ORDER BY datetime(started_at) DESC;
```

### CountItemsBySource

**Purpose:** Count items per source (AVOID - use LIMIT+1 instead)

```sql
-- ❌ DEPRECATED - Full table scan
SELECT COUNT(*) FROM media_items 
WHERE source_id = ?;

-- ✅ USE THIS - Check hasMore with LIMIT+1
SELECT * FROM media_items 
WHERE source_id = ?
LIMIT 51;  -- If 51 rows returned, hasMore = true
```

---

## Aggregates

### Library Load (Initial Page)

**Workflow:**
1. GetRecentItems (cursor = undefined, limit = 50)
2. Extract `created_at` from last item as nextCursor
3. Return items + nextCursor + hasMore

**Implementation:**
```typescript
const rows = db.prepare(`
  SELECT * FROM media_items 
  ORDER BY datetime(created_at) DESC 
  LIMIT 51
`).all();

const hasMore = rows.length > 50;
const items = rows.slice(0, 50);
const nextCursor = items[items.length - 1]?.created_at;
```

### Library Load (Next Page)

**Workflow:**
1. GetRecentItemsWithCursor (cursor from previous response)
2. Extract nextCursor from last item
3. Return items + nextCursor + hasMore

**Implementation:**
```typescript
const rows = db.prepare(`
  SELECT * FROM media_items 
  WHERE datetime(created_at) < datetime(?)
  ORDER BY datetime(created_at) DESC 
  LIMIT 51
`).all(cursor);

const hasMore = rows.length > 50;
const items = rows.slice(0, 50);
const nextCursor = items[items.length - 1]?.created_at;
```

### Filtered Library Load (Source + Type)

**Workflow:**
1. GetRecentItemsBySourceAndType
2. Filter video_segments in application layer
3. Return paginated results

**Implementation:**
```typescript
const rows = db.prepare(`
  SELECT * FROM media_items 
  WHERE source_id IN (${sourceIds.map(() => '?').join(',')})
    AND mime_type LIKE 'video/%'
    AND datetime(created_at) < datetime(?)
  ORDER BY datetime(created_at) DESC 
  LIMIT 51
`).all(...sourceIds, cursor);

// Filter out video_segment type in application
const filtered = rows.filter(r => r.type !== 'video_segment');
```

### Video Processing Lookup

**Workflow:**
1. GetVideosByPath (find parent video)
2. Process video segments
3. Update job status

**Implementation:**
```typescript
const videos = db.prepare(`
  SELECT * FROM media_items 
  WHERE path = ? AND type = 'video'
  LIMIT 10
`).all(videoPath);

// Should return 1 parent video (not segments)
```

---

## Performance Notes

### ✅ Efficient Patterns

1. **Cursor Pagination**: Uses indexed `created_at` column
2. **LIMIT + 1**: Avoids COUNT() queries
3. **WHERE + ORDER BY**: Leverages composite indexes
4. **Targeted Queries**: Specific path/type filters

### ❌ Anti-Patterns to Avoid

1. **COUNT() Queries**: Full table scans
2. **OFFSET Pagination**: Scans N rows to skip them
3. **SELECT ***: Load all columns when only need few
4. **No WHERE Clause**: Full table scans

### Index Usage

```sql
-- Good: Uses idx_media_items_created_at
SELECT * FROM media_items 
WHERE datetime(created_at) < ?
ORDER BY datetime(created_at) DESC;

-- Good: Uses idx_media_items_source_id + idx_media_items_created_at
SELECT * FROM media_items 
WHERE source_id = ? AND datetime(created_at) < ?
ORDER BY datetime(created_at) DESC;

-- Bad: No index on type column
SELECT * FROM media_items 
WHERE type = 'video_segment';  -- Full table scan
```

---

## Migration from Offset to Cursor

### Before (Offset-based)

```sql
-- Query 1: Count total (full table scan)
SELECT COUNT(*) FROM media_items WHERE source_id = ?;

-- Query 2: Get page (scans OFFSET rows)
SELECT * FROM media_items 
WHERE source_id = ?
ORDER BY datetime(created_at) DESC
LIMIT 50 OFFSET 100;  -- Scans 100 rows to skip them
```

**Problems:**
- 2 queries per page
- COUNT() scans entire table
- OFFSET performance degrades with page number
- Inconsistent results if data changes

### After (Cursor-based)

```sql
-- Single query with cursor
SELECT * FROM media_items 
WHERE source_id = ?
  AND datetime(created_at) < datetime(?)  -- Cursor
ORDER BY datetime(created_at) DESC
LIMIT 51;  -- LIMIT + 1 for hasMore check
```

**Benefits:**
- 1 query per page
- No COUNT() needed
- Constant O(1) performance
- Consistent results with concurrent updates

---

---

## Recent Fixes

### CamelCase to snake_case Column Mapping

**Date:** 2025-10-10  
**Issue:** Frontend passes `orderBy: 'createdAt'` but SQL expects `created_at`

**Error:**
```
SqliteError: no such column: createdAt
```

**Fix Location:** `src/api/main-media-api.ts` in `getRecentItems()`

**Implementation:**
```typescript
const orderByMap: Record<string, 'created_at' | 'modified_at' | 'name' | 'size'> = {
  'createdAt': 'created_at',
  'modifiedAt': 'modified_at',
  'name': 'name',
  'size': 'size'
};

const dbOrderBy = params?.orderBy ? orderByMap[params.orderBy] || 'created_at' : 'created_at';

const result = await this.db.getMediaItemsPaginated({
  orderBy: dbOrderBy,  // Use mapped value
  // ... other params
});
```

**Status:** ✅ Fixed

---

**Last Updated:** 2025-10-10 12:48 IST
