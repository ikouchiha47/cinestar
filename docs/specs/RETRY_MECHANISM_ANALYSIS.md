# Retry Mechanism Analysis

## Date: Nov 1, 2025 4:53am

## TL;DR

✅ **Retry mechanism EXISTS** but is **NOT being called automatically**!

## Current Architecture

### Database Schema (vector.db)

```sql
CREATE TABLE indexing_jobs (
  id TEXT PRIMARY KEY,
  status TEXT DEFAULT 'pending',  -- 'pending', 'running', 'completed', 'failed'
  retry_count INTEGER DEFAULT 0,  -- ✅ Retry counter exists!
  last_error TEXT,                -- ✅ Error tracking exists!
  priority INTEGER DEFAULT 0,
  -- ... other fields
);

-- ✅ Index for efficient retry queries
CREATE INDEX idx_jobs_retry 
ON indexing_jobs(job_type, status, retry_count);
```

### Retry Logic EXISTS

**File**: `src/core/image-job-processor.ts`

```typescript
async retryFailedJobs(): Promise<void> {
  const stmt = this.jobsDb.db.prepare(`
    SELECT id, retry_count
    FROM indexing_jobs
    WHERE job_type = 'image_processing'
      AND status = 'failed'
      AND retry_count < 3  // ✅ Max 3 retries
  `);
  
  const failedJobs = stmt.all() as any[];
  
  for (const job of failedJobs) {
    // ✅ Reset to pending and increment retry count
    this.jobsDb.db.prepare(`
      UPDATE indexing_jobs 
      SET status = 'pending', retry_count = retry_count + 1
      WHERE id = ?
    `).run(job.id);
  }
}
```

### Error Handling EXISTS

**File**: `src/core/image-job-coordinator.ts`

```typescript
async reportJobComplete(workerId: string, jobId: string, success: boolean, error?: string) {
  if (success) {
    await this.db.updateJobStatus(jobId, 'completed', 100);
  } else {
    // ✅ Jobs ARE marked as failed with error message
    await this.db.updateJobStatusWithError(jobId, 'failed', 0, error);
  }
}
```

## The Problem

### ❌ Retry Method is NEVER Called

**The `retryFailedJobs()` method exists but nothing calls it!**

```typescript
// Method exists in ImageJobProcessor
async retryFailedJobs(): Promise<void> { ... }

// But grep shows it's NEVER called anywhere!
// No scheduler, no periodic check, no manual trigger
```

### Current Flow

```
Image Processing → Error → Mark as 'failed' → ❌ STOPS HERE
                                              ↑
                                    Should trigger retry!
```

## What SHOULD Happen

### Option 1: Periodic Retry Check (Recommended)

Add a periodic scheduler that checks for failed jobs:

```typescript
// In ImageJobProcessor or main.ts
setInterval(async () => {
  await imageProcessor.retryFailedJobs();
}, 60000); // Check every 60 seconds
```

### Option 2: Immediate Re-enqueue on Failure

When a job fails, immediately re-enqueue it if retry_count < max:

```typescript
async reportJobComplete(workerId: string, jobId: string, success: boolean, error?: string) {
  if (!success) {
    const job = await this.db.getJob(jobId);
    
    if (job.retry_count < 3) {
      // ✅ Immediate re-enqueue
      await this.db.db.prepare(`
        UPDATE indexing_jobs 
        SET status = 'pending', 
            retry_count = retry_count + 1,
            last_error = ?
        WHERE id = ?
      `).run(error, jobId);
      
      console.log(`[RETRY] Job ${jobId} re-enqueued (attempt ${job.retry_count + 1}/3)`);
    } else {
      // Max retries exceeded
      await this.db.updateJobStatusWithError(jobId, 'failed', 0, error);
      console.error(`[RETRY] Job ${jobId} permanently failed after 3 attempts`);
    }
  }
}
```

### Option 3: Delayed Retry with Backoff

Add exponential backoff between retries:

```typescript
async reportJobComplete(workerId: string, jobId: string, success: boolean, error?: string) {
  if (!success) {
    const job = await this.db.getJob(jobId);
    
    if (job.retry_count < 3) {
      // Calculate backoff delay
      const delayMs = Math.min(1000 * Math.pow(2, job.retry_count), 60000);
      
      // Schedule retry after delay
      setTimeout(async () => {
        await this.db.db.prepare(`
          UPDATE indexing_jobs 
          SET status = 'pending', retry_count = retry_count + 1
          WHERE id = ?
        `).run(jobId);
        
        console.log(`[RETRY] Job ${jobId} retrying after ${delayMs}ms delay`);
      }, delayMs);
    }
  }
}
```

## Comparison with Video Jobs

**Video jobs have better retry infrastructure:**

**File**: `src/core/keyframe-refinement-job-queue.ts`

