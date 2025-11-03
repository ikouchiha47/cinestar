# Retry Logic Test Suite

## Date: Nov 1, 2025 11:18am

## Test Job Details

**Job ID**: `fc711930-202f-47c5-bbd8-af74d691df56`
**Video**: `bollywood.mp4`
**Current Status**: Processing (retry_count=1)

---

## Test Suite Checklist

### Phase 1: Basic Retry Tests

#### ✅ Test 1.1: Job Completes Successfully (Baseline)
- [x] Phase 0 completes
- [x] Phase 1 completes
- [x] Job marked as 'completed'
- [x] retry_count = 0

**Status**: ✅ PASSED (initial run completed successfully)

#### ⏳ Test 1.2: Single Retry After Failure
**Objective**: Test that failed job retries once

**Steps**:
1. [ ] Wait for current processing to complete
2. [ ] Verify job status is 'completed'
3. [ ] Manually set job to failed:
   ```sql
   UPDATE indexing_jobs 
   SET status='failed', 
       last_error='Test failure - simulated error',
       progress=50
   WHERE id='fc711930-202f-47c5-bbd8-af74d691df56';
   ```
4. [ ] Simulate coordinator reporting failure (or wait for orchestrator to pick up)
5. [ ] Check job is re-enqueued with retry_count=1

**Expected Results**:
- [ ] Job status changes to 'pending'
- [ ] retry_count increments to 1
- [ ] last_error is preserved
- [ ] Orchestrator picks up job
- [ ] Job processes successfully

**Verification Queries**:
```sql
-- Check retry status
SELECT id, status, retry_count, last_error, progress 
FROM indexing_jobs 
WHERE id='fc711930-202f-47c5-bbd8-af74d691df56';

-- Check logs
tail -f logs_6 | grep -E "COORDINATOR.*retry|re-enqueued"
```

#### ⏳ Test 1.3: Multiple Retries (2nd Attempt)
**Objective**: Test that job retries multiple times

**Steps**:
1. [ ] After Test 1.2 completes successfully
2. [ ] Set job to failed again:
   ```sql
   UPDATE indexing_jobs 
   SET status='failed', 
       last_error='Test failure - 2nd attempt',
       progress=75
   WHERE id='fc711930-202f-47c5-bbd8-af74d691df56';
   ```
3. [ ] Verify retry_count increments to 2

**Expected Results**:
- [ ] Job re-enqueued with retry_count=2
- [ ] Job processes successfully again

#### ⏳ Test 1.4: Max Retries Exceeded
**Objective**: Test that job fails permanently after 3 retries

**Steps**:
1. [ ] After Test 1.3 completes
2. [ ] Set job to failed with retry_count=3:
   ```sql
   UPDATE indexing_jobs 
   SET status='failed', 
       retry_count=3,
       last_error='Test failure - 3rd attempt (max retries)'
   WHERE id='fc711930-202f-47c5-bbd8-af74d691df56';
   ```
3. [ ] Try to trigger retry

**Expected Results**:
- [ ] Job stays as 'failed'
- [ ] retry_count = 3
- [ ] Logs show: `[VIDEO-COORDINATOR] ❌ Permanently failed after 3 attempts`
- [ ] Job NOT re-enqueued

**Verification**:
```sql
SELECT id, status, retry_count, last_error 
FROM indexing_jobs 
WHERE id='fc711930-202f-47c5-bbd8-af74d691df56';
```

---

### Phase 2: Automatic Retry Tests

#### ⏳ Test 2.1: Transient Failure - Ollama Down
**Objective**: Test automatic retry when Ollama is temporarily unavailable

**Steps**:
1. [ ] Stop Ollama: `docker stop ollama`
2. [ ] Upload new video or trigger new job
3. [ ] Job should fail during Phase 0 (transcription)
4. [ ] Verify coordinator auto-retries
5. [ ] Start Ollama: `docker start ollama`
6. [ ] Verify job succeeds on retry

