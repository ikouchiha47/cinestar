import { BaseVideoProcessor, ProcessingContext, ProcessingResult } from '../video-pipeline';
import * as fs from 'fs';
import { CaptioningService, MoondreamService } from './captioning-processor';
import { OllamaCaptioningService } from './ollama-captioning-service';
import path from 'path';

/**
 * Video-level batch captioning processor that collects all keyframes
 * from all segments and processes them in optimal batches.
 */
export class BatchCaptioningProcessor extends BaseVideoProcessor {
  public name = 'batch-captioning';
  public version = '1.0.0';
  private services: CaptioningService[] = [];
  private activeService?: CaptioningService;

  constructor(config: {
    batchSize?: number;
    captionConcurrency?: number;
    services?: CaptioningService[];
  } = {}) {
    super();
    this.setConfig({
      batchSize: 8, // Larger batches for video-level processing
      captionConcurrency: 4,
      ...config
    });

    this.services = config.services || [
      new OllamaCaptioningService(),
      new MoondreamService()
    ];
  }

  private async findAvailableService(): Promise<CaptioningService | undefined> {
    for (const service of this.services) {
      if (await service.isAvailable()) {
        return service;
      }
    }
    return undefined;
  }

  private async processImageBatch(
    imagePaths: string[], 
    service: CaptioningService
  ): Promise<Map<string, { caption: string; error?: string }>> {
    const cfg = this.getConfig();
    const concurrency = Math.max(1, Number(cfg.captionConcurrency) || 4);
    
    const results = new Map<string, { caption: string; error?: string }>();
    let next = 0;

    const worker = async () => {
      while (true) {
        const i = next++;
        if (i >= imagePaths.length) break;
        const imagePath = imagePaths[i];
        
        try {
          const result = await service.caption(imagePath);
          results.set(imagePath, { caption: result.caption });
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          this.log('error', `Captioning failed for ${path.basename(imagePath)} ${msg}`);
          results.set(imagePath, { caption: '', error: msg });
        }
      }
    };

    const workers = Array.from({ length: concurrency }, () => worker());
    await Promise.all(workers);
    return results;
  }

  async process(context: ProcessingContext): Promise<ProcessingResult> {
    try {
      // This processor expects to run at video level with all segment results
      const processedSegments = context.data.processedSegments || [];
      
      if (!processedSegments.length) {
        this.log('warn', 'No processed segments available for batch captioning');
        return { success: true, data: { batchCaptions: {} } };
      }

      // Find available service
      if (!this.activeService) {
        this.activeService = await this.findAvailableService();
        if (!this.activeService) {
          this.log('warn', 'No captioning services available');
          return { success: true, data: { batchCaptions: {}, reason: 'no_service_available' } };
        }
        this.log('info', `Using captioning service: ${this.activeService.name}`);
      }

      // Collect all keyframes across segments
      const allKeyframes: string[] = [];
      const segmentKeyframeMap = new Map<string, string[]>();

      for (const segmentContext of processedSegments) {
        const segment = segmentContext.segment;
        const segmentData = segmentContext.data;
        
        // Collect keyframes from segment data or segment keyframePath
        let keyframes: string[] = [];
        
        if (segmentData.keyframes && Array.isArray(segmentData.keyframes)) {
          keyframes.push(...segmentData.keyframes);
        } else if (segment.keyframePath) {
          keyframes.push(segment.keyframePath);
        }
        
        // Filter out any non-existent files to avoid ENOENT during captioning
        if (keyframes.length > 0) {
          const valid = keyframes.filter(p => {
            try { fs.accessSync(p, fs.constants.R_OK); return true; }
            catch { this.log('warn', `Missing keyframe on disk, skipping: ${p}`); return false; }
          });

          if (valid.length > 0) {
            allKeyframes.push(...valid);
            segmentKeyframeMap.set(segment.id, valid);
          } else {
            this.log('warn', `All keyframes missing for segment ${segment.id}, skipping segment`);
          }
        }
      }

      if (allKeyframes.length === 0) {
        this.log('warn', 'No keyframes found across all segments');
        return { success: true, data: { batchCaptions: {}, reason: 'no_keyframes' } };
      }

      this.log('info', `Batch captioning ${allKeyframes.length} keyframes from ${segmentKeyframeMap.size} segments`);
      
      const config = this.getConfig();
      this.log('info', `Batch size: ${config.batchSize}, concurrency: ${config.captionConcurrency}`);

      // Process all keyframes in optimal batches
      const allCaptions = new Map<string, { caption: string; error?: string }>();
      const batchSize = config.batchSize;
      
      for (let i = 0; i < allKeyframes.length; i += batchSize) {
        const batch = allKeyframes.slice(i, i + batchSize);
        this.log('info', `Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(allKeyframes.length / batchSize)} (${batch.length} images)`);
        
        const batchResults = await this.processImageBatch(batch, this.activeService);
        
        // Merge results
        for (const [path, result] of batchResults) {
          allCaptions.set(path, result);
        }
      }

      // Map captions back to segments
      const segmentCaptions = new Map<string, Array<{ path: string; caption: string; error?: string }>>();
      
      for (const [segmentId, keyframes] of segmentKeyframeMap) {
        const captions = keyframes.map(kf => ({
          path: kf,
          caption: allCaptions.get(kf)?.caption || '',
          error: allCaptions.get(kf)?.error
        }));
        segmentCaptions.set(segmentId, captions);
      }

      const successCount = Array.from(allCaptions.values()).filter(c => !c.error).length;
      const failureCount = allCaptions.size - successCount;

      this.log('info', `Batch captioning completed: ${successCount} success, ${failureCount} failed`);

      return {
        success: true,
        data: {
          batchCaptions: Object.fromEntries(segmentCaptions),
          totalKeyframes: allKeyframes.length,
          successCount,
          failureCount,
          service: this.activeService.name
        }
      };

    } catch (error) {
      this.log('error', 'Batch captioning failed', error);
      this.activeService = undefined;
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown batch captioning error'
      };
    }
  }
}
