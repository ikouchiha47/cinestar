import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { ConfigManager } from './config.js';

/**
 * Lightweight auto-tuner for FFmpeg per-process thread count.
 * - Creates a short synthetic test video
 * - Benchmarks frame extraction across a few thread counts
 * - Picks the best for the current machine and updates ConfigManager
 */
export async function autoTuneFFmpegThreads(options?: {
  candidates?: number[];
  parallelProcs?: number;
  durationSec?: number;
  size?: string;
  timestamps?: number[];
  skipIfEnvSet?: boolean;
}): Promise<{ selected: number; measurements: Array<{ threads: number; ms: number; frames: number }>; isDefault?: boolean; }> {
  const cfg = ConfigManager.getConfig();
  const defaultThreads = 2; // Default fallback value - test change 1

  // If explicitly set via env, use that value
  const envThreads = process.env.VIDEO_FFMPEG_THREADS;
  if (envThreads && !isNaN(parseInt(envThreads, 10))) {
    const selected = parseInt(envThreads, 10);
    return { selected, measurements: [], isDefault: false };
  }
  
  // If already configured, use existing value
  if (typeof cfg.video?.pipeline?.threadsPerProcess === 'number') {
    return { selected: cfg.video.pipeline.threadsPerProcess, measurements: [], isDefault: false };
  }

  const candidates = options?.candidates || [1, 2, 4];
  const durationSec = options?.durationSec ?? 6;
  const size = options?.size ?? '640x360';
  const cpuCount = os.cpus()?.length || 4;
  const defaultParallel = Math.max(2, Math.min(4, Math.floor(cpuCount / 2)));
  const parallelProcs = options?.parallelProcs ?? defaultParallel;
  const timestamps = options?.timestamps || [1, 2, 3, 4];

  const testVideo = path.resolve(process.cwd(), '.tune-test.mp4');

  const created = await createTestVideo(testVideo, durationSec, size);
  if (!created) {
    // Could not create test video; use default threads
    ConfigManager.updateConfig({
      video: {
        pipeline: {
          threadsPerProcess: defaultThreads
        }
      }
    });
    return { selected: defaultThreads, measurements: [], isDefault: true };
  }

  const measurements: Array<{ threads: number; ms: number; frames: number }> = [];

  // Run parallel benchmark for each candidate
  for (const threads of candidates) {
    const { ms, frames } = await runParallelExtract(testVideo, timestamps, threads, parallelProcs);
    measurements.push({ threads, ms, frames });
  }

  // Pick the lowest time (or highest FPS), prefer lower threads on ties
  measurements.sort((a, b) => (a.ms - b.ms) || (a.threads - b.threads));
  const best = measurements[0];
  const tunedThreads = best?.threads ?? defaultThreads;

  // Only use tuned value if it's better than default (higher thread count = potentially better)
  const selected = tunedThreads > defaultThreads ? tunedThreads : defaultThreads;
  const isDefault = selected === defaultThreads;

  // Update runtime config
  ConfigManager.updateConfig({
    video: {
      pipeline: {
        threadsPerProcess: selected
      }
    }
  });

  // Cleanup temp
  try { await fs.unlink(testVideo); } catch {}

  return { selected, measurements, isDefault };
}

async function createTestVideo(outPath: string, durationSec: number, size: string): Promise<boolean> {
  return new Promise((resolve) => {
    const ff = spawn('ffmpeg', [
      '-hide_banner',
      '-y',
      '-f', 'lavfi',
      '-i', `testsrc=duration=${durationSec}:size=${size}:rate=30`,
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '28',
      outPath
    ]);
    ff.on('close', (code) => resolve(code === 0));
    ff.on('error', () => resolve(false));
  });
}

async function runParallelExtract(videoPath: string, timestamps: number[], threads: number, procs: number): Promise<{ ms: number; frames: number; }> {
  const groups = partition(timestamps, procs);
  const start = Date.now();
  const results = await Promise.all(groups.map(g => runExtract(videoPath, g, threads)));
  const ms = Date.now() - start;
  const frames = results.reduce((a, b) => a + b.frames, 0);
  return { ms, frames };
}

function partition<T>(arr: T[], parts: number): T[][] {
  const out: T[][] = Array.from({ length: parts }, () => []);
  arr.forEach((v, i) => out[i % parts].push(v));
  return out;
}

function runExtract(videoPath: string, timestamps: number[], threads: number): Promise<{ ms: number; frames: number; }> {
  return new Promise((resolve) => {
    const start = Date.now();
    const select = `select='${timestamps.map(t => `eq(t,${t})`).join('+')}',showinfo`;
    const args = [
      '-hide_banner',
      '-v', 'warning',
      '-i', videoPath,
      '-an', '-sn', '-dn',
      '-vf', select,
      '-f', 'image2pipe',
      '-vcodec', 'mjpeg',
      '-q:v', '3',
      '-threads', String(threads),
      'pipe:1'
    ];

    const ff = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let frames = 0;

    ff.stdout.on('data', (chunk) => {
      const s = chunk.toString('binary');
      const matches = s.match(/\xFF\xD8/g);
      if (matches) frames += matches.length;
    });

    ff.on('close', () => {
      resolve({ ms: Date.now() - start, frames });
    });
    ff.on('error', () => resolve({ ms: Number.MAX_SAFE_INTEGER, frames: 0 }));
  });
}
