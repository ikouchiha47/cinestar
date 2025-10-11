# Memory: Golang Scheduler Migration Proposal

**Date:** 2025-10-10  
**Status:** Proposed (ADR-005)  
**Priority:** Medium (Future Enhancement)

---

## Context

We are considering migrating the video processing job scheduler from Node.js to Golang to address performance, reliability, and scalability issues.

---

## Current Architecture (Node.js)

```
Electron App (Node.js)
    ↓
Video Job Processor (Node.js)
    ↓
FFmpeg, Whisper, Ollama
```

### Problems with Current System

1. **Single-threaded bottleneck** - Node.js event loop blocks on CPU-intensive tasks
2. **Memory leaks** - Long-running Node.js processes accumulate memory
3. **Poor concurrency** - Limited parallel processing capabilities
4. **No crash recovery** - No supervisor to restart failed jobs
5. **Resource management** - Hard to limit CPU/memory per job
6. **Plugin isolation** - Plugins run in same process as app

---

## Proposed Architecture (Golang)

```
┌─────────────────────────────────────────────────────────────┐
│                    Electron App (Node.js)                   │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         gRPC Client (Long-lived connection)          │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            ↓ gRPC
┌─────────────────────────────────────────────────────────────┐
│              Scheduler Service (Golang)                     │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                  Supervisor Manager                   │  │
│  │  - Health checks                                      │  │
│  │  - Auto-restart workers                               │  │
│  │  - Resource monitoring                                │  │
│  └──────────────────────────────────────────────────────┘  │
│                            ↓                                │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                Job Queue (SQLite)                     │  │
│  │  - Priority queues (ORDER BY)                         │  │
│  │  - Job persistence (ACID)                             │  │
│  │  - Dead letter queue (failed status)                  │  │
│  │  - Zero external dependencies                         │  │
│  └──────────────────────────────────────────────────────┘  │
│                            ↓                                │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │  Worker 1   │  │  Worker 2   │  │  Worker N   │        │
│  │  (Goroutine)│  │  (Goroutine)│  │  (Goroutine)│        │
│  │             │  │             │  │             │        │
│  │  Video      │  │  Plugin     │  │  Batch      │        │
│  │  Processing │  │  Execution  │  │  Processing │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
│         ↓                ↓                ↓                │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              Resource Manager (cgroups)              │  │
│  │  - CPU limits per worker                             │  │
│  │  - Memory limits per worker                          │  │
│  │  - I/O throttling                                    │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│              External Services                              │
│  FFmpeg, Whisper, Ollama, Plugin Processes                  │
└─────────────────────────────────────────────────────────────┘
```

---

## Key Design Decisions

### 1. Database Integration

**Decision:** Build on existing `video-rag.db` with separate SQL query files

**Rationale:**
- Zero external dependencies (desktop-friendly)
- Reuse existing DB, migrations, backup/restore
- Keep SQL in separate files for maintainability

**Directory Structure:**
```
scheduler/
  queries/
    job_queue.sql         # enqueue, dequeue, counts
    job_status.sql        # complete/fail/update status
    job_recovery.sql      # resume after crash/restart
    migration.sql         # schema additions for queue
  pkg/
    queue/
      sqlite_queue.go     # Go wrapper loading SQL files
  cmd/
    scheduler/
      main.go
```

**Schema Addition:**
```sql
-- migrations_flat/016_scheduler_integration.sql
CREATE TABLE IF NOT EXISTS job_queue (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('video_processing','plugin_execution','batch_processing')),
  video_id TEXT,
  payload TEXT NOT NULL,              -- JSON blob
  priority INTEGER DEFAULT 5,
  status TEXT DEFAULT 'queued' CHECK(status IN ('queued','running','completed','failed')),
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  worker_id INTEGER,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  error TEXT,
  FOREIGN KEY (video_id) REFERENCES videos(id)
);

CREATE INDEX IF NOT EXISTS idx_job_queue_status_priority
  ON job_queue(status, priority DESC, created_at ASC);
```

### 2. Communication Protocol

**Decision:** gRPC with Protocol Buffers

**Rationale:**
- Type-safe API contracts
- Efficient binary serialization
- Built-in streaming support
- Cross-language compatibility

**Key RPC Methods:**
```protobuf
service Scheduler {
  rpc SubmitJob(JobRequest) returns (JobResponse);
  rpc GetJobStatus(JobStatusRequest) returns (JobStatusResponse);
  rpc StreamJobUpdates(JobStatusRequest) returns (stream JobUpdate);
  rpc CancelJob(CancelJobRequest) returns (CancelJobResponse);
  rpc GetWorkerStats(WorkerStatsRequest) returns (WorkerStatsResponse);
}
```

### 3. Supervisor & Health Checks

**Worker Health Monitoring:**
- Workers send heartbeat every 10s
- Supervisor scans workers every 5s
- Missing heartbeat (>30s) triggers restart
- Max 5 restart attempts per worker

**Job Recovery:**
- On startup, load incomplete jobs from `job_queue`
- Re-enqueue orphaned running jobs (older than 60s)
- Resume processing from last checkpoint

**Death Handling:**
```text
Scenarios:
- Worker crash → Supervisor restarts (max 5 attempts)
- Scheduler crash → Electron spawns and health-checks (max 10 attempts)
- App crash/restart → Jobs loaded from DB and resumed
```

