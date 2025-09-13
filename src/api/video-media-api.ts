import { VideoDatabase } from '../core/video-database.js';
import { EmbeddingService } from '../core/embedding-service.js';
import { VideoPipeline } from '../core/video-pipeline.js';
import { ConcurrencyLimiter } from '../core/concurrency-limiter.js';
import { MainMediaAPI } from './main-media-api';
import { VideoFile, VideoSegment, SearchResult, VideoProcessingJob } from '../core/video-database.js';
import { getVideoDuration } from '../core/video-processing';
import { SegmentationProcessor } from '../core/processors/segmentation-processor.js';
import { AudioExtractionProcessor } from '../core/processors/audio-extraction-processor.js';
import { VisualProcessor } from '../core/processors/visual-processor.js';
import { TranscriptionProcessor } from '../core/processors/transcription-processor.js';
import { CaptioningProcessor } from '../core/processors/captioning-processor.js';
import { OCRProcessor } from '../core/processors/ocr-processor.js';
import { DockerWhisperService } from '../core/processors/docker-whisper-service.js';
import { WhisperCliService } from '../core/processors/whisper-cli-service.js';
import { WhisperCppService } from '../core/processors/whisper-cpp-service.js';
import fs from 'fs';
import path from 'path';
import { ConfigManager } from '../core/config.js';


export interface VideoSearchQuery {
  query: string;
  limit?: number;
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
  // Main sources/items are managed by MainMediaAPI (SQLite-backed)
  private initialized = false;