**Expected Results**:
- [ ] Job fails with error about Ollama connection
- [ ] Coordinator logs: `🔄 Job re-enqueued (attempt 1/3)`
- [ ] retry_count increments automatically
- [ ] Job succeeds after Ollama restart

**Logs to watch**:
```bash
tail -f logs_6 | grep -E "COORDINATOR|Ollama|connection|retry"
```

#### ⏳ Test 2.2: Transient Failure - Network Timeout
**Objective**: Test retry on network-related failures

**Steps**:
1. [ ] Simulate network issue (if possible)
2. [ ] Or use timeout configuration
3. [ ] Verify automatic retry

**Expected Results**:
- [ ] Job retries automatically
- [ ] Succeeds after network recovers

#### ⏳ Test 2.3: Permanent Failure - File Not Found
**Objective**: Test that permanent errors don't retry indefinitely

**Steps**:
1. [ ] Create job for non-existent video file
2. [ ] Job should fail immediately
3. [ ] Verify it retries but eventually fails permanently

**Expected Results**:
- [ ] Retries 3 times
- [ ] Each retry fails quickly (file not found)
- [ ] After 3 attempts: permanently failed

---

### Phase 3: Coordinator Integration Tests

#### ⏳ Test 3.1: reportJobComplete - Success Path
**Objective**: Verify coordinator handles success correctly

**Steps**:
1. [ ] Monitor coordinator when job completes
2. [ ] Verify no retry logic triggered
3. [ ] Verify job marked as 'completed'

**Expected Logs**:
```
[VIDEO-COORDINATOR] ✅ Worker worker-1 completed job fc711930...
```

#### ⏳ Test 3.2: reportJobComplete - Failure Path
**Objective**: Verify coordinator triggers retry on failure

**Steps**:
1. [ ] Cause job to fail during processing
2. [ ] Monitor coordinator response
3. [ ] Verify retry logic executes

**Expected Logs**:
```
[VIDEO-COORDINATOR] 🔄 Worker worker-1 job fc711930... failed, re-enqueued for retry (attempt 1/3): [error]
```

#### ⏳ Test 3.3: reportJobComplete - Max Retries
**Objective**: Verify coordinator handles max retries

**Steps**:
1. [ ] Set retry_count=3
2. [ ] Cause failure
3. [ ] Verify coordinator marks as permanently failed

**Expected Logs**:
```
[VIDEO-COORDINATOR] ❌ Worker worker-1 job fc711930... permanently failed after 3 attempts: [error]
```

---

### Phase 4: Database Consistency Tests

#### ⏳ Test 4.1: Retry Count Persistence
**Objective**: Verify retry_count persists across restarts

**Steps**:
1. [ ] Set job to retry_count=2
2. [ ] Restart app
3. [ ] Verify retry_count still = 2

**Verification**:
```sql
SELECT retry_count FROM indexing_jobs WHERE id='fc711930-202f-47c5-bbd8-af74d691df56';
```

#### ⏳ Test 4.2: Last Error Tracking
**Objective**: Verify last_error is updated correctly

**Steps**:
1. [ ] Cause failure with specific error message
2. [ ] Verify last_error contains the message
3. [ ] Cause different failure
4. [ ] Verify last_error updates

**Verification**:
```sql
SELECT last_error FROM indexing_jobs WHERE id='fc711930-202f-47c5-bbd8-af74d691df56';
```

#### ⏳ Test 4.3: Retry Indexes Performance
**Objective**: Verify retry indexes work efficiently

**Steps**:
1. [ ] Create multiple jobs with different retry_counts
2. [ ] Query for jobs needing retry
3. [ ] Verify query uses index

**Verification**:
```sql
EXPLAIN QUERY PLAN
SELECT * FROM indexing_jobs 
WHERE status='pending' AND retry_count > 0;
```

---

### Phase 5: Image Job Retry Tests

