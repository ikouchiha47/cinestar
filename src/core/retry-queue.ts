/**
 * Retry queue with exponential backoff for handling API failures
 */

export interface RetryTask<T> {
  id: string;
  operation: () => Promise<T>;
  maxRetries: number;
  currentAttempt: number;
  backoffMs: number;
  lastError?: Error;
}

export class RetryQueue {
  private static instance: RetryQueue;
  private queue: Map<string, RetryTask<any>> = new Map();
  private processing = false;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;
  private failureCount = 0;
  private lastFailureTime = 0;
  private circuitBreakerDelay = 0;

  constructor(baseBackoffMs = 1000, maxBackoffMs = 30000) {
    this.baseBackoffMs = baseBackoffMs;
    this.maxBackoffMs = maxBackoffMs;
  }

  /**
   * Get singleton instance
   */
  static getInstance(): RetryQueue {
    if (!RetryQueue.instance) {
      RetryQueue.instance = new RetryQueue(2000, 60000); // 2s base, 60s max
    }
    return RetryQueue.instance;
  }

  /**
   * Add a task to the retry queue (alias for enqueue)
   */
  async addTask<T>(
    operation: () => Promise<T>,
    id: string,
    maxRetries: number = 3
  ): Promise<T> {
    const queueStartTime = Date.now();
    console.log(`📋 [QUEUE] ${id} added to retry queue (max retries: ${maxRetries})`);
    
    // Apply circuit breaker delay if system is under stress
    if (this.circuitBreakerDelay > 0) {
      const delay = Math.random() * this.circuitBreakerDelay;
      console.log(`🛡️ [CIRCUIT] ${id} delayed ${Math.round(delay)}ms due to system stress`);
      const circuitDelayStart = Date.now();
      await this.sleep(delay);
      const actualCircuitDelay = Date.now() - circuitDelayStart;
      console.log(`🛡️ [CIRCUIT] ${id} circuit delay completed (${actualCircuitDelay}ms)`);
    }
    
    try {
      const result = await this.enqueue(id, operation, maxRetries);
      const totalQueueTime = Date.now() - queueStartTime;
      console.log(`🏁 [QUEUE] ${id} completed successfully (total queue time: ${totalQueueTime}ms)`);
      return result;
    } catch (error) {
      const totalQueueTime = Date.now() - queueStartTime;
      console.log(`🚫 [QUEUE] ${id} failed permanently (total queue time: ${totalQueueTime}ms)`);
      throw error;
    }
  }

  /**
   * Add a task to the retry queue
   */
  async enqueue<T>(
    id: string,
    operation: () => Promise<T>,
    maxRetries: number = 3
  ): Promise<T> {
    const task: RetryTask<T> = {
      id,
      operation,
      maxRetries,
      currentAttempt: 0,
      backoffMs: this.baseBackoffMs
    };

    this.queue.set(id, task);
    
    if (!this.processing) {
      this.processQueue();
    }

    return this.executeTask(task);
  }

