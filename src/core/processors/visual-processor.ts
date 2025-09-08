import { BaseVideoProcessor, ProcessingContext, ProcessingResult } from '../video-pipeline';
import { generateThumbnails, extractKeyframe, getCacheDir } from '../video-processing';
import { FrameAnalysisService } from './frame-analysis-service';
import { ConfigManager } from '../config';
import path from 'path';

export class VisualProcessor extends BaseVideoProcessor {
  public name = 'visual';
  public version = '1.0.0';
  private frameAnalysisService: FrameAnalysisService;

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
    this.frameAnalysisService = new FrameAnalysisService();
    this.setConfig({
      generateThumbnails: true,
      generateKeyframes: true,
      thumbnailQuality: 2,
      keyframeInterval: 1, // Extract keyframe every N seconds
      maxKeyframes: 20, // Limit total keyframes per segment
      similarityThreshold: 0.15, // Filter similar frames (lower = more strict)
      useIntelligentFiltering: true,
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
        
        if (config.useIntelligentFiltering) {
          // Use unified intelligent frame selection algorithm
          const visionModelDims = ConfigManager.getConfig().ai.visionModelDims;
          const selectedFrames = await this.frameAnalysisService.selectOptimalFrames(
            segment.videoPath,
            {
              compressForVision: true,
              visionModelDims
            }
          );
          
          console.log(`Intelligent frame selection: ${selectedFrames.length} optimal frames`);

          // Return paths of selected frames for captioning
          results.keyframes = selectedFrames.map(frame => frame.path);
          this.log('info', `Intelligent filtering: ${selectedFrames.length} keyframes`);
        } else {
          // Fallback to simple interval-based extraction
          const keyframes: string[] = [];
          // const duration = segment.endTime - segment.startTime;
          const interval = config.keyframeInterval;
          
          for (let t = segment.startTime; t < segment.endTime; t += interval) {
            const keyframePath = path.join(keyframeDir, `${segment.id}_${t.toFixed(2)}.jpg`);
            await extractKeyframe(segment.videoPath, t, keyframePath);
            keyframes.push(keyframePath);
          }
          
          results.keyframes = keyframes.slice(0, config.maxKeyframes);
          this.log('info', `Generated ${results.keyframes.length} keyframes (simple mode)`);
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
