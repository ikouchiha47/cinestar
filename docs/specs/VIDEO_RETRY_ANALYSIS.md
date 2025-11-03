# Video Job Retry Analysis

## Date: Nov 1, 2025 5:17am

## TL;DR

**Video jobs have DIFFERENT retry strategy than image jobs:**
- ❌ **No retry_count field** in database
- ❌ **No automatic retry on failure**
- ✅ **HAS stalled job recovery** on startup
- ✅ **HAS batch-level resilience** (continues on batch failure)

## Current Video Job Architecture

### Database Schema (jobs.db)

```sql
CREATE TABLE job_runs (
  id TEXT PRIMARY KEY,
  status TEXT CHECK(status IN ('pending','running','succeeded','failed','canceled')),
  progress INTEGER DEFAULT 0,
  error TEXT,
  -- ❌ NO retry_count field
  -- ❌ NO last_error tracking
  -- ❌ NO max_retries
);
```

### Video Job Coordinator

**File**: `src/core/video-job-coordinator.ts`

```typescript
async reportJobComplete(workerId: string, jobId: string, success: boolean, error?: string) {
  if (success) {
    await this.videoJobAdapter.updateVideoJob(jobId, {
      status: 'completed',
      progress: 100
    });
  } else {
    // ❌ NO RETRY LOGIC - Just marks as failed
    await this.videoJobAdapter.updateVideoJob(jobId, {
      status: 'failed',
      progress: 0,
      error: error
    });
  }
}
```

## What Video Jobs DO Have

### 1. Stalled Job Recovery ✅

**On startup**, recovers jobs stuck in 'processing' state:

```typescript
// src/core/video-job-processor.ts
async recoverStalledVideoJobs() {
  // Find jobs stuck in 'processing'
  const stalledJobs = await db.prepare(`
    SELECT id FROM video_processing_jobs 
    WHERE status = 'processing'
  `).all();
  
  for (const job of stalledJobs) {
    // Calculate progress from completed batches
    const {phase0, phase1, totalBatches} = await this.getCompletedBatches(job.id);
    
    // Reset to 'scheduled' with correct progress
    await db.updateVideoJob(job.id, {
      status: 'scheduled',
      progress: calculatedProgress,
      currentPhase: determinePhase(phase0, phase1)
    });
    
    console.log(`🔄 Resumed stalled job at ${progress}%`);
  }
}
```

**This handles:**
- App crashes
- System restarts
- Process kills
- Network interruptions

**But NOT:**
- Permanent failures (marked as 'failed')
- Transient errors during processing

### 2. Batch-Level Resilience ✅

**Continues processing even if individual batches fail:**

```typescript
// src/core/video-processing/BatchManager.ts
async processPhase0(batches) {
  for (const batch of batches) {
    try {
      await this.processBatch(batch);
      results.push(batch);
    } catch (error) {
      console.error(`❌ Phase 0 failed for batch ${i}:`, error);
      // ✅ Continue with other batches instead of failing entire job
    }
  }
  return results; // Returns successful batches
}
```

**Benefits:**
- One bad batch doesn't kill entire video
- Partial success is better than total failure
- Can manually retry failed batches later

## Comparison: Image vs Video Jobs

### Image Jobs (After Our Fix)

| Feature | Status |
|---------|--------|
| retry_count field | ✅ Yes |
| Automatic retry | ✅ Yes (just added!) |
| Max retries | ✅ 3 attempts |
| Stalled recovery | ❌ No |
| Batch resilience | ❌ N/A (single-step) |

**Flow:**
```
Fail → Check retry_count → Retry up to 3 times → Permanent failure
```

### Video Jobs (Current)

| Feature | Status |
|---------|--------|
| retry_count field | ❌ No |
| Automatic retry | ❌ No |
| Max retries | ❌ No |
| Stalled recovery | ✅ Yes (on startup) |
| Batch resilience | ✅ Yes (continues on batch failure) |

**Flow:**
```
Fail → Mark as 'failed' → Manual intervention needed
Stalled → On restart: Resume from last completed batch
```

## Should Video Jobs Have Retry?

### Arguments FOR Adding Retry

**1. Consistency**
- Image jobs now have retry
- Users expect same behavior

**2. Transient Failures**
- Ollama restart during processing
- Network timeouts
- Resource constraints

**3. Long Processing Time**
- Videos take 5-20 minutes to process
- Losing all progress on transient error is painful

### Arguments AGAINST Adding Retry

**1. Already Has Stalled Recovery**
- Handles most failure scenarios
- Resumes from last completed batch
- No data loss

**2. Batch-Level Resilience**
- Individual batch failures don't kill job
- Can continue with partial success
- More granular than job-level retry

**3. Different Failure Modes**
- Videos fail at batch level, not job level
- Batch failures are logged but job continues
- Job-level failures are usually fatal (file not found, etc.)

**4. Complexity**
- Video processing has 2 phases
- Each phase has multiple batches
- Retry logic would be complex

## Recommended Approach

### Option 1: Add Retry (Like Images) ✅

**Pros:**
- Consistent with image jobs
- Handles transient failures
- User-friendly

**Cons:**
- May retry unnecessarily (stalled recovery already handles most cases)
- Adds complexity to already complex system

