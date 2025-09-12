#!/usr/bin/env node

import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

const TEST_VIDEO = './threads-bench-test.mp4';
const DURATION = 10; // seconds
const SIZE = '640x360';
const RATE = 30; // fps
const TIMESTAMPS = [1, 2, 3, 4, 5, 6, 7, 8];
const THREADS_LIST = [1, 2, 4];
const PARALLEL_CONCURRENCY = 4; // how many ffmpeg processes in parallel

function createTestVideo() {
  return new Promise((resolve) => {
    const ff = spawn('ffmpeg', [
      '-y',
      '-f', 'lavfi',
      '-i', `testsrc=duration=${DURATION}:size=${SIZE}:rate=${RATE}`,
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '23',
      TEST_VIDEO
    ]);
    ff.on('close', (code) => resolve(code === 0));
    ff.on('error', () => resolve(false));
  });
}

function runFfmpegExtract({ timestamps, threads, label }) {
  return new Promise((resolve) => {
    const start = Date.now();
    const select = `select='${timestamps.map(t => `eq(t,${t})`).join('+')}',showinfo`;
    const args = [
      '-hide_banner',
      '-v', 'warning',
      '-i', TEST_VIDEO,
      '-an', '-sn', '-dn',
      '-vf', select,
      '-f', 'image2pipe',
      '-vcodec', 'mjpeg',
      '-q:v', '2',
      '-threads', String(threads),
      'pipe:1'
    ];

    const ff = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let frames = 0;

    ff.stdout.on('data', (chunk) => {
      // Count JPEG start markers
      const s = chunk.toString('binary');
      const matches = s.match(/\xFF\xD8/g);
      if (matches) frames += matches.length;
    });

    let stderr = '';
    ff.stderr.on('data', (d) => { stderr += d.toString(); });

    ff.on('close', (code) => {
      const ms = Date.now() - start;
      resolve({ label, threads, frames, ms, code, stderr });
    });
  });
}

async function runSingleProcessBench() {
  const results = [];
  for (const threads of THREADS_LIST) {
    const res = await runFfmpegExtract({ timestamps: TIMESTAMPS, threads, label: 'single' });
    results.push(res);
  }
  return results;
}

function partition(arr, parts) {
  const out = Array.from({ length: parts }, () => []);
  arr.forEach((v, i) => out[i % parts].push(v));
  return out;
}

async function runParallelBench() {
  const results = [];
  const groups = partition(TIMESTAMPS, PARALLEL_CONCURRENCY);

  for (const threads of THREADS_LIST) {
    const start = Date.now();
    const runs = groups.map((g, idx) => runFfmpegExtract({ timestamps: g, threads, label: `p${idx}` }));
    const r = await Promise.all(runs);
    const totalMs = Date.now() - start;
    const frames = r.reduce((a, b) => a + b.frames, 0);
    results.push({ label: 'parallel', threads, frames, ms: totalMs, code: 0 });
  }
  return results;
}

async function appendToPerfMd(report) {
  const now = new Date().toISOString();
  const header = `\n\n## FFmpeg Threads Benchmark (${now})\n\n`;
  const intro = `This section benchmarks per-process FFmpeg thread count under two modes: single-process and parallel (${PARALLEL_CONCURRENCY} processes), extracting ${TIMESTAMPS.length} timestamps from a ${DURATION}s synthetic video (${SIZE}).`;

  const lines = [header, intro, '\n'];

  const byMode = report.reduce((acc, r) => {
    acc[r.label] = acc[r.label] || [];
    acc[r.label].push(r);
    return acc;
  }, {});

  for (const [mode, rows] of Object.entries(byMode)) {
    lines.push(`### Mode: ${mode}`);
    lines.push('');
    lines.push('| Threads | Time (ms) | Frames | FPS |');
    lines.push('|---------|-----------:|-------:|----:|');
    for (const r of rows.sort((a,b)=>a.threads-b.threads)) {
      const fps = r.ms > 0 ? (r.frames / (r.ms / 1000)).toFixed(2) : '0';
      lines.push(`| ${r.threads} | ${r.ms} | ${r.frames} | ${fps} |`);
    }
    lines.push('');
  }

  // Simple recommendation
  const single = byMode['single'] || [];
  const parallel = byMode['parallel'] || [];
  const bestSingle = single.slice().sort((a,b)=>a.ms-b.ms)[0];
  const bestParallel = parallel.slice().sort((a,b)=>a.ms-b.ms)[0];

  lines.push('### Recommendation');
  lines.push('');
  lines.push('- In most environments, lower per-process threads performs better when running processes in parallel due to reduced cache and I/O contention.');
  if (bestSingle) lines.push(`- Best single-process setting in this run: threads=${bestSingle.threads} (${bestSingle.ms} ms).`);
  if (bestParallel) lines.push(`- Best parallel setting in this run: threads=${bestParallel.threads} (${bestParallel.ms} ms with ${PARALLEL_CONCURRENCY} processes).`);

  try {
    const perfPath = path.resolve('PERF.md');
    await fs.appendFile(perfPath, lines.join('\n'));
    console.log('✅ Appended benchmark results to PERF.md');
  } catch (e) {
    console.error('Failed to append to PERF.md:', e.message);
  }
}

async function main() {
  console.log('🎬 Creating test video...');
  const ok = await createTestVideo();
  if (!ok) {
    console.error('❌ Unable to create test video. Ensure ffmpeg is installed and in PATH.');
    process.exit(1);
  }

  console.log('🧪 Running single-process benchmark...');
  const single = await runSingleProcessBench();
  single.forEach(r => console.log(`  threads=${r.threads} -> ${r.ms} ms, frames=${r.frames}`));

  console.log(`⚡ Running parallel benchmark (${PARALLEL_CONCURRENCY} procs)...`);
  const parallel = await runParallelBench();
  parallel.forEach(r => console.log(`  threads=${r.threads} -> ${r.ms} ms, frames=${r.frames}`));

  const report = [...single, ...parallel];
  await appendToPerfMd(report);

  // cleanup test video
  try { await fs.unlink(TEST_VIDEO); } catch {}
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error(err); process.exit(1); });
}
