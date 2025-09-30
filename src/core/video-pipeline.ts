import { EventEmitter } from 'events';

// Core pipeline interfaces for pluggable architecture
export interface VideoSegment {
  id: string;
  videoId: string;
  videoPath: string;
  startTime: number;
  endTime: number;
  thumbnailPath?: string;
  keyframePath?: string;
  audioPath?: string;
  metadata?: Record<string, any>;
}

export interface ProcessingContext {
  segment: VideoSegment;
  data: Record<string, any>;
  config?: Record<string, any>;
}

export interface ProcessingResult {
  success: boolean;
  data?: Record<string, any>;
  error?: string;
  metadata?: Record<string, any>;
}

// Base processor interface - all processors implement this
export interface VideoProcessor {
  name: string;
  version: string;
  process(context: ProcessingContext): Promise<ProcessingResult>;
  isEnabled(): boolean;
  getConfig(): Record<string, any>;
  setConfig(config: Record<string, any>): void;
}

// Base class implementation used by many processors
export abstract class BaseVideoProcessor implements VideoProcessor {
  public abstract name: string;
  public abstract version: string;
  protected config: Record<string, any> = {};
  protected enabled = true;

  // Default enablement
  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  // Config management
  getConfig(): Record<string, any> {
    return this.config;
  }

  setConfig(config: Record<string, any>): void {
    this.config = { ...this.config, ...config };
  }

  // Simple logger helper for processors
  protected log(level: 'info' | 'warn' | 'error' | 'debug', message: string, error?: unknown): void {
    const prefix = `[${this.name}]`;
    switch (level) {
      case 'info':
        console.log(prefix, message);
        break;
      case 'warn':
        console.warn(prefix, message);
        break;
      case 'debug':
        console.debug(prefix, message);
        break;
      case 'error':
      default:
        if (error) {
          console.error(prefix, message, error);
        } else {
          console.error(prefix, message);
        }
        break;
    }
  }

  // Concrete processors must implement
  abstract process(context: ProcessingContext): Promise<ProcessingResult>;
}

// Pipeline stage types
export type PipelineStage = 
  | 'segmentation'      // Scene detection, segment creation
  | 'audio-extraction'  // Audio extraction from video segments
  | 'visual'            // Thumbnail generation, keyframe extraction
  | 'transcription'     // Audio transcription
  | 'captioning'        // Visual captioning (per-segment)
  | 'batch-captioning'  // Video-level batch captioning
  | 'ocr'               // OCR text extraction
  | 'scene-reconstruction'; // LLM-based scene reconstruction

// Pipeline configuration
export interface PipelineConfig {
  stages: Record<PipelineStage, VideoProcessor[]>;
  retryCount?: number;
  timeout?: number;
}

// Main video processing pipeline with proper sequential data flow
export class VideoPipeline extends EventEmitter {
  private processors: Map<PipelineStage, VideoProcessor[]> = new Map();
  private config: PipelineConfig;

  constructor(config: Partial<PipelineConfig> = {}) {
    super();
    this.config = {
      stages: {} as Record<PipelineStage, VideoProcessor[]>,
      retryCount: 2,
      timeout: 300000, // 5 minutes
      ...config
    };
  }

  // Register a processor for a specific stage
  addProcessor(stage: PipelineStage, processor: VideoProcessor): void {
    if (!this.processors.has(stage)) {
      this.processors.set(stage, []);
    }
    this.processors.get(stage)!.push(processor);
    this.emit('processor:added', { stage, processor: processor.name });
  }

  // Remove a processor from a stage
  removeProcessor(stage: PipelineStage, processorName: string): boolean {
    const processors = this.processors.get(stage);
    if (!processors) return false;

    const index = processors.findIndex(p => p.name === processorName);
    if (index === -1) return false;

    processors.splice(index, 1);
    this.emit('processor:removed', { stage, processor: processorName });
    return true;
  }

  // Get all processors for a stage
  getProcessors(stage: PipelineStage): VideoProcessor[] {
    return this.processors.get(stage) || [];
  }

