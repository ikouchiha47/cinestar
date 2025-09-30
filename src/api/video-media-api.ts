import { VideoFile, VideoSegment, SearchResult } from '../types/video';
import { VideoDatabase } from '../core/video-database';
import { EmbeddingService } from '../core/embedding-service';
import { VideoPipeline } from '../core/video-pipeline';
import { VideoProcessingJob, VideoSearchQuery } from '../types/video';
import { getVideoDuration } from '../utils/video-utils';
import { MainMediaAPI } from './main-media-api';
import path from 'path';
import fs from 'fs';

/**
 * Video Media API for handling video processing and search
 */
export class VideoMediaAPI {
  private static instance: VideoMediaAPI;
  private videoDb: VideoDatabase;
  private embeddingService: EmbeddingService;
  private videoPipeline: VideoPipeline;
  private initialized = false;

  private constructor() {
    this.embeddingService = new EmbeddingService();
    this.videoDb = new VideoDatabase(this.embeddingService);
    this.videoPipeline = new VideoPipeline();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): VideoMediaAPI {
    if (!VideoMediaAPI.instance) {
      VideoMediaAPI.instance = new VideoMediaAPI();
    }
    return VideoMediaAPI.instance;
  }

  /**
   * Initialize the API
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    
    console.log('[VIDEO-MEDIA-API] Initializing...');
    
    // Initialize the video database
    await this.videoDb.initialize();
    
    this.setupPipeline();
    this.initialized = true;
    console.log('[VIDEO-MEDIA-API] Initialized successfully');
    
    // Recover stalled video processing jobs after initialization
    setTimeout(() => {
      this.recoverStalledVideoJobs().catch((error: any) => {
        console.warn('[VIDEO-MEDIA-API] Video job recovery failed:', error);
      });
    }, 4000); // Wait 4 seconds after initialization
  }

  /**
   * Set up video pipeline event handlers
   */
  private setupPipeline(): void {
    this.videoPipeline.on('completed', async (data: any) => {
      console.log(`[PIPELINE-COMPLETED] Video processing completed for ${data.videoPath}`);
      
      const job = await this.videoDb.getJobByVideoPath(data.videoPath);
      if (job) {
        const enrichedSegments = await this.enrichSegments(data.segments || []);
        
        if (enrichedSegments && enrichedSegments.length > 0) {
          console.log(`[PIPELINE-COMPLETED] Calling storeVideoSegments with ${enrichedSegments.length} enriched segments`);
          try {
            await this.storeVideoSegments(data.videoPath, enrichedSegments);
            console.log(`[PIPELINE-COMPLETED] storeVideoSegments completed successfully`);
          } catch (error) {
            console.log(`[PIPELINE-COMPLETED-ERROR] storeVideoSegments failed:`, error);
          }
          
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

  /**
   * Process a video file
   */
  async processVideo(videoPath: string): Promise<string> {
    try {
      console.log(`[VIDEO-API] Starting video processing for: ${videoPath}`);
      
      // Extract filename from path
      const fileName = path.basename(videoPath);
      
      // Create parent video entry in MainMediaAPI so it shows up in UI immediately
      console.log(`[VIDEO-API] Creating parent video entry for immediate UI display`);
      try {
        // First ensure the video_uploads source exists
        const sources = await MainMediaAPI.getSources();
        let sourceId = 'video_uploads';
        let sourceExists = false;
        
        if (sources.success && sources.sources) {
          const existingSource = sources.sources.find(s => s.name === 'Video Uploads' || s.id === 'video_uploads');
          if (existingSource) {
            sourceExists = true;
            sourceId = existingSource.id; // Use the actual ID from database
            console.log(`[VIDEO-API] Found existing source with ID: ${sourceId}`);
          }
        }
        
        if (!sourceExists) {
          console.log(`[VIDEO-API] Creating video_uploads source`);
          const sourceResult = await MainMediaAPI.addSource({
            name: 'Video Uploads',
            path: path.dirname(videoPath),
            type: 'local',
            enabled: true,
            createdAt: new Date()
          });
          console.log(`[VIDEO-API] Source creation result:`, sourceResult);
          
          if (sourceResult.success && sourceResult.id) {
            sourceId = sourceResult.id; // Use the generated ID
            console.log(`[VIDEO-API] Created new source with ID: ${sourceId}`);
          } else {
            throw new Error(`Failed to create source: ${sourceResult.error}`);
          }
        }
        
        // Generate a single quick thumbnail synchronously for immediate UI feedback
        console.log(`[VIDEO-API] Generating quick thumbnail for immediate display`);
        let metadata: Record<string, any> = { processingStatus: 'pending' };
        
        try {
          const { extractKeyframe, getCacheDir } = await import('../core/video-processing');
          const cacheDir = getCacheDir(videoPath);
          const thumbnailPath = path.join(cacheDir, 'quick_thumb.jpg');
          
          await extractKeyframe(videoPath, 10, thumbnailPath); // Single thumbnail at 10s
          console.log(`[VIDEO-API] Quick thumbnail generated: ${thumbnailPath}`);
          
          metadata = {
            thumbnailPath,
            thumbnailUrl: `file://${thumbnailPath}`,
            quickThumbnail: true,
            processingStatus: 'pending'
          };
        } catch (error) {
          console.warn(`[VIDEO-API] Failed to generate quick thumbnail:`, error);
        }

        console.log(`[VIDEO-API] Using sourceId: ${sourceId} for video: ${fileName}`);
        const addResult = await MainMediaAPI.addItemForFile(sourceId, videoPath, `Video file: ${fileName}`, metadata);
        console.log(`[VIDEO-API] Parent video created:`, addResult);
        
        // Also create corresponding entry in video database (video_files table)
        if (addResult.success && addResult.id) {
          try {
            console.log(`[VIDEO-API] Creating video_files entry for: ${addResult.id}`);
            await this.createVideoFileEntry(addResult.id, videoPath, fileName, fs.statSync(videoPath).size);
            console.log(`[VIDEO-API] ✅ Video_files entry created for: ${addResult.id}`);
          } catch (videoFileError) {
            console.warn(`[VIDEO-API] Failed to create video_files entry:`, videoFileError);
            // Continue anyway - compensation will handle it
          }
        }
      } catch (error) {
        console.warn(`[VIDEO-API] Failed to create parent video entry:`, error);
        // Continue anyway - background processing will handle it
      }
      
      // Create job in database for background processing (Pass 1 scheduled)
      const jobId = await this.videoDb.createJob({
        videoPath,
        fileName,
        status: 'scheduled',
        refinementPass: 1,
        threshold: 0.8,
        progress: 0,
        scheduledAt: new Date(Date.now() + (5 + Math.random() * 5) * 1000) // Schedule Pass 1 for 5-10 seconds from now (UTC)
      });

      console.log(`[VIDEO-API] Job ${jobId} submitted for background processing`);
      console.log(`[VIDEO-API] Video processing will happen asynchronously`);
      console.log(`[VIDEO-API] Use getJobStatus('${videoPath}') to check progress`);

      return jobId;
    } catch (error) {
      console.error(`[VIDEO-API] Error processing video ${videoPath}:`, error);
      throw error;
    }
  }

  /**
   * Enrich segments with additional metadata
   */
  private async enrichSegments(segments: any[]): Promise<any[]> {
    console.log(`[ENRICH-SEGMENTS] Enriching ${segments.length} segments`);
    
    const enrichedSegments = segments.map((segment, index) => {
      const enriched = {
        ...segment,
        id: segment.id || `segment_${index}`,
        sceneIndex: segment.sceneIndex ?? index,
        duration: segment.duration || (segment.endTime - segment.startTime)
      };
      
      console.log(`[ENRICH-SEGMENTS] Segment ${index}:`, {
        id: enriched.id,
        startTime: enriched.startTime,
        endTime: enriched.endTime,
        duration: enriched.duration,
        sceneIndex: enriched.sceneIndex,
        hasTranscription: !!enriched.transcription,
        hasCaption: !!enriched.caption,
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

  /**
   * Allow external adapters to listen to underlying pipeline events
   */
  onPipeline(eventName: string, listener: (payload: any) => void): void {
    this.videoPipeline.on(eventName as any, listener as any);
  }

  /**
   * Search for videos using text query
   */
  async searchVideos(query: VideoSearchQuery): Promise<SearchResult[]> {
    try {
      const { text, limit = 10, offset = 0 } = query;
      return await this.videoDb.hybridSearch(text, undefined, limit, offset);
    } catch (error) {
      console.error('Video search error:', error);
      return [];
    }
  }

  /**
   * Get job status for a video
   */
  async getJobStatus(videoPath: string): Promise<VideoProcessingJob | null> {
    // Get jobs by status and filter by video path
    const jobs = await this.videoDb.getJobs();
    return jobs.find(job => job.videoPath === videoPath) || null;
  }

  /**
   * Recover stalled video processing jobs on startup
   */
  async recoverStalledVideoJobs(): Promise<{ success: boolean; recoveredCount: number; error?: string }> {
    try {
      console.log('[VIDEO-JOB-RECOVERY] Checking for stalled video processing jobs...');
      
      // Get all jobs and find stalled ones using multiple criteria
      const jobs = await this.videoDb.getJobs();
      const now = new Date();
      const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
      const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);
      const twentyMinutesAgo = new Date(now.getTime() - 20 * 60 * 1000);
      
      const stalledJobs = jobs.filter(job => {
        // Case 1: Pending jobs that never started (>5 min old)
        if (job.status === 'pending' && job.createdAt && new Date(job.createdAt) < fiveMinutesAgo) {
          return true;
        }
        
        // Case 2: Processing jobs running too long (>20 min)
        if (job.status === 'processing' && job.startTime && new Date(job.startTime) < twentyMinutesAgo) {
          return true;
        }
        
        // Case 3: Scheduled jobs that never got picked up (>10 min)
        if (job.status === 'scheduled' && job.createdAt && new Date(job.createdAt) < tenMinutesAgo) {
          return true;
        }
        
        return false;
      });
      
      console.log(`[VIDEO-JOB-RECOVERY] Found ${stalledJobs.length} stalled video jobs`);
      
      if (stalledJobs.length > 0) {
        for (const job of stalledJobs) {
          console.log(`[VIDEO-JOB-RECOVERY] Resetting stalled video job: ${job.id} for video: ${job.videoPath}`);
          
          // Reset job to pending status
          await this.videoDb.updateJob(job.id, { status: 'pending', progress: 0 });
          
          // Restart the job
          try {
            const newJobId = await this.processVideo(job.videoPath);
            console.log(`[VIDEO-JOB-RECOVERY] Restarted video job: ${newJobId} for ${job.videoPath}`);
          } catch (error) {
            console.error(`[VIDEO-JOB-RECOVERY] Failed to restart video job for ${job.videoPath}:`, error);
            await this.videoDb.updateJob(job.id, { status: 'failed', error: String(error) });
          }
        }
      } else {
        console.log('[VIDEO-JOB-RECOVERY] No stalled video jobs found');
      }
      
      return { success: true, jobId: stalledJobs.length > 0 ? stalledJobs[0].id : null, recoveredCount: stalledJobs.length };
    } catch (error) {
      console.error('[VIDEO-JOB-RECOVERY] Failed to recover stalled video jobs:', error);
      return { success: false, recoveredCount: 0, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Get all active processing jobs
   */
  async getActiveJobs(): Promise<VideoProcessingJob[]> {
    console.log(`[VIDEO-API-ACTIVE] 🔍 VideoMediaAPI.getActiveJobs() called`);
    const jobs = await this.videoDb.getActiveJobs();
    console.log(`[VIDEO-API-ACTIVE] 📋 VideoMediaAPI returning ${jobs.length} jobs:`, 
      jobs.map(j => ({ id: j.id, status: j.status, videoPath: j.videoPath })));
    return jobs;
  }

  /**
   * Get video file by path
   */
  async getVideoFile(videoPath: string): Promise<VideoFile | undefined> {
    return await this.videoDb.getVideoFileByPath(videoPath);
  }

  /**
   * Get video segments by video ID
   */
  async getVideoSegments(videoId: string): Promise<VideoSegment[]> {
    return await this.videoDb.getVideoSegments(videoId);
  }

  /**
   * Check if file is a video file
   */
  isVideoFile(filePath: string): boolean {
    const videoExtensions = ['.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm', '.m4v'];
    const ext = path.extname(filePath).toLowerCase();
    return videoExtensions.includes(ext);
  }

  /**
   * Check if file is an audio file
   */
  isAudioFile(filePath: string): boolean {
    const audioExtensions = ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.wma'];
    const ext = path.extname(filePath).toLowerCase();
    return audioExtensions.includes(ext);
  }

  /**
   * Create video_files entry in video database to maintain referential integrity
   * This ensures both main database and video database have the parent video record
   */
  private async createVideoFileEntry(videoId: string, videoPath: string, fileName: string, fileSize: number): Promise<void> {
    try {
      // Direct SQL insert to use the specific ID from main database
      const stmt = (this.videoDb as any).db.prepare(`
        INSERT INTO video_files (
          id, file_path, file_name, file_size, duration, width, height,
          frame_rate, bitrate, codec, total_segments, processing_status, processing_error,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      const now = new Date().toISOString();
      stmt.run(
        videoId, // Use the exact ID from main database
        videoPath,
        fileName,
        fileSize,
        0, // duration - will be updated during processing
        null, null, null, null, null, // width, height, frameRate, bitrate, codec
        0, // totalSegments
        'pending', // processingStatus
        null, // processingError
        now, // createdAt
        now  // updatedAt
      );
      
      console.log(`[VIDEO-FILES-SYNC] ✅ Created video_files entry with ID: ${videoId}`);
    } catch (error) {
      console.error(`[VIDEO-FILES-SYNC] ❌ Failed to create video_files entry:`, error);
      throw error;
    }
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    // Close database connection
    await this.videoDb.close();
  }
}
