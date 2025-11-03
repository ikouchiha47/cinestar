# ADR-008: Consolidate Duplicate Databases

- Status: Proposed
- Date: 2025-10-19
- Authors: System Cleanup

## Context

We currently have 5 separate database files with significant overlap and confusion:

1. **`library.db`** (4.2MB) - Media items, sources, indexing jobs, grouping tables
2. **`vector.db`** (4.2MB) - Media items (duplicate!), sources (duplicate!), indexing jobs (duplicate!), vector search
3. **`video-rag.db`** (356KB) - Video segments, batches, transcriptions
4. **`video-jobs.db`** (108KB) - Video processing jobs
5. **`video-meta.db`** (96KB) - Video file metadata

### Problems:

1. **Duplicate schemas**: `library.db` and `vector.db` have IDENTICAL `media_items`, `media_sources`, and `indexing_jobs` tables
2. **No sync mechanism**: Images added to `library.db` are NOT synced to `vector.db`, making them invisible to search
3. **Confusing naming**: `video-rag.db` is a terrible name for video segments database
4. **Unnecessary fragmentation**: `video-jobs.db` and `video-meta.db` should be consolidated with video segments
5. **Broken search**: Search only queries `vector.db`, missing all images in `library.db`

## Decision

**Consolidate to 2 databases with clear separation of concerns:**

### 1. `media.db` (replaces library.db + vector.db)
- **Purpose**: Single source of truth for all media items, sources, jobs, and search
- **Tables**:
  - `media_items` - All media (images, videos, audio) with embeddings
  - `media_sources` - Folder sources
  - `indexing_jobs` - Background processing jobs
  - `media_groups`, `media_group_members`, `media_duplicate_links`, `media_features` - Grouping/deduplication
  - `vec_embeddings*` - Vector search extension tables
  - `media_fts*` - Full-text search tables

### 2. `video-segments.db` (replaces video-rag.db + video-jobs.db + video-meta.db)
- **Purpose**: Video-specific processing data (segments, batches, jobs)
- **Tables**:
  - `video_files` - Video file metadata
  - `video_segments` - Processed video segments with timestamps
  - `processing_batches` - 5-minute batch processing data
  - `transcription_segments` - Whisper transcription segments
  - `batch_keyframes` - Extracted keyframes per batch
  - `video_processing_jobs` - Video processing job queue
  - `scene_reconstruction_jobs` - Scene reconstruction queue

## Implementation Plan

### Phase 1: Merge library.db → vector.db → media.db

1. Copy all unique data from `library.db` to `vector.db`
2. Rename `vector.db` to `media.db`
3. Delete `library.db`
4. Update all code references from `library.db` to `media.db`

### Phase 2: Consolidate video databases → video-segments.db

1. Attach `video-jobs.db` and `video-meta.db` to `video-rag.db`
2. Copy all tables into `video-rag.db`
3. Rename `video-rag.db` to `video-segments.db`
4. Delete `video-jobs.db` and `video-meta.db`
5. Update all code references

### Phase 3: Update code to use consolidated databases

**Files to update:**
- `src/api/main-media-api.ts` - Use `media.db` instead of `library.db`
- `electron/main.ts` - ImageJobProcessor should use `media.db` for both db and vecDb
- `src/core/video-database.ts` - Use `video-segments.db`
- `src/core/video-jobs-database.ts` - Use `video-segments.db`
- All migration files - Update db directive comments

## Benefits

1. **Single source of truth**: One database for all media, no sync issues
2. **Simpler architecture**: 2 databases instead of 5
3. **Fixed search**: Images and videos both searchable from same database
4. **Clear naming**: `media.db` and `video-segments.db` are self-explanatory
5. **Better performance**: No cross-database queries needed
6. **Easier maintenance**: Fewer files to backup/migrate

## Risks

1. **Migration complexity**: Need to carefully merge data without loss
2. **Backward compatibility**: Existing installations need migration script
3. **Code changes**: Multiple files need updates

## Alternatives Considered

### Alternative 1: Keep all 5 databases, add sync
- **Rejected**: Adds complexity, doesn't fix naming or duplication

### Alternative 2: Single database for everything
- **Rejected**: Video processing data is large and specialized, better separated

### Alternative 3: Three databases (media.db, video-segments.db, search.db)
- **Rejected**: Separating search from media creates the same sync problem we have now

## Migration Script

```bash
#!/bin/bash
# Consolidate databases

# Phase 1: Merge library.db into vector.db
sqlite3 data/vector.db <<EOF
ATTACH DATABASE 'data/library.db' AS lib;

-- Copy any missing media_items from library.db
INSERT OR IGNORE INTO media_items 
SELECT * FROM lib.media_items;

-- Copy any missing media_sources
INSERT OR IGNORE INTO media_sources 
SELECT * FROM lib.media_sources;

-- Copy any missing indexing_jobs
INSERT OR IGNORE INTO indexing_jobs 
SELECT * FROM lib.indexing_jobs;

-- Copy grouping tables (only in library.db)
INSERT OR IGNORE INTO media_groups SELECT * FROM lib.media_groups;
INSERT OR IGNORE INTO media_group_members SELECT * FROM lib.media_group_members;
INSERT OR IGNORE INTO media_duplicate_links SELECT * FROM lib.media_duplicate_links;
INSERT OR IGNORE INTO media_features SELECT * FROM lib.media_features;

DETACH DATABASE lib;
EOF

# Rename vector.db to media.db
mv data/vector.db data/media.db

# Backup and remove library.db
mv data/library.db data/library.db.backup

# Phase 2: Consolidate video databases
sqlite3 data/video-rag.db <<EOF
ATTACH DATABASE 'data/video-jobs.db' AS jobs;
ATTACH DATABASE 'data/video-meta.db' AS meta;

-- Copy video_processing_jobs if not already present
CREATE TABLE IF NOT EXISTS video_processing_jobs AS SELECT * FROM jobs.video_processing_jobs;

-- Copy video_files if not already present  
CREATE TABLE IF NOT EXISTS video_files AS SELECT * FROM meta.video_files;

DETACH DATABASE jobs;
DETACH DATABASE meta;
EOF

# Rename video-rag.db to video-segments.db
mv data/video-rag.db data/video-segments.db

# Backup and remove old databases
mv data/video-jobs.db data/video-jobs.db.backup
mv data/video-meta.db data/video-meta.db.backup

echo "Database consolidation complete!"
echo "New databases: media.db, video-segments.db"
echo "Backups created with .backup extension"
```

## Status

**Proposed** - Awaiting approval and implementation