  /**
   * Execute a task with retry logic
   */
  private async executeTask<T>(task: RetryTask<T>): Promise<T> {
    const taskStartTime = Date.now();
    
    while (task.currentAttempt <= task.maxRetries) {
      const attemptStartTime = Date.now();
      try {
        console.log(`🔄 [RETRY] Attempting ${task.id} (${task.currentAttempt + 1}/${task.maxRetries + 1}) - Total elapsed: ${Date.now() - taskStartTime}ms`);
        
        const result = await task.operation();
        
        // Success - remove from queue
        this.queue.delete(task.id);
        const totalTime = Date.now() - taskStartTime;
        const attemptTime = Date.now() - attemptStartTime;
        console.log(`✅ [RETRY] ${task.id} succeeded on attempt ${task.currentAttempt + 1} (attempt: ${attemptTime}ms, total: ${totalTime}ms)`);
        
        return result;
        
      } catch (error) {
        task.currentAttempt++;
        task.lastError = error instanceof Error ? error : new Error(String(error));
        
        // Update failure tracking for circuit breaker
        this.failureCount++;
        this.lastFailureTime = Date.now();
        this.updateCircuitBreaker();
        
        const attemptTime = Date.now() - attemptStartTime;
        const totalTime = Date.now() - taskStartTime;
        console.log(`❌ [RETRY] ${task.id} failed (attempt ${task.currentAttempt}/${task.maxRetries + 1}) after ${attemptTime}ms: ${task.lastError.message}`);
        
        if (task.currentAttempt > task.maxRetries) {
          // Max retries exceeded
          this.queue.delete(task.id);
          console.error(`💀 [RETRY] ${task.id} failed permanently after ${task.maxRetries + 1} attempts (total time: ${totalTime}ms)`);
          throw new Error(`Operation failed after ${task.maxRetries + 1} attempts: ${task.lastError.message}`);
        }
        
        // Calculate exponential backoff with significant jitter to prevent thundering herd
        const baseJitter = Math.random() * 0.5 * task.backoffMs; // 50% jitter
        const additionalDelay = Math.random() * 1000; // 0-1s additional random delay
        const staggerDelay = (task.currentAttempt - 1) * 500; // Stagger retries by attempt number
        const delay = Math.min(task.backoffMs + baseJitter + additionalDelay + staggerDelay, this.maxBackoffMs);
        
        const delayStartTime = Date.now();
        console.log(`⏳ [RETRY] ${task.id} waiting ${Math.round(delay)}ms before retry (total elapsed: ${totalTime}ms)...`);
        
        await this.sleep(delay);
        
        const actualDelayTime = Date.now() - delayStartTime;
        console.log(`⏰ [RETRY] ${task.id} delay completed (planned: ${Math.round(delay)}ms, actual: ${actualDelayTime}ms)`);
        
        // Increase backoff for next attempt
        task.backoffMs = Math.min(task.backoffMs * 2, this.maxBackoffMs);
      }
    }
    
    throw new Error(`Unexpected retry loop exit for ${task.id}`);
  }

  /**
   * Process the retry queue
   */
  private async processQueue(): Promise<void> {
    this.processing = true;
    
    try {
      // Process tasks that need retry
      for (const task of this.queue.values()) {
        if (task.currentAttempt > 0 && task.currentAttempt <= task.maxRetries) {
          // This task is already being retried, skip
          continue;
        }
      }
    } finally {
      this.processing = false;
    }
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get queue status
   */
  getStatus(): { active: number; failed: number; pending: number } {
    let active = 0;
    let failed = 0;
    let pending = 0;

    for (const task of this.queue.values()) {
      if (task.currentAttempt > task.maxRetries) {
        failed++;
      } else if (task.currentAttempt > 0) {
        active++;
      } else {
        pending++;
      }
    }

    return { active, failed, pending };
  }

  /**
   * Update circuit breaker based on failure patterns
   */
  private updateCircuitBreaker(): void {
    const now = Date.now();
    const timeSinceLastFailure = now - this.lastFailureTime;
    
    // Reset failure count if no failures in last 30 seconds
    if (timeSinceLastFailure > 30000) {
      if (this.failureCount > 0 || this.circuitBreakerDelay > 0) {
        console.log(`🔄 [CIRCUIT] System recovered - resetting failure count (${this.failureCount}) and delay (${this.circuitBreakerDelay}ms)`);
      }
      this.failureCount = 0;
      this.circuitBreakerDelay = 0;
      return;
    }
    
    // Increase circuit breaker delay based on failure rate
    const previousDelay = this.circuitBreakerDelay;
    if (this.failureCount > 5) {
      this.circuitBreakerDelay = Math.min(this.failureCount * 200, 5000); // Max 5s delay
      if (this.circuitBreakerDelay !== previousDelay) {
        console.log(`🛡️ [CIRCUIT] System stress detected (${this.failureCount} failures), applying ${this.circuitBreakerDelay}ms delay (was ${previousDelay}ms)`);
      }
    }
  }

  /**
   * Clear all tasks
   */
  clear(): void {
    this.queue.clear();
    this.failureCount = 0;
    this.circuitBreakerDelay = 0;
  }
}

/**
 * Singleton retry queue instance
 */
export const globalRetryQueue = new RetryQueue(2000, 60000); // 2s base, 60s max

/**
 * Utility function to wrap operations with retry logic
 */
export async function withRetry<T>(
  id: string,
  operation: () => Promise<T>,
  maxRetries: number = 3
): Promise<T> {
  return globalRetryQueue.enqueue(id, operation, maxRetries);
}
