-- Migration 004: Progressive Video Refinement System
-- Add support for multi-pass video processing with decreasing thresholds

-- Extend video_processing_jobs for refinement tracking
ALTER TABLE video_processing_jobs ADD COLUMN refinement_pass INTEGER DEFAULT 1;
ALTER TABLE video_processing_jobs ADD COLUMN threshold REAL DEFAULT 0.8;
ALTER TABLE video_processing_jobs ADD COLUMN parent_job_id TEXT;
ALTER TABLE video_processing_jobs ADD COLUMN trigger_condition TEXT DEFAULT 'immediate';
ALTER TABLE video_processing_jobs ADD COLUMN scheduled_at DATETIME;

-- Add indexes for efficient refinement job queries
CREATE INDEX IF NOT EXISTS idx_jobs_refinement ON video_processing_jobs(refinement_pass, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_jobs_parent ON video_processing_jobs(parent_job_id);
CREATE INDEX IF NOT EXISTS idx_jobs_scheduled ON video_processing_jobs(scheduled_at, status) WHERE scheduled_at IS NOT NULL;

-- Extend video_segments for segment provenance tracking
ALTER TABLE video_segments ADD COLUMN refinement_pass INTEGER DEFAULT 1;
ALTER TABLE video_segments ADD COLUMN threshold_used REAL DEFAULT 0.8;
ALTER TABLE video_segments ADD COLUMN superseded_by TEXT; -- Reference to finer segment that replaces this one
ALTER TABLE video_segments ADD COLUMN processing_priority INTEGER DEFAULT 100; -- Higher = more important in search

-- Add indexes for refinement segment queries
CREATE INDEX IF NOT EXISTS idx_segments_refinement ON video_segments(refinement_pass, threshold_used);
CREATE INDEX IF NOT EXISTS idx_segments_superseded ON video_segments(superseded_by) WHERE superseded_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_segments_priority ON video_segments(processing_priority DESC);

-- Create refinement_passes lookup table for configuration
CREATE TABLE IF NOT EXISTS refinement_passes (
    pass_number INTEGER PRIMARY KEY,
    threshold REAL NOT NULL,
    delay_seconds INTEGER NOT NULL,
    trigger_condition TEXT NOT NULL DEFAULT 'delayed',
    enabled BOOLEAN DEFAULT TRUE,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Insert default refinement pass configuration
INSERT OR REPLACE INTO refinement_passes (pass_number, threshold, delay_seconds, trigger_condition, description) VALUES
(1, 0.8, 0, 'immediate', 'Coarse segmentation for immediate results'),
(2, 0.6, 300, 'delayed', 'Medium refinement after 5 minutes'),
(3, 0.4, 1800, 'conditional', 'Fine refinement after 30 minutes');

-- Create refinement_metrics table for tracking performance
CREATE TABLE IF NOT EXISTS refinement_metrics (
    id TEXT PRIMARY KEY,
    video_id TEXT NOT NULL,
    job_id TEXT NOT NULL,
    refinement_pass INTEGER NOT NULL,
    segments_before INTEGER DEFAULT 0,
    segments_after INTEGER DEFAULT 0,
    new_segments_created INTEGER DEFAULT 0,
    processing_time_ms INTEGER DEFAULT 0,
    embedding_time_ms INTEGER DEFAULT 0,
    total_content_chars INTEGER DEFAULT 0,
    search_quality_score REAL DEFAULT 0.0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (video_id) REFERENCES video_files (id) ON DELETE CASCADE,
    FOREIGN KEY (job_id) REFERENCES video_processing_jobs (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_refinement_metrics_video ON refinement_metrics(video_id, refinement_pass);
CREATE INDEX IF NOT EXISTS idx_refinement_metrics_performance ON refinement_metrics(processing_time_ms, refinement_pass);
