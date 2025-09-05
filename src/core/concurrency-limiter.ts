/**
 * Custom bounded concurrency implementation
 * Limits the number of concurrent async operations
 */
export class ConcurrencyLimiter {
  private queue: (() => Promise<any>)[] = [];
  private running = 0;
  private readonly limit: number;

  constructor(limit: number) {
    this.limit = limit;
  }

  async add<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
      this.tryNext();
    });
  }

  private tryNext(): void {
    if (this.running >= this.limit || this.queue.length === 0) {
      return;
    }

    this.running++;
    const task = this.queue.shift()!;
    
    task().finally(() => {
      this.running--;
      this.tryNext();
    });
  }

  get activeCount(): number {
    return this.running;
  }

  get pendingCount(): number {
    return this.queue.length;
  }
}

/**
 * Process an array of items with bounded concurrency
 * @param items Array of items to process
 * @param processor Function to process each item
 * @param concurrency Maximum number of concurrent operations
 * @param onProgress Optional progress callback
 */
export async function processWithConcurrency<T, R>(
  items: T[],
  processor: (item: T, index: number) => Promise<R>,
  concurrency: number = 3,
  onProgress?: (completed: number, total: number, item: T, result: R) => void
): Promise<R[]> {
  const startTime = Date.now();
  console.log(`🚀 [CONCURRENCY] Starting batch processing: ${items.length} items, concurrency: ${concurrency}`);
  
  const limiter = new ConcurrencyLimiter(concurrency);
  const results: R[] = new Array(items.length);
  let completed = 0;
  const itemTimings: { [index: number]: { start: number; end?: number; duration?: number } } = {};

  const promises = items.map((item, index) =>
    limiter.add(async () => {
      const itemStart = Date.now();
      itemTimings[index] = { start: itemStart };
      
      console.log(`⏱️  [CONCURRENCY] Item ${index + 1}/${items.length} started (active: ${limiter.activeCount}, pending: ${limiter.pendingCount})`);
      
      const result = await processor(item, index);
      
      const itemEnd = Date.now();
      const itemDuration = itemEnd - itemStart;
      itemTimings[index].end = itemEnd;
      itemTimings[index].duration = itemDuration;
      
      results[index] = result;
      completed++;
      
      console.log(`✅ [CONCURRENCY] Item ${index + 1}/${items.length} completed in ${itemDuration}ms (active: ${limiter.activeCount}, pending: ${limiter.pendingCount})`);
      
      if (onProgress) {
        onProgress(completed, items.length, item, result);
      }
      
      return result;
    })
  );

  await Promise.all(promises);
  
  const totalTime = Date.now() - startTime;
  const avgTime = Object.values(itemTimings).reduce((sum, timing) => sum + (timing.duration || 0), 0) / items.length;
  const minTime = Math.min(...Object.values(itemTimings).map(t => t.duration || 0));
  const maxTime = Math.max(...Object.values(itemTimings).map(t => t.duration || 0));
  
  console.log(`🏁 [CONCURRENCY] Batch processing complete:`);
  console.log(`   Total time: ${totalTime}ms`);
  console.log(`   Items processed: ${completed}/${items.length}`);
  console.log(`   Average item time: ${avgTime.toFixed(0)}ms`);
  console.log(`   Min item time: ${minTime}ms`);
  console.log(`   Max item time: ${maxTime}ms`);
  console.log(`   Theoretical sequential time: ${avgTime * items.length}ms`);
  console.log(`   Speedup: ${((avgTime * items.length) / totalTime).toFixed(1)}x`);
  
  return results;
}
