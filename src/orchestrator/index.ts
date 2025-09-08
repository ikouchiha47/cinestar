export * from './types';
export * from './resource-pools';
export * from './job-queue';
export * from './job-store';
export * from './pipeline-runner';
export * from './batch-embedding';
export * from './storyline';
export * from './partial-writer';

// Convenience bootstrap for quick usage
import { Orchestrator } from './pipeline-runner';

export async function runDirectory(dir: string, options?: { recursive?: boolean; concurrency?: number }) {
  const orch = new Orchestrator({
    videoConcurrency: options?.concurrency ?? 2,
  });
  await orch.initialize();
  await orch.enqueueDirectory(dir, options?.recursive ?? false);
  orch.start();
  return orch;
}
