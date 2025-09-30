import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import { ConfigManager } from './config';
import { VideoDatabase } from './video-database';

// FFmpeg/FFprobe paths are configured centrally in electron/main.ts via ffmpeg-bootstrap

export type KeyframeCandidate = {
  timestamp: number;
  passId: string;
  combinedScore: number;
};

export interface RefinementJob {
  id?: string;
  queue: string; // e.g. 'granularity_1', 'granularity_2'
  videoPath: string;
  outputDir: string;
  segmentId: string;
  candidates: KeyframeCandidate[];
  label: 'delayed' | 'background';
  status?: 'pending' | 'delayed' | 'processing' | 'completed' | 'failed';
  scheduledAt?: string; // ISO
  createdAt?: string;   // ISO
  retryCount?: number;
  maxRetries?: number;
  lastError?: string;
}

interface QueueConfig {
  concurrency: number;
  pollIntervalMs: number;
  defaultDelayMs: number;
}

class PersistentKeyframeQueue {
  private db: Database.Database;
  private cfg: QueueConfig;
  private queueName: string;
  private interval?: NodeJS.Timeout;
  private active = 0;

  constructor(queueName: string, cfg?: Partial<QueueConfig>) {
    this.queueName = queueName;
    const dbPath = path.join('data', `keyframe-refinement_${queueName}.db`);
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
    this.db = new Database(dbPath);
    this.cfg = {
      concurrency: Number(process.env.KEYFRAME_REFINEMENT_CONCURRENCY || 2),
      pollIntervalMs: Number(process.env.KEYFRAME_REFINEMENT_POLL_MS || 5000),
      defaultDelayMs: queueName.includes('2') ? 60_000 : 10_000,
      ...cfg,
    } as QueueConfig;
    this.initSchema();
    this.start();
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        queue TEXT NOT NULL,
        video_path TEXT NOT NULL,
        output_dir TEXT NOT NULL,
        segment_id TEXT NOT NULL,
        label TEXT NOT NULL,
        candidates_json TEXT NOT NULL,
        status TEXT NOT NULL,
        scheduled_at TEXT,
        created_at TEXT NOT NULL,
        retry_count INTEGER NOT NULL DEFAULT 0,
        max_retries INTEGER NOT NULL DEFAULT 3,
        last_error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_jobs_status_queue ON jobs(status, queue);
      CREATE INDEX IF NOT EXISTS idx_jobs_scheduled ON jobs(status, scheduled_at);
    `);
  }

  enqueue(job: Omit<RefinementJob, 'id' | 'status' | 'createdAt' | 'scheduledAt' | 'retryCount' | 'maxRetries'>, delayMs?: number) {
    const id = `kf_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const stmt = this.db.prepare(`
      INSERT INTO jobs (
        id, queue, video_path, output_dir, segment_id, label, candidates_json, status, scheduled_at, created_at, max_retries
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const now = new Date();
    const scheduledAt = new Date(now.getTime() + (delayMs ?? this.cfg.defaultDelayMs));
    stmt.run(
      id,
      job.queue,
      job.videoPath,
      job.outputDir,
      job.segmentId,
      job.label,
      JSON.stringify(job.candidates),
      'delayed',
      scheduledAt.toISOString(),
      now.toISOString(),
      3
    );
    return id;
  }

  start() {
    if (this.interval) return;
    this.interval = setInterval(() => this.tick(), this.cfg.pollIntervalMs);
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
    this.interval = undefined;
  }

  private tick() {
    // Respect concurrency
    while (this.active < this.cfg.concurrency) {
      const job = this.getNextJob();
      if (!job) break;
      this.processJob(job).catch(() => {/* errors handled inside */});
    }
  }

  private getNextJob(): RefinementJob | null {
    const row = this.db.prepare(`
      SELECT * FROM jobs 
      WHERE queue = ? AND (
        status = 'pending' OR (status = 'delayed' AND scheduled_at <= ?)
      )
      ORDER BY created_at ASC
      LIMIT 1
    `).get(this.queueName, new Date().toISOString()) as any;

    if (!row) return null;

    // Mark as processing
    this.db.prepare(`UPDATE jobs SET status = 'processing' WHERE id = ?`).run(row.id);

    const job: RefinementJob = {
      id: row.id,
      queue: row.queue,
      videoPath: row.video_path,
      outputDir: row.output_dir,
      segmentId: row.segment_id,
      label: row.label,
      candidates: JSON.parse(row.candidates_json),
      status: 'processing',
      scheduledAt: row.scheduled_at,
      createdAt: row.created_at,
      retryCount: row.retry_count,
      maxRetries: row.max_retries,
      lastError: row.last_error,
    };
    return job;
  }

  private async processJob(job: RefinementJob) {
    this.active++;
    try {
      const threads = String(ConfigManager.getConfig().video?.pipeline?.threadsPerProcess ?? 1);
      for (let i = 0; i < job.candidates.length; i++) {
        const c = job.candidates[i];
        const outPath = path.join(job.outputDir, `${job.segmentId}_${job.label}_${String(i).padStart(3, '0')}_${c.timestamp.toFixed(3)}.png`);
        await new Promise<void>((resolve, reject) => {
          ffmpeg(job.videoPath)
            .seekInput(c.timestamp)
            .frames(1)
            .noAudio()
            .outputOptions(['-q:v 2', '-f', 'image2', '-threads', threads])
            .output(outPath)
            .on('end', () => resolve())
            .on('error', (err: Error) => reject(err))
            .run();
        });
      }
      // Insert extracted frames into media DB as refined keyframes
      const db = new VideoDatabase();
      await db.initialize();

      const video = await db.getVideoFileByPath(job.videoPath);
      const videoId = video?.id || 'unknown';

      const rows = job.candidates.map((c, i) => ({
        videoId,
        segmentId: job.segmentId,
        imagePath: path.join(job.outputDir, `${job.segmentId}_${job.label}_${String(i).padStart(3, '0')}_${c.timestamp.toFixed(3)}.png`),
        label: job.label,
        caption: undefined as string | undefined,
        embedding: undefined as any,
      }));

      await db.addRefinedKeyframesBatch(rows);
      await db.close();

      this.db.prepare(`UPDATE jobs SET status = 'completed', last_error = NULL WHERE id = ?`).run(job.id);
    } catch (err: any) {
      const message = err?.message || String(err);
      this.db.prepare(`UPDATE jobs SET status = 'failed', last_error = ?, retry_count = retry_count + 1 WHERE id = ?`).run(message, job.id);
    } finally {
      this.active--;
    }
  }
}

// queue registry (1 per granularity interval by default)
const queues = new Map<string, PersistentKeyframeQueue>();

export function getRefinementQueue(name: string) {
  if (!queues.has(name)) {
    queues.set(name, new PersistentKeyframeQueue(name));
  }
  return queues.get(name)!;
}

export function enqueueRefinementJob(queue: string, job: Omit<RefinementJob, 'queue' | 'status' | 'id' | 'createdAt' | 'scheduledAt' | 'retryCount' | 'maxRetries'>, delayMs?: number) {
  return getRefinementQueue(queue).enqueue({ ...job, queue }, delayMs);
}
