
# Image Job Progress Tracking - Architectural Pattern

**Date**: 2025-10-10
**Component**: Image Processing System
**Pattern**: Async Job Aggregation for UI Progress Tracking

---

## Problem Statement

Implemented asynchronous batch image processing where:
- 1 user action (scan folder) = 1 scan job (completes immediately) + N background jobs (status='pending')
- UI polls `getActiveJobs()` which only returned jobs with `status='running'`
- **Result**: Background image jobs were invisible to the UI despite active processing

## Root Cause

**Architectural Mismatch**:
- System designed for **synchronous job processing**: 1 action = 1 job with `status='running'`
- Introduced **asynchronous batch processing**: 1 action = 1 scan + N background jobs
- **Missing aggregation layer** to translate background jobs into UI-visible progress

```typescript
// Old query - only showed 'running' jobs
SELECT * FROM indexing_jobs WHERE status IN ('running')

// But our image jobs have:
status='pending'   // Waiting to be processed
status='completed' // Already processed
status='failed'    // Failed processing

// Result: INVISIBLE to UI! ❌
```

---

## Solution Implemented

Modified `SqliteMainDatabase.getActiveJobs()` to **dynamically aggregate** background jobs:

```typescript
// 1. Get regular running jobs (scans, etc.)
SELECT * FROM indexing_jobs 
WHERE status='running' 
AND job_type IN ('scan', 'media_scan')

// 2. Get aggregate stats for image processing jobs
SELECT 
  source_id,
  COUNT(*) as total,
  SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed,
  SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as failed,
  SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) as pending
FROM indexing_jobs
WHERE job_type='image_processing'
GROUP BY source_id
HAVING pending > 0 OR (completed + failed < total)

// 3. Create synthetic "aggregate job" for UI
{
  id: 'image_processing_<sourceId>',
  status: 'running',
  progress: Math.floor((completed / total) * 100),
  title: 'Processing Images',
  description: '32/43 images indexed (2 failed)'
}
```

---

## The Architectural Pattern

```
UI Layer (polls every 2.5s)
    ↓
API Layer (getIndexingStatus)
    ↓
Database Layer (getActiveJobs) ← AGGREGATION HAPPENS HERE
    ↓
Job Storage (indexing_jobs table)
```

**Key Insight**: The aggregation layer sits at the **database query level**, not in application code.

---

## Benefits

- ✅ **Automatic integration** - No UI changes needed
- ✅ **Single progress bar** - Aggregates all image jobs per source
- ✅ **Real-time updates** - Recalculated on every poll (2.5s)
- ✅ **Works with existing code** - Leverages existing polling infrastructure
- ✅ **Database-level aggregation** - Efficient SQL queries vs application logic
- ✅ **Scalable** - Works for 10 or 10,000 background jobs

---

## Architectural Lesson

**When introducing new job types with different lifecycle patterns (sync vs async), you MUST update the aggregation layer that feeds the UI.**

### Common Mistake:
```typescript
// ❌ Only querying for 'running' jobs
SELECT * FROM jobs WHERE status='running'

// But new job type uses 'pending' status
// Result: UI shows nothing!
```

### Correct Approach:
```typescript
// ✅ Aggregate background jobs into synthetic UI jobs
SELECT source_id, COUNT(*), SUM(completed)
FROM jobs 
WHERE job_type='background_task'
GROUP BY source_id
HAVING COUNT(*) > SUM(completed)

// Create synthetic job for UI display
```

---

## Future Improvements

### 1. Parent Tracking Job Pattern
Instead of synthetic jobs, create a dedicated parent tracking job:
- Persistent job ID (no synthetic IDs)
- Store metadata (estimated completion, error summaries)
- Better audit trail
- Easier pause/resume functionality

### 2. Event-Based Progress (vs Polling)
Replace polling with event emissions:
```typescript
// ImageJobProcessor emits events
this.emit('batch:complete', { sourceId, progress: 75 });

// UI listens via IPC
ipcRenderer.on('image:progress', updateProgressBar);
```

### 3. Priority Queue System
Use existing `priority` column for job prioritization:
- High: User-initiated re-index
- Normal: New folder scan
- Low: Background re-processing

---

## Files Modified

1. `src/core/sqlite-main-database.ts` - Modified `getActiveJobs()`
2. `src/api/main-media-api.ts` - Modified `performIndexing()`
3. `src/core/image-job-processor.ts` - NEW - Background processor
4. `electron/main.ts` - Wired ImageJobProcessor
5. `migrations_flat/019_image_job_processing.sql` - NEW - Schema changes

---

## Related Patterns

- **Video Processing**: Uses same pattern for Phase 0/1/2 jobs
- **Batch Processing**: Similar to video batch transcription
- **Job Queue Systems**: Celery, Bull, Sidekiq all use this pattern

---

## Testing

```bash
# 1. Connect folder with 43 images
# 2. Watch logs:
[DB-ACTIVE-JOBS-DEBUG] Found 0 running jobs, 1 image processing groups
[DB-ACTIVE-JOBS-DEBUG] Returning 0 regular + 1 image jobs

# 3. UI should show:
"Processing Images: 8/43 images indexed (0 failed)"

# 4. Progress updates every 2.5s automatically
```

---

## Key Takeaway

**Database-level aggregation is the right place for translating background job states into UI-visible progress.** Don't try to fix this in the UI or API layer - fix it where the data lives.
