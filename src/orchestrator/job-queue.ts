import { EventEmitter } from 'events';
import { ConcurrencyLimiter } from '../core/concurrency-limiter';
import type { Job } from './types';

export type JobHandler = (job: Job) => Promise<void>;

export class JobQueue extends EventEmitter {
  private queue: Job[] = [];
  private running = 0;
  private limiter: ConcurrencyLimiter;
  private handler: JobHandler;
  private started = false;

  constructor(concurrency: number, handler: JobHandler) {
    super();
    this.limiter = new ConcurrencyLimiter(concurrency);
    this.handler = handler;
  }

  enqueue(job: Job) {
    this.queue.push(job);
    this.emit('job:enqueued', job);
    if (this.started) this.tick();
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.tick();
  }

  stop() {
    this.started = false;
  }

  private tick() {
    if (!this.started) return;
    if (this.queue.length === 0) return;

    const job = this.queue.shift()!;
    this.running++;

    this.limiter.add(async () => {
      try {
        this.emit('job:started', job);
        await this.handler(job);
        this.emit('job:completed', job);
      } catch (error) {
        this.emit('job:failed', job, error);
      } finally {
        this.running--;
        if (this.started && this.queue.length > 0) {
          this.tick();
        }
      }
    });
  }
}
