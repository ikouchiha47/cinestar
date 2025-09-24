import { BaseVideoProcessor, ProcessingContext, ProcessingResult, VideoSegment } from '../video-pipeline';
import { generateThumbnails, getCacheDir, extractKeyframe } from '../video-processing';
import { FluentFrameAnalysisService } from './fluent-frame-analysis-service';
import { ProgressiveKeyframeExtractor } from './progressive-keyframe-extractor';
import { enqueueRefinementJob } from '../keyframe-refinement-job-queue';
import path from 'path';
import { promises as fs } from 'fs';

export class VisualProcessor extends BaseVideoProcessor {
  public name = 'visual';
  public version = '1.0.0';
  // Intelligent frame analysis disabled by default; only used for dev test
  private progressiveExtractor: ProgressiveKeyframeExtractor;

  constructor(config: {
    generateThumbnails?: boolean;
    generateKeyframes?: boolean;
    thumbnailQuality?: number;
    keyframeInterval?: number;
    maxKeyframes?: number;
    similarityThreshold?: number;
    useIntelligentFiltering?: boolean;
    useProgressiveExtraction?: boolean;
  } = {}) {

    super();

    this.setConfig({
      generateThumbnails: true,
      generateKeyframes: true,
      thumbnailQuality: 2,
      keyframeInterval: 1, // Extract keyframe every N seconds
      maxKeyframes: 20, // Legacy cap (not applied in sceneCut mode); kept for fallback
      similarityThreshold: 0.15, // Filter similar frames (lower = more strict)
      useIntelligentFiltering: false,
      useProgressiveExtraction: false, // Enable progressive multi-pass extraction
      // New: rate-based sampling settings (optional)
      keyframesMode: 'scene', // 'scene' | 'rate' | 'progressive'
      keyframesFPS: 0,        // when > 0, sample this many frames per second for the segment
      keyframesTargetTotal: 0, // when > 0 and FPS is 0, evenly sample this many frames across the segment
      keyframesMaxTotal: 500,  // hard cap to avoid runaway extraction
      ...config
    });

    // Initialize progressive extractor if enabled
    this.progressiveExtractor = new ProgressiveKeyframeExtractor();
  }