  // Process a video segment through the entire pipeline with proper data flow
  async processSegment(segment: VideoSegment): Promise<ProcessingContext> {
    const context: ProcessingContext = {
      segment: { ...segment }, // Clone to avoid mutations
      data: {},
      config: this.config
    };

    this.emit('segment:start', { segmentId: segment.id });
    const overallStart = Date.now();

    // First run segmentation to get proper segments
    const segmentationProcessors = this.getProcessors('segmentation').filter(p => p.isEnabled());
    if (segmentationProcessors.length > 0) {
      this.emit('stage:start', { stage: 'segmentation', segmentId: segment.id, processorCount: segmentationProcessors.length });
      
      for (const processor of segmentationProcessors) {
        const result = await this.runProcessor(processor, context);
        if (result.success && result.data) {
          Object.assign(context.data, result.data);
        }
      }
      
      this.emit('stage:complete', { stage: 'segmentation', segmentId: segment.id });
    }

    // If segmentation created new segments, process each one individually
    const segments = context.data.segments as VideoSegment[] || [segment];
    
    // Define processing order for each segment - SEQUENTIAL to ensure proper data flow
    const stageOrder: PipelineStage[] = [
      'audio-extraction',  // Must complete before transcription
      'visual',
      'transcription',     // Uses audioPath from audio-extraction
      'ocr'
    ];

    // Process each segment through the remaining stages
    for (const seg of segments) {
      await this.processSegmentStages(seg, stageOrder, context);
    }

    // After all segments are processed, run video-level processors
    await this.processVideoLevelStages(context);

    // Emit segment completion with zero-copy data reference
    this.emit('segment:complete', { 
      segmentId: segment.id,
      segmentData: context.segment, // Zero-copy: pass reference to segment object
      processedData: context.data,  // Zero-copy: pass reference to processed data
      duration: Date.now() - overallStart 
    });

    return context;
  }

  // Process video-level stages that run after all segments complete
  private async processVideoLevelStages(context: ProcessingContext): Promise<void> {
    // Video-level stages that process all segments together
    const videoLevelStages: PipelineStage[] = [
      'batch-captioning',     // Process all keyframes in optimal batches
      'scene-reconstruction'  // Reconstruct scenes using all segment data
    ];

    for (const stage of videoLevelStages) {
      const processors = this.getProcessors(stage).filter(p => p.isEnabled());
      
      if (processors.length === 0) {
        this.emit('stage:skip', { stage, videoPath: context.segment.videoPath });
        continue;
      }

      const stageStart = Date.now();
      this.emit('stage:start', { stage, videoPath: context.segment.videoPath, processorCount: processors.length });

      try {
        // Run all processors for this stage
        for (const processor of processors) {
          const result = await this.runProcessor(processor, context);
          
          if (result.success && result.data) {
            // Merge processor results into global context
            Object.assign(context.data, result.data);
          }
        }

        // Emit stage completion with zero-copy processed data
        this.emit('stage:complete', { 
          stage, 
          videoPath: context.segment.videoPath,
          processedData: context.data, // Zero-copy: pass reference to processed data
          duration: Date.now() - stageStart 
        });

      } catch (error: any) {
        this.emit('stage:error', { 
          stage, 
          videoPath: context.segment.videoPath,
          error: error.message,
          duration: Date.now() - stageStart 
        });
        throw error;
      }
    }
  }

