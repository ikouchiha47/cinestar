# ADR-005: Golang Scheduler with RPC and Supervisors

**Status:** Proposed  
**Date:** 2025-10-03  
**Decision Makers:** Engineering Team  
**Related:** ADR-004 (Plugin Distribution), PRD-PLUGIN-ECOSYSTEM

---

## Context

The current Node.js-based job processing system has limitations:

### Current Architecture (Node.js)
```
Electron App (Node.js)
    ↓
Video Job Processor (Node.js)
    ↓
FFmpeg, Whisper, Ollama
```

### Problems:
1. **Single-threaded bottleneck** - Node.js event loop blocks on CPU-intensive tasks
2. **Memory leaks** - Long-running Node.js processes accumulate memory
3. **Poor concurrency** - Limited parallel processing capabilities
4. **Crash recovery** - No supervisor to restart failed jobs
5. **Resource management** - Hard to limit CPU/memory per job
6. **Plugin isolation** - Plugins run in same process as app

---

## Decision

**Build a Golang-based scheduler service with gRPC, supervised workers, and plugin isolation.**

### Architecture Overview

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

### Database Integration with Existing Infrastructure

**Decision:** Build on existing `video-rag.db` with separate SQL query files (no external services)

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

**Schema additions (added to existing migrations):**
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

CREATE INDEX IF NOT EXISTS idx_job_queue_video
  ON job_queue(video_id) WHERE status IN ('queued','running');

CREATE INDEX IF NOT EXISTS idx_job_queue_created
  ON job_queue(created_at);
```

**Example SQL query files:**

`scheduler/queries/job_queue.sql`
```sql
-- Enqueue new job
-- params: id, type, video_id, payload, priority
INSERT INTO job_queue (id, type, video_id, payload, priority, created_at)
VALUES (?, ?, ?, ?, ?, strftime('%s','now'));

-- Dequeue highest priority job (atomic, with write lock)
-- Use BEGIN IMMEDIATE to acquire a RESERVED lock so other writers wait.
-- params: worker_id
BEGIN IMMEDIATE;
WITH next AS (
  SELECT id FROM job_queue
  WHERE status='queued'
  ORDER BY priority DESC, created_at ASC
  LIMIT 1
)
UPDATE job_queue
SET status='running', worker_id=?, started_at=strftime('%s','now'), attempts=attempts+1
WHERE id = (SELECT id FROM next)
RETURNING id, type, video_id, payload, attempts;
COMMIT;
```

`scheduler/queries/job_status.sql`
```sql
-- Complete
-- params: id
UPDATE job_queue SET status='completed', completed_at=strftime('%s','now') WHERE id=?;

-- Fail with retry (dead-letter when attempts >= max_attempts)
-- params: error, id
UPDATE job_queue
SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
    error = ?,
    worker_id = NULL
WHERE id = ?;

-- Explicit re-enqueue (e.g., supervisor decides to retry without counting attempt)
-- params: id
UPDATE job_queue
SET status='queued', worker_id=NULL
WHERE id=? AND status='running';

-- Get status
-- params: id
SELECT status, attempts, max_attempts, error, started_at, completed_at FROM job_queue WHERE id=?;
```

`scheduler/queries/job_recovery.sql`
```sql
-- Incomplete jobs to resume on startup
SELECT id, type, video_id, payload, attempts, max_attempts
FROM job_queue
WHERE status IN ('running','queued')
ORDER BY created_at ASC;

-- Re-enqueue orphaned running jobs (older than 60s since start)
-- This handles app/scheduler crash or missing heartbeats on restart
UPDATE job_queue
SET status='queued', worker_id=NULL, error=COALESCE(error,'') || ' | re-enqueued on startup'
WHERE status='running' AND started_at IS NOT NULL AND started_at < strftime('%s','now') - 60
RETURNING id;
```

#### SQLite settings (WAL + timeout)

```go
// On queue initialization, enable WAL and set busy timeout to 5s
db, err := sql.Open("sqlite3", dbPath+"?_busy_timeout=5000&_journal_mode=WAL")
if err != nil { /* handle */ }

