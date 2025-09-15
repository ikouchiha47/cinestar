import { EventEmitter } from 'events';
import { SceneReconstructionJobQueue } from './scene-reconstruction-job-queue';
import { OptimizedSceneReconstructionProcessor } from './processors/optimized-scene-reconstruction';

export interface SceneReconstructionSchedulerConfig {
  enabled?: boolean;
  maxConcurrentCoarse?: number;
  maxConcurrentFine?: number;
  batchSize?: number;
  checkIntervalSeconds?: number;
  
  // Frame reduction strategies
  sceneBoundaryDetection?: {
    enabled: boolean;
    threshold: number; // 0.1-0.9, higher = more sensitive
    minSceneDuration: number; // seconds
  };
  motionDetection?: {
    enabled: boolean;
    threshold: number; // 0.1-0.9, higher = more motion required
    skipStaticFrames: boolean;
  };
  
  // Logging
  logMergedEmbeddings?: boolean;
}

export class SceneReconstructionScheduler extends EventEmitter {
  private jobQueue: SceneReconstructionJobQueue;
  private processor: OptimizedSceneReconstructionProcessor;
  private config: SceneReconstructionSchedulerConfig;

  constructor(config: SceneReconstructionSchedulerConfig = {}) {
    super();
    
    this.config = {
      enabled: true,
      maxConcurrentCoarse: 2,
      maxConcurrentFine: 1,
      batchSize: 5,
      checkIntervalSeconds: 300, // 5 minutes
      sceneBoundaryDetection: {
        enabled: true,
        threshold: 0.3,
        minSceneDuration: 2.0
      },
      motionDetection: {
        enabled: true,
        threshold: 0.2,
        skipStaticFrames: true
      },
      logMergedEmbeddings: true,
      ...config
    };
    
    this.jobQueue = new SceneReconstructionJobQueue();
    this.processor = new OptimizedSceneReconstructionProcessor();
    
    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    this.jobQueue.on('batchReady', async ({ type, jobs }) => {
      await this.processBatch(type, jobs);
    });
  }

  async scheduleReconstruction(
    videoId: string,
    segments: Array<{
      id: string;
      videoPath: string;
      startTime: number;
      endTime: number;
      transcription?: string;
      caption?: string;
      ocrText?: string;
      videoLengthSeconds: number;
      segmentIndex: number;
    }>
  ): Promise<void> {
    if (!this.config.enabled) return;

    // Apply frame reduction strategies
    const optimizedSegments = await this.applyFrameReduction(segments);
    console.log(`[SCHEDULER] Frame reduction: ${segments.length} → ${optimizedSegments.length} segments (${((segments.length - optimizedSegments.length) / segments.length * 100).toFixed(1)}% reduction)`);

    // Create jobs for both coarse and fine passes
    for (const segment of optimizedSegments) {
      // Coarse pass job
      this.jobQueue.addJob({
        videoId,
        segmentId: segment.id,
        videoPath: segment.videoPath,
        startTime: segment.startTime,
        endTime: segment.endTime,
        jobType: 'coarse',
        priority: 10, // Higher priority
        weight: 1,
        status: 'pending',
        transcription: segment.transcription,
        caption: segment.caption,
        ocrText: segment.ocrText,
        videoLengthSeconds: segment.videoLengthSeconds,
        segmentIndex: segment.segmentIndex,
        maxRetries: 3
      });

      // Fine pass job (delayed)
      this.jobQueue.addJob({
        videoId,
        segmentId: segment.id,
        videoPath: segment.videoPath,
        startTime: segment.startTime,
        endTime: segment.endTime,
        jobType: 'fine',
        priority: 100, // Lower priority
        weight: 1,
        status: 'pending',
        transcription: segment.transcription,
        caption: segment.caption,
        ocrText: segment.ocrText,
        videoLengthSeconds: segment.videoLengthSeconds,
        segmentIndex: segment.segmentIndex,
        maxRetries: 3
      });
    }
  }

  private async applyFrameReduction(segments: any[]): Promise<any[]> {
    let filteredSegments = [...segments];

    // Scene boundary detection
    if (this.config.sceneBoundaryDetection?.enabled) {
      filteredSegments = this.applySceneBoundaryDetection(filteredSegments);
    }

    // Motion detection
    if (this.config.motionDetection?.enabled) {
      filteredSegments = await this.applyMotionDetection(filteredSegments);
    }

    return filteredSegments;
  }

  private applySceneBoundaryDetection(segments: any[]): any[] {
    const config = this.config.sceneBoundaryDetection!;
    const filtered: any[] = [];
    
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const duration = segment.endTime - segment.startTime;
      
      // Keep segments that meet minimum duration or are scene boundaries
      if (duration >= config.minSceneDuration || i === 0 || i === segments.length - 1) {
        filtered.push(segment);
      } else {
        // Simple heuristic: keep every Nth segment based on threshold
        const keepRatio = 1 - config.threshold;
        if (Math.random() < keepRatio) {
          filtered.push(segment);
        }
      }
    }
    
