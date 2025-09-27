import { VideoDatabase, VideoProcessingJob, VideoFile, VideoSegment, SearchResult } from '../core/video-database.js';
import { EmbeddingService } from '../core/embedding-service.js';
import { VideoPipeline } from '../core/video-pipeline.js';
import { ConcurrencyLimiter } from '../core/concurrency-limiter.js';
import { VideoJobProcessor } from '../core/video-job-processor.js';
import { MainMediaAPI } from './main-media-api';
import { getVideoDuration } from '../core/video-processing';
import { generateQuickThumbnail } from '../utils/quickThumbnail';
import { SegmentationProcessor } from '../core/processors/segmentation-processor.js';
import { AudioExtractionProcessor } from '../core/processors/audio-extraction-processor.js';
import { VisualProcessor } from '../core/processors/visual-processor.js';
import { TranscriptionProcessor } from '../core/processors/transcription-processor.js';
import { BatchCaptioningProcessor } from '../core/processors/batch-captioning-processor.js';
import { OCRProcessor } from '../core/processors/ocr-processor.js';
import { OptimizedSceneReconstructionProcessor } from '../core/processors/optimized-scene-reconstruction.js';
// import { SceneReconstructionScheduler } from '../core/scene-reconstruction-scheduler.js';
import { DockerWhisperService } from '../core/processors/docker-whisper-service.js';
import { WhisperCliService } from '../core/processors/whisper-cli-service.js';
import { WhisperCppService } from '../core/processors/whisper-cpp-service.js';
import fs from 'fs';
import path from 'path';
import { ConfigManager } from '../core/config.js';


export interface VideoSearchQuery {
  query: string;
  limit?: number;
  offset?: number;
  searchType?: 'text' | 'vector' | 'hybrid';
  videoPath?: string;
  timeRange?: {
    start: number;
    end: number;
  };
}

/**
 * Video-specific MediaAPI for processing and searching video content
 * This handles video indexing, transcription, and semantic search
 */
export class VideoMediaAPI {
  private static instance: VideoMediaAPI;
  private videoDb: VideoDatabase;
  private embeddingService: EmbeddingService;
  private videoPipeline: VideoPipeline;
  private concurrencyLimiter: ConcurrencyLimiter;
  private jobProcessor: VideoJobProcessor;
  // Main sources/items are managed by MainMediaAPI (SQLite-backed)
  private initialized = false;

  private constructor() {
    this.embeddingService = new EmbeddingService();
    this.videoDb = new VideoDatabase(this.embeddingService);
    this.concurrencyLimiter = new ConcurrencyLimiter(2); // Limit to 2 concurrent video processing jobs
    this.videoPipeline = new VideoPipeline();
    this.setupVideoPipeline();
    
    // Pass the configured pipeline to the job processor
    this.jobProcessor = new VideoJobProcessor(this.videoPipeline);
  }

  static getInstance(): VideoMediaAPI {
    if (!VideoMediaAPI.instance) {
      VideoMediaAPI.instance = new VideoMediaAPI();
    }
    return VideoMediaAPI.instance;
  }

