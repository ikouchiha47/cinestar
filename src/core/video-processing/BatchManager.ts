import { VideoDatabase } from '../video-database';
import { SqliteJobsDatabase } from '../sqlite-jobs-database';
import { BatchProcessor } from '../processors/batch-processor';
import { TranscriptionProcessor } from '../processors/transcription-processor';
import { CaptioningCoordinator } from './CaptioningCoordinator';
import { EmbeddingCoordinator } from './EmbeddingCoordinator';
import { VideoProcessingContext, BatchProcessingResult, BatchCompletionStats } from './types';

/**
 * BatchManager
 * 
 * Responsibilities:
 * - Coordinate Phase 0 processing (transcription + audio-only indexing)
 * - Coordinate Phase 1 processing (keyframes + enhanced indexing)
 * - Track batch progress and completion
 * - Delegate to CaptioningCoordinator and EmbeddingCoordinator
 */
export class BatchManager {
  private videoDb: VideoDatabase; // Used for video file lookups
  private jobsDb?: SqliteJobsDatabase;
  private batchProcessor: BatchProcessor;
  private transcriptionProcessor: TranscriptionProcessor;
  private captioningCoordinator: CaptioningCoordinator;
  private embeddingCoordinator: EmbeddingCoordinator;

  constructor(
    videoDb: VideoDatabase,
    captioningCoordinator: CaptioningCoordinator,
    embeddingCoordinator: EmbeddingCoordinator,
    jobsDb?: SqliteJobsDatabase
  ) {
    this.videoDb = videoDb;
    this.jobsDb = jobsDb;
    this.captioningCoordinator = captioningCoordinator;
    this.embeddingCoordinator = embeddingCoordinator;
    
    // Initialize batch processor with jobsDb
    this.batchProcessor = new BatchProcessor(videoDb, '/tmp/drillbit_batches', 300, jobsDb);
    this.transcriptionProcessor = new TranscriptionProcessor();
    
    console.log('[BATCH-MANAGER] Initialized with 5-minute batch duration');
  }

  /**
   * Set the job run ID for batch processing
   * This must be called before processing batches
   */
  setJobRunId(jobRunId: string): void {
    // Update the batch processor with the current job run ID
    this.batchProcessor = new BatchProcessor(
      this.videoDb,
      '/tmp/drillbit_batches',
      300,
      this.jobsDb,
      jobRunId
    );
    console.log(`[BATCH-MANAGER] 📝 Set job run ID: ${jobRunId}`);
  }