### 4. Resource Management

**Per-Worker Limits (via cgroups):**
- CPU: 25% of one core
- Memory: 512 MB
- I/O: Throttled weight

**Plugin Isolation:**
- Each plugin runs in separate process
- Resource limits enforced via cgexec
- Timeout protection
- Sandboxed execution

---

## Node.js Client Integration

**File:** `src/core/scheduler-client.ts`

```typescript
export class SchedulerClient extends EventEmitter {
  private client: any;
  
  async submitJob(type: string, payload: any, priority: number = 5): Promise<string> {
    // Submit job to Golang scheduler via gRPC
    // Returns job ID
  }
  
  async getJobStatus(jobId: string): Promise<any> {
    // Get current job status
  }
  
  streamJobUpdates(jobId: string, callback: (update: any) => void): () => void {
    // Stream real-time updates via gRPC streaming
    // Returns cancel function
  }
  
  async cancelJob(jobId: string): Promise<boolean> {
    // Cancel running job
  }
}
```

**Usage in Video Processor:**
```typescript
export class VideoJobProcessor {
  private scheduler: SchedulerClient;
  
  async processVideo(videoPath: string) {
    // Submit job to Golang scheduler
    const jobId = await this.scheduler.submitJob('video_processing', {
      videoPath,
      phases: ['transcription', 'captioning', 'embedding']
    }, 8); // High priority
    
    // Stream updates
    this.scheduler.streamJobUpdates(jobId, (update) => {
      console.log(`Job ${jobId}: ${update.status} (${update.progress}%)`);
      this.emit('job-progress', update);
    });
    
    // Wait for completion
    // ...
  }
}
```

---

## Expected Benefits

### Performance
- **10x faster** job processing (Golang vs Node.js)
- **True parallelism** - Goroutines utilize all CPU cores
- **Lower memory** - Golang uses ~10x less memory than Node.js
- **No GC pauses** - Golang GC is much faster than V8

### Reliability
- **Auto-restart** - Supervisor restarts crashed workers
- **Health checks** - Detect and recover from hangs
- **Resource limits** - Prevent runaway processes
- **Graceful shutdown** - Clean job cancellation

### Scalability
- **Horizontal scaling** - Add more scheduler instances
- **Worker pools** - Scale workers independently
- **Queue-based** - Handle millions of jobs
- **Plugin isolation** - Each plugin in separate process

---

## Migration Path

### Phase 1: Build Scheduler (Weeks 1-2)
- Implement Golang scheduler service
- Add gRPC server
- Build supervisor manager
- Create worker pool

### Phase 2: Integration (Weeks 3-4)
- Build Node.js gRPC client
- Migrate video processing to scheduler
- Add SQLite job queue tables
- Test end-to-end

### Phase 3: Plugin Support (Weeks 5-6)
- Add plugin execution workers
- Implement resource limits
- Add plugin sandboxing
- Test with sample plugins

### Phase 4: Production (Weeks 7-8)
- Load testing
- Performance tuning
- Monitoring & alerts
- Documentation

---

## Alternatives Considered

### 1. Keep Node.js with Worker Threads
- ❌ Still limited by V8 memory
- ❌ Complex to manage
- ❌ Poor resource isolation

### 2. Python with Celery
- ❌ Slower than Golang
- ❌ More memory usage
- ❌ Complex deployment

### 3. Rust
- ✅ Faster than Golang
- ❌ Steeper learning curve
- ❌ Smaller ecosystem
- ❌ Longer development time

---

## Risks & Mitigation

### Risk 1: Learning Curve
**Mitigation:** Start with simple implementation, iterate

### Risk 2: gRPC Complexity
**Mitigation:** Use well-tested libraries, good documentation

### Risk 3: Migration Effort
**Mitigation:** Gradual migration, run both systems in parallel

---

## Success Metrics

- **Performance:** 10x faster job processing
- **Reliability:** 99.9% uptime, < 1% job failures
- **Resource Usage:** 50% reduction in memory usage
- **Scalability:** Handle 1000+ concurrent jobs

---

## Current Status

**Status:** Proposed (ADR-005 written)  
**Decision:** Not yet approved  
**Implementation:** Not started

**Blockers:**
- Need team approval
- Need to complete current video processing improvements
- Need to stabilize batch processing system first

**Dependencies:**
- Current batch processing system (ADR-004) should be stable
- Plugin ecosystem (PRD-PLUGIN-ECOSYSTEM) design finalized

---

## Related Documents

- **ADR-005:** `/Users/darksied/dev/pocs/drillbit/docs/adr/ADR-005-golang-scheduler-with-rpc.md`
- **PRD-PLUGIN-ECOSYSTEM:** `/Users/darksied/dev/pocs/drillbit/docs/PRD-PLUGIN-ECOSYSTEM.md`
- **ADR-004:** Batch-Concurrent Processing Workflow

---

## Notes

- This is a **future enhancement**, not urgent
- Current Node.js system works but has scalability limits
- Golang scheduler would enable plugin ecosystem
- Consider after stabilizing current video processing pipeline

---

**Last Updated:** 2025-10-10 10:44 IST
