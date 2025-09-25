import { VideoDatabase, VideoProcessingJob } from './video-database.js';
import { EmbeddingService } from './embedding-service.js';
import { VideoPipeline } from './video-pipeline.js';
import { ConcurrencyLimiter } from './concurrency-limiter.js';
import { SqliteVecDatabase } from './sqlite-vec-database.js';

/**
 * Background job processor for video processing tasks
 * Handles video processing jobs asynchronously without blocking request cycles
 */
export class VideoJobProcessor {
  private videoDb: VideoDatabase;
  private embeddingService: EmbeddingService;
  private videoPipeline: VideoPipeline;
  private concurrencyLimiter: ConcurrencyLimiter;
  private vectorDb: SqliteVecDatabase;
  private isProcessing = false;
  private processingInterval: NodeJS.Timeout | null = null;

  constructor(sharedPipeline?: VideoPipeline) {
    this.embeddingService = new EmbeddingService();
    this.videoDb = new VideoDatabase(this.embeddingService);
    this.concurrencyLimiter = new ConcurrencyLimiter(2);
    this.videoPipeline = sharedPipeline || new VideoPipeline();
    this.vectorDb = new SqliteVecDatabase('./data/vector.db');
    
    // Only setup pipeline if we created our own (not shared)
    if (!sharedPipeline) {
      this.setupPipeline();
    }
  }

  /**
   * Start the background job processor
   */
  async start(): Promise<void> {
    console.log(`[VIDEO-JOB-PROCESSOR] Starting background job processor`);
    
    if (this.processingInterval) {
      console.log(`[VIDEO-JOB-PROCESSOR] Already running`);
      return;
    }

    // Process jobs every 5 seconds
    this.processingInterval = setInterval(async () => {
      if (!this.isProcessing) {
        await this.processNextJob();
      }
    }, 5000);

    console.log(`[VIDEO-JOB-PROCESSOR] Background processor started`);
  }

  /**
   * Stop the background job processor
   */
  async stop(): Promise<void> {
    console.log(`[VIDEO-JOB-PROCESSOR] Stopping background job processor`);
    
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }

