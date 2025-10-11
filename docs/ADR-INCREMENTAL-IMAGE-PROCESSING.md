# ADR-006: Incremental Batch Image Processing

**Status:** Proposed  
**Date:** 2025-10-10  
**Authors:** System Architecture Team

---

## Context

### Current Problem

Images are processed **sequentially one at a time** in `MainMediaAPI.performIndexing()`:
- **43 images = 43 sequential API calls** (~3s each = **2+ minutes total**)
- **No incremental loading** - users wait for entire batch to complete
- **No batch processing** - unlike video processing which uses batches
- **Poor fault tolerance** - one failure can block entire indexing
- **No retry mechanism** - failed images require full re-index

### Performance Impact
```typescript
// Current: Sequential processing
for (const file of mediaFiles) {  // 43 iterations
  await generateCaption(file);     // 3s per image
  await generateEmbedding(file);   // 0.5s per image
  // Total: ~150 seconds for 43 images
}
```

### User Experience Issues
- ❌ Long wait times before any images appear
- ❌ No visibility into processing progress
- ❌ Cannot use partially processed results
- ❌ App appears frozen during indexing

---

## Decision

**Implement individual job-based architecture with batch processing at execution time.**

### Architecture Pattern

Following the proven video processing pattern:
- **1 image = 1 job** (granular tracking)
- **Worker pulls N jobs** at a time (batch efficiency)
- **Process concurrently** (parallel execution)
- **Update individually** (fault tolerance)

### Why Individual Jobs?

**Industry Standard Pattern** (Celery, Bull, Sidekiq, RabbitMQ):
```
Job Queue: [Job1, Job2, Job3, ..., JobN]
Worker Pool: Pulls jobs in batches → Processes → Updates status
```

**Benefits:**
- ✅ **Granular failure tracking** - Each image has its own status
- ✅ **Built-in retry logic** - Re-queue failed jobs
- ✅ **Observability** - `SELECT * FROM jobs WHERE status='failed'`
- ✅ **Idempotency** - Safe to replay failed jobs
- ✅ **Priority queuing** - Can prioritize specific images
- ✅ **Fault tolerance** - Partial success is automatic

**Database Overhead Analysis:**
```
Job row size: ~200 bytes
43 jobs = 8.6 KB
1000 jobs = 200 KB
Negligible! Real bottleneck: LLM inference time
```

---

## Proposed Architecture

### Phase 1: Scan & Store Immediately (Instant Visibility)

**Key Insight:** Add files to main DB immediately so `getRecentItems()` shows them NOW. Background jobs handle caption/embedding async.

```typescript
async performIndexing(scanJobId: string, sourceId: string): Promise<void> {
  const source = await this.db.getSource(sourceId);
  const mediaFiles = await scanDirectory(source.path);
  
  // IMMEDIATELY add to main DB - users see them NOW
  for (const file of mediaFiles) {
    const itemId = await generateDeterministicId(file.path);
    
    // 1. Add to main DB (media_items table) - INSTANT VISIBILITY
    await this.db.addMediaItem({
      id: itemId,
      sourceId,
      name: file.name,
      path: file.path,
      size: file.size,
      type: file.type,
      mimeType: getMimeType(file.path),
      createdAt: new Date(),
      modifiedAt: file.lastModified,
      metadata: {} // Can add thumbnailPath later
    });
    
    // 2. Add to vector DB with status='pending' - SEARCHABLE LATER
    await this.vecDb.addMediaItemWithIdAsync(itemId, {
      sourceId,
      name: file.name,
      path: file.path,
      size: file.size,
      type: file.type,
      captionStatus: 'pending',    // ← Background will process
      embeddingStatus: 'pending',  // ← Background will process
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    
    // 3. Create background job for caption+embedding - ASYNC PROCESSING
    await this.db.createImageProcessingJob({
      id: `img_${Date.now()}_${randomId()}`,
      sourceId,
      filePath: file.path,
      fileName: file.name,
      fileSize: file.size,
      status: 'pending',
      jobType: 'image_processing',
      retryCount: 0
    });
  }
  
  // Scan complete - images visible in UI NOW, processing in background
  await this.db.updateJobStatus(scanJobId, 'completed', 100);
  
  console.log(`[INDEXING] ✅ Added ${mediaFiles.length} images to DB - visible immediately`);
  console.log(`[INDEXING] 🔄 Created ${mediaFiles.length} background jobs for caption/embedding`);
}
```