    console.log(`[SCHEDULER] Scene boundary detection: ${segments.length} → ${filtered.length} segments`);
    return filtered;
  }

  private async applyMotionDetection(segments: any[]): Promise<any[]> {
    const config = this.config.motionDetection!;
    
    if (!config.skipStaticFrames) {
      return segments;
    }

    // Simple motion detection heuristic based on segment duration and content
    const filtered = segments.filter((segment) => {
      const hasContent = segment.transcription || segment.caption || segment.ocrText;
      const isShortSegment = (segment.endTime - segment.startTime) < 3.0;
      
      // Keep segments with content or short segments (likely motion)
      if (hasContent || isShortSegment) {
        return true;
      }
      
      // For longer segments without content, apply threshold
      return Math.random() > config.threshold;
    });
    
    console.log(`[SCHEDULER] Motion detection: ${segments.length} → ${filtered.length} segments`);
    return filtered;
  }

  private async processBatch(jobType: 'coarse' | 'fine', jobs: any[]) {
    if (jobs.length === 0) return;

    console.log(`[${jobType.toUpperCase()}] Processing batch of ${jobs.length} jobs`);

    for (const job of jobs) {
      try {
        this.jobQueue.markJobProcessing(job.id);
        
        const startTime = Date.now();
        
        // Build temporal context
        const temporalContext = await this.buildTemporalContextForJob(job);
        
        // Process with optimized processor
        const context = {
          segment: {
            id: job.segmentId,
            videoId: job.videoId,
            videoPath: job.videoPath,
            startTime: job.startTime,
            endTime: job.endTime,
            sceneIndex: job.segmentIndex
          },
          data: {
            transcription: { text: job.transcription || '' },
            captions: [job.caption || ''],
            ocrText: job.ocrText || '',
            temporalContext
          }
        };

        const result = await this.processor.process(context);
        
        if (result.success) {
          const processingTime = Date.now() - startTime;
          const reconstructedScene = result.data?.reconstructedScene || '';
          
          this.jobQueue.markJobCompleted(job.id, reconstructedScene, processingTime);
          
          // Enhanced logging for merged embeddings
          if (this.config.logMergedEmbeddings && reconstructedScene) {
            console.log(`[${jobType.toUpperCase()}] 🧠 TinyLlama Scene Reconstruction:`);
            console.log(`   Job ID: ${job.id}`);
            console.log(`   Segment: ${job.startTime}s - ${job.endTime}s`);
            console.log(`   Input Sources:`);
            if (job.transcription) console.log(`     📝 Transcription: "${job.transcription.substring(0, 50)}..."`);
            if (job.caption) console.log(`     🖼️  Caption: "${job.caption.substring(0, 50)}..."`);
            if (job.ocrText) console.log(`     📄 OCR: "${job.ocrText.substring(0, 50)}..."`);
            console.log(`   🔄 Merged Embedding Result: "${reconstructedScene}"`);
            console.log(`   ⏱️  Processing Time: ${processingTime}ms`);
            console.log(`   🎯 Model: TinyLlama (${this.processor.name} v${this.processor.version})`);
            
            if (result.metadata?.temporalContext) {
              console.log(`   🔗 Temporal Context: ${result.metadata.temporalContext} previous segments`);
            }
          } else {
            console.log(`[${jobType.toUpperCase()}] Completed job ${job.id} in ${processingTime}ms`);
          }
        } else {
          this.jobQueue.markJobFailed(job.id, result.error || 'Unknown error');
          console.error(`[${jobType.toUpperCase()}] Failed job ${job.id}: ${result.error}`);
        }
        
      } catch (error) {
        this.jobQueue.markJobFailed(job.id, error instanceof Error ? error.message : String(error));
        console.error(`[${jobType.toUpperCase()}] Error processing job ${job.id}:`, error);
      }
    }
  }

  private async buildTemporalContextForJob(job: any): Promise<string[]> {
    // Get previous segments for temporal context
    const stmt = this.jobQueue['db'].prepare(`
      SELECT reconstructed_scene, transcription, caption, ocr_text 
      FROM scene_reconstruction_jobs 
      WHERE video_id = ? AND start_time < ? AND job_type = ? AND status = 'completed'
      ORDER BY start_time DESC
      LIMIT 3
    `);
    
    const rows = stmt.all(job.videoId, job.startTime, job.jobType) as any[];
    
    return rows.map(row => 
      row.reconstructed_scene || 
      [row.transcription, row.caption, row.ocr_text].filter(Boolean).join(' ')
    ).reverse();
  }

  getStats() {
    return this.jobQueue.getQueueStats();
  }

  start() {
    if (!this.config.enabled) return;
    console.log('Scene reconstruction scheduler started');
  }

  stop() {
    this.jobQueue.stop();
    console.log('Scene reconstruction scheduler stopped');
  }

  async waitForCompletion(): Promise<void> {
    return new Promise((resolve) => {
      const checkCompletion = () => {
        const stats = this.getStats();
        const pending = (stats.coarse.pending + stats.coarse.processing + 
                        stats.fine.pending + stats.fine.processing + 
                        stats.fine.delayed);
        
        if (pending === 0) {
          resolve();
        } else {
          setTimeout(checkCompletion, 5000);
        }
      };
      checkCompletion();
    });
  }
}
