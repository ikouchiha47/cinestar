-- Migration 016: Add indexes for visual processing fields
-- Optimize queries for Phase 1 visual enhancement tracking

-- Add index for visual processing status queries
CREATE INDEX IF NOT EXISTS idx_batches_visual_status 
  ON processing_batches(video_id, status, visual_confidence) 
  WHERE visual_captions IS NOT NULL;

-- Add index for scene reconstruction queries  
CREATE INDEX IF NOT EXISTS idx_batches_scene_quality
  ON processing_batches(video_id, scene_coherence, updated_at)
  WHERE scene_context IS NOT NULL;

-- Add composite index for Phase 1 completion tracking
CREATE INDEX IF NOT EXISTS idx_batches_phase1_complete
  ON processing_batches(video_id, status, visual_confidence, scene_coherence)
  WHERE status = 'enhanced';

-- Add index for visual data existence checks
CREATE INDEX IF NOT EXISTS idx_batches_has_visual_data
  ON processing_batches(video_id, status)
  WHERE visual_captions IS NOT NULL AND scene_context IS NOT NULL;