```typescript
// ✅ Has retry_count and max_retries in schema
CREATE TABLE jobs (
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  last_error TEXT
);

// ✅ Automatically increments retry_count on failure
this.db.prepare(`
  UPDATE jobs 
  SET status = 'failed', 
      last_error = ?, 
      retry_count = retry_count + 1  // ✅ Auto-increment
  WHERE id = ?
`).run(message, job.id);
```

## Recommended Solution

### Implement Automatic Retry on Failure

**Update `image-job-coordinator.ts`:**

```typescript
async reportJobComplete(workerId: string, jobId: string, success: boolean, error?: string): Promise<void> {
  if (success) {
    await this.db.updateJobStatus(jobId, 'completed', 100);
    console.log(`[IMAGE-COORDINATOR] ✅ Worker ${workerId} completed job ${jobId}`);
  } else {
    // Get current retry count
    const job = this.db.db.prepare(`
      SELECT retry_count FROM indexing_jobs WHERE id = ?
    `).get(jobId) as any;
    
    const maxRetries = 3;
    
    if (job && job.retry_count < maxRetries) {
      // Re-enqueue for retry
      this.db.db.prepare(`
        UPDATE indexing_jobs 
        SET status = 'pending', 
            retry_count = retry_count + 1,
            last_error = ?
        WHERE id = ?
      `).run(error, jobId);
      
      console.log(`[IMAGE-COORDINATOR] 🔄 Worker ${workerId} job ${jobId} failed, re-enqueued (attempt ${job.retry_count + 1}/${maxRetries})`);
    } else {
      // Max retries exceeded or job not found
      await this.db.updateJobStatusWithError(jobId, 'failed', 0, error);
      console.error(`[IMAGE-COORDINATOR] ❌ Worker ${workerId} job ${jobId} permanently failed after ${maxRetries} attempts: ${error}`);
    }
  }
}
```

### Add Periodic Cleanup (Optional)

**In `electron/main.ts` or `ImageJobProcessor`:**

```typescript
// Check for stuck jobs every 5 minutes
setInterval(async () => {
  // Find jobs that have been 'running' for too long (e.g., > 10 minutes)
  const stuckJobs = db.prepare(`
    SELECT id, retry_count 
    FROM indexing_jobs 
    WHERE status = 'running' 
      AND started_at < datetime('now', '-10 minutes')
      AND retry_count < 3
  `).all();
  
  for (const job of stuckJobs) {
    // Reset to pending for retry
    db.prepare(`
      UPDATE indexing_jobs 
      SET status = 'pending', 
          retry_count = retry_count + 1,
          last_error = 'Job timeout - stuck in running state'
      WHERE id = ?
    `).run(job.id);
    
    console.log(`[RETRY-CLEANUP] Reset stuck job ${job.id}`);
  }
}, 5 * 60 * 1000);
```

## Benefits of Automatic Retry

### 1. **Transient Failures Handled**
- Network timeouts
- Ollama temporarily unavailable
- Resource constraints

### 2. **No Manual Intervention**
- Jobs automatically retry
- Exponential backoff prevents thundering herd
- Max retries prevents infinite loops

### 3. **Better Observability**
- `retry_count` shows how many attempts
- `last_error` shows what failed
- Can query failed jobs: `SELECT * FROM indexing_jobs WHERE status='failed' AND retry_count >= 3`

### 4. **Consistent with Video Jobs**
- Video jobs already have this pattern
- Images should work the same way

## Current State vs Desired State

### Current ❌
```
Job fails → Mark as 'failed' → Sits in database forever
```

### Desired ✅
```
Job fails → Check retry_count → If < 3: Re-enqueue → Retry
                               → If >= 3: Mark as permanently failed
```

## Implementation Priority

**HIGH PRIORITY** - This is a critical missing piece:

1. ✅ Schema supports retries (retry_count exists)
2. ✅ Error tracking exists (last_error field)
3. ✅ Retry method exists (retryFailedJobs())
4. ❌ **Missing**: Automatic triggering of retries

**Quick Win**: Add 5-10 lines of code to `reportJobComplete()` to enable automatic retries.

## Testing

After implementing:

1. **Trigger a failure** (e.g., stop Ollama)
2. **Check logs** for retry messages
3. **Query database**:
   ```sql
   SELECT id, status, retry_count, last_error 
   FROM indexing_jobs 
   WHERE job_type = 'image_processing' 
   ORDER BY created_at DESC 
   LIMIT 10;
   ```
4. **Verify** jobs are retried up to 3 times
5. **Verify** jobs marked as permanently failed after 3 attempts

## Related Files

- `src/core/image-job-processor.ts` - Has retry method (unused)
- `src/core/image-job-coordinator.ts` - Needs retry logic in reportJobComplete()
- `src/core/keyframe-refinement-job-queue.ts` - Good example of working retry
- `src/core/config.ts` - Has retry config (retryAttempts, retryDelayMs)
