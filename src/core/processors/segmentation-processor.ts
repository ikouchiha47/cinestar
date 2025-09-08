import { BaseVideoProcessor, ProcessingContext, ProcessingResult } from '../video-pipeline';
import { detectScenes, createVideoSegments } from '../video-processing';

export class SegmentationProcessor extends BaseVideoProcessor {
  public name = 'segmentation';
  public version = '1.0.0';

  constructor(config: {
    threshold?: number;
    overlapSeconds?: number;
    minSegmentLength?: number;
  } = {}) {
    super();
    this.setConfig({
      threshold: 0.4,
      overlapSeconds: 2,
      minSegmentLength: 3,
      ...config
    });
  }

  async process(context: ProcessingContext): Promise<ProcessingResult> {
    try {
      const { segment } = context;
      const config = this.getConfig();

      this.log('info', `Processing segmentation for video: ${segment.videoPath}`);

      // Detect scene changes
      const sceneCuts = await detectScenes(segment.videoPath, config.threshold);
      this.log('info', `Detected ${sceneCuts.length} scene cuts`);

      // Create segments with overlap
      const segments = await createVideoSegments(
        segment.videoPath,
        segment.videoId,
        sceneCuts,
        config.overlapSeconds,
        config.minSegmentLength
      );

      this.log('info', `Created ${segments.length} segments`);

      return {
        success: true,
        data: {
          sceneCuts,
          segments,
          segmentCount: segments.length
        },
        metadata: {
          processingTime: Date.now(),
          config: this.getConfig()
        }
      };
    } catch (error) {
      this.log('error', 'Segmentation failed', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown segmentation error'
      };
    }
  }
}