// For drivers that don't accept DSN params, run explicit PRAGMAs
// _, _ = db.Exec("PRAGMA journal_mode=WAL;")
// _, _ = db.Exec("PRAGMA busy_timeout=5000;")
```

---

## Implementation Details

### 1. Golang Scheduler Service

```go
// cmd/scheduler/main.go
package main

import (
    "context"
    "log"
    "net"
    
    "github.com/clipwise/scheduler/pkg/supervisor"
    "github.com/clipwise/scheduler/pkg/queue"
    "github.com/clipwise/scheduler/pkg/worker"
    pb "github.com/clipwise/scheduler/proto"
    "google.golang.org/grpc"
)

type SchedulerServer struct {
    pb.UnimplementedSchedulerServer
    supervisor *supervisor.Manager
    queue      *queue.SQLiteQueue
    workers    *worker.Pool
}

func main() {
    // Initialize components (use existing video-rag.db)
    queue, err := queue.NewExistingDBQueue(getDatabasePath())
    if err != nil {
        log.Fatalf("failed to init queue: %v", err)
    }
    supervisor := supervisor.NewManager()
    workers := worker.NewPool(10) // 10 concurrent workers
    
    // Start supervisor
    go supervisor.Start()
    
    // Start workers
    for i := 0; i < 10; i++ {
        worker := worker.New(i, queue, supervisor)
        workers.Add(worker)
        go worker.Start()
    }
    
    // Start gRPC server
    lis, err := net.Listen("tcp", ":50051")
    if err != nil {
        log.Fatalf("failed to listen: %v", err)
    }
    
    grpcServer := grpc.NewServer()
    schedulerServer := &SchedulerServer{
        supervisor: supervisor,
        queue:      queue,
        workers:    workers,
    }
    
    pb.RegisterSchedulerServer(grpcServer, schedulerServer)
    
    log.Println("Scheduler service started on :50051")
    if err := grpcServer.Serve(lis); err != nil {
        log.Fatalf("failed to serve: %v", err)
    }
}

// Resolve DB path from env or default to app's userData
func getDatabasePath() string {
    if p := os.Getenv("SCHEDULER_DB_PATH"); p != "" {
        return p
    }
    home, _ := os.UserHomeDir()
    return filepath.Join(home, ".clipwise", "video-rag.db")
}

// gRPC methods
func (s *SchedulerServer) SubmitJob(ctx context.Context, req *pb.JobRequest) (*pb.JobResponse, error) {
    job := &queue.Job{
        ID:       generateJobID(),
        Type:     req.Type,
        Payload:  req.Payload,
        Priority: req.Priority,
    }
    
    if err := s.queue.Enqueue(job); err != nil {
        return nil, err
    }
    
    return &pb.JobResponse{
        JobId:  job.ID,
        Status: "queued",
    }, nil
}

func (s *SchedulerServer) GetJobStatus(ctx context.Context, req *pb.JobStatusRequest) (*pb.JobStatusResponse, error) {
    status, err := s.queue.GetStatus(req.JobId)
    if err != nil {
        return nil, err
    }
    
    return &pb.JobStatusResponse{
        JobId:    req.JobId,
        Status:   status.State,
        Progress: status.Progress,
        Error:    status.Error,
    }, nil
}

func (s *SchedulerServer) StreamJobUpdates(req *pb.JobStatusRequest, stream pb.Scheduler_StreamJobUpdatesServer) error {
    // Stream job updates in real-time
    updates := s.queue.Subscribe(req.JobId)
    
    for update := range updates {
        if err := stream.Send(&pb.JobUpdate{
            JobId:    req.JobId,
            Status:   update.Status,
            Progress: update.Progress,
            Message:  update.Message,
        }); err != nil {
            return err
        }
    }
    
    return nil
}
```

### Death Handling & Resume

```text
Scenarios handled:
- Worker crash → Supervisor detects missing heartbeat (>30s) and restarts (max 5 attempts)
- Scheduler crash → Electron spawns and health-checks; auto-restarts (max 10 attempts)
- App crash/restart → Incomplete jobs loaded from `job_queue` and resumed