  private setupVideoPipeline(): void {
    // Create processors
    const segmentationProcessor = new SegmentationProcessor();
    const audioExtractionProcessor = new AudioExtractionProcessor();
    // Visual processor configuration via ConfigManager
    const appCfg = ConfigManager.getConfig();
    const vk = appCfg.video?.keyframes;
    const visualProcessor = new VisualProcessor({
      keyframesMode: vk?.mode || 'scene',
      keyframesFPS: vk?.fps || 0,
      keyframesTargetTotal: vk?.targetTotal || 0,
      keyframesMaxTotal: vk?.maxTotal || 500,
    } as any);
    const transcriptionProcessor = new TranscriptionProcessor();
    // Batch captioning for optimal GPU utilization
    const cap = appCfg.captioning;
    const batchCaptioningProcessor = new BatchCaptioningProcessor({ 
      batchSize: cap?.batchSize ?? 8, // Larger batches for video-level processing
      captionConcurrency: cap?.concurrency ?? 4,
    });
    const ocrProcessor = new OCRProcessor();
    const sceneReconstructionProcessor = new OptimizedSceneReconstructionProcessor({
      enabled: true,
      model: 'tinyllama:latest',
      baseUrl: 'http://localhost:9001',
      temperature: 0.7,
      maxTokens: 2000, // Increased for richer scene descriptions
      useRnnStyle: true,
      contextWindow: 3
    });

    // Setup transcription processor with available services
    // Use Docker API as primary service (fastest with faster_whisper)
    const dockerWhisperService = new DockerWhisperService();
    transcriptionProcessor.addService(dockerWhisperService);
    
    // Add CLI and local services only in debug mode
    if (process.env.NODE_ENV === 'development' || process.env.DEBUG === 'true') {
      const whisperCliService = new WhisperCliService();
      const whisperCppService = new WhisperCppService();
      transcriptionProcessor.addService(whisperCliService);
      transcriptionProcessor.addService(whisperCppService);
    }

    // Register processors into pipeline
    this.videoPipeline.addProcessor('segmentation', segmentationProcessor);
    this.videoPipeline.addProcessor('audio-extraction', audioExtractionProcessor);
    this.videoPipeline.addProcessor('visual', visualProcessor);
    this.videoPipeline.addProcessor('transcription', transcriptionProcessor);
    this.videoPipeline.addProcessor('batch-captioning', batchCaptioningProcessor);
    this.videoPipeline.addProcessor('ocr', ocrProcessor);
    this.videoPipeline.addProcessor('scene-reconstruction', sceneReconstructionProcessor);

    // Setup event listeners
    this.videoPipeline.on('progress', async (data) => {
      const job = await this.videoDb.getJob(data.videoPath);
      if (job) {
        await this.videoDb.updateJob(job.id, { progress: data.progress });
        console.log(`Video processing progress: ${data.videoPath} - ${data.progress}%`);
      }
    });

    this.videoPipeline.on('error', async (data) => {
      const job = await this.videoDb.getJob(data.videoPath);
      if (job) {
        await this.videoDb.updateJob(job.id, { 
          status: 'failed', 
          error: data.error,
          endTime: new Date()
        });
        console.error(`Video processing failed: ${data.videoPath}`, data.error);
      }
    });

    this.videoPipeline.on('completed', async (data) => {
      console.log(`[PIPELINE-COMPLETED] Video processing completed for ${data.videoPath}`);
      console.log(`[PIPELINE-COMPLETED] Segments in data: ${data.segments?.length || 0}`);
      
      const job = await this.videoDb.getJob(data.videoPath);
      if (job) {
        await this.videoDb.updateJob(job.id, {
          status: 'completed',
          progress: 100,
          endTime: new Date(),
          segmentCount: data.segments?.length || 0
        });
        
        // Merge processed content back into segments before storage
        let enrichedSegments = data.segments || [];
        
        // Extract processed content from pipeline data structure
        const processedSegments = data.processedSegments || [];
        const reconstructedScenes = data.reconstructedScenes || {};
        
        if (processedSegments.length > 0 || Object.keys(reconstructedScenes).length > 0) {
          console.log(`[PIPELINE-COMPLETED] Merging processed content from ${processedSegments.length} processed segments and ${Object.keys(reconstructedScenes).length} reconstructed scenes`);
          enrichedSegments = this.mergeProcessedContent(data.segments || [], processedSegments, { reconstructedScenes });
        } else {
          console.log(`[PIPELINE-COMPLETED] No processed content to merge - using original segments`);
        }
        
        // Store segments in database
        if (enrichedSegments && enrichedSegments.length > 0) {
          console.log(`[PIPELINE-COMPLETED] Calling storeVideoSegments with ${enrichedSegments.length} enriched segments`);
          try {
            await this.storeVideoSegments(data.videoPath, enrichedSegments);
            console.log(`[PIPELINE-COMPLETED] storeVideoSegments completed successfully - about to continue`);
          } catch (error) {
            console.log(`[PIPELINE-COMPLETED-ERROR] storeVideoSegments failed:`, error);
          }
          
          console.log(`[PIPELINE-COMPLETED] After storeVideoSegments try-catch block - execution continuing`);
          
          // Note: Segment indexing is handled by the background job processor
          // The video is now searchable via the parent video entry
          // Background refinement jobs will create searchable segments progressively
          console.log(`[PIPELINE-COMPLETED] Video processing completed, segments stored in video database`);
          
          // Generate video-level screenplay/narrative
          console.log(`[VIDEO-SCREENPLAY] Generating overall video narrative for ${data.videoPath}`);
          await this.generateVideoScreenplay(data.videoPath, enrichedSegments);
        } else {
          console.warn(`[PIPELINE-COMPLETED] No segments to store for ${data.videoPath}`);
        }
        
        console.log(`[PIPELINE-COMPLETED] Video processing completed: ${data.videoPath}`);
      } else {
        console.warn(`[PIPELINE-COMPLETED] No job found for ${data.videoPath}`);
      }
    });
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await this.videoDb.initialize();

      this.initialized = true;
      console.log('VideoMediaAPI initialized successfully');
    } catch (error) {
      console.error('Failed to initialize VideoMediaAPI:', error);
      throw error;
    }
  }

  /**
   * Process a video file through the complete pipeline
   */
  async processVideo(videoPath: string): Promise<{ success: boolean; error?: string }> {
    if (!fs.existsSync(videoPath)) {
      throw new Error(`Video file not found: ${videoPath}`);
    }

    // [DEBUG] Log video upload details
    const uploadFileName = path.basename(videoPath);
    console.log(`[VIDEO-UPLOAD-DEBUG] Video upload initiated:`, {
      fullPath: videoPath,
      fileName: uploadFileName,
      timestamp: new Date().toISOString()
    });

    // Add video as source to main SQLite database via MainMediaAPI (no JSON paths)
    try {
      const videoName = path.basename(videoPath, path.extname(videoPath));
      let sourceId: string | undefined;

      const res = await MainMediaAPI.addSource({
        name: videoName,
        type: 'local',
        path: videoPath,
        enabled: true,
        config: { videoFile: videoPath }
      } as any);

      if (res.success && res.id) {
        sourceId = res.id;
        console.log(`[Video Source] Added video source to main database: ${videoName} (${res.id})`);
      } else {
        // If the source already exists for this path, find its id and continue
        console.warn(`[Video Source] Failed to add source (may already exist):`, res.error);
        try {
          const sourcesResp = await MainMediaAPI.getSources();
          if (sourcesResp.success && sourcesResp.sources?.length) {
            const existing = sourcesResp.sources.find(s => s.path === videoPath);
            if (existing) {
              sourceId = existing.id;
              console.log(`[Video Source] Using existing source for file ${videoPath}: ${existing.id}`);
            }
          }
        } catch (e) {
          console.warn('[Video Source] Could not fetch existing sources:', e);
        }
      }

      // Generate quick thumbnail for immediate visual feedback
      let thumbnailPath: string | undefined;
      console.log(`[QUICK-THUMB] Generating quick thumbnail for: ${videoName}`);
      try {
        const thumbnailResult = await generateQuickThumbnail(videoPath);
        if (thumbnailResult.success && thumbnailResult.thumbnailPath) {
          thumbnailPath = thumbnailResult.thumbnailPath;
          console.log(`[QUICK-THUMB] Quick thumbnail generated: ${thumbnailPath}`);
        } else {
          console.warn(`[QUICK-THUMB] Failed to generate quick thumbnail: ${thumbnailResult.error}`);
        }
      } catch (error) {
        console.warn(`[QUICK-THUMB] Error generating quick thumbnail:`, error);
      }

      // Insert this specific video file as an item so it appears in the home UI
      if (sourceId) {
        try {
          console.log(`[Video Source] Inserting video into main DB:`, {
            sourceId: sourceId,
            videoPath: videoPath,
            videoName: videoName,
            thumbnailPath: thumbnailPath,
            timestamp: new Date().toISOString()
          });
          
          const metadata = { 
            via: 'VideoMediaAPI',
            ...(thumbnailPath && { thumbnailPath })
          };
          
          const addItem = await MainMediaAPI.addItemForFile(sourceId, videoPath, `Video file: ${videoName}`, metadata);
          if (addItem.success) {
            console.log(`[Video Source] Inserted/updated video item in main DB: ${videoName}`);
            console.log(`[VIDEO-PARENT-CREATION-DEBUG] Parent video created successfully:`, {
              itemId: addItem.id,
              sourceId: sourceId,
              videoName: videoName
            });
          } else {
            console.warn(`[Video Source] Failed to insert video item into main DB: ${addItem.error}`);
          }
        } catch (e) {
          console.warn('[Video Source] Error inserting video item into main DB:', e);
        }
      } else {
        console.warn(`[Video Source] No sourceId resolved for ${videoPath}; video item will not appear in main UI.`);
      }
    } catch (error) {
      console.warn(`[Video Source] Failed to add video source to main database:`, error);
    }

    // Check if already processed or previously inserted
    const existingVideo = await this.videoDb.getVideoFileByPath(videoPath);
    if (existingVideo) {
      if (existingVideo.processingStatus === 'completed') {
        // Validate that segments actually exist
        const segmentCount = await this.videoDb.getSegmentCount(existingVideo.id);
        if (segmentCount === 0) {
          console.log(`Video marked completed but has no segments, resetting: ${videoPath}`);
          await this.videoDb.resetFailedVideo(existingVideo.id);
        } else {
          console.log(`Video already processed: ${videoPath}`);
          return existingVideo.id;
        }
      }
      if (existingVideo.processingStatus === 'failed') {
        console.log(`Resetting failed video for retry: ${videoPath}`);
        await this.videoDb.resetFailedVideo(existingVideo.id);
      } else {
        // If a row exists (pending/processing), reuse it to avoid UNIQUE constraint error
        console.log(`Reusing existing video record for ${videoPath} with status ${existingVideo.processingStatus}`);
      }
    }

    // Create job in database
    const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const fileName = path.basename(videoPath);
    const job: VideoProcessingJob = {
      id: jobId,
      videoPath,
      fileName,
      status: 'pending',
      progress: 0,
      startTime: new Date(),
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await this.videoDb.createJob(job);

    try {
      // Add video file to database
      const stats = fs.statSync(videoPath);
      const fileName = path.basename(videoPath);
      
      // Insert new row only if no existing record, otherwise update existing status
      let videoId: string;
      if (!existingVideo) {
        videoId = await this.videoDb.addVideoFile({
          filePath: videoPath,
          fileName,
          fileSize: stats.size,
          duration: 0, // Will be updated after processing
          totalSegments: 0,
          processingStatus: 'processing',
        });
      } else {
        videoId = existingVideo.id;
        await this.videoDb.updateVideoFile(videoId, {
          processingStatus: 'processing',
          totalSegments: existingVideo.totalSegments || 0,
          processingError: undefined,
        });
      }

      // Submit job for background processing instead of processing synchronously
      console.log(`[VIDEO-API] Job ${jobId} submitted for background processing`);
      console.log(`[VIDEO-API] Video processing will happen asynchronously`);
      console.log(`[VIDEO-API] Use getJobStatus('${videoPath}') to check progress`);
      
      // Start background job processor if not already running
      await this.jobProcessor.start();
      
      return videoId;
    } catch (error) {
      job.status = 'failed';
      job.error = error instanceof Error ? error.message : 'Unknown error';
      job.endTime = new Date();
      
      // Update database
      const video = await this.videoDb.getVideoFileByPath(videoPath);
      if (video) {
        await this.videoDb.updateVideoFile(video.id, {
          processingStatus: 'failed',
          processingError: job.error,
        });
      }
      
      throw error;
    }
  }

  /**
   * Merge processed content from pipeline back into segment objects
   */
  private mergeProcessedContent(originalSegments: any[], processedSegments: any[], pipelineData: any): any[] {
    console.log(`[MERGE-CONTENT-DEBUG] Starting merge process:`);
    console.log(`[MERGE-CONTENT-DEBUG] Original segments: ${originalSegments.length}`);
    console.log(`[MERGE-CONTENT-DEBUG] Processed segments: ${processedSegments.length}`);
    console.log(`[MERGE-CONTENT-DEBUG] Pipeline data keys:`, Object.keys(pipelineData));
    
    // Create a map of processed segment data by segment ID
    const processedMap = new Map<string, any>();
    for (const processedSegment of processedSegments) {
      if (processedSegment.segment?.id) {
        console.log(`[MERGE-CONTENT-DEBUG] Mapping processed segment: ${processedSegment.segment.id}`);
        console.log(`[MERGE-CONTENT-DEBUG] Processed segment data keys:`, Object.keys(processedSegment.data || {}));
        processedMap.set(processedSegment.segment.id, processedSegment);
      }
    }
    
    // Extract reconstructed scenes and batch captions from pipeline data
    const reconstructedScenes = pipelineData.reconstructedScenes || {};
    const batchCaptions = pipelineData.batchCaptions || {};
    
    console.log(`[MERGE-CONTENT-DEBUG] Reconstructed scenes available:`, Object.keys(reconstructedScenes));
    console.log(`[MERGE-CONTENT-DEBUG] Batch captions available:`, Object.keys(batchCaptions));
    
    // Log sample batch caption structure if available
    const firstCaptionKey = Object.keys(batchCaptions)[0];
    if (firstCaptionKey) {
      console.log(`[MERGE-CONTENT-DEBUG] Sample batch caption structure:`, batchCaptions[firstCaptionKey]);
    }
    
    // Merge processed content into original segments
    const enrichedSegments = originalSegments.map(segment => {
      console.log(`[MERGE-CONTENT-DEBUG] Processing segment: ${segment.id}`);
      
      const processed = processedMap.get(segment.id);
      const enriched = { ...segment };
      
      console.log(`[MERGE-CONTENT-DEBUG] Original segment data:`, {
        id: segment.id,
        hasTranscription: !!segment.transcription,
        hasCaption: !!segment.caption,
        hasOcrText: !!segment.ocrText,
        hasKeyframePath: !!segment.keyframePath
      });
      
      if (processed?.data) {
        console.log(`[MERGE-CONTENT-DEBUG] Found processed data for ${segment.id}:`, {
          hasTranscription: !!processed.data.transcription,
          hasCaptions: !!processed.data.captions,
          hasOcrText: !!processed.data.ocrText,
          hasKeyframes: !!processed.data.keyframes
        });
        
        // Merge transcription, captions, OCR, keyframes
        if (processed.data.transcription) {
          enriched.transcription = processed.data.transcription;
          console.log(`[MERGE-CONTENT-DEBUG] Merged transcription from processed data`);
        }
        if (processed.data.captions) {
          enriched.caption = Array.isArray(processed.data.captions) ? processed.data.captions.join(' ') : processed.data.captions;
          console.log(`[MERGE-CONTENT-DEBUG] Merged captions from processed data`);
        }
        if (processed.data.ocrText) {
          enriched.ocrText = processed.data.ocrText;
          console.log(`[MERGE-CONTENT-DEBUG] Merged OCR text from processed data`);
        }
        if (processed.data.keyframes) {
          enriched.keyframePath = Array.isArray(processed.data.keyframes) ? processed.data.keyframes[0] : processed.data.keyframes;
          console.log(`[MERGE-CONTENT-DEBUG] Merged keyframes from processed data`);
        }
      } else {
        console.log(`[MERGE-CONTENT-DEBUG] No processed data found for ${segment.id}`);
      }
      
      // Add batch captions if available (these come from batch captioning processor)
      const segmentCaptions = batchCaptions[segment.id];
      if (segmentCaptions && segmentCaptions.length > 0) {
        console.log(`[MERGE-CONTENT-DEBUG] Found ${segmentCaptions.length} batch captions for ${segment.id}`);
        console.log(`[MERGE-CONTENT-DEBUG] Sample caption:`, segmentCaptions[0]);
        
        // Use the first caption or join multiple captions
        enriched.caption = segmentCaptions.length === 1 
          ? segmentCaptions[0].caption 
          : segmentCaptions.map((c: any) => c.caption).join(' ');
        console.log(`[MERGE-CONTENT-DEBUG] Merged batch captions for ${segment.id}`);
      } else {
        console.log(`[MERGE-CONTENT-DEBUG] No batch captions found for ${segment.id}`);
      }
      
      // Add reconstructed scene if available
      if (reconstructedScenes[segment.id]) {
        enriched.reconstructedScene = reconstructedScenes[segment.id];
        console.log(`[MERGE-CONTENT-DEBUG] Merged reconstructed scene for ${segment.id}`);
      } else {
        console.log(`[MERGE-CONTENT-DEBUG] No reconstructed scene found for ${segment.id}`);
      }
      
      console.log(`[MERGE-CONTENT-DEBUG] Final enriched segment ${segment.id}:`, {
        hasTranscription: !!enriched.transcription,
        transcriptionType: typeof enriched.transcription,
        hasCaption: !!enriched.caption,
        captionType: typeof enriched.caption,
        hasOcrText: !!enriched.ocrText,
        hasReconstructedScene: !!enriched.reconstructedScene,
        hasKeyframePath: !!enriched.keyframePath
      });
      
      return enriched;
    });
    
    return enrichedSegments;
  }

  /**
   * Store video segments in the database
   */
  private async storeVideoSegments(videoPath: string, segments: any[]): Promise<void> {
    console.log(`[STORE-SEGMENTS] Starting storeVideoSegments for ${videoPath} with ${segments.length} segments`);
    
    if (!segments || segments.length === 0) {
      console.log(`[STORE-SEGMENTS] No segments provided for ${videoPath}, skipping storage`);
      return;
    }

    try {
      // Get video file from database
      const videoFile = await this.videoDb.getVideoFileByPath(videoPath);
      console.log(`[STORE-SEGMENTS] Found video file for ${videoPath}:`, videoFile?.id);

      if (!videoFile) {
        throw new Error(`Video file not found for path: ${videoPath}`);
      }

      // Store segments in video database
      await this.videoDb.addVideoSegmentsBatch(segments.map(segment => ({
        ...segment,
        videoId: videoFile.id
      })));

      console.log(`[STORE-SEGMENTS] ✅ Successfully stored ${segments.length} video segments for ${videoPath}`);
      
    } catch (error) {
      console.error(`[STORE-SEGMENTS] Failed to store video segments for ${videoPath}:`, error);
      throw error;
    }
  }

  /**
   * Generate overall video screenplay/narrative from all segments
   */
  private async generateVideoScreenplay(videoPath: string, segments: any[]): Promise<void> {
    try {
      console.log(`[VIDEO-SCREENPLAY] Generating overall video narrative for ${videoPath}`);
      
      // For now, just log that we would generate a screenplay
      // In a full implementation, this would call an LLM to create a narrative
      console.log(`[VIDEO-SCREENPLAY] Would generate screenplay for ${segments.length} segments`);
      console.log(`[VIDEO-SCREENPLAY] Screenplay generation completed for ${videoPath}`);
      
    } catch (error) {
      console.error(`[VIDEO-SCREENPLAY-ERROR] Failed to generate video screenplay:`, error);
    }
  }
}
            .filter(Boolean).join(' ');
          console.log(`[Video Embedding] Using concatenated content for ${videoPath} segment ${segment.sceneIndex}:`, content.substring(0, 200) + '...');
        }

        if (content && content.trim().length > 0) {
          try {
            embedding = await this.embeddingService.embedSingle(content);
            console.log(`[Video Embedding] Generated embedding of length ${embedding?.length} for segment ${segment.sceneIndex}`);
          } catch (error) {
            console.warn(`Failed to generate embedding for segment: ${error}`);
          }
        }

        // Ensure required fields
        const rawStart = (segment as any).startTime;
        const rawEnd = (segment as any).endTime;
        const segStart = Number.isFinite(Number(rawStart)) ? Number(rawStart) : 0;
        const segEnd = Number.isFinite(Number(rawEnd)) ? Number(rawEnd) : segStart;
        let segDuration = Number.isFinite(Number((segment as any).duration))
          ? Number((segment as any).duration)
          : (segEnd - segStart);
        if (!Number.isFinite(segDuration) || segDuration <= 0) {
          // Ensure a tiny positive duration to satisfy NOT NULL and avoid zero-length segments
          segDuration = Math.max(0.001, segEnd - segStart);
        }
        const segSceneIndex = typeof (segment as any).sceneIndex === 'number' ? (segment as any).sceneIndex : i;

        const existingSeg = existingByScene.get(segSceneIndex);
        if (existingSeg) {
          // Update existing partial row with new data
          const patch: any = {
            startTime: segStart ?? existingSeg.startTime,
            endTime: segEnd ?? existingSeg.endTime,
            duration: (segDuration ?? existingSeg.duration),
            thumbnailPath: segment.thumbnailPath ?? existingSeg.thumbnailPath,
            keyframePath: segment.keyframePath ?? existingSeg.keyframePath,
            transcription: segment.transcription ?? existingSeg.transcription,
            caption: segment.caption ?? existingSeg.caption,
            ocrText: segment.ocrText ?? existingSeg.ocrText,
            metadata: segment.metadata ?? existingSeg.metadata,
          };
          if (embedding) patch.embedding = embedding;
          try {
            await this.videoDb.updateVideoSegment(existingSeg.id, patch);
          } catch (e) {
            console.warn(`Failed to update existing segment ${existingSeg.id}:`, e);
          }
        } else {
          // Extract text values from potentially complex objects
          const transcriptionText = segment.transcription?.text || segment.transcription || null;
          const captionText = segment.caption?.text || segment.caption || null;
          const ocrTextValue = segment.ocrText?.text || segment.ocrText || null;
          
          console.log(`[STORE-SEGMENTS-DEBUG] Extracted text values:`, {
            transcriptionText: typeof transcriptionText === 'string' ? transcriptionText.substring(0, 50) + '...' : transcriptionText,
            captionText: typeof captionText === 'string' ? captionText.substring(0, 50) + '...' : captionText,
            ocrTextValue: typeof ocrTextValue === 'string' ? ocrTextValue.substring(0, 50) + '...' : ocrTextValue,
            transcriptionType: typeof transcriptionText,
            captionType: typeof captionText,
            ocrTextType: typeof ocrTextValue
          });
          
          const segmentToInsert = {
            videoPath,
            startTime: segStart,
            endTime: segEnd,
            duration: segDuration,
            sceneIndex: segSceneIndex,
            thumbnailPath: segment.thumbnailPath || null,
            keyframePath: segment.keyframePath || null,
            transcription: transcriptionText,
            caption: captionText,
            ocrText: ocrTextValue,
            embedding,
            metadata: segment.metadata || null,
            reconstructedScene: segment.reconstructedScene || null
          };
          
          console.log(`[STORE-SEGMENTS-DEBUG] Prepared segment for insertion:`, {
            videoPath: segmentToInsert.videoPath,
            startTime: segmentToInsert.startTime,
            endTime: segmentToInsert.endTime,
            duration: segmentToInsert.duration,
            sceneIndex: segmentToInsert.sceneIndex,
            thumbnailPath: segmentToInsert.thumbnailPath,
            keyframePath: segmentToInsert.keyframePath,
            transcription: segmentToInsert.transcription ? `"${String(segmentToInsert.transcription).substring(0, 50)}..."` : null,
            caption: segmentToInsert.caption ? `"${String(segmentToInsert.caption).substring(0, 50)}..."` : null,
            ocrText: segmentToInsert.ocrText ? `"${String(segmentToInsert.ocrText).substring(0, 50)}..."` : null,
            hasEmbedding: !!segmentToInsert.embedding,
            embeddingLength: segmentToInsert.embedding?.length,
            metadata: segmentToInsert.metadata,
            reconstructedScene: segmentToInsert.reconstructedScene ? `"${segmentToInsert.reconstructedScene.substring(0, 50)}..."` : null
          });
          
          toInsert.push(segmentToInsert);
        }
      }

      console.log(`[STORE-SEGMENTS] Prepared ${toInsert.length} segments for insertion`);
      
      if (toInsert.length > 0) {
        console.log(`[STORE-SEGMENTS] Calling addVideoSegmentsBatch with ${toInsert.length} segments`);
        const insertedIds = await this.videoDb.addVideoSegmentsBatch(toInsert);
        console.log(`[STORE-SEGMENTS] Successfully stored ${insertedIds.length} new video segments for ${videoPath}`);
        console.log(`[STORE-SEGMENTS] Inserted segment IDs: ${insertedIds.slice(0, 3).join(', ')}${insertedIds.length > 3 ? '...' : ''}`);
      } else {
        console.log(`[STORE-SEGMENTS] No new segments to insert for ${videoPath} (all segments already exist)`);
      }

      console.log(`[STORE-SEGMENTS] Completed storeVideoSegments for ${videoPath}`)

    } catch (error) {
      console.error(`[STORE-SEGMENTS] Failed to store video segments for ${videoPath}:`, error);
      throw error;
    }

    console.log(`[STORE-SEGMENTS] End storeVideoSegments. Returning`)
  }

  /**
   * Search video content
   */
  async searchVideos(query: VideoSearchQuery): Promise<SearchResult[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const { query: searchQuery, limit = 10, offset = 0, searchType = 'hybrid' } = query;

      switch (searchType) {
        case 'text':
          return await this.videoDb.textSearch(searchQuery, limit, offset);

        case 'vector':
          const embedding = await this.embeddingService.embedSingle(searchQuery);
          return await this.videoDb.vectorSearch(embedding, limit, offset);

        case 'hybrid':
        default:
          const queryEmbedding = await this.embeddingService.embedSingle(searchQuery);
          return await this.videoDb.hybridSearch(searchQuery, queryEmbedding, limit, offset);
      }
    } catch (error) {
      console.error('Video search failed:', error);
      throw error;
    }
  }

  /**
   * Get processing job status
   */
  async getJobStatus(videoPath: string): Promise<VideoProcessingJob | null> {
    return await this.videoDb.getJob(videoPath);
  }

  /**
   * Allow external adapters to listen to underlying pipeline events
   * without exposing internal state or mutating behavior.
   */
  onPipeline(eventName: string, listener: (payload: any) => void): void {
    this.videoPipeline.on(eventName as any, listener as any);
  }

  /**
   * Get all active jobs
   */
  async getActiveJobs(): Promise<VideoProcessingJob[]> {
    return await this.videoDb.getActiveJobs();
  }

  /**
   * Get video file info
   */
  async getVideoFile(videoPath: string): Promise<VideoFile | undefined> {
    return await this.videoDb.getVideoFileByPath(videoPath);
  }

  /**
   * Get video segments
   */
  async getVideoSegments(videoId: string): Promise<VideoSegment[]> {
    return await this.videoDb.getVideoSegments(videoId);
  }

  /**
   * Check if video file is supported
   */
  static isVideoFile(filePath: string): boolean {
    const videoExtensions = ['.mp4', '.avi', '.mov', '.mkv', '.webm', '.flv', '.wmv', '.m4v'];
    const ext = path.extname(filePath).toLowerCase();
    return videoExtensions.includes(ext);
  }

  /**
   * Check if audio file is supported (for transcription only)
   */
  static isAudioFile(filePath: string): boolean {
    const audioExtensions = ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.wma'];
    const ext = path.extname(filePath).toLowerCase();
    return audioExtensions.includes(ext);
  }

  /**
   * Process audio file (transcription only)
   */
  async resetFailedVideo(videoPath: string): Promise<boolean> {
    if (!this.initialized) {
      await this.initialize();
    }
    return await this.videoDb.resetFailedVideoByPath(videoPath);
  }

  async getFailedVideos(): Promise<any[]> {
    if (!this.initialized) {
      await this.initialize();
    }
    return await this.videoDb.getFailedVideos();
  }

  async processAudio(audioPath: string): Promise<string> {
    if (!this.initialized) {
      await this.initialize();
    }

    // Check if file exists
    if (!fs.existsSync(audioPath)) {
      throw new Error(`Audio file not found: ${audioPath}`);
    }

    try {
      // Create a simplified pipeline for audio-only processing
      const whisperService = new WhisperCppService();
      const transcription = await whisperService.transcribe(audioPath);

      // Store as a single segment
      const stats = fs.statSync(audioPath);
      const fileName = path.basename(audioPath);
      
      const videoId = await this.videoDb.addVideoFile({
        filePath: audioPath,
        fileName,
        fileSize: stats.size,
        duration: (transcription as any).duration || ((Array.isArray((transcription as any).segments) && (transcription as any).segments.length)
          ? (transcription as any).segments[(transcription as any).segments.length - 1].end || 0
          : 0),
        processingStatus: 'completed',
        totalSegments: 1,
      });

      // Add single segment with full transcription
      await this.videoDb.addVideoSegment({
        videoPath: audioPath,
        startTime: 0,
        endTime: (transcription as any).duration || ((Array.isArray((transcription as any).segments) && (transcription as any).segments.length)
          ? (transcription as any).segments[(transcription as any).segments.length - 1].end || 0
          : 0),
        duration: (transcription as any).duration || ((Array.isArray((transcription as any).segments) && (transcription as any).segments.length)
          ? (transcription as any).segments[(transcription as any).segments.length - 1].end || 0
          : 0),
        sceneIndex: 0,
        transcription: transcription.text,
      });

      return videoId;
    } catch (error) {
      console.error('Audio processing failed:', error);
      throw error;
    }
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    await this.videoDb.close();
  }
}