    console.log(`[VIDEO-JOB-PROCESSOR] Background processor stopped`);
  }

  /**
   * Process the next pending job
   */
  private async processNextJob(): Promise<void> {
    try {
      this.isProcessing = true;
      
      const pendingJobs = await this.videoDb.getPendingJobs();
      if (pendingJobs.length === 0) {
        return;
      }

      const job = pendingJobs[0];
      console.log(`[VIDEO-JOB-PROCESSOR] Processing job ${job.id} for ${job.videoPath}`);

      // Update job status to processing
      await this.videoDb.updateJob(job.id, {
        status: 'processing',
        startTime: new Date(),
        progress: 0
      });

      // Process the video
      await this.processVideoJob(job);

    } catch (error) {
      console.error(`[VIDEO-JOB-PROCESSOR-ERROR] Failed to process job:`, error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process a single video job
   */
  private async processVideoJob(job: VideoProcessingJob): Promise<void> {
    try {
      console.log(`[VIDEO-JOB-PROCESSOR] Starting video processing for ${job.videoPath}`);

      // Get video duration and create initial segment for pipeline processing
      const { getVideoDuration } = await import('../core/video-processing');
      const duration = await getVideoDuration(job.videoPath);
      
      const initialSegment = {
        id: `seg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        videoId: job.id,
        videoPath: job.videoPath,
        startTime: 0,
        endTime: duration,
      } as any;

      // Submit to video pipeline
      console.log(`[VIDEO-JOB-PROCESSOR] Submitting initial segment to pipeline:`, {
        id: initialSegment.id,
        startTime: initialSegment.startTime,
        endTime: initialSegment.endTime,
        duration: duration
      });
      
      const result = await this.videoPipeline.processSegment(initialSegment);
      
      console.log(`[VIDEO-JOB-PROCESSOR] Video pipeline completed for ${job.videoPath}`);
      console.log(`[VIDEO-JOB-PROCESSOR] Result keys: ${Object.keys(result || {})}`);
      console.log(`[VIDEO-JOB-PROCESSOR] Result.data keys: ${Object.keys(result.data || {})}`);
      console.log(`[VIDEO-JOB-PROCESSOR] Result.segment:`, !!result.segment);
      console.log(`[VIDEO-JOB-PROCESSOR] Full result structure:`, JSON.stringify(result, null, 2));

      // Process the results
      await this.processVideoResults(job, result);

      // Update job as completed
      await this.videoDb.updateJob(job.id, {
        status: 'completed',
        progress: 100,
        endTime: new Date(),
        segmentCount: result.data?.segments?.length || 0
      });

      console.log(`[VIDEO-JOB-PROCESSOR] Job ${job.id} completed successfully`);

    } catch (error) {
      console.error(`[VIDEO-JOB-PROCESSOR-ERROR] Job ${job.id} failed:`, error);
      
      // Update job as failed
      await this.videoDb.updateJob(job.id, {
        status: 'failed',
        progress: 0,
        endTime: new Date(),
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Process video pipeline results and store segments with multi-stage embeddings
   */
  private async processVideoResults(job: VideoProcessingJob, result: any): Promise<void> {
    console.log(`[VIDEO-JOB-PROCESSOR] Processing results for job ${job.id}`);
    console.log(`[VIDEO-JOB-PROCESSOR] Available result keys: ${Object.keys(result || {})}`);
    
    // The pipeline returns nested data: { segment, data: { processedSegments, reconstructedScenes, ... } }
    // Extract from the actual nested structure
    const pipelineData = result.data || {};
    const processedSegments = pipelineData.processedSegments || [];
    const reconstructedScenes = pipelineData.reconstructedScenes || {};
    const batchCaptions = pipelineData.batchCaptions || {};
    
    console.log(`[VIDEO-JOB-PROCESSOR] Pipeline data analysis:`);
    console.log(`[VIDEO-JOB-PROCESSOR] - Pipeline data keys: ${Object.keys(pipelineData)}`);
    console.log(`[VIDEO-JOB-PROCESSOR] - Processed segments: ${processedSegments.length}`);
    console.log(`[VIDEO-JOB-PROCESSOR] - Reconstructed scenes: ${Object.keys(reconstructedScenes).length}`);
    console.log(`[VIDEO-JOB-PROCESSOR] - Batch captions keys: ${Object.keys(batchCaptions)}`);
    
    // Build enriched segments from the processed segments
    let enrichedSegments = [];
    
    if (processedSegments.length > 0) {
      console.log(`[VIDEO-JOB-PROCESSOR] Extracting rich content from ${processedSegments.length} processed segments`);
      
      for (const processedSegmentData of processedSegments) {
        const segment = processedSegmentData.segment || {};
        const segmentData = processedSegmentData.data || {};
        
        console.log(`[VIDEO-JOB-PROCESSOR] Processing segment ${segment.id}:`);
        console.log(`[VIDEO-JOB-PROCESSOR] - Has transcription: ${!!segmentData.transcription}`);
        console.log(`[VIDEO-JOB-PROCESSOR] - Transcription length: ${segmentData.transcription?.text?.length || 0} chars`);
        console.log(`[VIDEO-JOB-PROCESSOR] - Has keyframes: ${segmentData.keyframes?.length || 0}`);
        
        // Extract reconstructed scene for this segment
        const reconstructedScene = reconstructedScenes[segment.id] || '';
        console.log(`[VIDEO-JOB-PROCESSOR] - Has reconstructed scene: ${!!reconstructedScene}`);
        console.log(`[VIDEO-JOB-PROCESSOR] - Reconstructed scene length: ${reconstructedScene.length} chars`);
        
        // Extract captions for this segment
        let primaryCaption = '';
        let captionCount = 0;
        
        // Try to find captions for this segment
        if (batchCaptions[segment.id]) {
          const segmentCaptions = batchCaptions[segment.id];
          if (Array.isArray(segmentCaptions) && segmentCaptions.length > 0) {
            primaryCaption = segmentCaptions[0].caption || segmentCaptions[0] || '';
            captionCount = segmentCaptions.length;
          } else if (typeof segmentCaptions === 'string') {
            primaryCaption = segmentCaptions;
            captionCount = 1;
          }
        }
        
        // Fallback: look for any captions in the segment data
        if (!primaryCaption && segmentData.keyframes && segmentData.keyframes.length > 0) {
          // Try to extract from keyframe captions if available
          const keyframeCaptions = segmentData.keyframes
            .map((kf: any) => kf.caption)
            .filter((caption: any) => caption && caption.length > 0);
          if (keyframeCaptions.length > 0) {
            primaryCaption = keyframeCaptions[0];
            captionCount = keyframeCaptions.length;
          }
        }
        
        console.log(`[VIDEO-JOB-PROCESSOR] - Available captions: ${captionCount}`);
        console.log(`[VIDEO-JOB-PROCESSOR] - Primary caption length: ${primaryCaption.length} chars`);
        
        // Build enriched segment with all available content
        const enrichedSegment = {
          ...segment,
          // Transcription content
          transcription: segmentData.transcription?.text || segmentData.transcription || '',
          // Visual content (caption)
          caption: primaryCaption,
          // Narrative content (reconstructed scene)
          reconstructedScene: reconstructedScene,
          // Additional metadata
          keyframes: segmentData.keyframes || [],
          audioPath: segmentData.audioPath || '',
          metadata: {
            duration: segmentData.duration || 0,
            keyframeCount: segmentData.keyframes?.length || 0,
            transcriptionSegments: segmentData.transcription?.segments?.length || 0,
            captionCount: captionCount
          }
        };
        
        enrichedSegments.push(enrichedSegment);
        
        console.log(`[VIDEO-JOB-PROCESSOR] ✅ Enriched segment ${segment.id} with:`);
        console.log(`[VIDEO-JOB-PROCESSOR]   - Transcription: ${enrichedSegment.transcription.length} chars`);
        console.log(`[VIDEO-JOB-PROCESSOR]   - Caption: ${enrichedSegment.caption.length} chars`);
        console.log(`[VIDEO-JOB-PROCESSOR]   - Reconstruction: ${enrichedSegment.reconstructedScene.length} chars`);
      }
    } else {
      console.warn(`[VIDEO-JOB-PROCESSOR] No processed segments found in pipeline data`);
    }
    
    // Generate multi-stage embeddings for each segment
    if (enrichedSegments && enrichedSegments.length > 0) {
      console.log(`[VIDEO-JOB-PROCESSOR] Generating multi-stage embeddings for ${enrichedSegments.length} segments`);
      enrichedSegments = await this.generateMultiStageEmbeddings(enrichedSegments);
      
      // Store segments in video database with multi-stage embeddings
      console.log(`[VIDEO-JOB-PROCESSOR] Storing ${enrichedSegments.length} enriched segments with multi-stage embeddings`);
      await this.storeVideoSegmentsWithMultiEmbeddings(job.videoPath, enrichedSegments);
      
      // Index video segments in main search database for vector search
      console.log(`[VIDEO-JOB-PROCESSOR] Indexing video segments in main search database`);
      await this.indexVideoSegmentsForSearch(job.videoPath, enrichedSegments);
      
      console.log(`[VIDEO-JOB-PROCESSOR] Successfully processed and indexed ${enrichedSegments.length} segments`);
    } else {
      console.warn(`[VIDEO-JOB-PROCESSOR] No segments to store for ${job.videoPath}`);
    }
  }

  /**
   * Generate multi-stage embeddings for segments
   */
  private async generateMultiStageEmbeddings(segments: any[]): Promise<any[]> {
    console.log(`[VIDEO-JOB-PROCESSOR] Starting multi-stage embedding generation for ${segments.length} segments`);
    
    const enrichedSegments = [];
    
    for (const segment of segments) {
      console.log(`[VIDEO-JOB-PROCESSOR] Generating embeddings for segment ${segment.id || 'unknown'}`);
      
      const multiStageEmbeddings: any = {
        available_embeddings: [],
        embedding_timestamps: {},
        embedding_metadata: {}
      };
      
      const timestamp = new Date().toISOString();
      
      // 1. Transcription Embedding (highest priority - enables immediate search)
      const transcriptionText = segment.transcription?.text || segment.transcription || '';
      if (transcriptionText && transcriptionText.length > 0) {
        console.log(`[VIDEO-JOB-PROCESSOR] Generating transcription embedding (${transcriptionText.length} chars)`);
        try {
          multiStageEmbeddings.transcription_embedding = await this.embeddingService.embedSingle(transcriptionText);
          multiStageEmbeddings.available_embeddings.push('transcription');
          multiStageEmbeddings.embedding_timestamps.transcription = timestamp;
          multiStageEmbeddings.embedding_metadata.transcription = {
            confidence: 0.9, // High confidence for direct speech
            content_length: transcriptionText.length,
            source: 'speech_recognition'
          };
          console.log(`[VIDEO-JOB-PROCESSOR] ✅ Generated transcription embedding`);
        } catch (error) {
          console.error(`[VIDEO-JOB-PROCESSOR] Failed to generate transcription embedding:`, error);
        }
      }
      
      // 2. Caption Embedding (visual content)
      const captionText = segment.caption || '';
      if (captionText && captionText.length > 0) {
        console.log(`[VIDEO-JOB-PROCESSOR] Generating caption embedding (${captionText.length} chars)`);
        try {
          multiStageEmbeddings.caption_embedding = await this.embeddingService.embedSingle(captionText);
          multiStageEmbeddings.available_embeddings.push('caption');
          multiStageEmbeddings.embedding_timestamps.caption = timestamp;
          multiStageEmbeddings.embedding_metadata.caption = {
            confidence: 0.8, // Good confidence for visual description
            content_length: captionText.length,
            source: 'visual_captioning'
          };
          console.log(`[VIDEO-JOB-PROCESSOR] ✅ Generated caption embedding`);
        } catch (error) {
          console.error(`[VIDEO-JOB-PROCESSOR] Failed to generate caption embedding:`, error);
        }
      }
      
      // 3. Reconstruction Embedding (narrative context)
      const reconstructedScene = segment.reconstructedScene || '';
      if (reconstructedScene && reconstructedScene.length > 0) {
        console.log(`[VIDEO-JOB-PROCESSOR] Generating reconstruction embedding (${reconstructedScene.length} chars)`);
        try {
          multiStageEmbeddings.reconstruction_embedding = await this.embeddingService.embedSingle(reconstructedScene);
          multiStageEmbeddings.available_embeddings.push('reconstruction');
          multiStageEmbeddings.embedding_timestamps.reconstruction = timestamp;
          multiStageEmbeddings.embedding_metadata.reconstruction = {
            confidence: 0.95, // Highest confidence for processed narrative
            content_length: reconstructedScene.length,
            source: 'scene_reconstruction'
          };
          console.log(`[VIDEO-JOB-PROCESSOR] ✅ Generated reconstruction embedding`);
        } catch (error) {
          console.error(`[VIDEO-JOB-PROCESSOR] Failed to generate reconstruction embedding:`, error);
        }
      }
      
      // Fallback: Use legacy embedding field if available
      if (segment.embedding && multiStageEmbeddings.available_embeddings.length === 0) {
        console.log(`[VIDEO-JOB-PROCESSOR] Using legacy embedding as fallback`);
        multiStageEmbeddings.reconstruction_embedding = segment.embedding;
        multiStageEmbeddings.available_embeddings.push('reconstruction');
        multiStageEmbeddings.embedding_timestamps.reconstruction = timestamp;
        multiStageEmbeddings.embedding_metadata.reconstruction = {
          confidence: 0.7,
          content_length: 0,
          source: 'legacy_embedding'
        };
      }
      
      console.log(`[VIDEO-JOB-PROCESSOR] Generated ${multiStageEmbeddings.available_embeddings.length} embeddings for segment: [${multiStageEmbeddings.available_embeddings.join(', ')}]`);
      
      // Merge embeddings into segment
      const enrichedSegment = {
        ...segment,
        ...multiStageEmbeddings,
        available_embeddings: JSON.stringify(multiStageEmbeddings.available_embeddings),
        embedding_timestamps: JSON.stringify(multiStageEmbeddings.embedding_timestamps),
        embedding_metadata: JSON.stringify(multiStageEmbeddings.embedding_metadata)
      };
      
      enrichedSegments.push(enrichedSegment);
    }
    
    console.log(`[VIDEO-JOB-PROCESSOR] Completed multi-stage embedding generation for ${enrichedSegments.length} segments`);
    return enrichedSegments;
  }

  /**
   * Store video segments with multi-stage embeddings
   */
  private async storeVideoSegmentsWithMultiEmbeddings(videoPath: string, segments: any[]): Promise<void> {
    console.log(`[VIDEO-JOB-PROCESSOR] Starting storeVideoSegmentsWithMultiEmbeddings for ${videoPath} with ${segments?.length || 0} segments`);
    
    if (!segments || segments.length === 0) {
      console.warn(`[VIDEO-JOB-PROCESSOR] No segments provided for ${videoPath}, skipping storage`);
      return;
    }

    try {
      // Store video file first
      const videoFile = await this.videoDb.getVideoFileByPath(videoPath);
      if (!videoFile) {
        console.log(`[VIDEO-JOB-PROCESSOR] Creating video file entry for ${videoPath}`);
        await this.videoDb.addVideoFile({
          filePath: videoPath,
          fileName: videoPath.split('/').pop() || 'unknown',
          duration: segments[segments.length - 1]?.endTime || 0,
          frameRate: 30,
          fileSize: 0,
          totalSegments: segments.length,
          processingStatus: 'processing'
        });
      }

      // Prepare segments for batch insertion with multi-stage embeddings
      const segmentsToInsert = [];
      
      for (const segment of segments) {
        console.log(`[VIDEO-JOB-PROCESSOR] Processing segment for insertion with multi-embeddings:`, {
          startTime: segment.startTime,
          endTime: segment.endTime,
          availableEmbeddings: segment.available_embeddings,
          hasTranscriptionEmbedding: !!segment.transcription_embedding,
          hasCaptionEmbedding: !!segment.caption_embedding,
          hasReconstructionEmbedding: !!segment.reconstruction_embedding
        });

        segmentsToInsert.push({
          videoPath: videoPath,
          startTime: segment.startTime,
          endTime: segment.endTime,
          duration: segment.endTime - segment.startTime,
          sceneIndex: segment.sceneIndex || 0,
          thumbnailPath: segment.thumbnailPath || null,
          keyframePath: segment.keyframePath || null,
          transcription: segment.transcription?.text || segment.transcription || '',
          caption: segment.caption || '',
          ocrText: segment.ocrText || null,
          embedding: segment.reconstruction_embedding || segment.caption_embedding || segment.transcription_embedding, // Fallback for legacy compatibility
          metadata: segment.metadata || null,
          reconstructedScene: segment.reconstructedScene || '',
          // Multi-stage embeddings
          transcription_embedding: segment.transcription_embedding || undefined,
          caption_embedding: segment.caption_embedding || undefined,
          reconstruction_embedding: segment.reconstruction_embedding || undefined,
          available_embeddings: segment.available_embeddings || '[]',
          embedding_timestamps: segment.embedding_timestamps || '{}',
          embedding_metadata: segment.embedding_metadata || '{}'
        });
      }

      console.log(`[VIDEO-JOB-PROCESSOR] Prepared ${segmentsToInsert.length} segments for insertion with multi-stage embeddings`);
      
      if (segmentsToInsert.length > 0) {
        const insertedIds = await this.videoDb.addVideoSegmentsBatch(segmentsToInsert);
        console.log(`[VIDEO-JOB-PROCESSOR] Successfully stored ${insertedIds.length} video segments with multi-stage embeddings`);
      }
      
    } catch (error) {
      console.error(`[VIDEO-JOB-PROCESSOR] Failed to store video segments with multi-embeddings for ${videoPath}:`, error);
      throw error;
    }
  }

  /**
   * Store video segments in database with embeddings (legacy method)
   */
  private async storeVideoSegments(videoPath: string, segments: any[]): Promise<void> {
    console.log(`[VIDEO-JOB-PROCESSOR] Starting storeVideoSegments for ${videoPath} with ${segments?.length || 0} segments`);
    
    if (!segments || segments.length === 0) {
      console.warn(`[VIDEO-JOB-PROCESSOR] No segments provided for ${videoPath}, skipping storage`);
      return;
    }

    try {
      // Store video file first
      const videoFile = await this.videoDb.getVideoFileByPath(videoPath);
      if (!videoFile) {
        console.log(`[VIDEO-JOB-PROCESSOR] Creating video file entry for ${videoPath}`);
        await this.videoDb.addVideoFile({
          filePath: videoPath,
          fileName: videoPath.split('/').pop() || 'unknown',
          duration: segments[segments.length - 1]?.endTime || 0,
          frameRate: 30,
          fileSize: 0,
          totalSegments: segments.length,
          processingStatus: 'processing'
        });
      }

      // Prepare segments for batch insertion
      const segmentsToInsert = [];
      
      for (const segment of segments) {
        console.log(`[VIDEO-JOB-PROCESSOR] Processing segment for insertion:`, {
          startTime: segment.startTime,
          endTime: segment.endTime,
          hasTranscription: !!segment.transcription,
          hasCaption: !!segment.caption,
          hasReconstructedScene: !!segment.reconstructedScene
        });

        // Generate embedding from reconstructed scene or fallback content
        let embedding: Float32Array | undefined = undefined;
        const reconstructedScene = segment.reconstructedScene || '';
        const transcriptionText = segment.transcription?.text || segment.transcription || '';
        const captionText = segment.caption || '';
        
        const embeddingText = reconstructedScene || transcriptionText || captionText;
        
        if (embeddingText) {
          console.log(`[VIDEO-JOB-PROCESSOR] Generating embedding for segment (${embeddingText.length} chars)`);
          embedding = await this.embeddingService.embedSingle(embeddingText);
          console.log(`[VIDEO-JOB-PROCESSOR] Generated embedding of length ${embedding?.length || 0}`);
        }

        segmentsToInsert.push({
          videoPath: videoPath,
          startTime: segment.startTime,
          endTime: segment.endTime,
          duration: segment.endTime - segment.startTime,
          sceneIndex: segment.sceneIndex || 0,
          thumbnailPath: segment.thumbnailPath || null,
          keyframePath: segment.keyframePath || null,
          transcription: transcriptionText,
          caption: captionText,
          ocrText: segment.ocrText || null,
          embedding: embedding,
          metadata: segment.metadata || null,
          reconstructedScene: reconstructedScene
        });
      }

      console.log(`[VIDEO-JOB-PROCESSOR] Prepared ${segmentsToInsert.length} segments for insertion`);
      
      if (segmentsToInsert.length > 0) {
        const insertedIds = await this.videoDb.addVideoSegmentsBatch(segmentsToInsert);
        console.log(`[VIDEO-JOB-PROCESSOR] Successfully stored ${insertedIds.length} video segments`);
      }
      
    } catch (error) {
      console.error(`[VIDEO-JOB-PROCESSOR] Failed to store video segments for ${videoPath}:`, error);
      throw error;
    }
  }

  /**
   * Index video segments in the main search database for vector search
   */
  private async indexVideoSegmentsForSearch(videoPath: string, segments: any[]): Promise<void> {
    console.log(`[VIDEO-JOB-PROCESSOR] Indexing ${segments.length} video segments for search`);
    
    try {
      // Check if parent video exists in main database using path search
      const existingVideos = this.vectorDb.searchByPath(videoPath);
      
      if (existingVideos.length === 0) {
        console.log(`[VIDEO-JOB-PROCESSOR] Parent video not found, creating it in main DB`);
        // Create the parent video entry
        const videoName = videoPath.split('/').pop() || 'Unknown Video';
        const parentVideoId = await this.vectorDb.addMediaItemAsync({
          name: videoName,
          path: videoPath,
          type: 'video' as const,
          size: 0,
          sourceId: videoPath,
          createdAt: new Date(),
          updatedAt: new Date(),
          caption: '',
          captionStatus: 'pending' as const,
          embeddingStatus: 'pending' as const
        });
        console.log(`[VIDEO-JOB-PROCESSOR] Created parent video with ID: ${parentVideoId}`);
      } else {
        console.log(`[VIDEO-JOB-PROCESSOR] Parent video found in main DB: ${existingVideos[0].name}`);
      }
      
      for (const segment of segments) {
        const segmentName = `${videoPath} - Segment ${Math.floor(segment.startTime)}s-${Math.floor(segment.endTime)}s`;
        
        // Combine all text content for search
        const transcriptionText = segment.transcription?.text || segment.transcription || '';
        const captionText = segment.caption || '';
        const reconstructedText = segment.reconstructedScene || '';
        
        const searchableContent = [transcriptionText, captionText, reconstructedText]
          .filter(text => text && text.length > 0)
          .join(' ');
        
        console.log(`[VIDEO-JOB-PROCESSOR] Adding segment to search index:`);
        console.log(`[VIDEO-JOB-PROCESSOR] - Content length: ${searchableContent.length} characters`);
        console.log(`[VIDEO-JOB-PROCESSOR] - Contains "car": ${searchableContent.toLowerCase().includes('car')}`);
        console.log(`[VIDEO-JOB-PROCESSOR] - Content preview: "${searchableContent.substring(0, 100)}..."`);
        
        if (searchableContent.length > 0) {
          // Get the correct sourceId from the parent video
          const parentVideo = existingVideos[0];
          
          // Generate embedding for the searchable content
          console.log(`[VIDEO-JOB-PROCESSOR] Generating embedding for search content`);
          const searchEmbedding = await this.embeddingService.embedSingle(searchableContent);
          
          const segmentItemId = await this.vectorDb.addMediaItemAsync({
            name: segmentName,
            path: `${videoPath}#t=${segment.startTime},${segment.endTime}`,
            type: 'video_segment' as const,
            size: 0,
            sourceId: parentVideo.sourceId, // Use parent video's sourceId (references media_sources.id)
            createdAt: new Date(),
            updatedAt: new Date(),
            caption: searchableContent, // This will be used for embedding generation
            captionStatus: 'completed' as const,
            embedding: searchEmbedding, // Include the embedding
            embeddingStatus: 'completed' as const, // Mark as completed
            embeddingGeneratedAt: new Date() // Prevent background processor from picking it up
          });
          
          console.log(`[VIDEO-JOB-PROCESSOR] Successfully indexed segment with ID: ${segmentItemId}`);
        } else {
          console.warn(`[VIDEO-JOB-PROCESSOR] Skipping segment with no searchable content`);
        }
      }
      
      console.log(`[VIDEO-JOB-PROCESSOR] Completed indexing ${segments.length} video segments for search`);
      
    } catch (error) {
      console.error(`[VIDEO-JOB-PROCESSOR-ERROR] Failed to index video segments:`, error);
      throw error;
    }
  }

  /**
   * Merge processed content back into segments
   */
  private mergeProcessedContent(originalSegments: any[], processedSegments: any[], pipelineData: any): any[] {
    // Implementation copied from VideoMediaAPI
    const enrichedSegments = originalSegments.map((segment, index) => {
      const enriched = { ...segment };
      
      // Find corresponding processed segment
      const processedSegment = processedSegments.find(ps => 
        ps.segment && ps.segment.id === segment.id
      );
      
      if (processedSegment && processedSegment.data) {
        const data = processedSegment.data;
        
        // Merge transcription
        if (data.transcription) {
          enriched.transcription = data.transcription;
        }
        
        // Merge keyframes
        if (data.keyframes && data.keyframes.length > 0) {
          enriched.keyframePath = data.keyframes[0];
        }
      }
      
      // Merge batch captions
      const batchCaptions = pipelineData.batchCaptions || {};
      if (batchCaptions[segment.id] && batchCaptions[segment.id].length > 0) {
        enriched.caption = batchCaptions[segment.id][0].caption;
      }
      
      // Merge reconstructed scenes
      const reconstructedScenes = pipelineData.reconstructedScenes || {};
      if (reconstructedScenes[segment.id]) {
        enriched.reconstructedScene = reconstructedScenes[segment.id];
      }
      
      return enriched;
    });
    
    return enrichedSegments;
  }

  /**
   * Setup video pipeline with processors
   */
  private setupPipeline(): void {
    // Pipeline setup would be similar to VideoMediaAPI
    // For now, we'll assume it's already configured
    console.log(`[VIDEO-JOB-PROCESSOR] Video pipeline setup completed`);
  }
}