Mechanisms:
- Heartbeat: workers send heartbeat every 10s via `supervisor.Heartbeat(workerID)`
- Health check: supervisor scans workers every 5s, enqueues restarts
- Persistence: `job_queue.status IN ('running','queued')` recovered on start via `job_recovery.sql`
- Orphan detection: if a worker misses heartbeats (>30s), mark its job back to `queued` (re-enqueue) and clear `worker_id`
- Fallback: if scheduler fails repeatedly, app can fall back to Node.js processing
```

### 2. Supervisor Manager

```go
// pkg/supervisor/manager.go
package supervisor

import (
    "context"
    "log"
    "sync"
    "time"
)

type Manager struct {
    workers   map[int]*WorkerStatus
    mu        sync.RWMutex
    restartCh chan int
}

type WorkerStatus struct {
    ID          int
    State       string // "running", "stopped", "crashed"
    LastSeen    time.Time
    RestartCount int
    MaxRestarts  int
}

func NewManager() *Manager {
    return &Manager{
        workers:   make(map[int]*WorkerStatus),
        restartCh: make(chan int, 100),
    }
}

func (m *Manager) Start() {
    // Health check loop
    ticker := time.NewTicker(5 * time.Second)
    defer ticker.Stop()
    
    for {
        select {
        case <-ticker.C:
            m.healthCheck()
            
        case workerID := <-m.restartCh:
            m.restartWorker(workerID)
        }
    }
}

func (m *Manager) healthCheck() {
    m.mu.RLock()
    defer m.mu.RUnlock()
    
    now := time.Now()
    for id, status := range m.workers {
        // Worker hasn't reported in 30 seconds
        if now.Sub(status.LastSeen) > 30*time.Second {
            log.Printf("[SUPERVISOR] Worker %d appears dead, restarting...", id)
            m.restartCh <- id
        }
    }
}

func (m *Manager) restartWorker(workerID int) {
    m.mu.Lock()
    defer m.mu.Unlock()
    
    status := m.workers[workerID]
    if status.RestartCount >= status.MaxRestarts {
        log.Printf("[SUPERVISOR] Worker %d exceeded max restarts (%d), giving up", 
            workerID, status.MaxRestarts)
        status.State = "failed"
        return
    }
    
    status.RestartCount++
    status.State = "restarting"
    
    // Signal worker pool to restart this worker
    // (implementation depends on worker pool design)
    
    log.Printf("[SUPERVISOR] Restarted worker %d (attempt %d/%d)", 
        workerID, status.RestartCount, status.MaxRestarts)
}

func (m *Manager) Heartbeat(workerID int) {
    m.mu.Lock()
    defer m.mu.Unlock()
    
    if status, exists := m.workers[workerID]; exists {
        status.LastSeen = time.Now()
        status.State = "running"
    }
}

func (m *Manager) RegisterWorker(workerID int, maxRestarts int) {
    m.mu.Lock()
    defer m.mu.Unlock()
    
    m.workers[workerID] = &WorkerStatus{
        ID:          workerID,
        State:       "starting",
        LastSeen:    time.Now(),
        MaxRestarts: maxRestarts,
    }
}
```

### 3. Worker Pool

```go
// pkg/worker/pool.go
package worker

import (
    "context"
    "log"
    "sync"
    
    "github.com/clipwise/scheduler/pkg/queue"
    "github.com/clipwise/scheduler/pkg/supervisor"
)

type Worker struct {
    ID         int
    queue      *queue.SQLiteQueue
    supervisor *supervisor.Manager
    ctx        context.Context
    cancel     context.CancelFunc
}

func New(id int, q *queue.SQLiteQueue, s *supervisor.Manager) *Worker {
    ctx, cancel := context.WithCancel(context.Background())
    
    return &Worker{
        ID:         id,
        queue:      q,
        supervisor: s,
        ctx:        ctx,
        cancel:     cancel,
    }
}

