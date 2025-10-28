-- sql: db:media
PRAGMA foreign_keys=ON;

-- ============================================================================
-- MIGRATION DEPRECATED - Backfill moved to runtime
-- ============================================================================
-- 
-- This migration originally attempted to backfill media_items from vector.db
-- to media.db, but it failed silently for many users due to ATTACH issues.
--
-- The backfill logic has been moved to src/core/modality-backfill.ts where it:
-- - Runs on every app start (idempotent)
-- - Has better error handling and logging
-- - Self-heals automatically
-- - Can be re-run without manual intervention
--
-- This migration is kept for historical purposes and to maintain migration
-- numbering, but the actual backfill happens in maybeBackfillMediaItems().
--
-- See: docs/BACKFILL_FIX_SUMMARY.md for details
-- ============================================================================

-- No-op: Schema already exists from previous migrations
SELECT 'Migration 030: Backfill moved to runtime - see modality-backfill.ts' AS status;