  async process(context: ProcessingContext): Promise<ProcessingResult> {
    const segment = context.segment;
    try {
      const config = this.getConfig();
      const cacheDir = getCacheDir(segment.videoPath);

      this.log('info', `Processing visual elements for segment: ${segment.id}`);

      const results: Record<string, any> = {};

      // Generate thumbnails if enabled and scene cuts are available
      if (config.generateThumbnails && context.data.sceneCuts) {
        const thumbnailDir = path.join(cacheDir, 'thumbnails');
        
        const thumbnails = await generateThumbnails(
          segment.videoPath,
          context.data.sceneCuts,
          thumbnailDir
        );
        
        results.thumbnails = thumbnails;
        this.log('info', `Generated ${thumbnails.length} thumbnails`);
      }

      // Generate keyframes if enabled
      if (config.generateKeyframes) {
        const keyframeDir = path.join(cacheDir, 'keyframes');

        // Decide strategy: progressive vs rate-based vs scene cuts
        const useProgressive = config.keyframesMode === 'progressive' || config.useProgressiveExtraction;
        const useRate = (config.keyframesMode === 'rate') || (Number(config.keyframesFPS) > 0 || Number(config.keyframesTargetTotal) > 0);

        if (useProgressive) {
          // Progressive multi-pass extraction
          this.log('info', 'Using progressive multi-pass keyframe extraction');
          // Clean stale keyframes for this segment to avoid index/name mismatch
          try {
            const existing = await fs.readdir(keyframeDir);
            const prefix = `${segment.id}_`;
            await Promise.all(
              existing
                .filter(f => f.startsWith(prefix) && f.endsWith('.png'))
                .map(f => fs.unlink(path.join(keyframeDir, f)).catch(() => {}))
            );
          } catch {}
          
          const progressiveResults = await this.progressiveExtractor.extractProgressively(
            segment.videoPath,
            segment.startTime,
            segment.endTime,
            segment.id,
            keyframeDir
          );

          // Return immediate keyframes for pipeline continuation
          // Only return paths that actually exist (belt-and-suspenders)
          const immediateKeyframes = [] as string[];
          for (const c of progressiveResults.immediate) {
            if (c.extracted && c.imagePath) {
              try { await fs.access(c.imagePath); immediateKeyframes.push(c.imagePath); }
              catch { this.log('warn', `Keyframe missing on disk, skipping: ${c.imagePath}`); }
            }
          }

          results.keyframes = immediateKeyframes;
          results.progressiveKeyframes = {
            immediate: progressiveResults.immediate,
            delayed: progressiveResults.delayed,
            background: progressiveResults.background
          };

          this.log('info', `Generated ${immediateKeyframes.length} immediate keyframes, ${progressiveResults.delayed.length} delayed, ${progressiveResults.background.length} background`);

          // Enqueue delayed and background refinement jobs (persistent queues)
          if (progressiveResults.delayed.length > 0) {
            enqueueRefinementJob('granularity_1', {
              videoPath: segment.videoPath,
              outputDir: keyframeDir,
              segmentId: segment.id,
              label: 'delayed',
              candidates: progressiveResults.delayed.map(c => ({
                timestamp: c.timestamp,
                passId: c.passId,
                combinedScore: c.combinedScore,
              })),
            });
          }

          if (progressiveResults.background.length > 0) {
            enqueueRefinementJob('granularity_2', {
              videoPath: segment.videoPath,
              outputDir: keyframeDir,
              segmentId: segment.id,
              label: 'background',
              candidates: progressiveResults.background.map(c => ({
                timestamp: c.timestamp,
                passId: c.passId,
                combinedScore: c.combinedScore,
              })),
            });
          }

        } else if (useRate) {
          // Rate-based sampling across the whole segment duration
          const start = Number(segment.startTime) || 0;
          const end = Number(segment.endTime) || start;
          const duration = Math.max(0, end - start);
          const fps = Number(config.keyframesFPS) || 0;
          const target = !fps && Number(config.keyframesTargetTotal) > 0 ? Number(config.keyframesTargetTotal) : 0;

          let interval = 0;
          if (fps > 0) {
            interval = 1 / fps;
          } else if (target > 0 && duration > 0) {
            interval = duration / target;
          } else {
            // Fallback to legacy interval if misconfigured
            interval = Math.max(1, Number(config.keyframeInterval) || 1);
          }

          const timestamps: number[] = [];
          if (interval > 0) {
            for (let t = start; t < end; t += interval) {
              timestamps.push(t);
              if (timestamps.length >= Number(config.keyframesMaxTotal) || timestamps.length > 1_000) break;
            }
          }

          const keyframes: string[] = [];
          for (let i = 0; i < timestamps.length; i++) {
            const ts = timestamps[i];
            const outPath = path.join(keyframeDir, `${segment.id}_${String(i).padStart(3,'0')}_${ts.toFixed(3)}.png`);
            await extractKeyframe(segment.videoPath, ts, outPath);
            keyframes.push(outPath);
          }
          results.keyframes = keyframes;
          this.log('info', `Generated ${keyframes.length} keyframes (rate mode)`);

        } else {
          // Use simplified two-pass approach for this segment
          
          // Create a pseudo-segment for the indexer (it expects full video analysis)
          // For now, we'll use a simplified approach that works with existing segmentation
          const segmentDuration = segment.endTime - segment.startTime;
          
          this.log('info', `Using two-pass keyframe extraction for ${segmentDuration.toFixed(1)}s segment`);
          
          try {
            // For integration with existing pipeline, we'll extract keyframes directly for this segment
            // In a full implementation, this would run once per video, not per segment
            const keyframes = await this.extractSegmentKeyframes(
              segment.videoPath,
              segment,
              keyframeDir
            );
            
            results.keyframes = keyframes;
            this.log('info', `Generated ${keyframes.length} keyframes using two-pass approach`);
            
          } catch (error) {
            this.log('warn', 'Two-pass extraction failed, using fallback', error instanceof Error ? error.message : String(error));
            
            // Fallback: single keyframe at segment middle
            const fallbackTimestamp = segment.startTime + (segmentDuration / 2);
            const fallbackPath = path.join(keyframeDir, `${segment.id}_000_${fallbackTimestamp.toFixed(3)}.png`);
            
            await this.extractSingleKeyframe(segment.videoPath, fallbackTimestamp, fallbackPath);
            results.keyframes = [fallbackPath];
            this.log('info', 'Generated 1 fallback keyframe');
          }

          // Dev-only: test MJPEG in-memory extraction
          if (process.env.TEST_INMEMORY_MJPEG === '1' && results.keyframes.length > 0) {
            try {
              const svc = new FluentFrameAnalysisService();
              // Extract timestamps from keyframe filenames for testing
              const timestamps = results.keyframes.map((kf: string) => {
                const match = path.basename(kf).match(/_([\d.]+)\.png$/);
                return match ? parseFloat(match[1]) : segment.startTime;
              });
              const sample = timestamps.slice(0, Math.min(12, timestamps.length));
              const testRes = await svc.extractFramesInMemoryMJPEG(segment.videoPath, sample, { concurrencyLimit: 2 });
              this.log('info', `[DEV TEST] MJPEG in-memory extraction: ${testRes.length}/${sample.length} frames decoded`);
            } catch (e) {
              this.log('warn', '[DEV TEST] MJPEG in-memory extraction failed', e instanceof Error ? e.message : String(e));
            }
          }
        }
      }

      return {
        success: true,
        data: results,
        metadata: {
          processingTime: Date.now(),
          config: this.getConfig()
        }
      };
    } catch (error) {
      this.log('error', 'Visual processing failed', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown visual processing error'
      };
    }
  }