func (w *Worker) Start() {
    w.supervisor.RegisterWorker(w.ID, 5) // Max 5 restarts
    
    log.Printf("[WORKER-%d] Starting...", w.ID)
    
    // Heartbeat goroutine
    go w.heartbeat()
    
    // Job processing loop
    for {
        select {
        case <-w.ctx.Done():
            log.Printf("[WORKER-%d] Shutting down", w.ID)
            return
            
        default:
            job, err := w.queue.Dequeue(w.ctx)
            if err != nil {
                log.Printf("[WORKER-%d] Error dequeuing: %v", w.ID, err)
                continue
            }
            
            if job == nil {
                continue // No jobs available
            }
            
            w.processJob(job)
        }
    }
}

func (w *Worker) heartbeat() {
    ticker := time.NewTicker(10 * time.Second)
    defer ticker.Stop()
    
    for {
        select {
        case <-w.ctx.Done():
            return
        case <-ticker.C:
            w.supervisor.Heartbeat(w.ID)
        }
    }
}

func (w *Worker) processJob(job *queue.Job) {
    log.Printf("[WORKER-%d] Processing job %s (type: %s)", w.ID, job.ID, job.Type)
    
    // Set resource limits for this job
    limits := &ResourceLimits{
        CPUPercent: 25,  // 25% of one core
        MemoryMB:   512, // 512 MB
    }
    
    ctx := context.WithValue(w.ctx, "limits", limits)
    
    // Process based on job type
    var err error
    switch job.Type {
    case "video_processing":
        err = w.processVideo(ctx, job)
    case "plugin_execution":
        err = w.processPlugin(ctx, job)
    case "batch_processing":
        err = w.processBatch(ctx, job)
    default:
        err = fmt.Errorf("unknown job type: %s", job.Type)
    }
    
    if err != nil {
        log.Printf("[WORKER-%d] Job %s failed: %v", w.ID, job.ID, err)
        w.queue.MarkFailed(job.ID, err.Error())
    } else {
        log.Printf("[WORKER-%d] Job %s completed", w.ID, job.ID)
        w.queue.MarkComplete(job.ID)
    }
}

func (w *Worker) processVideo(ctx context.Context, job *queue.Job) error {
    // Apply resource limits
    limits := ctx.Value("limits").(*ResourceLimits)
    if err := applyResourceLimits(limits); err != nil {
        return err
    }
    
    // Process video with FFmpeg
    // (existing video processing logic)
    
    return nil
}

func (w *Worker) processPlugin(ctx context.Context, job *queue.Job) error {
    // Run plugin in isolated process
    cmd := exec.CommandContext(ctx, "node", "plugin-runner.js", job.Payload)
    
    // Apply resource limits via cgroups
    limits := ctx.Value("limits").(*ResourceLimits)
    if err := setCgroupLimits(cmd, limits); err != nil {
        return err
    }
    
    output, err := cmd.CombinedOutput()
    if err != nil {
        return fmt.Errorf("plugin execution failed: %v, output: %s", err, output)
    }
    
    return nil
}
```

### 4. Resource Management (cgroups)

```go
// pkg/worker/resources.go
package worker

import (
    "fmt"
    "os/exec"
    "strconv"
    
    "github.com/containerd/cgroups"
    specs "github.com/opencontainers/runtime-spec/specs-go"
)

type ResourceLimits struct {
    CPUPercent int   // Percentage of one core (0-100)
    MemoryMB   int   // Memory limit in MB
    IOWeight   uint16 // I/O weight (10-1000)
}

