-- Migration 005: Add Jitter Support to Refinement Scheduling
-- Add jitter configuration to prevent thundering herd problems

-- Add jitter_percent column to refinement_passes table
ALTER TABLE refinement_passes ADD COLUMN jitter_percent REAL DEFAULT 0.2;

-- Update existing passes with appropriate jitter values
UPDATE refinement_passes SET jitter_percent = 0.1 WHERE pass_number = 1; -- 10% jitter for immediate pass
UPDATE refinement_passes SET jitter_percent = 0.2 WHERE pass_number = 2; -- 20% jitter for medium pass  
UPDATE refinement_passes SET jitter_percent = 0.3 WHERE pass_number = 3; -- 30% jitter for fine pass

-- Add index for jitter-related queries
CREATE INDEX IF NOT EXISTS idx_refinement_passes_jitter ON refinement_passes(jitter_percent, delay_seconds);

-- Add comment explaining jitter purpose
PRAGMA table_info(refinement_passes);
-- jitter_percent: Percentage of delay_seconds to use as random jitter (±)
-- Example: delay_seconds=300, jitter_percent=0.2 → random delay between 240-360 seconds
-- This prevents multiple videos from processing simultaneously (thundering herd)