  /**
   * Extract keyframes for a segment using simplified two-pass approach
   */
  private async extractSegmentKeyframes(
    videoPath: string,
    segment: VideoSegment,
    outputDir: string
  ): Promise<string[]> {
    const duration = segment.endTime - segment.startTime;
    
    // Simplified content classification based on duration and position
    let targetCount: number;
    if (duration < 5) {
      targetCount = 1; // Short segments get 1 keyframe
    } else if (duration < 15) {
      targetCount = Math.min(2, Math.ceil(duration / 8)); // Medium segments
    } else {
      targetCount = Math.min(4, Math.ceil(duration / 6)); // Longer segments
    }
    
    const keyframes: string[] = [];
    
    if (targetCount === 1) {
      // Single keyframe at segment center with slight randomization
      const timestamp = segment.startTime + (duration / 2) + (Math.random() - 0.5) * Math.min(1, duration * 0.1);
      const keyframePath = path.join(outputDir, `${segment.id}_000_${timestamp.toFixed(3)}.png`);
      
      await this.extractSingleKeyframe(videoPath, timestamp, keyframePath);
      keyframes.push(keyframePath);
      
    } else {
      // Multiple keyframes distributed across segment
      const interval = duration / (targetCount + 1);
      
      for (let i = 1; i <= targetCount; i++) {
        const baseTimestamp = segment.startTime + (interval * i);
        // Add small random offset to avoid identical frames
        const timestamp = baseTimestamp + (Math.random() - 0.5) * Math.min(0.5, interval * 0.1);
        const keyframePath = path.join(outputDir, `${segment.id}_${String(i-1).padStart(3,'0')}_${timestamp.toFixed(3)}.png`);
        
        await this.extractSingleKeyframe(videoPath, timestamp, keyframePath);
        keyframes.push(keyframePath);
      }
    }
    
    return keyframes;
  }

  /**
   * Extract a single keyframe as WebP
   */
  private async extractSingleKeyframe(videoPath: string, timestamp: number, outputPath: string): Promise<void> {
    const { spawn } = await import('child_process');
    const { promises: fs } = await import('fs');
    
    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    await fs.mkdir(outputDir, { recursive: true });
    
    return new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-ss', timestamp.toString(),
        '-i', videoPath,
        '-vframes', '1',
        '-f', 'image2',
        '-q:v', '2',
        '-y',
        outputPath
      ], {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let errorOutput = '';

      ffmpeg.stderr?.on('data', (data) => {
        errorOutput += data.toString();
      });

      ffmpeg.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`FFmpeg keyframe extraction failed: ${errorOutput}`));
        } else {
          resolve();
        }
      });
    });
  }
}
