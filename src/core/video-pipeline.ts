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

// Pipeline stage types
export type PipelineStage = 
  | 'segmentation'    // Scene detection, segment creation
  | 'visual'          // Thumbnail generation, keyframe extraction
  | 'transcription'   // ASR processing
  | 'captioning'      // Visual description generation
  | 'ocr'             // Text extraction from frames
  | 'embedding'       // Vector embedding generation
  | 'storage'         // Database storage
  | 'indexing';       // Search index creation

// Pipeline configuration
export interface PipelineConfig {
  stages: Record<PipelineStage, VideoProcessor[]>;
  parallel?: boolean;
  retryCount?: number;
  timeout?: number;
}

// Main video processing pipeline
export class VideoPipeline extends EventEmitter {
  private processors: Map<PipelineStage, VideoProcessor[]> = new Map();
  private config: PipelineConfig;

  constructor(config: Partial<PipelineConfig> = {}) {
    super();
    this.config = {
      stages: {},
      parallel: false,
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

  // Process a video segment through the entire pipeline
  async processSegment(segment: VideoSegment): Promise<ProcessingContext> {
    const context: ProcessingContext = {
      segment,
      data: {},
      config: this.config
    };

    this.emit('segment:start', { segmentId: segment.id });

    // Define processing order
    const stageOrder: PipelineStage[] = [
      'segmentation',
      'visual',
      'transcription',
      'captioning', 
      'ocr',
      'embedding',
      'storage',
      'indexing'
    ];

    const totalStages = stageOrder.length;
    let completedStages = 0;

    for (const stage of stageOrder) {
      const processors = this.getProcessors(stage).filter(p => p.isEnabled());
      
      if (processors.length === 0) {
        this.emit('stage:skip', { stage, segmentId: segment.id });
        completedStages++;
        const progress = Math.min(100, Math.round((completedStages / totalStages) * 100));
        // Emit coarse-grained progress based on stage completion
        this.emit('progress', { videoPath: segment.videoPath, segmentId: segment.id, stage, progress });
        continue;
      }

      this.emit('stage:start', { stage, segmentId: segment.id, processorCount: processors.length });

      try {
        if (this.config.parallel && processors.length > 1) {
          // Run processors in parallel
          const results = await Promise.all(
            processors.map(processor => this.runProcessor(processor, context))
          );
          
          // Merge results
          for (const result of results) {
            if (result.success && result.data) {
              Object.assign(context.data, result.data);
            }
          }
        } else {
          // Run processors sequentially
          for (const processor of processors) {
            const result = await this.runProcessor(processor, context);
            if (result.success && result.data) {
              Object.assign(context.data, result.data);
            }
          }
        }

        this.emit('stage:complete', { stage, segmentId: segment.id });
        completedStages++;
        const progress = Math.min(100, Math.round((completedStages / totalStages) * 100));
        this.emit('progress', { videoPath: segment.videoPath, segmentId: segment.id, stage, progress });
      } catch (error) {
        this.emit('stage:error', { stage, segmentId: segment.id, error });
        throw error;
      }
    }

    this.emit('segment:complete', { segmentId: segment.id, context });
    return context;
  }

  // Run a single processor with retry logic
  private async runProcessor(
    processor: VideoProcessor, 
    context: ProcessingContext
  ): Promise<ProcessingResult> {
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt <= this.config.retryCount!; attempt++) {
      try {
        this.emit('processor:start', { 
          processor: processor.name, 
          segmentId: context.segment.id, 
          attempt 
        });

        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Processor timeout')), this.config.timeout);
        });

        const result = await Promise.race([
          processor.process(context),
          timeoutPromise
        ]);

        this.emit('processor:complete', { 
          processor: processor.name, 
          segmentId: context.segment.id, 
          success: result.success 
        });

        return result;
      } catch (error) {
        lastError = error as Error;
        this.emit('processor:error', { 
          processor: processor.name, 
          segmentId: context.segment.id, 
          error: lastError.message, 
          attempt 
        });

        if (attempt < this.config.retryCount!) {
          // Wait before retry with exponential backoff
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
      }
    }

    return {
      success: false,
      error: lastError?.message || 'Unknown error'
    };
  }

  // Process multiple segments
  async processSegments(segments: VideoSegment[]): Promise<ProcessingContext[]> {
    const results: ProcessingContext[] = [];
    
    this.emit('batch:start', { segmentCount: segments.length });

    for (const segment of segments) {
      try {
        const result = await this.processSegment(segment);
        results.push(result);
      } catch (error) {
        this.emit('batch:error', { segmentId: segment.id, error });
        // Continue processing other segments
      }
    }

    this.emit('batch:complete', { processedCount: results.length });
    return results;
  }

  // Get pipeline status
  getStatus(): {
    stages: Record<PipelineStage, { processors: string[]; enabled: number }>;
    config: PipelineConfig;
  } {
    const stages: Record<string, { processors: string[]; enabled: number }> = {};
    
    for (const [stage, processors] of this.processors.entries()) {
      stages[stage] = {
        processors: processors.map(p => p.name),
        enabled: processors.filter(p => p.isEnabled()).length
      };
    }

    return {
      stages: stages as Record<PipelineStage, { processors: string[]; enabled: number }>,
      config: this.config
    };
  }
}

// Base processor class with common functionality
export abstract class BaseVideoProcessor implements VideoProcessor {
  public abstract name: string;
  public abstract version: string;
  protected enabled: boolean = true;
  protected config: Record<string, any> = {};

  abstract process(context: ProcessingContext): Promise<ProcessingResult>;

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  getConfig(): Record<string, any> {
    return { ...this.config };
  }

  setConfig(config: Record<string, any>): void {
    this.config = { ...this.config, ...config };
  }

  protected log(level: 'info' | 'warn' | 'error', message: string, data?: any): void {
    console[level](`[${this.name}] ${message}`, data || '');
  }
}
