#!/usr/bin/env node
import { Orchestrator } from './pipeline-runner';

async function main() {
  const [, , targetDirArg, recursiveArg, concurrencyArg] = process.argv;
  const targetDir = targetDirArg || './data';
  const recursive = (recursiveArg || 'false').toLowerCase() === 'true';
  const concurrency = Number(concurrencyArg || process.env.ORCH_CONCURRENCY || 2);

  const orch = new Orchestrator({ videoConcurrency: concurrency });
  await orch.initialize();
  await orch.enqueueDirectory(targetDir, recursive);

  orch.on('job:enqueued', (job) => console.log(`[orchestrator] enqueued`, job.videoPath));
  orch.on('job:started', (job) => console.log(`[orchestrator] started`, job.videoPath));
  orch.on('job:completed', (job) => console.log(`[orchestrator] completed`, job.videoPath));
  orch.on('job:failed', (job, error) => console.error(`[orchestrator] failed`, job.videoPath, error));
  orch.on('stage:start', (job, stage) => console.log(`[stage] start`, stage, 'for', job.videoPath));
  orch.on('stage:complete', (job, stage, ms) => console.log(`[stage] complete`, stage, `${ms}ms`, 'for', job.videoPath));
  orch.on('stage:error', (job, stage, err) => console.error(`[stage] error`, stage, 'for', job.videoPath, err));

  orch.start();
}

main().catch((e) => {
  console.error('orchestrator run failed:', e);
  process.exit(1);
});
