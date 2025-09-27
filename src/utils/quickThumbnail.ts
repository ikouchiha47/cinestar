/**
 * Quick thumbnail generation for immediate video preview
 * Extracts a random keyframe from uploaded videos for instant visual feedback
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { spawn } from 'child_process';

interface ThumbnailResult {
  success: boolean;
  thumbnailPath?: string;
  error?: string;
}

/**
 * Generate a quick thumbnail from a video file
 * Extracts a frame at 10% of video duration (or 5 seconds, whichever is smaller)
 */
export async function generateQuickThumbnail(
  videoPath: string,
  outputDir: string = './data/thumbs'
): Promise<ThumbnailResult> {
  try {
    console.log(`[QUICK-THUMB] Generating thumbnail for: ${videoPath}`);
    
    // Ensure output directory exists
    await fs.mkdir(outputDir, { recursive: true });
    
    // Generate unique filename based on video path
    const videoName = path.basename(videoPath, path.extname(videoPath));
    const sanitizedName = videoName.replace(/[^a-zA-Z0-9-_]/g, '_');
    const thumbnailPath = path.join(outputDir, `${sanitizedName}_thumb.jpg`);
    
    // Check if thumbnail already exists
    try {
      await fs.access(thumbnailPath);
      console.log(`[QUICK-THUMB] Thumbnail already exists: ${thumbnailPath}`);
      return { success: true, thumbnailPath };
    } catch {
      // Thumbnail doesn't exist, continue with generation
    }
    
    // Get video duration first
    const duration = await getVideoDuration(videoPath);
    if (!duration) {
      throw new Error('Could not determine video duration');
    }
    
    // Extract frame at 10% of duration (max 10 seconds)
    const seekTime = Math.min(duration * 0.1, 10);
    
    console.log(`[QUICK-THUMB] Video duration: ${duration}s, extracting frame at: ${seekTime}s`);
    
    // Use FFmpeg to extract thumbnail
    const success = await extractThumbnailWithFFmpeg(videoPath, thumbnailPath, seekTime);
    
    if (success) {
      console.log(`[QUICK-THUMB] ✅ Thumbnail generated: ${thumbnailPath}`);
      return { success: true, thumbnailPath };
    } else {
      throw new Error('FFmpeg thumbnail extraction failed');
    }
    
  } catch (error) {
    console.error(`[QUICK-THUMB] ❌ Failed to generate thumbnail:`, error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

/**
 * Get video duration using FFprobe
 */
async function getVideoDuration(videoPath: string): Promise<number | null> {
  return new Promise((resolve) => {
    const ffprobe = spawn('ffprobe', [
      '-v', 'quiet',
      '-show_entries', 'format=duration',
      '-of', 'csv=p=0',
      videoPath
    ]);
    
    let output = '';
    
    ffprobe.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    ffprobe.on('close', (code) => {
      if (code === 0) {
        const duration = parseFloat(output.trim());
        resolve(isNaN(duration) ? null : duration);
      } else {
        console.warn(`[QUICK-THUMB] FFprobe failed with code: ${code}`);
        resolve(null);
      }
    });
    
    ffprobe.on('error', (error) => {
      console.warn(`[QUICK-THUMB] FFprobe error:`, error);
      resolve(null);
    });
  });
}

/**
 * Extract thumbnail using FFmpeg
 */
async function extractThumbnailWithFFmpeg(
  videoPath: string, 
  outputPath: string, 
  seekTime: number
): Promise<boolean> {
  return new Promise((resolve) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i', videoPath,
      '-ss', seekTime.toString(),
      '-vframes', '1',
      '-q:v', '2', // High quality
      '-vf', 'scale=320:240:force_original_aspect_ratio=decrease,pad=320:240:(ow-iw)/2:(oh-ih)/2', // Consistent size with padding
      '-y', // Overwrite output file
      outputPath
    ]);
    
    let errorOutput = '';
    
    ffmpeg.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });
    
    ffmpeg.on('close', (code) => {
      if (code === 0) {
        console.log(`[QUICK-THUMB] FFmpeg extraction successful`);
        resolve(true);
      } else {
        console.warn(`[QUICK-THUMB] FFmpeg failed with code: ${code}`);
        console.warn(`[QUICK-THUMB] FFmpeg error:`, errorOutput);
        resolve(false);
      }
    });
    
    ffmpeg.on('error', (error) => {
      console.warn(`[QUICK-THUMB] FFmpeg spawn error:`, error);
      resolve(false);
    });
  });
}

/**
 * Clean up old thumbnails (optional utility)
 */
export async function cleanupOldThumbnails(
  outputDir: string = './data/thumbs',
  maxAgeMs: number = 7 * 24 * 60 * 60 * 1000 // 7 days
): Promise<void> {
  try {
    const files = await fs.readdir(outputDir);
    const now = Date.now();
    
    for (const file of files) {
      if (!file.endsWith('_thumb.jpg')) continue;
      
      const filePath = path.join(outputDir, file);
      const stats = await fs.stat(filePath);
      
      if (now - stats.mtime.getTime() > maxAgeMs) {
        await fs.unlink(filePath);
        console.log(`[QUICK-THUMB] Cleaned up old thumbnail: ${file}`);
      }
    }
  } catch (error) {
    console.warn(`[QUICK-THUMB] Cleanup failed:`, error);
  }
}
