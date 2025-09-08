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
  | 'transcription'     // ASR processing
  | 'captioning'        // Visual description generation
  | 'ocr'               // Text extraction from frames
  | 'embedding'         // Vector embedding generation
  | 'storage'           // Database storage
  | 'indexing';         // Search index creation

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

    // Define processing order - SEQUENTIAL to ensure proper data flow
    const stageOrder: PipelineStage[] = [
      'segmentation',
      'audio-extraction',  // Must complete before transcription
      'visual',
      'transcription',     // Uses audioPath from audio-extraction
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
        this.emit('progress', { videoPath: segment.videoPath, segmentId: segment.id, stage, progress });
        continue;
      }

      const stageStart = Date.now();
      this.emit('stage:start', { stage, segmentId: segment.id, processorCount: processors.length });

      try {
        // Run all processors for this stage SEQUENTIALLY to ensure data consistency
        for (const processor of processors) {
          const result = await this.runProcessor(processor, context);
          
          if (result.success && result.data) {
            // Merge processor results into context
            Object.assign(context.data, result.data);
            
            // CRITICAL: Update segment with paths for downstream processors
            if (result.data.audioPath) {
              context.segment.audioPath = result.data.audioPath;
              console.log(`[Pipeline] Audio path set for ${segment.id}: ${result.data.audioPath}`);
            }
            if (result.data.thumbnailPath) {
              context.segment.thumbnailPath = result.data.thumbnailPath;
            }
            if (result.data.keyframePath) {
              context.segment.keyframePath = result.data.keyframePath;
            }
          }
        }

        this.emit('stage:complete', { 
          stage, 
          segmentId: segment.id, 
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

    this.emit('segment:complete', { 
      segmentId: segment.id, 
      duration: Date.now() - overallStart 
    });

    return context;
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
        captioning: this.getProcessors('captioning').map(p => ({ name: p.name, enabled: p.isEnabled() })),
        ocr: this.getProcessors('ocr').map(p => ({ name: p.name, enabled: p.isEnabled() })),
        embedding: this.getProcessors('embedding').map(p => ({ name: p.name, enabled: p.isEnabled() })),
        storage: this.getProcessors('storage').map(p => ({ name: p.name, enabled: p.isEnabled() })),
        indexing: this.getProcessors('indexing').map(p => ({ name: p.name, enabled: p.isEnabled() }))
      }
    };
  }
}
