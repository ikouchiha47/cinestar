import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs/promises';
import { ConfigManager } from './config.js';

// Configure fluent-ffmpeg to use the static binary
if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}

export interface VideoSegment {
  id: string;
  videoId: string;
  startTime: number;
  endTime: number;
  thumbnailPath?: string;
  keyframePath?: string;
}

/**
 * Detect scene changes in a video using ffmpeg's scene detection filter
 */
export async function detectScenes(videoFile: string, threshold = 0.4): Promise<number[]> {
  return new Promise<number[]>((resolve, reject) => {
    const cuts: number[] = [];
    
    if (!ffmpegPath) {
      reject(new Error('ffmpeg-static not available'));
      return;
    }

    const proc = spawn(ffmpegPath, [
      '-i', videoFile,
      '-filter_complex', `select='gt(scene,${threshold})',metadata=print`,
      '-f', 'null', '-'
    ]);

    proc.stderr.on('data', (data) => {
      const str = data.toString();
      const matches = str.match(/pts_time:([0-9.]+)/g) || [];

      for (const match of matches) {
        const time = parseFloat(match.split(':')[1]);

        if (!isNaN(time)) {
          cuts.push(time);
        }
      }
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(cuts.sort((a, b) => a - b));
      } else {
        reject(new Error(`ffmpeg process exited with code ${code}`));
      }
    });

    proc.on('error', reject);
  });
}

/**
 * Generate thumbnails for video scenes
 */
export async function generateThumbnails(
  videoFile: string, 
  sceneCuts: number[], 
  outDir: string
): Promise<string[]> {
  // Ensure output directory exists
  await fs.mkdir(outDir, { recursive: true });

  return Promise.all(
    sceneCuts.map((time, i) =>
      new Promise<string>((resolve, reject) => {
        const outPath = path.join(outDir, `thumb_${i}.jpg`);
        const threads = String(ConfigManager.getConfig().video?.pipeline?.threadsPerProcess ?? 1);
        
        ffmpeg(videoFile)
          .noAudio()
          .seekInput(time)
          .frames(1)
          .outputOptions([
            '-vcodec', 'mjpeg',
            '-qscale:v', '2',
            '-pix_fmt', 'yuvj420p',
            '-threads', threads,
          ])
          .output(outPath)
          .on('end', () => resolve(outPath))
          .on('error', reject)
          .run();
      })
    )
  );
}

/**
 * Extract a single keyframe at a specific timestamp
 */
export async function extractKeyframe(
  videoFile: string, 
  timestamp: number, 
  outputPath: string
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // Ensure output directory exists
    const dir = path.dirname(outputPath);
    fs.mkdir(dir, { recursive: true }).then(() => {
      const threads = String(ConfigManager.getConfig().video?.pipeline?.threadsPerProcess ?? 1);
      ffmpeg(videoFile)
        .seekInput(timestamp)
        .frames(1)
        .outputOptions(['-q:v', '2', '-threads', threads])
        .output(outputPath)
        .on('end', () => resolve())
        .on('error', reject)
        .run();
    }).catch(reject);
  });
}

/**
 * Get video duration using ffprobe
 */
export async function getVideoDuration(videoFile: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    ffmpeg.ffprobe(videoFile, (err, metadata) => {
      if (err) {
        reject(err);
        return;
      }
      
      const duration = metadata.format?.duration;
      if (typeof duration === 'number') {
        resolve(duration);
      } else {
        reject(new Error('Could not determine video duration'));
      }
    });
  });
}

/**
 * Create video segments from scene cuts with overlap
 */
export async function createVideoSegments(
  videoFile: string,
  videoId: string,
  sceneCuts: number[],
  overlapSeconds = 2,
  minSegmentLength = 3
): Promise<VideoSegment[]> {
  const duration = await getVideoDuration(videoFile);
  const segments: VideoSegment[] = [];
  
  // Add start of video if not already present
  const allCuts = [0, ...sceneCuts, duration].sort((a, b) => a - b);
  
  for (let i = 0; i < allCuts.length - 1; i++) {
    let start = allCuts[i];
    let end = allCuts[i + 1];
    
    // Add overlap, but ensure we don't create zero-duration segments
    if (i > 0) start = Math.max(0, start - overlapSeconds);
    if (i < allCuts.length - 2) end = Math.min(duration, end + overlapSeconds);
    
    // Skip segments that are too short
    if (end - start < minSegmentLength) {
      console.warn(`Skipping short segment: ${start}s - ${end}s (duration: ${end - start}s)`);
      continue;
    }
    
    const segment: VideoSegment = {
      id: `${videoId}_seg_${i}`,
      videoId,
      startTime: start,
      endTime: end
    };
    
    segments.push(segment);
  }
  
  return segments;
}

/**
 * Generate cache directory path for a video file
 */
export function getCacheDir(videoFile: string): string {
  const basename = path.basename(videoFile, path.extname(videoFile));
  const hash = Buffer.from(videoFile).toString('base64').replace(/[/+=]/g, '');
  return path.join(process.cwd(), '.cache', 'video', `${basename}_${hash.slice(0, 8)}`);
}

/**
 * Main video indexing function that orchestrates the entire process
 */
export async function indexVideo(videoFile: string, videoId: string): Promise<{
  segments: VideoSegment[];
  thumbnails: string[];
  duration: number;
}> {
  try {
    console.log(`Starting video indexing for: ${videoFile}`);
    
    // Get video duration
    const duration = await getVideoDuration(videoFile);
    console.log(`Video duration: ${duration}s`);
    
    // Detect scene changes
    const sceneCuts = await detectScenes(videoFile, 0.4);
    console.log(`Detected ${sceneCuts.length} scene cuts:`, sceneCuts);
    
    // Create segments with overlap
    const segments = await createVideoSegments(videoFile, videoId, sceneCuts);
    console.log(`Created ${segments.length} segments`);
    
    // Generate thumbnails
    const cacheDir = getCacheDir(videoFile);
    const thumbnailDir = path.join(cacheDir, 'thumbnails');
    const thumbnails = await generateThumbnails(videoFile, sceneCuts, thumbnailDir);
    console.log(`Generated ${thumbnails.length} thumbnails`);
    
    // Update segments with thumbnail paths
    segments.forEach((segment, i) => {
      if (i < thumbnails.length) {
        segment.thumbnailPath = thumbnails[i];
      }
    });
    
    return {
      segments,
      thumbnails,
      duration
    };
    
  } catch (error) {
    console.error('Video indexing failed:', error);
    throw error;
  }
}
