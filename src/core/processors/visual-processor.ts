import { BaseVideoProcessor, ProcessingContext, ProcessingResult } from '../video-pipeline';
import { generateThumbnails, extractKeyframe, getCacheDir } from '../video-processing';
import path from 'path';

export class VisualProcessor extends BaseVideoProcessor {
  public name = 'visual';
  public version = '1.0.0';

  constructor(config: {
    generateThumbnails?: boolean;
    generateKeyframes?: boolean;
    thumbnailQuality?: number;
    keyframeInterval?: number;
  } = {}) {
    super();
    this.setConfig({
      generateThumbnails: true,
      generateKeyframes: true,
      thumbnailQuality: 2,
      keyframeInterval: 1, // Extract keyframe every N seconds
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
        const keyframes: string[] = [];
        
        // Extract keyframes at regular intervals within the segment
        const duration = segment.endTime - segment.startTime;
        const interval = config.keyframeInterval;
        
        for (let t = segment.startTime; t < segment.endTime; t += interval) {
          const keyframePath = path.join(keyframeDir, `${segment.id}_${t.toFixed(2)}.jpg`);
          await extractKeyframe(segment.videoPath, t, keyframePath);
          keyframes.push(keyframePath);
        }
        
        results.keyframes = keyframes;
        this.log('info', `Generated ${keyframes.length} keyframes`);
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