**Result:**
- ✅ **Images appear in UI immediately** after scan
- ✅ **No waiting** for caption/embedding generation
- ✅ **Background jobs** process async
- ✅ **Search becomes available** as embeddings complete

### Phase 2: Background Batch Processing

```typescript
class ImageJobProcessor {
  private batchSize = 8;
  private concurrency = 4;
  
  async start(): Promise<void> {
    while (this.isRunning) {
      await this.processNextBatch();
      await sleep(5000); // Check every 5s (like video processor)
    }
  }
  
  private async processNextBatch(): Promise<void> {
    // Pull 8 pending jobs
    const jobs = await this.db.getPendingImageJobs(this.batchSize);
    if (jobs.length === 0) return;
    
    console.log(`[IMAGE-BATCH] Processing ${jobs.length} images...`);
    
    // Process with concurrency=4
    const results = await this.processConcurrent(jobs, this.concurrency);
    
    // Update each job status independently
    for (const result of results) {
      if (result.success) {
        await this.db.updateJobStatus(result.jobId, 'completed', 100);
        console.log(`[IMAGE-BATCH] ✅ ${result.fileName} completed`);
      } else {
        await this.db.updateJobStatus(
          result.jobId, 
          'failed', 
          0, 
          result.error
        );
        console.log(`[IMAGE-BATCH] ❌ ${result.fileName} failed: ${result.error}`);
      }
    }
  }
  
  private async processConcurrent(jobs: Job[], concurrency: number): Promise<Result[]> {
    const results: Result[] = [];
    const queue = [...jobs];
    
    const worker = async () => {
      while (queue.length > 0) {
        const job = queue.shift()!;
        try {
          // 1. Compress if needed
          const inferencePath = await this.maybeCompress(job.filePath, job.fileSize);
          
          // 2. Generate caption
          const caption = await this.llm.generateImageDescription(inferencePath);
          
          // 3. Generate embedding
          const embedding = await this.llm.generateImageEmbedding(inferencePath);
          
          // 4. Update vector DB
          await this.vecDb.updateCaption(job.id, caption, 'completed');
          await this.vecDb.updateEmbedding(job.id, embedding, 'completed');
          
          results.push({ jobId: job.id, fileName: job.fileName, success: true });
        } catch (error) {
          results.push({ 
            jobId: job.id, 
            fileName: job.fileName, 
            success: false, 
            error: error.message 
          });
        }
      }
    };
    
    // Spawn N concurrent workers
    await Promise.all(Array(concurrency).fill(0).map(() => worker()));
    return results;
  }
}
```

### Phase 3: Retry Worker (Recon)

```typescript
async retryFailedJobs(): Promise<void> {
  // Simple query - no complex parsing needed
  const failedJobs = await this.db.query(`
    SELECT * FROM indexing_jobs 
    WHERE job_type='image_processing' 
    AND status='failed' 
    AND retry_count < 3
  `);
  
  console.log(`[RETRY] Found ${failedJobs.length} failed jobs`);
  
  // Reset status and let batch worker pick them up
  for (const job of failedJobs) {
    await this.db.updateJobStatus(job.id, 'pending', 0);
    await this.db.incrementRetryCount(job.id);
  }
}
```

---

## Database Schema

### Extend Existing `indexing_jobs` Table