#### ⏳ Test 5.1: Image Job Single Retry
**Objective**: Verify image jobs also retry correctly

**Steps**:
1. [ ] Process image
2. [ ] Set image job to failed
3. [ ] Verify retry logic works

**Expected Results**:
- [ ] Image job retries
- [ ] Uses same retry logic as video

#### ⏳ Test 5.2: Image Job Max Retries
**Objective**: Verify image jobs respect max retries

**Steps**:
1. [ ] Set image job retry_count=3
2. [ ] Cause failure
3. [ ] Verify permanently failed

---

### Phase 6: Stalled Job Recovery Tests

#### ⏳ Test 6.1: Stalled Recovery Still Works
**Objective**: Verify stalled recovery doesn't conflict with retry

**Steps**:
1. [ ] Start video processing
2. [ ] Kill app mid-processing
3. [ ] Restart app
4. [ ] Verify stalled recovery runs
5. [ ] Verify job resumes correctly

**Expected Logs**:
```
[VIDEO-JOB-PROCESSOR] 🔧 Recovering stalled jobs...
[VIDEO-JOB-PROCESSOR] 🔄 Resumed stalled job at X%
```

#### ⏳ Test 6.2: Stalled + Retry Interaction
**Objective**: Verify stalled recovery works with retry_count

**Steps**:
1. [ ] Set job to retry_count=1
2. [ ] Start processing
3. [ ] Kill app
4. [ ] Restart
5. [ ] Verify retry_count preserved

---

### Phase 7: Recon Flow Tests (Future)

#### 📝 Test 7.1: Recon Job Creation
**Objective**: Create recon job after permanent failure

**Design**:
```
Job fails permanently (retry_count >= 3)
    ↓
Create recon job
    ↓
Analyze failure:
  - Check logs for error patterns
  - Check database state
  - Check file existence
  - Check service availability
    ↓
Generate report:
  - Root cause
  - Suggested fixes
  - Retry with different params?
```

**Steps** (to implement):
1. [ ] Design recon job schema
2. [ ] Create recon job processor
3. [ ] Implement failure analysis
4. [ ] Generate actionable reports

#### 📝 Test 7.2: Recon-Triggered Retry
**Objective**: Retry job after recon suggests fix

**Design**:
```
Recon job completes
    ↓
Identifies fixable issue (e.g., service was down)
    ↓
Suggests retry with adjusted params
    ↓
User approves or auto-retry
    ↓
Create new job with fixes
```

**Steps** (to implement):
1. [ ] Design recon → retry flow
2. [ ] Implement parameter adjustment
3. [ ] Add user approval UI
4. [ ] Test end-to-end flow

#### 📝 Test 7.3: Recon Failure Patterns
**Objective**: Learn from failures to prevent future issues

**Design**:
```
Collect failure data:
  - Error messages
  - Retry counts
  - Time to failure
  - System state
    ↓
Identify patterns:
  - Common errors
  - Time-based failures
  - Resource-related issues
    ↓
Suggest improvements:
  - Increase timeouts
  - Add health checks
  - Improve error messages
```

---

## Test Execution Order

### Immediate Tests (Today)
1. ✅ Test 1.1 - Baseline (already passed)
2. ⏳ Test 1.2 - Single retry
3. ⏳ Test 1.3 - Multiple retries
4. ⏳ Test 1.4 - Max retries
5. ⏳ Test 3.1 - Coordinator success
6. ⏳ Test 3.2 - Coordinator failure
7. ⏳ Test 3.3 - Coordinator max retries

### Short-term Tests (This Week)
1. ⏳ Test 2.1 - Ollama down
2. ⏳ Test 2.2 - Network timeout
3. ⏳ Test 2.3 - Permanent failure
4. ⏳ Test 4.1 - Retry persistence
5. ⏳ Test 4.2 - Error tracking
6. ⏳ Test 5.1 - Image retry
7. ⏳ Test 6.1 - Stalled recovery

