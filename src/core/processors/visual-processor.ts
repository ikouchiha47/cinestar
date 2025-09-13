import { BaseVideoProcessor, ProcessingContext, ProcessingResult } from '../video-pipeline';
import { generateThumbnails, extractKeyframe, getCacheDir } from '../video-processing';
import { FluentFrameAnalysisService } from './fluent-frame-analysis-service';
import path from 'path';

export class VisualProcessor extends BaseVideoProcessor {
  public name = 'visual';
  public version = '1.0.0';
  // Intelligent frame analysis disabled by default; only used for dev test

  constructor(config: {
    generateThumbnails?: boolean;
    generateKeyframes?: boolean;
    thumbnailQuality?: number;
    keyframeInterval?: number;
    maxKeyframes?: number;
    similarityThreshold?: number;
    useIntelligentFiltering?: boolean;
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
      // New: rate-based sampling settings (optional)
      keyframesMode: 'scene', // 'scene' | 'rate'
      keyframesFPS: 0,        // when > 0, sample this many frames per second for the segment
      keyframesTargetTotal: 0, // when > 0 and FPS is 0, evenly sample this many frames across the segment
      keyframesMaxTotal: 500,  // hard cap to avoid runaway extraction
      ...config
    });
  }

  async process(context: ProcessingContext): Promise<ProcessingResult> {
    try {
      const { segment } = context;
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

        // Decide strategy: rate-based vs scene cuts
        const useRate = (config.keyframesMode === 'rate') || (Number(config.keyframesFPS) > 0 || Number(config.keyframesTargetTotal) > 0);

        if (useRate) {
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
            const outPath = path.join(keyframeDir, `${segment.id}_${String(i).padStart(3,'0')}_${ts.toFixed(3)}.jpg`);
            await extractKeyframe(segment.videoPath, ts, outPath);
            keyframes.push(outPath);
          }
          results.keyframes = keyframes;
          this.log('info', `Generated ${keyframes.length} keyframes (rate mode)`);

        } else if (Array.isArray(context.data.sceneCuts) && context.data.sceneCuts.length > 0) {
          const cuts: number[] = context.data.sceneCuts.slice().sort((a: number, b: number) => a - b);
          const keyframePaths: string[] = [];
          for (let i = 0; i < cuts.length; i++) {
            const ts = cuts[i];
            const outPath = path.join(keyframeDir, `${segment.id}_${String(i).padStart(3,'0')}_${ts.toFixed(3)}.jpg`);
            await extractKeyframe(segment.videoPath, ts, outPath);
            keyframePaths.push(outPath);
          }
          results.keyframes = keyframePaths;
          this.log('info', `Generated ${keyframePaths.length} keyframes (scene cuts)`);

          // Dev-only: test MJPEG in-memory extraction using the frame analysis service
          if (process.env.TEST_INMEMORY_MJPEG === '1') {
            try {
              const svc = new FluentFrameAnalysisService();
              const sample = cuts.slice(0, Math.min(12, cuts.length));
              const testRes = await svc.extractFramesInMemoryMJPEG(segment.videoPath, sample, { concurrencyLimit: 2 });
              this.log('info', `[DEV TEST] MJPEG in-memory extraction: ${testRes.length}/${sample.length} frames decoded`);
            } catch (e) {
              this.log('warn', '[DEV TEST] MJPEG in-memory extraction failed', e instanceof Error ? e.message : String(e));
            }
          }
        } else {
          // Fallback to simple interval-based extraction
          const keyframes: string[] = [];
          const interval = Math.max(1, Number(config.keyframeInterval) || 1);
          for (let t = segment.startTime; t < segment.endTime; t += interval) {
            const outPath = path.join(keyframeDir, `${segment.id}_${t.toFixed(2)}.jpg`);
            await extractKeyframe(segment.videoPath, t, outPath);
            keyframes.push(outPath);
          }
          results.keyframes = keyframes;
          this.log('info', `Generated ${keyframes.length} keyframes (interval fallback)`);
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
}