```sql
-- Add new columns to existing table
ALTER TABLE indexing_jobs ADD COLUMN job_type TEXT DEFAULT 'scan';
ALTER TABLE indexing_jobs ADD COLUMN file_path TEXT;
ALTER TABLE indexing_jobs ADD COLUMN file_name TEXT;
ALTER TABLE indexing_jobs ADD COLUMN file_size INTEGER;
ALTER TABLE indexing_jobs ADD COLUMN retry_count INTEGER DEFAULT 0;
ALTER TABLE indexing_jobs ADD COLUMN last_error TEXT;
ALTER TABLE indexing_jobs ADD COLUMN priority INTEGER DEFAULT 0;

-- Index for efficient batch pulls
CREATE INDEX IF NOT EXISTS idx_jobs_type_status 
ON indexing_jobs(job_type, status, priority DESC);

-- Index for retry queries
CREATE INDEX IF NOT EXISTS idx_jobs_retry 
ON indexing_jobs(job_type, status, retry_count);
```

### Query Patterns

```sql
-- Batch worker: Pull 8 pending jobs
SELECT * FROM indexing_jobs 
WHERE job_type='image_processing' AND status='pending' 
ORDER BY priority DESC, created_at ASC
LIMIT 8;

-- Progress tracking
SELECT 
  COUNT(CASE WHEN status='completed' THEN 1 END) as completed,
  COUNT(CASE WHEN status='failed' THEN 1 END) as failed,
  COUNT(CASE WHEN status='pending' THEN 1 END) as pending,
  COUNT(CASE WHEN status='running' THEN 1 END) as running
FROM indexing_jobs 
WHERE job_type='image_processing' AND source_id=?;

-- Failed jobs for retry
SELECT * FROM indexing_jobs 
WHERE job_type='image_processing' 
AND status='failed' 
AND retry_count < 3;
```

---

## Implementation Plan (CEO Mode: Ship Today)

### Phase 1: Database & Core (2 hours)
1. **Database Migration** - Add `job_type`, `file_path`, `file_size`, `retry_count` columns (15 min)
2. **Database Methods** - Add `getPendingImageJobs(limit)`, `createImageProcessingJob()` (30 min)
3. **Modify `performIndexing()`** - Implement immediate DB insert + job creation (45 min)
4. **Test Scan** - Verify images appear immediately in UI (30 min)

### Phase 2: Background Worker (2 hours)
5. **Create `ImageJobProcessor`** - Copy video processor pattern (45 min)
6. **Concurrent Processing** - Implement worker pool with concurrency=4 (30 min)
7. **Wire to Electron** - Start worker in `electron/main.ts` (15 min)
8. **Test Processing** - Verify 43 images complete in <60s (30 min)

### Phase 3: Polish (Tomorrow)
9. **UI Status Badges** - Show "Processing..." vs "✓ Indexed" (1 hour)
10. **Retry Logic** - Handle failures with retry_count (30 min)
11. **Error Handling** - Graceful degradation (30 min)
12. **Production Testing** - Test with real dataset (1 hour)

**Total Time: ~4 hours for core functionality, polish tomorrow**

---

## Success Metrics

### Performance
- ✅ **Images visible IMMEDIATELY** after scan (vs 150s wait currently)
- ✅ **43 images fully indexed in <60 seconds** (vs 150s currently)
- ✅ **Batch processing: ~6 batches of 8 images** (8-10s per batch)
- ✅ **Search available incrementally** as embeddings complete

### Reliability
- ✅ **Partial success handling** - 40 succeed, 3 fail = 40 searchable
- ✅ **Automatic retry** - Failed jobs retry up to 3 times
- ✅ **Fault tolerance** - App crash doesn't lose progress

### Observability
- ✅ **Clear status tracking** - Query failed jobs easily
- ✅ **Progress visibility** - Real-time completion percentage (automatic via aggregate queries)
- ✅ **Error messages** - Know why specific images failed

---

## Progress Tracking Architecture

### The Challenge: Async Jobs vs Sync UI

