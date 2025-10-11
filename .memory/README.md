# Memory System

**Purpose:** Persist system state knowledge across sessions using SQLite and markdown.

---

## Files

### 1. **schema.sql**
Database schema definitions for media items, sources, and indexing jobs.

**Usage:**
```bash
# Create/update memory database
sqlite3 ./memory/system-state.db < ./memory/schema.sql
```

### 2. **QUERIES.md**
Comprehensive query documentation with:
- Individual queries by intent
- Aggregate workflows
- Performance notes
- Migration patterns

**Usage:**
- Reference when writing new queries
- Copy-paste tested SQL patterns
- Understand cursor pagination implementation

### 3. **system-state.db**
SQLite database tracking system state.

**Tables:**
- `media_items` - Media file records
- `media_sources` - Source directories/locations
- `indexing_jobs` - Background processing jobs

**Indexes:**
- Optimized for cursor-based pagination
- Created_at, modified_at for temporal queries
- Source_id, mime_type for filtering

**Usage:**
```bash
# View tables
sqlite3 ./memory/system-state.db ".tables"

# View schema
sqlite3 ./memory/system-state.db ".schema media_items"

# View indexes
sqlite3 ./memory/system-state.db "SELECT name FROM sqlite_master WHERE type='index';"

# Run query
sqlite3 ./memory/system-state.db "SELECT * FROM media_items ORDER BY datetime(created_at) DESC LIMIT 10;"
```

---

## Query Workflows

### Example: Get Recent Items with Cursor Pagination

```bash
# First page
sqlite3 ./memory/system-state.db "
  SELECT * FROM media_items 
  ORDER BY datetime(created_at) DESC 
  LIMIT 51;
"

# Next page (using cursor from last item)
sqlite3 ./memory/system-state.db "
  SELECT * FROM media_items 
  WHERE datetime(created_at) < datetime('2025-10-10T11:00:00.000Z')
  ORDER BY datetime(created_at) DESC 
  LIMIT 51;
"
```

### Example: Filter by Source and Type

```bash
sqlite3 ./memory/system-state.db "
  SELECT * FROM media_items 
  WHERE source_id = 'abc123'
    AND mime_type LIKE 'video/%'
    AND datetime(created_at) < datetime('2025-10-10T11:00:00.000Z')
  ORDER BY datetime(created_at) DESC 
  LIMIT 51;
"
```

---

## Maintenance

### Update Schema

```bash
# Backup first
cp ./memory/system-state.db ./memory/system-state.db.backup

# Apply schema changes
sqlite3 ./memory/system-state.db < ./memory/schema.sql
```

### Verify Indexes

```bash
# Check index usage
sqlite3 ./memory/system-state.db "EXPLAIN QUERY PLAN 
  SELECT * FROM media_items 
  WHERE datetime(created_at) < datetime('2025-10-10T11:00:00.000Z')
  ORDER BY datetime(created_at) DESC 
  LIMIT 51;
"
```

### Analyze Performance

```bash
# Gather statistics
sqlite3 ./memory/system-state.db "ANALYZE;"

# View query plan
sqlite3 ./memory/system-state.db ".eqp on"
```

---

## Integration with AGENTS.md

This memory system follows the guidelines in `/Users/darksied/dev/pocs/drillbit/AGENTS.md`:

✅ **SQLite for structured memory**  
✅ **CLI tools for interaction** (sqlite3)  
✅ **Cursor pagination support**  
✅ **Proper indexes for performance**  
✅ **Query documentation in markdown**  
✅ **Workflows as query aggregates**  

---

## Recent Changes

### 2025-10-10 11:48 IST
- Created schema.sql with media_items, media_sources, indexing_jobs
- Created QUERIES.md with cursor pagination patterns
- Initialized system-state.db with schema
- Verified 10 indexes created successfully
- Documented query workflows and maintenance procedures

---

**Last Updated:** 2025-10-10 11:48 IST