### Future Tests (Next Sprint)
1. 📝 Test 7.1 - Recon job creation
2. 📝 Test 7.2 - Recon-triggered retry
3. 📝 Test 7.3 - Failure pattern analysis

---

## Success Criteria

### Must Pass (Critical)
- [ ] Test 1.2 - Single retry works
- [ ] Test 1.4 - Max retries enforced
- [ ] Test 3.2 - Coordinator triggers retry
- [ ] Test 3.3 - Coordinator handles max retries
- [ ] Test 6.1 - Stalled recovery still works

### Should Pass (Important)
- [ ] Test 2.1 - Transient failures handled
- [ ] Test 4.1 - Retry count persists
- [ ] Test 5.1 - Image jobs retry
- [ ] Test 6.2 - Stalled + retry interaction

### Nice to Have (Future)
- [ ] Test 7.1 - Recon job creation
- [ ] Test 7.2 - Recon-triggered retry
- [ ] Test 7.3 - Failure pattern analysis

---

## Monitoring Commands

### Check Job Status
```sql
SELECT 
  id, 
  status, 
  retry_count, 
  last_error, 
  progress,
  created_at,
  started_at,
  completed_at
FROM indexing_jobs 
WHERE id='fc711930-202f-47c5-bbd8-af74d691df56';
```

### Watch Logs
```bash
# All retry-related logs
tail -f logs_6 | grep -E "COORDINATOR|retry|re-enqueued"

# Specific job logs
tail -f logs_6 | grep "fc711930"

# Error logs
tail -f logs_6 | grep -E "Error|error|failed|❌"
```

### Find All Retried Jobs
```sql
SELECT 
  id, 
  file_name,
  status, 
  retry_count, 
  last_error 
FROM indexing_jobs 
WHERE retry_count > 0
ORDER BY retry_count DESC;
```

### Retry Statistics
```sql
SELECT 
  status,
  retry_count,
  COUNT(*) as count
FROM indexing_jobs
WHERE job_type='video_processing'
GROUP BY status, retry_count
ORDER BY retry_count DESC;
```

---

## Notes

- All tests use job ID: `fc711930-202f-47c5-bbd8-af74d691df56`
- Database: `data/jobs.db`
- Logs: `logs_6`
- Max retries: 3
- Retry logic in: `src/core/video-job-coordinator.ts` and `src/core/image-job-coordinator.ts`

---

## Test Results Log

### Test 1.1: Baseline ✅
- **Date**: Nov 1, 2025 11:05am
- **Result**: PASSED
- **Notes**: Job completed successfully, retry_count=0

### Test 1.2: Single Retry ⏳
- **Date**: Pending
- **Result**: Waiting for current processing to complete
- **Notes**: Job currently processing with retry_count=1

---

## Future Enhancements

### Recon System Design

**Database Schema**:
```sql
CREATE TABLE recon_jobs (
  id TEXT PRIMARY KEY,
  failed_job_id TEXT NOT NULL,
  status TEXT CHECK(status IN ('pending','analyzing','completed','failed')),
  failure_analysis TEXT, -- JSON
  suggested_fixes TEXT,  -- JSON
  created_at TEXT,
  completed_at TEXT
);

CREATE TABLE failure_patterns (
  id TEXT PRIMARY KEY,
  error_pattern TEXT,
  frequency INTEGER,
  suggested_fix TEXT,
  success_rate REAL,
  last_seen TEXT
);
```

**Recon Job Flow**:
1. Detect permanent failure (retry_count >= 3)
2. Create recon job
3. Analyze:
   - Parse error messages
   - Check system state
   - Review logs
   - Check file/service availability
4. Generate report
5. Suggest fixes or retry with adjustments
6. Track success rate of suggestions

**Integration Points**:
- VideoJobCoordinator.reportJobComplete() - Create recon job on permanent failure
- New ReconJobProcessor - Process recon jobs
- UI - Display recon results and suggestions
- Analytics - Track failure patterns over time