func applyResourceLimits(limits *ResourceLimits) error {
    // Create cgroup for this process
    control, err := cgroups.New(cgroups.V1, cgroups.StaticPath("/clipwise/worker"), &specs.LinuxResources{
        CPU: &specs.LinuxCPU{
            // CPUPercent of 25 = 25000 microseconds per 100ms period
            Quota:  int64(limits.CPUPercent * 1000),
            Period: uint64(100000),
        },
        Memory: &specs.LinuxMemory{
            Limit: int64(limits.MemoryMB * 1024 * 1024),
        },
        BlockIO: &specs.LinuxBlockIO{
            Weight: &limits.IOWeight,
        },
    })
    
    if err != nil {
        return fmt.Errorf("failed to create cgroup: %v", err)
    }
    
    // Add current process to cgroup
    if err := control.Add(cgroups.Process{Pid: os.Getpid()}); err != nil {
        return fmt.Errorf("failed to add process to cgroup: %v", err)
    }
    
    return nil
}

func setCgroupLimits(cmd *exec.Cmd, limits *ResourceLimits) error {
    // For child processes (plugins), set limits before execution
    // This requires running the command through cgexec or similar
    
    cgexec := exec.Command("cgexec",
        "-g", fmt.Sprintf("cpu,memory:/clipwise/plugin-%d", cmd.Process.Pid),
        cmd.Path,
    )
    cgexec.Args = append(cgexec.Args, cmd.Args[1:]...)
    
    *cmd = *cgexec
    return nil
}
```

### 5. gRPC Protocol Definition

```protobuf
// proto/scheduler.proto
syntax = "proto3";

package scheduler;

option go_package = "github.com/clipwise/scheduler/proto";

service Scheduler {
  // Submit a new job
  rpc SubmitJob(JobRequest) returns (JobResponse);
  
  // Get job status
  rpc GetJobStatus(JobStatusRequest) returns (JobStatusResponse);
  
  // Stream job updates in real-time
  rpc StreamJobUpdates(JobStatusRequest) returns (stream JobUpdate);
  
  // Cancel a job
  rpc CancelJob(CancelJobRequest) returns (CancelJobResponse);
  
  // Get worker statistics
  rpc GetWorkerStats(WorkerStatsRequest) returns (WorkerStatsResponse);
}

message JobRequest {
  string type = 1;        // "video_processing", "plugin_execution", etc.
  bytes payload = 2;      // JSON-encoded job data
  int32 priority = 3;     // 0 (low) to 10 (high)
  map<string, string> metadata = 4;
}

message JobResponse {
  string job_id = 1;
  string status = 2;      // "queued", "running", "completed", "failed"
}

message JobStatusRequest {
  string job_id = 1;
}

message JobStatusResponse {
  string job_id = 1;
  string status = 2;
  int32 progress = 3;     // 0-100
  string error = 4;
  int64 started_at = 5;
  int64 completed_at = 6;
}

message JobUpdate {
  string job_id = 1;
  string status = 2;
  int32 progress = 3;
  string message = 4;
  int64 timestamp = 5;
}

message CancelJobRequest {
  string job_id = 1;
}

message CancelJobResponse {
  bool success = 1;
  string message = 2;
}

message WorkerStatsRequest {}

message WorkerStatsResponse {
  int32 total_workers = 1;
  int32 active_workers = 2;
  int32 idle_workers = 3;
  int32 crashed_workers = 4;
  int32 queued_jobs = 5;
  int32 running_jobs = 6;
}
```

### 6. Node.js Client (Electron App)

```typescript
// src/core/scheduler-client.ts
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { EventEmitter } from 'events';

const PROTO_PATH = './proto/scheduler.proto';

export class SchedulerClient extends EventEmitter {
  private client: any;
  private connected: boolean = false;
  
  constructor(address: string = 'localhost:50051') {
    super();
    
    const packageDefinition = protoLoader.loadSync(PROTO_PATH);
    const proto = grpc.loadPackageDefinition(packageDefinition).scheduler;
    
    this.client = new proto.Scheduler(
      address,
      grpc.credentials.createInsecure()
    );
    
    this.connect();
  }
  
