import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import * as ffprobeStatic from 'ffprobe-static';

// Resolve paths outside ASAR for packaged apps
const resolvedFfmpegPath = ffmpegPath?.replace('app.asar', 'app.asar.unpacked');
const resolvedFfprobePath = ffprobeStatic.path?.replace('app.asar', 'app.asar.unpacked');

if (resolvedFfmpegPath && resolvedFfprobePath) {
  const binDir = path.dirname(resolvedFfmpegPath);

  // Set up environment variables (no logging to avoid EPIPE in production)
  process.env.FFMPEG_PATH = resolvedFfmpegPath;
  process.env.FFPROBE_PATH = resolvedFfprobePath;
  process.env.PATH = `${binDir}:${process.env.PATH || ''}`;
}

export function getFfmpegPaths() {
  return { 
    ffmpeg: resolvedFfmpegPath || ffmpegPath, 
    ffprobe: resolvedFfprobePath || ffprobeStatic.path 
  };
}
