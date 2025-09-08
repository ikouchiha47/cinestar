import { ConcurrencyLimiter } from '../core/concurrency-limiter';

export interface ResourcePools {
  cpu: ConcurrencyLimiter;
  gpu: ConcurrencyLimiter;
  io: ConcurrencyLimiter;
}

export interface PoolConfig {
  cpu?: number;
  gpu?: number;
  io?: number;
}

export function createResourcePools(cfg: PoolConfig = {}): ResourcePools {
  const { cpu = 4, gpu = 1, io = 8 } = cfg;
  return {
    cpu: new ConcurrencyLimiter(cpu),
    gpu: new ConcurrencyLimiter(gpu),
    io: new ConcurrencyLimiter(io)
  };
}
