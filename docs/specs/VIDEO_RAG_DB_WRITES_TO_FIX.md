# Video-rag.db Write Operations That Need Fixing

## Problem
Multiple components are still writing to video-rag.db's `video_processing_jobs` table instead of using VideoJobAdapter to write to jobs.db.

## Components Writing to video-rag.db

### 1. VideoJobCoordinator (src/core/video-job-coordinator.ts)
**Lines 61-65**: Fallback `videoDb.updateJob()` when VideoJobAdapter not available
```typescript
} else {
  await this.videoDb.updateJob(job.id, {
    status: 'processing',
    startTime: new Date()
  });
}
```

**Fix**: Remove the else block or throw error since VideoJobAdapter should always be available

---

### 2. ProgressTracker (src/core/video-processing/ProgressTracker.ts)
**Lines 198-202**: Fallback `videoDb.updateJob()` 
```typescript
} else {
  // Fallback to video-rag.db
  await this.videoDb.updateJob(jobId, {
    progress: progressUpdate.progress,
    statusMessage: progressUpdate.actionTitle,
```

**Fix**: Remove fallback or throw error

---

### 3. VideoJobOrchestrator (src/core/video-processing/VideoJobOrchestrator.ts)
**Lines 285-288**: Direct `videoDb.updateJob()` call
```typescript
} else {
  await this.videoDb.updateJob(jobId, {
    status,
    progress,
```

**Fix**: Always use VideoJobAdapter

---

### 4. VideoJobProcessor (src/core/video-job-processor.ts)
**Multiple locations**: Direct `videoDb.updateJob()` calls
- Line 321: Stalled job recovery
- Line 480: Job completion
- Line 492: Job failure
- Line 1527: Progress updates
- Line 1751: Immediate processing
- Line 1780: Error handling
- Line 2188: Notifications
- Line 2338: Phase 1 progress
- Line 2519: Enhanced batch completion
- Line 2536: Enhanced batch errors

**Fix**: All need to use VideoJobAdapter instead

---

### 5. VideoMediaAPI (src/api/video-media-api.ts)
**Lines 472-474**: DELETE operation
```typescript
DELETE FROM video_processing_jobs WHERE video_path = ?
```

**Fix**: Use VideoJobAdapter.deleteVideoJob() instead

---

## Solution Strategy

1. **Make VideoJobAdapter mandatory** - Remove all fallback code
2. **Add error checking** - Throw errors if VideoJobAdapter not available
3. **Update all write operations** - Replace `videoDb.updateJob()` with `videoJobAdapter.updateVideoJob()`
4. **Test thoroughly** - Ensure no writes go to video-rag.db

## Priority
**CRITICAL** - These writes are causing data inconsistency between jobs.db and video-rag.db
