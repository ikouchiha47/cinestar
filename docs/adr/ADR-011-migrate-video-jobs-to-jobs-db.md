# ADR-011: Migrate Video Job Tracking from video-rag.db to jobs.db

## Status
Proposed

## Context

Currently, video processing job tracking is split across multiple databases:
- **Image jobs**: Already migrated to `jobs.db` (via `SqliteJobsDatabase`)
- **Video jobs**: Still in `video-rag.db` (via `VideoDatabase`)

This creates inconsistency and prevents us from fully deprecating `video-rag.db` as planned in the database architecture migration.

### Current State

**Video job data in `video-rag.db`:**
- `video_processing_jobs` - Job status, progress, metadata
- `processing_batches` - Batch-level processing state
- `transcription_segments` - Transcription timing data
- `batch_keyframes` - Keyframe metadata
- `video_files` - Parent video metadata

**Problems:**
1. Progress bar queries read from `video-rag.db` while image jobs read from `jobs.db`
2. Inconsistent job tracking architecture across media types
3. Cannot deprecate `video-rag.db` until video jobs are migrated
4. Duplicate job tracking logic between `VideoDatabase` and `SqliteJobsDatabase`

### Target State

All job tracking consolidated in `jobs.db`:
- Video processing jobs use same schema as image jobs
- Unified job status queries across all media types
- Single source of truth for progress bar UI
- `video-rag.db` can be deprecated for job tracking

## Decision

Migrate video job tracking from `video-rag.db` to `jobs.db` using the existing `job_runs` schema with video-specific extensions.

### Architecture

```
jobs.db
├── job_runs (existing)
│   ├── id, definition_id, status, progress
│   └── target_item_id (video file ID)
├── job_steps (existing)
│   └── Track batch processing phases
├── video_job_metadata (new)
│   ├── job_run_id (FK to job_runs)
│   ├── video_path, file_name
│   ├── refinement_pass, threshold
│   └── current_phase (phase0/phase1)
├── processing_batches (migrated)
│   ├── job_run_id (FK to job_runs)
│   └── batch metadata
└── batch_keyframes (migrated)
    └── keyframe metadata
```

### Migration Strategy

**Phase 1: Schema Migration**
- Create `video_job_metadata` table in `jobs.db`
- Migrate `processing_batches` table to `jobs.db`
- Migrate `batch_keyframes` table to `jobs.db`
- Keep `transcription_segments` in `video-rag.db` (workflow data, not job tracking)

**Phase 2: Code Migration**
- Update `VideoDatabase` to use `SqliteJobsDatabase` for job queries
- Update `VideoJobProcessor` to write to `jobs.db`
- Update `BatchProcessor` to write to `jobs.db`
- Update progress bar queries to read from `jobs.db`

**Phase 3: Data Migration**
- Copy existing jobs from `video-rag.db` to `jobs.db`
- Verify data integrity
- Archive old tables in `video-rag.db`

## Consequences

### Positive
- ✅ Unified job tracking across all media types
- ✅ Consistent progress bar queries
- ✅ Simplified database architecture
- ✅ Can deprecate `video-rag.db` for job tracking
- ✅ Reuse existing `SqliteJobsDatabase` infrastructure

### Negative
- ⚠️ Requires careful migration of in-flight jobs
- ⚠️ Need to update all job query callsites
- ⚠️ Temporary dual-write period during migration

### Neutral
- 📝 `video_files` table remains in `video-rag.db` (metadata, not job tracking)
- 📝 `transcription_segments` remains in `video-rag.db` (workflow data)

## Implementation Plan

See: `.kiro/specs/migrate-video-jobs-to-jobs-db/tasks.md`

## References

- [Vector DB Cutover Plan](../vector-db-cutover-plan.md) - Phase 3
- Migration 026: `init_jobs_db.sql`
- Migration 038: `move_indexing_jobs_to_jobs_db.sql`
- `src/core/sqlite-jobs-database.ts` - Target implementation
- `src/core/video-database.ts` - Current implementation

## Notes

**Why not move everything from video-rag.db?**
- `video_files` is metadata about videos, not job tracking
- `transcription_segments` is workflow data (precise timing), not job status
- `video_keyframes` is video processing output, not job tracking

We're only migrating **job tracking** data to `jobs.db`, not all video-related data.

---

**Author**: System  
**Date**: 2025-01-26  
**Supersedes**: None  
**Superseded by**: None