**Problem Identified**: The system was designed for **synchronous job processing** where 1 user action = 1 job with `status='running'`. But we introduced **asynchronous batch processing** where 1 user action = 1 scan job (completes immediately) + N background jobs (status='pending').

**Root Cause**:
```typescript
// getActiveJobs() only returned jobs with status='running'
SELECT * FROM indexing_jobs WHERE status IN ('running')

// But our image jobs have status='pending' (background jobs!)
// Result: UI shows nothing! ❌
```

### The Solution: Aggregate Progress Tracking

Modified `SqliteMainDatabase.getActiveJobs()` to **dynamically aggregate** background image processing jobs:

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
  SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as failed
FROM indexing_jobs
WHERE job_type='image_processing'
GROUP BY source_id
HAVING pending > 0  -- Only show if work remaining

// 3. Create synthetic "aggregate job" for UI
{
  id: 'image_processing_<sourceId>',
  status: 'running',
  progress: (completed / total) * 100,  // Real-time!
  title: 'Processing Images',
  description: '32/43 images indexed (2 failed)'
}
```

### Key Architectural Insight

**The Pattern**:
```
UI Layer (polls every 2.5s)
    ↓
API Layer (getIndexingStatus)
    ↓
Database Layer (getActiveJobs) ← AGGREGATION HAPPENS HERE
    ↓
Job Storage (indexing_jobs table)
```

**Lesson Learned**: When introducing **new job types** with **different lifecycle patterns** (sync vs async), you must update the **aggregation layer** that feeds the UI. Otherwise, the UI remains unaware of background work.

### Benefits of This Approach

- ✅ **Automatic integration** - No UI changes needed
- ✅ **Single progress bar** - Aggregates all image jobs per source
- ✅ **Real-time updates** - Recalculated on every poll (2.5s)
- ✅ **Works with existing code** - Leverages existing polling infrastructure
- ✅ **Database-level aggregation** - Efficient SQL queries vs application logic

---

## Consequences

### Positive
- ✅ **60% faster processing** - Concurrent batch processing
- ✅ **Immediate feedback** - Images appear as processed
- ✅ **Better fault tolerance** - Partial success is automatic
- ✅ **Easier debugging** - Per-image status and errors
- ✅ **Retry capability** - Failed images can be reprocessed
- ✅ **Scalable** - Works with 10 or 10,000 images
- ✅ **Consistent pattern** - Matches video processing architecture

### Negative
- ⚠️ **More database rows** - 43 jobs vs 1 job (negligible overhead)
- ⚠️ **Slightly more complex** - Need background worker management
- ⚠️ **Migration required** - Database schema changes needed

### Neutral
- 🔄 **Reuses existing patterns** - Video processor architecture
- 🔄 **Incremental rollout** - Can deploy without breaking existing code

---

## Alternatives Considered

### Alternative 1: Single Job with Batch Tasks ❌
**Rejected because:**
- Need separate task tracking table (more complexity)
- Harder to implement retry logic
- Poor observability (need to parse job metadata)
- Custom failure handling required

### Alternative 2: Keep Sequential Processing ❌
**Rejected because:**
- Too slow (150s for 43 images)
- No incremental loading
- Poor user experience
- Doesn't scale

### Alternative 3: Full Parallel Processing ❌
**Rejected because:**
- Resource exhaustion (43 concurrent LLM calls)
- No rate limiting
- Potential OOM errors
- Harder to manage

---

## References

- Video processing pattern: `src/core/video-job-processor.ts`
- Batch captioning: `src/core/processors/batch-captioning-processor.ts`
- Current image indexing: `src/api/main-media-api.ts:1228-1381`
- Job queue patterns: Celery, Bull, Sidekiq, RabbitMQ

---

## Future Improvements

### 1. Parent Tracking Job Pattern (Better Architecture)

**Current Approach**: Synthetic aggregate jobs created on-the-fly via SQL queries
**Future Approach**: Create a dedicated parent tracking job

**Benefits**:
- Persistent job ID (no synthetic IDs)
- Can store additional metadata (estimated completion time, error summaries)
- Better audit trail
- Easier to implement pause/resume functionality

**Implementation**:
```typescript
// When scan completes, create a tracking job
const trackingJobId = `img_track_${sourceId}_${Date.now()}`;
await this.db.createJob({
  id: trackingJobId,
  sourceId,
  status: 'running',
  title: 'Processing Images',
  operationType: 'image_processing_tracker',
  totalItems: jobsCreated,
  processedItems: 0
});

