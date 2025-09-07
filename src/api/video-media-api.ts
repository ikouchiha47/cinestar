import { VideoDatabase, VideoFile, VideoSegment, SearchResult } from '../core/video-database';
import { EmbeddingService } from '../core/embedding-service';
import { VideoPipeline } from '../core/video-pipeline';
import { TemporalMerger, MergedResult } from '../core/temporal-merger';
import { SegmentationProcessor } from '../core/processors/segmentation-processor';
import { VisualProcessor } from '../core/processors/visual-processor';
import { TranscriptionProcessor } from '../core/processors/transcription-processor';
import { CaptioningProcessor } from '../core/processors/captioning-processor';
import { OCRProcessor } from '../core/processors/ocr-processor';
import { WhisperNodeService } from '../core/processors/whisper-node-service';
import { ConcurrencyLimiter } from '../core/concurrency-limiter';
import * as fs from 'fs';
import * as path from 'path';

export interface VideoProcessingJob {
  id: string;
  videoPath: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  error?: string;
  startTime?: Date;
  endTime?: Date;
  segmentCount?: number;
}

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
  private temporalMerger: TemporalMerger;
  private activeJobs = new Map<string, VideoProcessingJob>();
  private initialized = false;

  private constructor() {
    this.embeddingService = new EmbeddingService();
    this.videoDb = new VideoDatabase(this.embeddingService);
    this.concurrencyLimiter = new ConcurrencyLimiter(2); // Limit to 2 concurrent video processing jobs
    this.temporalMerger = new TemporalMerger();
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
    const visualProcessor = new VisualProcessor();
    const transcriptionProcessor = new TranscriptionProcessor();
    const captioningProcessor = new CaptioningProcessor();
    const ocrProcessor = new OCRProcessor();

    // Add Whisper-node service to transcription processor
    const whisperService = new WhisperNodeService();
    transcriptionProcessor.addService('whisper-node', whisperService);

    // Register processors into pipeline
    this.videoPipeline.addProcessor('segmentation', segmentationProcessor);
    this.videoPipeline.addProcessor('visual', visualProcessor);
    this.videoPipeline.addProcessor('transcription', transcriptionProcessor);
    this.videoPipeline.addProcessor('captioning', captioningProcessor);
    this.videoPipeline.addProcessor('ocr', ocrProcessor);

    // Setup event listeners
    this.videoPipeline.on('progress', (data) => {
      const job = this.activeJobs.get(data.videoPath);
      if (job) {
        job.progress = data.progress;
        console.log(`Video processing progress: ${data.videoPath} - ${data.progress}%`);
      }
    });

    this.videoPipeline.on('error', (data) => {
      const job = this.activeJobs.get(data.videoPath);
      if (job) {
        job.status = 'failed';
        job.error = data.error;
        job.endTime = new Date();
        console.error(`Video processing failed: ${data.videoPath}`, data.error);
      }
    });

    this.videoPipeline.on('completed', async (data) => {
      const job = this.activeJobs.get(data.videoPath);
      if (job) {
        job.status = 'completed';
        job.progress = 100;
        job.endTime = new Date();
        job.segmentCount = data.segments?.length || 0;
        
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

    // Check if already processed or previously inserted
    const existingVideo = await this.videoDb.getVideoFileByPath(videoPath);
    if (existingVideo) {
      if (existingVideo.processingStatus === 'completed') {
        console.log(`Video already processed: ${videoPath}`);
        return existingVideo.id;
      }
      // If a row exists (pending/processing/failed), reuse it to avoid UNIQUE constraint error
      console.log(`Reusing existing video record for ${videoPath} with status ${existingVideo.processingStatus}`);
    }

    // Create job
    const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const job: VideoProcessingJob = {
      id: jobId,
      videoPath,
      status: 'pending',
      progress: 0,
      startTime: new Date(),
    };

    this.activeJobs.set(videoPath, job);

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
        
        // Run video pipeline: start with an initial segment representing the whole video (time bounds may be refined by processors)
        const initialSegment = {
          id: `seg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          videoId,
          videoPath,
          startTime: 0,
          endTime: 0,
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
      const segmentsToStore = await Promise.all(
        segments.map(async (segment) => {
          // Generate embedding for segment content
          let embedding: Float32Array | undefined;
          const content = [
            segment.transcription,
            segment.caption,
            segment.ocrText,
          ].filter(Boolean).join(' ');

          if (content.trim()) {
            try {
              embedding = await this.embeddingService.embedSingle(content);
            } catch (error) {
              console.warn(`Failed to generate embedding for segment: ${error}`);
            }
          }

          return {
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
          };
        })
      );

      // Batch insert segments
      await this.videoDb.addVideoSegmentsBatch(segmentsToStore);
      console.log(`Stored ${segmentsToStore.length} video segments for ${videoPath}`);
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
  getJobStatus(videoPath: string): VideoProcessingJob | undefined {
    return this.activeJobs.get(videoPath);
  }

  /**
   * Get all active jobs
   */
  getActiveJobs(): VideoProcessingJob[] {
    return Array.from(this.activeJobs.values());
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
      const whisperService = new WhisperNodeService();
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
