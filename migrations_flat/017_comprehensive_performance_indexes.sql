-- Migration: 017_video_rag_indexes_only.sql
-- Purpose: Add indexes ONLY for video-rag.db tables (no vector.db references)
-- Analysis: Based on query_analysis.json - actual query patterns from codebase
-- Target: video-rag.db ONLY
-- Created: 2025-10-02

-- =============================================================================
-- VIDEO-RAG.DB INDEXES ONLY (No vector.db table references)
-- =============================================================================

-- CRITICAL: Job lookup by video path and status (most frequent)
-- Query: SELECT id, status FROM video_processing_jobs WHERE video_path = ? AND status IN (...)
CREATE INDEX IF NOT EXISTS idx_jobs_video_path_status 
ON video_processing_jobs(video_path, status);

-- CRITICAL: Job status with ordering for UI
-- Query: SELECT * FROM video_processing_jobs WHERE status = ? ORDER BY created_at DESC  
CREATE INDEX IF NOT EXISTS idx_jobs_status_created 
ON video_processing_jobs(status, created_at DESC);

-- CRITICAL: Video segments by video_id with time ordering
-- Query: SELECT * FROM video_segments WHERE video_id = ? ORDER BY start_time
CREATE INDEX IF NOT EXISTS idx_segments_video_time 
ON video_segments(video_id, start_time);

-- CRITICAL: Processing batch progress queries (recovery system)
-- Query: SELECT COUNT(*) FROM processing_batches WHERE video_id = ? AND status = ?
CREATE INDEX IF NOT EXISTS idx_batches_video_status_count 
ON processing_batches(video_id, status);

-- IMPORTANT: Keyframe queries by caption status
-- Query: SELECT id, video_id, segment_id FROM video_keyframes WHERE caption IS NULL ORDER BY created_at
CREATE INDEX IF NOT EXISTS idx_keyframes_caption_created 
ON video_keyframes(caption, created_at) 
WHERE caption IS NULL OR TRIM(caption) = '';

-- IMPORTANT: Keyframe queries by embedding status  
-- Query: SELECT id, caption FROM video_keyframes WHERE embedding IS NULL ORDER BY created_at
CREATE INDEX IF NOT EXISTS idx_keyframes_embedding_created 
ON video_keyframes(embedding, created_at) 
WHERE embedding IS NULL;

-- USEFUL: Recovery system - batch status filtering
-- Query: getCompletedBatches() - counts batches by status
CREATE INDEX IF NOT EXISTS idx_batches_video_status_recovery 
ON processing_batches(video_id, status) 
WHERE status IN ('audio_only', 'enhanced');

-- USEFUL: Job recovery - stalled job detection
-- Query: Recovery system checks for stalled jobs
CREATE INDEX IF NOT EXISTS idx_jobs_stalled_detection 
ON video_processing_jobs(status, created_at, start_time) 
WHERE status IN ('processing', 'pending', 'scheduled');

-- USEFUL: Video segment embedding queries
-- Query: Segments with embeddings for search
CREATE INDEX IF NOT EXISTS idx_segments_embedding_search 
ON video_segments(video_id) 
WHERE embedding IS NOT NULL;

-- =============================================================================
-- ANALYZE TABLES (video-rag.db only)
-- =============================================================================

-- Update statistics for query planner
ANALYZE video_processing_jobs;
ANALYZE video_files; 
ANALYZE video_segments;
ANALYZE processing_batches;
ANALYZE video_keyframes;

-- Optimize database
PRAGMA optimize;