  private constructor() {
    this.embeddingService = new EmbeddingService();
    this.videoDb = new VideoDatabase(this.embeddingService);
    this.concurrencyLimiter = new ConcurrencyLimiter(2); // Limit to 2 concurrent video processing jobs
    this.videoPipeline = new VideoPipeline();
    this.setupVideoPipeline();
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
    // Captioning throughput via ConfigManager
    const cap = appCfg.captioning;
    const captioningProcessor = new CaptioningProcessor({ 
      batchSize: cap?.batchSize ?? 4, 
      captionThumbnails: cap?.captionThumbnails ?? false, 
      captionConcurrency: cap?.concurrency ?? 4,
      captionKeyframes: cap?.captionKeyframes ?? true,
    });
    const ocrProcessor = new OCRProcessor();

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
    this.videoPipeline.addProcessor('captioning', captioningProcessor);
    this.videoPipeline.addProcessor('ocr', ocrProcessor);

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
      const job = await this.videoDb.getJob(data.videoPath);
      if (job) {
        await this.videoDb.updateJob(job.id, {
          status: 'completed',
          progress: 100,
          endTime: new Date(),
          segmentCount: data.segments?.length || 0
        });
        
        // Store segments in database
        if (data.segments) {
          await this.storeVideoSegments(data.videoPath, data.segments);
        }
        
        console.log(`Video processing completed: ${data.videoPath}`);
      }
    });
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await this.videoDb.initialize();
      
      // Test embedding service connection
      const isConnected = await this.embeddingService.testConnection();
      if (!isConnected) {
        console.warn('Embedding service not available - vector search will be disabled');
      }

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
  async processVideo(videoPath: string): Promise<string> {
    if (!this.initialized) {
      await this.initialize();
    }

    // Check if file exists
    if (!fs.existsSync(videoPath)) {
      throw new Error(`Video file not found: ${videoPath}`);
    }

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

      // Insert this specific video file as an item so it appears in the home UI
      if (sourceId) {
        try {
          const addItem = await MainMediaAPI.addItemForFile(sourceId, videoPath, `Video file: ${videoName}`, { via: 'VideoMediaAPI' });
          if (addItem.success) {
            console.log(`[Video Source] Inserted/updated video item in main DB: ${videoName}`);
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

      // Process with concurrency limit
      await this.concurrencyLimiter.add(async () => {
        job.status = 'processing';
        
        // Create initial segment for pipeline processing - segmentation will determine actual bounds
        const duration = await getVideoDuration(videoPath);
        const initialSegment = {
          id: `seg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          videoId,
          videoPath,
          startTime: 0,
          endTime: duration,
        } as any; // conforms to VideoPipeline.VideoSegment shape
        const context = await this.videoPipeline.processSegment(initialSegment);

        // Update video file with metadata
        const md = (context?.data && (context.data.metadata || context.data.videoMetadata)) || undefined;
        const segments = (context?.data && (context.data.segments || context.data.videoSegments)) || [];
        await this.videoDb.updateVideoFile(videoId, {
          duration: md?.duration || 0,
          width: md?.width,
          height: md?.height,
          frameRate: md?.frameRate,
          bitrate: md?.bitrate,
          codec: md?.codec,
          totalSegments: Array.isArray(segments) ? segments.length : 0,
          processingStatus: 'completed',
        });
      });

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
   * Store video segments in database with embeddings
   */
  private async storeVideoSegments(videoPath: string, segments: any[]): Promise<void> {
    try {
      // Fetch existing segments (if any) for idempotency and enrichment
      const file = await this.videoDb.getVideoFileByPath(videoPath);
      const existing = file ? await this.videoDb.getVideoSegments(file.id) : [];
      const existingByScene = new Map<number, any>();
      for (const seg of existing) existingByScene.set(seg.sceneIndex, seg);

      const toInsert: any[] = [];

      for (const segment of segments) {
        // Generate embedding on the fly (best effort)
        let embedding: Float32Array | undefined;
        const content = [segment.transcription, segment.caption, segment.ocrText]
          .filter(Boolean).join(' ');

        if (content && content.trim().length > 0) {
          console.log(`[Video Embedding] Content for ${videoPath} segment ${segment.sceneIndex}:`, content.substring(0, 200) + '...');
          try {
            embedding = await this.embeddingService.embedSingle(content);
            console.log(`[Video Embedding] Generated embedding of length ${embedding?.length} for segment ${segment.sceneIndex}`);
          } catch (error) {
            console.warn(`Failed to generate embedding for segment: ${error}`);
          }
        }

        const existingSeg = existingByScene.get(segment.sceneIndex);
        if (existingSeg) {
          // Update existing partial row with new data
          const patch: any = {
            startTime: segment.startTime ?? existingSeg.startTime,
            endTime: segment.endTime ?? existingSeg.endTime,
            duration: segment.duration ?? existingSeg.duration,
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
          toInsert.push({
            videoPath,
            startTime: segment.startTime,
            endTime: segment.endTime,
            duration: segment.duration,
            sceneIndex: segment.sceneIndex,
            thumbnailPath: segment.thumbnailPath,
            keyframePath: segment.keyframePath,
            transcription: segment.transcription,
            caption: segment.caption,
            ocrText: segment.ocrText,
            embedding,
            metadata: segment.metadata,
          });
        }
      }

      if (toInsert.length > 0) {
        await this.videoDb.addVideoSegmentsBatch(toInsert);
        console.log(`Stored ${toInsert.length} new video segments for ${videoPath}`);
      }
    } catch (error) {
      console.error('Failed to store video segments:', error);
      throw error;
    }
  }

  /**
   * Search video content
   */
  async searchVideos(query: VideoSearchQuery): Promise<SearchResult[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const { query: searchQuery, limit = 10, searchType = 'hybrid' } = query;

      switch (searchType) {
        case 'text':
          return await this.videoDb.textSearch(searchQuery, limit);

        case 'vector':
          const embedding = await this.embeddingService.embedSingle(searchQuery);
          return await this.videoDb.vectorSearch(embedding, limit);

        case 'hybrid':
        default:
          const queryEmbedding = await this.embeddingService.embedSingle(searchQuery);
          return await this.videoDb.hybridSearch(searchQuery, queryEmbedding, limit);
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