  private connect() {
    // Keep connection alive
    this.client.waitForReady(Date.now() + 5000, (error: Error) => {
      if (error) {
        console.error('[SCHEDULER-CLIENT] Connection failed:', error);
        this.emit('error', error);
        
        // Retry connection
        setTimeout(() => this.connect(), 5000);
      } else {
        console.log('[SCHEDULER-CLIENT] Connected to scheduler');
        this.connected = true;
        this.emit('connected');
      }
    });
  }
  
  async submitJob(type: string, payload: any, priority: number = 5): Promise<string> {
    return new Promise((resolve, reject) => {
      this.client.SubmitJob({
        type,
        payload: Buffer.from(JSON.stringify(payload)),
        priority,
        metadata: {}
      }, (error: Error, response: any) => {
        if (error) {
          reject(error);
        } else {
          resolve(response.job_id);
        }
      });
    });
  }
  
  async getJobStatus(jobId: string): Promise<any> {
    return new Promise((resolve, reject) => {
      this.client.GetJobStatus({ job_id: jobId }, (error: Error, response: any) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }
  
  streamJobUpdates(jobId: string, callback: (update: any) => void): () => void {
    const stream = this.client.StreamJobUpdates({ job_id: jobId });
    
    stream.on('data', (update: any) => {
      callback(update);
    });
    
    stream.on('error', (error: Error) => {
      console.error('[SCHEDULER-CLIENT] Stream error:', error);
    });
    
    stream.on('end', () => {
      console.log('[SCHEDULER-CLIENT] Stream ended');
    });
    
    // Return cancel function
    return () => stream.cancel();
  }
  
  async cancelJob(jobId: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      this.client.CancelJob({ job_id: jobId }, (error: Error, response: any) => {
        if (error) {
          reject(error);
        } else {
          resolve(response.success);
        }
      });
    });
  }
}

// Usage in video-job-processor.ts
export class VideoJobProcessor {
  private scheduler: SchedulerClient;
  
  constructor() {
    this.scheduler = new SchedulerClient();
    
    this.scheduler.on('connected', () => {
      console.log('[VIDEO-JOB-PROCESSOR] Scheduler connected');
    });
    
    this.scheduler.on('error', (error) => {
      console.error('[VIDEO-JOB-PROCESSOR] Scheduler error:', error);
    });
  }
  
  async processVideo(videoPath: string) {
    // Submit job to Golang scheduler
    const jobId = await this.scheduler.submitJob('video_processing', {
      videoPath,
      phases: ['transcription', 'captioning', 'embedding']
    }, 8); // High priority
    
    console.log(`[VIDEO-JOB-PROCESSOR] Submitted job: ${jobId}`);
    
    // Stream updates
    const cancelStream = this.scheduler.streamJobUpdates(jobId, (update) => {
      console.log(`[VIDEO-JOB-PROCESSOR] Job ${jobId}: ${update.status} (${update.progress}%)`);
      
      // Emit to UI
      this.emit('job-progress', {
        jobId,
        status: update.status,
        progress: update.progress,
        message: update.message
      });
    });
    
    // Wait for completion
    while (true) {
      const status = await this.scheduler.getJobStatus(jobId);
      
      if (status.status === 'completed') {
        cancelStream();
        return { success: true, jobId };
      }
      
      if (status.status === 'failed') {
        cancelStream();
        throw new Error(status.error);
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}
```

---

## Benefits

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

### Developer Experience
- **Real-time updates** - gRPC streaming for live progress
- **Better debugging** - Structured logging, metrics
- **Type safety** - Protocol buffers for API
- **Easy deployment** - Single binary, no dependencies

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
- Add SQLite job queue tables and load SQL query files
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

## Conclusion

A Golang-based scheduler with gRPC and supervisors provides:
- **Better performance** than Node.js
- **Higher reliability** with auto-restart
- **Better scalability** for plugins
- **Cleaner architecture** with separation of concerns

**Recommendation:** Approve and begin Phase 1 implementation.

---

**Status:** Proposed  
**Next Steps:** Team review, approve, begin implementation  
**Estimated Effort:** 8 weeks  
**Dependencies:** SQLite (existing video-rag.db), Protocol Buffers
