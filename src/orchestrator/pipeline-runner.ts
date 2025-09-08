import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';

import { Job, OrchestratorConfig } from './types';
import { InMemoryJobStore } from './job-store';
import { SQLiteJobStore } from './sqlite-job-store';
import { JobQueue } from './job-queue';
// Resource pools will be wired in future steps when we parallelize heavy GPU/IO work per segment

import { VideoMediaAPI } from '../api/video-media-api';
import { batchEmbedMissingSegments } from './batch-embedding';
import { buildStorylineJson } from './storyline';
import { batchCaptionMissingSegments } from './batch-caption';
import { attachPartialSegmentWriter } from './partial-writer';

export class Orchestrator extends EventEmitter {
  private readonly cfg: OrchestratorConfig;
  private readonly store: InMemoryJobStore | SQLiteJobStore;
  private readonly queue: JobQueue;
  private readonly api: VideoMediaAPI;

  constructor(cfg: Partial<OrchestratorConfig> = {}) {
    super();
    this.cfg = {
      videoConcurrency: cfg.videoConcurrency ?? 2,
      gpuBatchSize: cfg.gpuBatchSize ?? 8,
      ocrBatchSize: cfg.ocrBatchSize ?? 8,
      embeddingBatchSize: cfg.embeddingBatchSize ?? 64,
    };

    // Prefer durable SQLite-backed store, fallback to in-memory
    try {
      this.store = new SQLiteJobStore();
    } catch (e) {
      console.warn('[Orchestrator] SQLiteJobStore init failed, falling back to InMemoryJobStore:', e);
      this.store = new InMemoryJobStore();
    }
    this.api = VideoMediaAPI.getInstance();

    this.queue = new JobQueue(this.cfg.videoConcurrency, async (job) => {
      await this.processVideoJob(job);
    });

    // Bubble up queue events
    this.queue.on('job:enqueued', (job) => {
      this.store.addEvent({ jobId: job.id, ts: new Date(), level: 'info', message: 'job enqueued' });
      this.emit('job:enqueued', job);
    });
    this.queue.on('job:started', (job) => {
      this.store.addEvent({ jobId: job.id, ts: new Date(), level: 'info', message: 'job started' });
      this.emit('job:started', job);
    });
    this.queue.on('job:completed', (job) => {
      this.store.addEvent({ jobId: job.id, ts: new Date(), level: 'info', message: 'job completed' });
      this.emit('job:completed', job);
    });
    this.queue.on('job:failed', (job, error) => {
      this.store.addEvent({ jobId: job.id, ts: new Date(), level: 'error', message: 'job failed', payloadJson: JSON.stringify({ error: String(error) }) });
      this.emit('job:failed', job, error);
    });
  }

  async initialize() {
    await this.api.initialize();
    // Attach partial-writer once to enable early segment visibility for search/UI
    attachPartialSegmentWriter(this.api);
  }

  // Enqueue all videos in a directory (non-recursive by default)
  async enqueueDirectory(dir: string, recursive = false) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && recursive) {
        await this.enqueueDirectory(fullPath, true);
      } else if (entry.isFile() && Orchestrator.isVideoFile(fullPath)) {
        this.enqueueVideo(fullPath);
      }
    }
  }

  enqueueVideo(videoPath: string) {
    const job: Job = {
      id: `job_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      videoPath,
      status: 'pending',
      createdAt: new Date(),
    };
    this.store.create(job);
    this.queue.enqueue(job);
  }

  start() {
    this.queue.start();
  }

  stop() {
    this.queue.stop();
  }

  listJobs() {
    return this.store.list();
  }

  // Core per-video flow (sequential inside)
  private async processVideoJob(job: Job) {
    try {
      this.store.update(job.id, { status: 'running', startedAt: new Date() });
      this.emit('stage:start', job, 'discover');

      // Use existing VideoMediaAPI to process the full video through the current pipeline
      // This preserves existing functionality while we layer batching on top later.
      const videoId = await this.api.processVideo(job.videoPath);
      this.store.update(job.id, { videoId });

      // Optional: fill missing captions (parallelized per segment) if any slipped through
      this.emit('stage:start', job, 'captioning');
      const c0 = Date.now();
      try {
        const filled = await batchCaptionMissingSegments(videoId, Math.max(1, Math.min(2, this.cfg.gpuBatchSize)));
        this.emit('stage:complete', job, 'captioning', Date.now() - c0);
        if (filled > 0) this.store.addEvent({ jobId: job.id, ts: new Date(), level: 'info', message: `filled ${filled} captions` });
      } catch (e) {
        this.emit('stage:error', job, 'captioning', e as Error);
        this.store.addEvent({ jobId: job.id, ts: new Date(), level: 'error', message: 'captioning stage failed', payloadJson: JSON.stringify({ error: String(e) }) });
      }

      // Embeddings (batch, non-blocking relative to UI/search)
      this.emit('stage:start', job, 'embeddings');
      const t0 = Date.now();
      let embedded = 0;
      try {
        embedded = await batchEmbedMissingSegments(videoId, this.cfg.embeddingBatchSize);
        this.emit('stage:complete', job, 'embeddings', Date.now() - t0);
        this.store.addEvent({ jobId: job.id, ts: new Date(), level: 'info', message: `embedded ${embedded} segments` });
      } catch (e) {
        this.emit('stage:error', job, 'embeddings', e as Error);
        this.store.addEvent({ jobId: job.id, ts: new Date(), level: 'error', message: 'embedding stage failed', payloadJson: JSON.stringify({ error: String(e) }) });
      }

      // Storyline JSON output (does not affect DB indexing)
      this.emit('stage:start', job, 'storyline');
      const s0 = Date.now();
      try {
        const outPath = await buildStorylineJson(videoId);
        this.emit('stage:complete', job, 'storyline', Date.now() - s0);
        this.store.addEvent({ jobId: job.id, ts: new Date(), level: 'info', message: `storyline written`, payloadJson: JSON.stringify({ outPath }) });
      } catch (e) {
        this.emit('stage:error', job, 'storyline', e as Error);
        this.store.addEvent({ jobId: job.id, ts: new Date(), level: 'error', message: 'storyline stage failed', payloadJson: JSON.stringify({ error: String(e) }) });
      }

      this.emit('stage:complete', job, 'indexing', 0);
      this.store.update(job.id, { status: 'completed', completedAt: new Date() });
    } catch (err: any) {
      this.store.update(job.id, { status: 'failed', error: err?.message, completedAt: new Date() });
      this.emit('stage:error', job, 'indexing', err);
      throw err;
    }
  }

  // Utility: delegate to existing API function
  static isVideoFile(filePath: string) {
    return VideoMediaAPI.isVideoFile(filePath);
  }
}
