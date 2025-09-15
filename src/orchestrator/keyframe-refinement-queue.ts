import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import { ConcurrencyLimiter } from '../core/concurrency-limiter';
import { ConfigManager } from '../core/config';

export type KeyframeCandidate = {
  timestamp: number;
  passId: string; // 'delayed' | 'background' or custom id
  combinedScore: number;
};

export interface RefinementJob {
  videoPath: string;
  outputDir: string;
  segmentId: string;
  candidates: KeyframeCandidate[];
  label: 'delayed' | 'background';
}

class KeyframeRefinementQueue {
  private limiter: ConcurrencyLimiter;
  private queue: RefinementJob[] = [];
  private started = false;

  constructor(concurrency: number) {
    this.limiter = new ConcurrencyLimiter(concurrency);
  }

  enqueue(job: RefinementJob, delayMs = 0) {
    if (delayMs > 0) {
      setTimeout(() => this.enqueue(job, 0), delayMs);
      return;
    }
    this.queue.push(job);
    if (this.started) this.tick();
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.tick();
  }

  private tick() {
    if (!this.started) return;
    if (this.queue.length === 0) return;
    const job = this.queue.shift()!;
    this.limiter.add(async () => {
      await this.processJob(job).catch((err) => {
        // Best effort logging; do not throw
        console.warn('[KeyframeRefinementQueue] job failed', err);
      });
      // Continue processing
      this.tick();
    });
  }

  private async processJob(job: RefinementJob) {
    const threads = String(ConfigManager.getConfig().video?.pipeline?.threadsPerProcess ?? 1);
    // Extract frames for all candidates
    for (let i = 0; i < job.candidates.length; i++) {
      const c = job.candidates[i];
      const outputPath = path.join(
        job.outputDir,
        `${job.segmentId}_${job.label}_${String(i).padStart(3, '0')}_${c.timestamp.toFixed(3)}.png`
      );

      await new Promise<void>((resolve, reject) => {
        ffmpeg(job.videoPath)
          .seekInput(c.timestamp)
          .frames(1)
          .noAudio()
          .outputOptions(['-q:v 2', '-f', 'image2', '-threads', threads])
          .output(outputPath)
          .on('end', () => resolve())
          .on('error', (err: Error) => reject(err))
          .run();
      });
    }
  }
}

// Singleton queue with reasonable concurrency (default 2)
const defaultConcurrency = Number(process.env.KEYFRAME_REFINEMENT_CONCURRENCY || 2);
export const keyframeRefinementQueue = new KeyframeRefinementQueue(defaultConcurrency);
keyframeRefinementQueue.start();

export function enqueueDelayedKeyframes(job: Omit<RefinementJob, 'label'>, delayMs = 10_000) {
  keyframeRefinementQueue.enqueue({ ...job, label: 'delayed' }, delayMs);
}

export function enqueueBackgroundKeyframes(job: Omit<RefinementJob, 'label'>, delayMs = 60_000) {
  keyframeRefinementQueue.enqueue({ ...job, label: 'background' }, delayMs);
}