  /**
   * Process Phase 0: Transcription and audio-only indexing
   * Creates batches, extracts audio, transcribes, and generates audio-only embeddings
   * Goal: Make video searchable within ~60 seconds
   */
  async processPhase0(context: VideoProcessingContext): Promise<BatchProcessingResult[]> {
    console.log(`[BATCH-MANAGER] 🚀 Starting Phase 0 for ${context.videoPath}`);
    
    // Set the job run ID for this processing session
    this.setJobRunId(context.jobId);
    
    try {
      // Get video duration first
      const videoFile = await this.videoDb.getVideoFileByPath(context.videoPath);
      const videoDuration = videoFile?.duration || 0;

      if (videoDuration === 0) {
        throw new Error(`Video duration not found for ${context.videoPath}`);
      }

      // Create audio batches (5-minute segments)
      const batches = await this.batchProcessor.createAudioBatches(
        context.videoId,
        context.videoPath,
        videoDuration
      );

      console.log(`[BATCH-MANAGER] Created ${batches.length} batches`);

      const results: BatchProcessingResult[] = [];

      // Process each batch
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        console.log(`[BATCH-MANAGER] Processing Phase 0 batch ${i + 1}/${batches.length}...`);

        try {
          // Transcribe batch
          const transcriptionResult = await this.transcriptionProcessor.transcribeBatch(batch);
          const transcription = transcriptionResult.text;
          console.log(`[BATCH-MANAGER] ✅ Transcribed batch ${i + 1}: ${transcription.substring(0, 50)}...`);

          // Generate audio-only embedding
          const embedding = await this.embeddingCoordinator.generateAudioEmbedding(transcription);
          console.log(`[BATCH-MANAGER] ✅ Generated audio embedding for batch ${i + 1}`);

          // Save transcription and embedding to database
          await this.batchProcessor.updateBatchTranscription(
            batch.id, 
            transcription, 
            Array.from(embedding),
            transcriptionResult.confidence
          );
          
          // Update batch status to 'audio_only'
          await this.batchProcessor.updateBatchStatus(batch.id, 'audio_only');

          // Add to results
          results.push({
            batchId: batch.id,
            videoPath: context.videoPath,
            startTime: batch.startTime,
            endTime: batch.endTime,
            phase0Complete: true,
            phase1Complete: false,
            transcription,
            embedding
          });

          console.log(`[BATCH-MANAGER] ✅ Phase 0 complete for batch ${i + 1}/${batches.length}`);
        } catch (error) {
          console.error(`[BATCH-MANAGER] ❌ Phase 0 failed for batch ${i + 1}:`, error);
          // Continue with other batches
        }
      }

      console.log(`[BATCH-MANAGER] ✅ Phase 0 complete: ${results.length}/${batches.length} batches processed`);
      return results;
    } catch (error) {
      console.error(`[BATCH-MANAGER] ❌ Phase 0 failed:`, error);
      throw error;
    }
  }

  /**
   * Process Phase 1: Keyframes and enhanced indexing
   * Extracts keyframes, generates captions, reconstructs scenes, and creates enhanced embeddings
   * Goal: Add rich visual context for better search quality
   */
  async processPhase1(context: VideoProcessingContext): Promise<BatchProcessingResult[]> {
    console.log(`[BATCH-MANAGER] 🎨 Starting Phase 1 for ${context.videoPath}`);

    // Set the job run ID for this processing session
    this.setJobRunId(context.jobId);

    try {
      // Get batches that completed Phase 0
      const batches = await this.batchProcessor.getBatchesForVideo(context.jobId);
      const phase0Batches = batches.filter(b => 
        b.status === 'audio_only' || b.status === 'enhanced' || b.status === 'complete'
      );

      console.log(`[BATCH-MANAGER] Found ${phase0Batches.length} batches ready for Phase 1`);

      const results: BatchProcessingResult[] = [];

      // Process each batch
      for (let i = 0; i < phase0Batches.length; i++) {
        const batch = phase0Batches[i];
        console.log(`[BATCH-MANAGER] Processing Phase 1 batch ${i + 1}/${phase0Batches.length}...`);

        try {
          // Extract keyframes (4 per batch at 0.2, 0.4, 0.6, 0.8 positions)
          console.log(`[BATCH-MANAGER] Extracting keyframes for batch ${i + 1}...`);
          const keyframes = await this.batchProcessor.extractBatchKeyframes(batch, context.videoPath);
          console.log(`[BATCH-MANAGER] ✅ Extracted ${keyframes.length} keyframes`);

          // Generate captions (with multi-pass if enabled)
          console.log(`[BATCH-MANAGER] Captioning keyframes for batch ${i + 1}...`);
          const captionedKeyframes = await this.captioningCoordinator.captionKeyframes(keyframes);
          console.log(`[BATCH-MANAGER] ✅ Captioned ${captionedKeyframes.length} keyframes`);

          // Scene reconstruction
          console.log(`[BATCH-MANAGER] Reconstructing scene for batch ${i + 1}...`);
          const sceneReconstruction = await this.captioningCoordinator.reconstructScene(
            batch.transcription || '',
            captionedKeyframes
          );
          console.log(`[BATCH-MANAGER] ✅ Scene reconstruction: ${sceneReconstruction.substring(0, 50)}...`);

          // Generate enhanced embedding
          console.log(`[BATCH-MANAGER] Generating enhanced embedding for batch ${i + 1}...`);
          const embedding = await this.embeddingCoordinator.generateEnhancedEmbedding(
            batch.transcription || '',
            captionedKeyframes,
            sceneReconstruction
          );
          console.log(`[BATCH-MANAGER] ✅ Generated enhanced embedding`);

          // Save visual captions to database
          const captions = captionedKeyframes.map(k => k.caption);
          await this.batchProcessor.updateBatchVisualData(batch.id, captions);
          
          // Save scene reconstruction to database
          await this.batchProcessor.updateBatchSceneReconstruction(batch.id, sceneReconstruction);
          
          // Update enhanced embedding (replaces audio-only embedding)
          await this.batchProcessor.updateBatchTranscription(
            batch.id,
            batch.transcription || '',
            Array.from(embedding)
          );

          // Update batch status to 'enhanced'
          await this.batchProcessor.updateBatchStatus(batch.id, 'enhanced');

          // Prepare multi-pass data
          const multiPassData = captionedKeyframes.length > 0 ? {
            caption: captionedKeyframes[0].caption,
            spatial: captionedKeyframes[0].spatial,
            temporal: captionedKeyframes[0].temporal,
            elements: captionedKeyframes.flatMap(k => k.elements || []),
            tokens: undefined
          } : undefined;

          // Add to results
          results.push({
            batchId: batch.id,
            videoPath: context.videoPath,
            startTime: batch.startTime,
            endTime: batch.endTime,
            phase0Complete: true,
            phase1Complete: true,
            transcription: batch.transcription,
            keyframes: captionedKeyframes,
            sceneReconstruction,
            embedding,
            multiPassData
          });

          console.log(`[BATCH-MANAGER] ✅ Phase 1 complete for batch ${i + 1}/${phase0Batches.length}`);
        } catch (error) {
          console.error(`[BATCH-MANAGER] ❌ Phase 1 failed for batch ${i + 1}:`, error);
          // Continue with other batches
        }
      }

      console.log(`[BATCH-MANAGER] ✅ Phase 1 complete: ${results.length}/${phase0Batches.length} batches processed`);
      return results;
    } catch (error) {
      console.error(`[BATCH-MANAGER] ❌ Phase 1 failed:`, error);
      throw error;
    }
  }

  /**
   * Get batch completion statistics
   * Returns counts of batches that completed Phase 0 and Phase 1
   */
  async getCompletedBatches(jobId: string): Promise<BatchCompletionStats> {
    try {
      const batches = await this.batchProcessor.getBatchesForVideo(jobId);

      const phase0Complete = batches.filter(b => 
        b.status === 'audio_only' || b.status === 'enhanced' || b.status === 'complete'
      ).length;

      const phase1Complete = batches.filter(b => 
        b.status === 'enhanced' || b.status === 'complete'
      ).length;

      return {
        phase0: phase0Complete,
        phase1: phase1Complete,
        totalBatches: batches.length
      };
    } catch (error) {
      console.error(`[BATCH-MANAGER] Failed to get completed batches for ${jobId}:`, error);
      return { phase0: 0, phase1: 0, totalBatches: 0 };
    }
  }

  /**
   * Resume processing from a specific phase
   * Useful for job recovery after failures
   */
  async resumeProcessing(context: VideoProcessingContext, fromPhase: 'phase0' | 'phase1'): Promise<{
    phase0Results: BatchProcessingResult[];
    phase1Results: BatchProcessingResult[];
  }> {
    console.log(`[BATCH-MANAGER] Resuming processing from ${fromPhase}...`);

    let phase0Results: BatchProcessingResult[] = [];
    let phase1Results: BatchProcessingResult[] = [];

    if (fromPhase === 'phase0') {
      // Resume from Phase 0
      phase0Results = await this.processPhase0(context);
      phase1Results = await this.processPhase1(context);
    } else {
      // Resume from Phase 1 (Phase 0 already complete)
      phase1Results = await this.processPhase1(context);
    }

    return { phase0Results, phase1Results };
  }

  /**
   * Get batch processing statistics
   */
  async getStats(jobId: string): Promise<{
    totalBatches: number;
    phase0Complete: number;
    phase1Complete: number;
    pending: number;
    failed: number;
  }> {
    try {
      const batches = await this.batchProcessor.getBatchesForVideo(jobId);

      return {
        totalBatches: batches.length,
        phase0Complete: batches.filter(b => 
          b.status === 'audio_only' || b.status === 'enhanced' || b.status === 'complete'
        ).length,
        phase1Complete: batches.filter(b => 
          b.status === 'enhanced' || b.status === 'complete'
        ).length,
        pending: batches.filter(b => b.status === 'pending').length,
        failed: batches.filter(b => b.status === 'failed').length
      };
    } catch (error) {
      console.error(`[BATCH-MANAGER] Failed to get stats for ${jobId}:`, error);
      return {
        totalBatches: 0,
        phase0Complete: 0,
        phase1Complete: 0,
        pending: 0,
        failed: 0
      };
    }
  }
}
