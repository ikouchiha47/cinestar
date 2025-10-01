-- Migration: 018_vector_db_indexes.sql
-- Purpose: Add indexes ONLY for vector.db tables (no video-rag.db references)
-- Analysis: Based on query_analysis.json - actual query patterns from codebase
-- Target: vector.db ONLY
-- Created: 2025-10-02

-- =============================================================================
-- VECTOR.DB INDEXES ONLY (No video-rag.db table references)
-- =============================================================================

-- CRITICAL: Media item filtering by type and status (search operations)
-- Query: SELECT * FROM media_items WHERE type = ? AND caption_status = ?
CREATE INDEX IF NOT EXISTS idx_media_type_caption_status 
ON media_items(type, caption_status);

-- CRITICAL: Media item filtering by type and embedding status
-- Query: Search filtering and status checks
CREATE INDEX IF NOT EXISTS idx_media_type_embedding_status 
ON media_items(type, embedding_status);

-- CRITICAL: Media item source and path lookup (duplicate detection)
-- Query: SELECT id FROM media_items WHERE source_id = ? AND path = ?
CREATE INDEX IF NOT EXISTS idx_media_source_path 
ON media_items(source_id, path);

-- IMPORTANT: Media source path lookups with enabled filtering
-- Query: SELECT * FROM media_sources WHERE path = ? AND enabled = 1
CREATE INDEX IF NOT EXISTS idx_sources_path_enabled 
ON media_sources(path, enabled);

-- IMPORTANT: Media items by source with ordering
-- Query: SELECT * FROM media_items WHERE source_id = ? ORDER BY datetime(created_at) DESC
CREATE INDEX IF NOT EXISTS idx_media_source_created 
ON media_items(source_id, created_at DESC);

-- USEFUL: Media item search queries (text search)
-- Query: SELECT * FROM media_items WHERE lower(name) LIKE ? OR lower(path) LIKE ? OR lower(caption) LIKE ?
-- Note: LIKE queries benefit from these indexes for sorting/limiting results
CREATE INDEX IF NOT EXISTS idx_media_name_search 
ON media_items(name);

CREATE INDEX IF NOT EXISTS idx_media_caption_search 
ON media_items(caption) 
WHERE caption IS NOT NULL;

-- USEFUL: Indexing job status queries
-- Query: SELECT source_id FROM indexing_jobs WHERE id = ?
-- Already covered by primary key, but add status filtering
CREATE INDEX IF NOT EXISTS idx_indexing_status_created 
ON indexing_jobs(status, created_at);

-- =============================================================================
-- ANALYZE TABLES (vector.db only)
-- =============================================================================

-- Update statistics for query planner
ANALYZE media_items;
ANALYZE media_sources;
ANALYZE indexing_jobs;

-- Optimize database
PRAGMA optimize;
