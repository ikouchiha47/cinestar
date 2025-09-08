import { ConcurrencyLimiter } from './concurrency-limiter';
import { ConfigManager } from './config';

/**
 * ExternalProcessPool limits the number of concurrent CPU-heavy external processes
 * (e.g., ffmpeg, CLI tools). It uses the existing ConcurrencyLimiter under the hood.
 */
export class ExternalProcessPool {
  private static instance: ExternalProcessPool;
  private limiter: ConcurrencyLimiter;

  private constructor(limit: number) {
    this.limiter = new ConcurrencyLimiter(limit);
    console.log(`🧵 [POOL] External process pool initialized with limit=${limit}`);
  }

  static getInstance(): ExternalProcessPool {
    if (!ExternalProcessPool.instance) {
      const cfg = ConfigManager.getConfig();
      const limit = cfg.video?.pipeline?.maxWorkers || 2;
      ExternalProcessPool.instance = new ExternalProcessPool(limit);
    }
    return ExternalProcessPool.instance;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    return this.limiter.add(fn);
  }

  get active(): number {
    return this.limiter.activeCount;
  }

  get pending(): number {
    return this.limiter.pendingCount;
  }
}