// ImageJobProcessor updates this job as it processes
async processNextBatch() {
  // ... process batch ...
  
  // Update tracker job progress
  const stats = await this.getImageJobStats(sourceId);
  await this.db.updateJobProgress(trackingJobId, {
    progress: Math.floor((stats.completed / stats.total) * 100),
    processedItems: stats.completed
  });
  
  // Complete tracker when all done
  if (stats.completed + stats.failed === stats.total) {
    await this.db.updateJobStatus(trackingJobId, 'completed', 100);
  }
}
```

### 2. Priority Queue System

Add priority levels for image processing:
- **High**: User-initiated re-index
- **Normal**: New folder scan
- **Low**: Background re-processing

**Implementation**:
```sql
-- Already have priority column in migration!
SELECT * FROM indexing_jobs 
WHERE job_type='image_processing' AND status='pending'
ORDER BY priority DESC, created_at ASC
LIMIT 8
```

### 3. Adaptive Batch Sizing

Dynamically adjust batch size based on system load:
- Monitor LLM response times
- Increase batch size if fast (<5s per image)
- Decrease batch size if slow (>15s per image)
- Target: Keep batches completing in 30-60s

### 4. UI Status Badges

Show processing status on image cards:
```typescript
interface MediaItem {
  // ... existing fields
  processingStatus?: 'pending' | 'processing' | 'completed' | 'failed';
}

// UI shows:
// ⏳ Processing... (pending/processing)
// ✓ Indexed (completed)
// ⚠️ Failed (failed)
```

### 5. Batch Job Cancellation

Allow users to cancel in-progress image processing:
```typescript
async cancelImageProcessing(sourceId: string): Promise<void> {
  // Mark all pending jobs as cancelled
  await this.db.execute(`
    UPDATE indexing_jobs 
    SET status='cancelled' 
    WHERE source_id=? 
    AND job_type='image_processing' 
    AND status='pending'
  `, [sourceId]);
}
```

### 6. Progress Webhooks/Events

Instead of polling, emit events when progress changes:
```typescript
// ImageJobProcessor emits events
this.emit('batch:complete', {
  sourceId,
  completed: stats.completed,
  total: stats.total,
  progress: Math.floor((stats.completed / stats.total) * 100)
});

// UI listens via IPC
ipcRenderer.on('image:progress', (event, data) => {
  updateProgressBar(data.sourceId, data.progress);
});
```

### 7. Separate Ollama Instance for Image Processing

Following the video processing pattern (Memory: 53411ce8):
- **Search embeddings** → Direct Ollama (port 11434)
- **Video indexing** → Load-balanced Ollama (port 11435)
- **Image indexing** → Dedicated Ollama (port 11436) ← NEW

**Benefits**:
- No competition with video processing
- Isolated resource allocation
- Better performance monitoring

---

## Notes

This ADR follows the proven pattern already established in the video processing system. The key insight is that **individual jobs with batch execution** provides the best balance of:
- **Efficiency** (batch processing)
- **Observability** (per-job status)
- **Fault tolerance** (partial success)
- **Simplicity** (reuse existing patterns)

**Architectural Lesson**: When introducing new job types with different lifecycle patterns (sync vs async), always update the aggregation layer that feeds the UI. Database-level aggregation via SQL is more efficient than application-level aggregation.