**Implementation:**
```typescript
// Add to job_runs table
ALTER TABLE job_runs ADD COLUMN retry_count INTEGER DEFAULT 0;
ALTER TABLE job_runs ADD COLUMN max_retries INTEGER DEFAULT 3;

// Update VideoJobCoordinator.reportJobComplete()
async reportJobComplete(workerId, jobId, success, error) {
  if (!success) {
    const job = await db.getJob(jobId);
    
    if (job.retry_count < 3) {
      // Re-enqueue
      await db.updateJob(jobId, {
        status: 'pending',
        retry_count: job.retry_count + 1,
        error: error
      });
      console.log(`🔄 Video job re-enqueued (attempt ${job.retry_count + 1}/3)`);
    } else {
      // Permanently failed
      await db.updateJob(jobId, {
        status: 'failed',
        error: error
      });
      console.error(`❌ Video job permanently failed after 3 attempts`);
    }
  }
}
```

### Option 2: Enhance Stalled Recovery (Current + Improvements) ⚠️

**Keep current system but improve:**

**Add periodic stalled check** (not just on startup):
```typescript
// Check every 5 minutes
setInterval(async () => {
  await this.recoverStalledVideoJobs();
}, 5 * 60 * 1000);
```

**Add batch retry logic:**
```typescript
// Retry failed batches instead of skipping them
async processPhase0(batches) {
  for (const batch of batches) {
    let attempts = 0;
    while (attempts < 3) {
      try {
        await this.processBatch(batch);
        break; // Success
      } catch (error) {
        attempts++;
        if (attempts >= 3) {
          console.error(`❌ Batch ${batch.id} failed after 3 attempts`);
          // Mark batch as failed, continue with next
        } else {
          console.log(`🔄 Retrying batch ${batch.id} (attempt ${attempts}/3)`);
          await sleep(1000 * attempts); // Exponential backoff
        }
      }
    }
  }
}
```

### Option 3: Hybrid Approach (RECOMMENDED) ✅

**Combine both strategies:**

1. **Keep stalled recovery** (handles crashes/restarts)
2. **Add batch-level retry** (handles transient errors)
3. **Add job-level retry** (handles complete failures)

**Benefits:**
- ✅ Handles all failure modes
- ✅ Consistent with image jobs
- ✅ Minimal code changes
- ✅ Best user experience

## Implementation Plan

### Phase 1: Add Database Fields

```sql
-- Migration: Add retry fields to job_runs
ALTER TABLE job_runs ADD COLUMN retry_count INTEGER DEFAULT 0;
ALTER TABLE job_runs ADD COLUMN max_retries INTEGER DEFAULT 3;
ALTER TABLE job_runs ADD COLUMN last_error TEXT;
```

### Phase 2: Update VideoJobCoordinator

```typescript
// src/core/video-job-coordinator.ts
async reportJobComplete(workerId: string, jobId: string, success: boolean, error?: string) {
  if (success) {
    // Existing success logic
  } else {
    // NEW: Add retry logic
    const job = await this.videoJobAdapter.getJob(jobId);
    const maxRetries = 3;
    
    if (job && job.retry_count < maxRetries) {
      await this.videoJobAdapter.updateVideoJob(jobId, {
        status: 'pending',
        retry_count: job.retry_count + 1,
        last_error: error
      });
      console.log(`[VIDEO-COORDINATOR] 🔄 Job ${jobId} re-enqueued (attempt ${job.retry_count + 1}/${maxRetries})`);
    } else {
      await this.videoJobAdapter.updateVideoJob(jobId, {
        status: 'failed',
        error: error
      });
      console.error(`[VIDEO-COORDINATOR] ❌ Job ${jobId} permanently failed after ${maxRetries} attempts`);
    }
  }
}
```

### Phase 3: Add Batch-Level Retry (Optional)

```typescript
// src/core/video-processing/BatchManager.ts
async processBatchWithRetry(batch: Batch, maxAttempts: number = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await this.processBatch(batch);
    } catch (error) {
      if (attempt >= maxAttempts) {
        console.error(`❌ Batch ${batch.id} failed after ${maxAttempts} attempts`);
        throw error;
      }
      console.log(`🔄 Retrying batch ${batch.id} (attempt ${attempt}/${maxAttempts})`);
      await sleep(1000 * attempt); // Exponential backoff
    }
  }
}
```

## Testing

### Test Stalled Recovery (Already Works)
```bash
# Start video processing
# Kill the app mid-processing
# Restart app
# Check logs for "Resumed stalled job"
```

### Test Job-Level Retry (After Implementation)
```bash
# Stop Ollama
docker stop ollama

# Start video processing
# Job should fail and retry

# Start Ollama
docker start ollama

# Job should succeed on retry
```

### Test Batch-Level Retry (After Implementation)
```bash
# Cause intermittent failures
# Individual batches should retry
# Job should complete with all batches processed
```

## Summary

**Current State:**
- ❌ No automatic retry on job failure
- ✅ Stalled job recovery on startup
- ✅ Batch-level resilience

**Recommended:**
- ✅ Add job-level retry (like images)
- ✅ Keep stalled recovery
- ✅ Optionally add batch-level retry

**Benefits:**
- Consistent behavior across image and video jobs
- Better handling of transient failures
- Improved user experience
- No data loss on recoverable errors

**Next Steps:**
1. Add retry_count fields to job_runs table
2. Implement retry logic in VideoJobCoordinator
3. Test with transient failures
4. Monitor retry success rate