  // Process a single segment through specified stages
  private async processSegmentStages(segment: VideoSegment, stageOrder: PipelineStage[], globalContext: ProcessingContext): Promise<void> {
    // Create individual context for this segment
    const segmentContext: ProcessingContext = {
      segment: { 
        ...segment,
        // Ensure videoPath is inherited from global context if not present
        videoPath: segment.videoPath || globalContext.segment.videoPath
      },
      data: {},
      config: this.config
    };

    const totalStages = stageOrder.length;
    let completedStages = 0;

    for (const stage of stageOrder) {
      const processors = this.getProcessors(stage).filter(p => p.isEnabled());
      
      if (processors.length === 0) {
        this.emit('stage:skip', { stage, segmentId: segment.id });
        completedStages++;
        const progress = Math.min(100, Math.round((completedStages / totalStages) * 100));
        this.emit('progress', { videoPath: segment.videoPath, segmentId: segment.id, stage, progress });
        continue;
      }

      const stageStart = Date.now();
      this.emit('stage:start', { stage, segmentId: segment.id, processorCount: processors.length });

      try {
        // Run all processors for this stage SEQUENTIALLY to ensure data consistency
        for (const processor of processors) {
          const result = await this.runProcessor(processor, segmentContext);
          
          if (result.success && result.data) {
            // Merge processor results into segment context
            Object.assign(segmentContext.data, result.data);
            
            // CRITICAL: Update segment with paths for downstream processors
            if (result.data.audioPath) {
              segmentContext.segment.audioPath = result.data.audioPath;
              console.log(`[Pipeline] Audio path set for ${segment.id}: ${result.data.audioPath}`);
            }
            if (result.data.thumbnailPath) {
              segmentContext.segment.thumbnailPath = result.data.thumbnailPath;
            }
            if (result.data.keyframePath) {
              segmentContext.segment.keyframePath = result.data.keyframePath;
            }
          }
        }

        // Emit stage completion with zero-copy processed data
        this.emit('stage:complete', { 
          stage, 
          segmentId: segment.id,
          segmentData: segmentContext.segment, // Zero-copy: direct reference to segment
          processedData: segmentContext.data,  // Zero-copy: direct reference to processed data
          duration: Date.now() - stageStart 
        });

        completedStages++;
        const progress = Math.min(100, Math.round((completedStages / totalStages) * 100));
        this.emit('progress', { videoPath: segment.videoPath, segmentId: segment.id, stage, progress });

      } catch (error: any) {
        this.emit('stage:error', { 
          stage, 
          segmentId: segment.id, 
          error: error.message,
          duration: Date.now() - stageStart 
        });
        throw error;
      }
    }

    // Emit individual segment completion with zero-copy data
    this.emit('segment:complete', {
      segmentId: segment.id,
      segmentData: segmentContext.segment, // Zero-copy: direct reference to segment
      processedData: segmentContext.data,  // Zero-copy: direct reference to processed data
      completedStages: completedStages,
      totalStages: totalStages
    });

    // Merge segment results back into global context
    if (!globalContext.data.processedSegments) {
      globalContext.data.processedSegments = [];
    }
    globalContext.data.processedSegments.push(segmentContext);
  }

  // Run a single processor with retry logic
  private async runProcessor(processor: VideoProcessor, context: ProcessingContext): Promise<ProcessingResult> {
    const maxRetries = this.config.retryCount || 2;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.emit('processor:start', { 
          processor: processor.name, 
          segmentId: context.segment.id, 
          attempt 
        });

        const result = await processor.process(context);
        
        this.emit('processor:complete', { 
          processor: processor.name, 
          segmentId: context.segment.id, 
          success: result.success,
          attempt 
        });

        return result;

      } catch (error: any) {
        lastError = error;
        this.emit('processor:error', { 
          processor: processor.name, 
          segmentId: context.segment.id, 
          error: error.message,
          attempt 
        });

        if (attempt < maxRetries) {
          console.warn(`Processor ${processor.name} failed (attempt ${attempt}), retrying...`);
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // Exponential backoff
        }
      }
    }

    throw lastError || new Error(`Processor ${processor.name} failed after ${maxRetries} attempts`);
  }

  // Process multiple segments with controlled concurrency
  async processSegments(segments: VideoSegment[]): Promise<ProcessingContext[]> {
    const results: ProcessingContext[] = [];
    
    this.emit('segments:start', { count: segments.length });

    // Process segments with concurrency control to avoid resource exhaustion
    const concurrencyLimit = 2; // Conservative limit
    for (let i = 0; i < segments.length; i += concurrencyLimit) {
      const batch = segments.slice(i, i + concurrencyLimit);
      const batchResults = await Promise.all(
        batch.map(segment => this.processSegment(segment))
      );
      results.push(...batchResults);
    }

    this.emit('segments:complete', { count: results.length });
    return results;
  }

  // Get pipeline status
  getStatus(): Record<string, any> {
    return {
      config: this.config,
      processors: {
        segmentation: this.getProcessors('segmentation').map(p => ({ name: p.name, enabled: p.isEnabled() })),
        'audio-extraction': this.getProcessors('audio-extraction').map(p => ({ name: p.name, enabled: p.isEnabled() })),
        visual: this.getProcessors('visual').map(p => ({ name: p.name, enabled: p.isEnabled() })),
        transcription: this.getProcessors('transcription').map(p => ({ name: p.name, enabled: p.isEnabled() })),
        'batch-captioning': this.getProcessors('batch-captioning').map(p => ({ name: p.name, enabled: p.isEnabled() })),
        ocr: this.getProcessors('ocr').map(p => ({ name: p.name, enabled: p.isEnabled() })),
        'scene-reconstruction': this.getProcessors('scene-reconstruction').map(p => ({ name: p.name, enabled: p.isEnabled() }))
      }
    };
  }
}
