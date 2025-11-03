# ADR-009: Migrate Video Processing from video-rag.db to jobs.db

## Status
**IN PROGRESS** - Schema ready, code migration pending

## Context
Video processing currently writes to `video-rag.db`, but in production we want `video-rag.db` to be **read-only** (legacy data only). All new video processing should write to `jobs.db`.

## Decision

### Database Architecture
- **video-rag.db**: Read-only, legacy data, backfill source
- **jobs.db**: Active writes, all new video processing data

### Migration Strategy

#### Phase 1: Schema ✅ COMPLETE
- ✅ Migration 048: Created `processing_batches`, `batch_keyframes`, `video_job_metadata` in jobs.db
- ✅ Migration 049: Added multi-pass fields to `batch_keyframes` in jobs.db
- ✅ Migration 045: Commented out (no longer recreates tables in video-rag.db)
- ✅ Migration 042: Deprecated (targeted wrong database)

#### Phase 2: Backfill ⏳ PENDING
- ✅ Migration 050: Backfill script created
- ⏳ TODO: Run backfill to copy existing batches from video-rag.db → jobs.db

#### Phase 3: Code Migration 🚧 IN PROGRESS
**Files that need updating:**

1. **BatchProcessor** (`src/core/processors/batch-processor.ts`)
   - Currently: Uses `VideoDatabase` → writes to video-rag.db
   - Target: Use `SqliteJobsDatabase` → write to jobs.db
   - Changes needed:
     - Constructor: Accept `jobsDb` instead of `videoDb`
     - `storeBatch()`: Write to jobs.db `processing_batches`
     - `storeKeyframe()`: Write to jobs.db `batch_keyframes`
     - Add `job_run_id` to all inserts

2. **VideoJobProcessor** (`src/core/video-job-processor.ts`)
   - Currently: Uses `VideoDatabase` for batch operations
   - Target: Use `SqliteJobsDatabase`
   - Changes needed:
     - Pass `jobsDb` to BatchProcessor
     - Update batch queries to use jobs.db
     - Link batches to `job_run_id`

3. **EnhancedBatchProcessor** (Phase 1 logic)
   - Currently: Queries video-rag.db for batches
   - Target: Query jobs.db
   - Changes needed:
     - Update `getBatchesForVideo()` to query jobs.db
     - Update keyframe storage to use jobs.db

#### Phase 4: Config Updates 🔧 REQUIRED
Enable spatial/temporal analysis:
```typescript
// src/core/config.ts
multiPass: {
  enabled: true,
  phases: {
    enableExtraction: true,
    enableSpatial: true,      // ← Enable this
    enableTemporal: true,     // ← Enable this
    enableSegmentationCheck: false
  }
}
```

## Issues Fixed

### 1. Migration 042 Targeted Wrong Database ❌
**Problem**: Tried to add multi-pass columns to `video_keyframes` in video-rag.db  
**Fix**: Deprecated 042, created 049 targeting `batch_keyframes` in jobs.db

### 2. Migration 045 Would Destroy Data ❌
**Problem**: `DROP TABLE processing_batches` in video-rag.db  
**Fix**: Commented out all SQL, kept for version tracking only

### 3. Keyframes Not Being Saved ❌
**Problem**: `BatchProcessor.updateKeyframe()` tries to UPDATE non-existent rows  
**Root Cause**: Missing INSERT logic + wrong database target  
**Fix**: Pending code migration to jobs.db

### 4. `undefined` in Transcription Embeddings ❌
**Problem**: Embedding input shows `'undefined\n\nVisual Context:'`  
**Root Cause**: Transcription field not properly passed to embedding builder  
**Fix**: Pending investigation in `processEnhancedBatches()`

## Implementation Checklist

### Immediate (Before Next Run)
- [x] Run migration 049 to add multi-pass columns to jobs.db ✅
- [x] Run migration 050 to backfill existing batches (N/A - fresh DB)
- [x] Update config to enable spatial/temporal ✅

### Code Migration (Week 1)
- [x] Update `BatchProcessor` to use `SqliteJobsDatabase` ✅
- [x] Update `VideoJobProcessor` to pass `jobsDb` to BatchProcessor ✅
- [x] Update all batch queries to target jobs.db ✅
- [ ] Fix `undefined` transcription bug in embedding builder (TODO)

### Testing (Week 1)
- [ ] Process test video with new code
- [ ] Verify batches written to jobs.db
- [ ] Verify keyframes written to jobs.db
- [ ] Verify spatial/temporal captions generated
- [ ] Verify no writes to video-rag.db

### Production Rollout (Week 2)
- [ ] Deploy with video-rag.db as read-only
- [ ] Monitor for any video-rag.db write attempts
- [ ] Validate backfill completeness

## Consequences

### Positive
- ✅ Clean separation: jobs.db for active work, video-rag.db for legacy
- ✅ No risk of destroying production data
- ✅ Backfill preserves all existing batch data
- ✅ Multi-pass captioning ready to use

### Negative
- ⚠️ Code changes required in BatchProcessor and VideoJobProcessor
- ⚠️ Need to test thoroughly before production
- ⚠️ Temporary dual-database state during migration

## References
- Migration 048: `migrations_flat/048_migrate_video_jobs_to_jobs_db.sql`
- Migration 049: `migrations_flat/049_add_multipass_to_batch_keyframes.sql`
- Migration 050: `migrations_scripts/050_backfill_batches_from_video_rag.js`
- BatchProcessor: `src/core/processors/batch-processor.ts`
- VideoJobProcessor: `src/core/video-job-processor.ts`
