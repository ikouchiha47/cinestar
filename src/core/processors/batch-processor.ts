import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { promises as fs } from 'fs';
import { spawn } from 'child_process';
import { VideoDatabase } from '../video-database';
import { SqliteJobsDatabase } from '../sqlite-jobs-database';

export interface ProcessingBatch {
  id: string;
  videoId: string;
  batchIndex: number;
  batchType: 'audio' | 'visual' | 'keyframe';
  startTime: number;
  endTime: number;
  duration: number;
  outputPath: string;
  audioPath?: string;
  transcription?: string;
  embedding?: number[];
  visualCaptions?: string[];
  sceneContext?: any;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'audio_only' | 'enhanced' | 'complete';
  transcriptionConfidence?: number;
  visualConfidence?: number;
  sceneCoherence?: number;
  metadata?: any;
  createdAt: Date;
  updatedAt?: Date;
}

export interface TranscriptionSegment {
  id: string;
  batchId: string;
  segmentIndex: number;
  startTime: number;
  endTime: number;
  text: string;
  confidence?: number;
  speaker?: string;
  language?: string;
  embedding?: number[];
  metadata?: string;  // JSON string in DB
  createdAt?: Date;
}

export interface BatchKeyframe {
  id: string;
  batchId: string;
  keyframeIndex: number;
  timestamp: number;
  imagePath: string;
  caption?: string;
  captionConfidence?: number;
  description?: string;
  metadata?: any;
}

export class BatchProcessor {
  private videoDb: VideoDatabase;
  private jobsDb?: SqliteJobsDatabase;
  private jobRunId?: string;
  private tempDir: string;
  private batchDuration: number;

  constructor(
    videoDb: VideoDatabase,
    tempDir: string = '/tmp/drillbit_batches',
    batchDuration: number = 300,
    jobsDb?: SqliteJobsDatabase,
    jobRunId?: string
  ) {
    this.videoDb = videoDb;
    this.jobsDb = jobsDb;
    this.jobRunId = jobRunId;
    this.tempDir = tempDir;
    this.batchDuration = batchDuration; // 5 minutes default
    
    if (jobsDb && jobRunId) {
      console.log('[BATCH-PROCESSOR] ✅ Using jobs.db for batch storage (job_run_id:', jobRunId, ')');
    } else {
      console.log('[BATCH-PROCESSOR] ⚠️ Using legacy video-rag.db for batch storage');
    }
  }

  /**
   * Get the appropriate database for batch operations
   */
  private getDb(): Database.Database {
    return this.jobsDb?.db || this.videoDb.database;
  }

  /**
   * Create audio batches for immediate processing
   */
  async createAudioBatches(videoId: string, videoPath: string, videoDuration: number): Promise<ProcessingBatch[]> {
    console.log(`[BATCH-PROCESSOR] Creating audio batches for video ${videoId} (${videoDuration}s)`);
    
    await fs.mkdir(this.tempDir, { recursive: true });
    
    const batchCount = Math.ceil(videoDuration / this.batchDuration);
    const batches: ProcessingBatch[] = [];
    
    for (let i = 0; i < batchCount; i++) {
      const startTime = i * this.batchDuration;
      const remainingTime = videoDuration - startTime;
      const actualDuration = Math.min(this.batchDuration, remainingTime);
      const endTime = startTime + actualDuration;
      
      const batchId = uuidv4();
      const audioPath = path.join(this.tempDir, `${batchId}.wav`);
      
      // Extract audio segment
      await this.extractAudioSegment(videoPath, startTime, actualDuration, audioPath);
      
      const batch: ProcessingBatch = {
        id: batchId,
        videoId,
        batchIndex: i,
        batchType: 'audio',
        startTime,
        endTime,
        duration: actualDuration,
        outputPath: audioPath,
        audioPath,
        status: 'audio_only',
        createdAt: new Date()
      };
      
      batches.push(batch);
      
      // Store in database immediately
      await this.storeBatch(batch);
      
      console.log(`[BATCH-PROCESSOR] Created batch ${i + 1}/${batchCount}: ${startTime.toFixed(1)}s-${endTime.toFixed(1)}s`);
    }
    
    return batches;
  }

  /**
   * Extract audio segment using FFmpeg
   */
  private async extractAudioSegment(videoPath: string, startTime: number, duration: number, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [
        '-i', videoPath,
        '-ss', startTime.toString(),
        '-t', duration.toString(),
        '-acodec', 'pcm_s16le',
        '-ac', '1',
        '-ar', '16000',
        '-f', 'wav',
        '-y', // Overwrite output file
        outputPath
      ];

      const ffmpeg = spawn('ffmpeg', args);

      ffmpeg.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`FFmpeg failed with code ${code}`));
        }
      });

      ffmpeg.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Store batch in database (jobs.db if available, otherwise video-rag.db)
   */
  async storeBatch(batch: ProcessingBatch): Promise<void> {
    const db = this.jobsDb?.db || this.videoDb.database;
    const tableName = 'processing_batches';
    
    // For jobs.db, include job_run_id
    if (this.jobsDb && this.jobRunId) {
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO ${tableName} (
          id, job_run_id, video_id, batch_index, start_time, end_time, duration, audio_path,
          transcription, embedding, visual_captions, scene_context,
          status, transcription_confidence, visual_confidence, scene_coherence,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        batch.id,
        this.jobRunId,
        batch.videoId,
        batch.batchIndex,
        batch.startTime,
        batch.endTime,
        batch.duration,
        batch.audioPath || null,
        batch.transcription || null,
        batch.embedding ? Buffer.from(new Float32Array(batch.embedding).buffer) : null,
        batch.visualCaptions ? JSON.stringify(batch.visualCaptions) : null,
        batch.sceneContext ? JSON.stringify(batch.sceneContext) : null,
        batch.status,
        batch.transcriptionConfidence || null,
        batch.visualConfidence || null,
        batch.sceneCoherence || null,
        batch.createdAt.toISOString(),
        batch.updatedAt ? batch.updatedAt.toISOString() : null
      );
    } else {
      // Legacy: video-rag.db (no job_run_id column)
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO ${tableName} (
          id, video_id, batch_index, start_time, end_time, duration, audio_path,
          transcription, embedding, visual_captions, scene_context,
          status, transcription_confidence, visual_confidence, scene_coherence,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        batch.id,
        batch.videoId,
        batch.batchIndex,
        batch.startTime,
        batch.endTime,
        batch.duration,
        batch.audioPath || null,
        batch.transcription || null,
        batch.embedding ? Buffer.from(new Float32Array(batch.embedding).buffer) : null,
        batch.visualCaptions ? JSON.stringify(batch.visualCaptions) : null,
        batch.sceneContext ? JSON.stringify(batch.sceneContext) : null,
        batch.status,
        batch.transcriptionConfidence || null,
        batch.visualConfidence || null,
        batch.sceneCoherence || null,
        batch.createdAt.toISOString(),
        batch.updatedAt ? batch.updatedAt.toISOString() : null
      );
    }
  }

  /**
   * Update batch with transcription results
   */
  async updateBatchTranscription(batchId: string, transcription: string, embedding: number[], confidence?: number): Promise<void> {
    const stmt = this.getDb().prepare(`
      UPDATE processing_batches 
      SET transcription = ?, embedding = ?, transcription_confidence = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    stmt.run(
      transcription,
      Buffer.from(new Float32Array(embedding).buffer),
      confidence,
      batchId
    );

    console.log(`[BATCH-PROCESSOR] Updated batch ${batchId} with transcription (${transcription.length} chars)`);
  }

  /**
   * Store transcription segments with precise timing
   */
  async storeTranscriptionSegments(batchId: string, segments: any[]): Promise<void> {
    if (!segments || segments.length === 0) return;

    const stmt = this.getDb().prepare(`
      INSERT INTO transcription_segments (
        id, batch_id, segment_index, start_time, end_time, text, confidence
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const segmentId = uuidv4();
      
      stmt.run(
        segmentId,
        batchId,
        i,
        segment.start || 0,
        segment.end || 0,
        segment.text || '',
        segment.confidence || null
      );
    }

    console.log(`[BATCH-PROCESSOR] Stored ${segments.length} transcription segments for batch ${batchId}`);
  }

  /**
   * Update batch status
   */
  async updateBatchStatus(batchId: string, status: ProcessingBatch['status']): Promise<void> {
    const stmt = this.getDb().prepare(`
      UPDATE processing_batches 
      SET status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    stmt.run(status, batchId);
    console.log(`[BATCH-PROCESSOR] Updated batch ${batchId} status to ${status}`);
  }

  /**
   * Insert a batch record into the processing_batches table
   */
  insertBatch(batch: {
    id: string;
    video_id: string;
    batch_index: number;
    batch_type: string;
    start_time: number;
    end_time: number;
    duration: number;
    transcription: string;
    embedding: string | null;
  }): string {
    console.log(`[BATCH-PROCESSOR] Inserting batch record for video ${batch.video_id} (${batch.start_time}s-${batch.end_time}s)`);
    
    try {
      // IDEMPOTENCY: Check if batch already exists for same video and time range
      const existingBatch = this.getDb().prepare(`
        SELECT id FROM processing_batches 
        WHERE video_id = ? AND start_time = ? AND end_time = ?
      `).get(batch.video_id, batch.start_time, batch.end_time) as {id: string} | undefined;
      
      if (existingBatch) {
        console.log(`[BATCH-PROCESSOR] 🔄 IDEMPOTENCY: Batch already exists for ${batch.video_id} (${batch.start_time}s-${batch.end_time}s), returning existing ID: ${existingBatch.id}`);
        return existingBatch.id;
      }

      // For jobs.db, include job_run_id
      if (this.jobsDb && this.jobRunId) {
        const stmt = this.getDb().prepare(`
          INSERT INTO processing_batches (
            id, job_run_id, video_id, batch_index, batch_type, start_time, end_time, duration,
            transcription, embedding, status, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'audio_only', CURRENT_TIMESTAMP)
        `);
        
        stmt.run(
          batch.id,
          this.jobRunId,
          batch.video_id,
          batch.batch_index,
          batch.batch_type,
          batch.start_time,
          batch.end_time,
          batch.duration,
          batch.transcription,
          batch.embedding
        );
      } else {
        // Legacy: video-rag.db (no job_run_id column)
        const stmt = this.getDb().prepare(`
          INSERT INTO processing_batches (
            id, video_id, batch_index, batch_type, start_time, end_time, duration,
            transcription, embedding, status, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'audio_only', CURRENT_TIMESTAMP)
        `);
        
        stmt.run(
          batch.id,
          batch.video_id,
          batch.batch_index,
          batch.batch_type,
          batch.start_time,
          batch.end_time,
          batch.duration,
          batch.transcription,
          batch.embedding
        );
      }
      
      console.log(`[BATCH-PROCESSOR] ✅ Inserted new batch record with ID: ${batch.id}`);
      return batch.id;
    } catch (error) {
      console.error(`[BATCH-PROCESSOR] ❌ Failed to insert batch record:`, error);
      throw error;
    }
  }

  /**
   * Get batches for a video
   */
  async getBatchesForVideo(videoId: string, batchType?: string): Promise<ProcessingBatch[]> {
    console.log(`[BATCH-PROCESSOR] Getting batches for video ${videoId}, type ${batchType || 'all'}`);
    console.log(`[BATCH-PROCESSOR] Using ${this.jobsDb ? 'jobs.db' : 'video-rag.db'}`);
    
    try {
      // NEW SYSTEM (jobs.db): Query by job_run_id
      // The videoId parameter is actually the jobId in the new system
      if (this.jobsDb && this.jobRunId) {
        console.log(`[BATCH-PROCESSOR] Querying jobs.db by job_run_id = ${videoId}`);
        const query = batchType 
          ? `SELECT * FROM processing_batches WHERE job_run_id = ? AND batch_type = ? ORDER BY start_time`
          : `SELECT * FROM processing_batches WHERE job_run_id = ? ORDER BY start_time`;
        
        const params = batchType ? [videoId, batchType] : [videoId];
        const rows = this.getDb().prepare(query).all(...params) as any[];
        console.log(`[BATCH-PROCESSOR] Found ${rows.length} batches in jobs.db`);
        return rows.map(row => this.mapRowToBatch(row));
      }
      
      // LEGACY SYSTEM (video-rag.db): Query by video_id
      console.log(`[BATCH-PROCESSOR] Querying video-rag.db by video_id = ${videoId}`);
      const query = batchType 
        ? `SELECT * FROM processing_batches WHERE video_id = ? AND batch_type = ? ORDER BY start_time`
        : `SELECT * FROM processing_batches WHERE video_id = ? ORDER BY start_time`;
      
      const params = batchType ? [videoId, batchType] : [videoId];
      const rows = this.getDb().prepare(query).all(...params) as any[];
      
      console.log(`[BATCH-PROCESSOR] Found ${rows.length} batches for video ${videoId}`);
      
      return rows.map(row => ({
        id: row.id,
        videoId: row.video_id,
        batchIndex: row.batch_index,
        batchType: row.batch_type,
        startTime: row.start_time,
        endTime: row.end_time,
        duration: row.duration,
        outputPath: row.output_path,
        status: row.status,
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
        createdAt: new Date(row.created_at)
      }));
    } catch (error) {
      console.error(`[BATCH-PROCESSOR] Error getting batches for video ${videoId}:`, error);
      return [];
    }
  }

  /**
   * Get batch by ID
   */
  async getBatch(batchId: string): Promise<ProcessingBatch | null> {
    const stmt = this.getDb().prepare(`
      SELECT * FROM processing_batches WHERE id = ?
    `);

    const row = stmt.get(batchId);
    return row ? this.mapRowToBatch(row) : null;
  }

  /**
   * Get batches ready for search (have embeddings)
   */
  async getSearchableBatches(videoId?: string): Promise<ProcessingBatch[]> {
    const stmt = videoId 
      ? this.getDb().prepare(`
          SELECT * FROM processing_batches 
          WHERE video_id = ? AND embedding IS NOT NULL 
          ORDER BY batch_index
        `)
      : this.getDb().prepare(`
          SELECT * FROM processing_batches 
          WHERE embedding IS NOT NULL 
          ORDER BY video_id, batch_index
        `);

    const rows = videoId ? stmt.all(videoId) : stmt.all();
    return rows.map(row => this.mapRowToBatch(row));
  }

  /**
   * Cleanup audio files for completed batches
   */
  async cleanupAudioFiles(videoId: string): Promise<void> {
    const batches = await this.getBatchesForVideo(videoId);
    
    for (const batch of batches) {
      if (batch.audioPath) {
        try {
          await fs.unlink(batch.audioPath);
          console.log(`[BATCH-PROCESSOR] Cleaned up audio file: ${batch.audioPath}`);
        } catch (error) {
          console.warn(`[BATCH-PROCESSOR] Failed to cleanup audio file: ${batch.audioPath}`, error);
        }
      }
    }
  }

  // DEPRECATED: These search methods are not used in production.
  // Production search uses av-modality-vec-database.ts with sqlite-vec for performance.
  // Keeping commented for reference in case single-video batch search is needed.
  
  /*
  async searchBatches(queryEmbedding: number[], limit: number = 10): Promise<Array<{
    batch: ProcessingBatch;
    similarity: number;
    timeRange: string;
  }>> {
    const stmt = this.getDb().prepare(`
      SELECT 
        pb.*,
        v.file_path as video_path,
        v.file_name as video_name
      FROM processing_batches pb
      JOIN videos v ON pb.video_id = v.id
      WHERE pb.embedding IS NOT NULL
      ORDER BY pb.video_id, pb.batch_index
    `);

    const rows = stmt.all();
    const results: Array<{batch: ProcessingBatch; similarity: number; timeRange: string}> = [];

    for (const row of rows) {
      if (!row.embedding) continue;

      const batchEmbedding = Array.from(new Float32Array(row.embedding.buffer));
      const similarity = this.cosineSimilarity(queryEmbedding, batchEmbedding);

      const batch = this.mapRowToBatch(row);
      const timeRange = `${this.formatTime(batch.startTime)}-${this.formatTime(batch.endTime)}`;

      results.push({
        batch,
        similarity,
        timeRange
      });
    }

    return results
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  async searchSegments(queryEmbedding: number[], limit: number = 20): Promise<Array<{
    segment: TranscriptionSegment;
    batch: ProcessingBatch;
    similarity: number;
    timeRange: string;
    videoPath: string;
    videoName: string;
  }>> {
    const stmt = this.getDb().prepare(`
      SELECT 
        ts.*,
        pb.video_id,
        pb.batch_index,
        pb.start_time as batch_start,
        pb.end_time as batch_end,
        pb.transcription as batch_transcription,
        v.file_path as video_path,
        v.file_name as video_name
      FROM transcription_segments ts
      JOIN processing_batches pb ON ts.batch_id = pb.id
      JOIN videos v ON pb.video_id = v.id
      WHERE ts.embedding IS NOT NULL
      ORDER BY ts.start_time
    `);

    const rows = stmt.all();
    const results: Array<{
      segment: TranscriptionSegment;
      batch: ProcessingBatch;
      similarity: number;
      timeRange: string;
      videoPath: string;
      videoName: string;
    }> = [];

    for (const row of rows) {
      if (!row.embedding) continue;

      const segmentEmbedding = Array.from(new Float32Array(row.embedding.buffer));
      const similarity = this.cosineSimilarity(queryEmbedding, segmentEmbedding);

      const segment: TranscriptionSegment = {
        id: row.id,
        batchId: row.batch_id,
        segmentIndex: row.segment_index,
        startTime: row.start_time,
        endTime: row.end_time,
        text: row.text,
        confidence: row.confidence,
        embedding: segmentEmbedding
      };

      const batch: ProcessingBatch = {
        id: row.batch_id,
        videoId: row.video_id,
        batchIndex: row.batch_index,
        startTime: row.batch_start,
        endTime: row.batch_end,
        transcription: row.batch_transcription,
        status: 'audio_only'
      };

      const timeRange = `${this.formatTime(segment.startTime)}-${this.formatTime(segment.endTime)}`;

      results.push({
        segment,
        batch,
        similarity,
        timeRange,
        videoPath: row.video_path,
        videoName: row.video_name
      });
    }

    return results
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
  */

  /**
   * Format time in MM:SS format
   */
  private formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Extract 4 keyframes per batch (evenly distributed across 5-minute segment)
   */
  async extractBatchKeyframes(batch: ProcessingBatch, videoPath: string): Promise<BatchKeyframe[]> {
    const keyframes: BatchKeyframe[] = [];
    const duration = batch.endTime - batch.startTime;
    
    // Extract 4 keyframes evenly distributed across the batch
    const keyframeTimes = [
      batch.startTime + (duration * 0.2),  // 20% into batch
      batch.startTime + (duration * 0.4),  // 40% into batch  
      batch.startTime + (duration * 0.6),  // 60% into batch
      batch.startTime + (duration * 0.8)   // 80% into batch
    ];

    console.log(`[BATCH-PROCESSOR] Extracting 4 keyframes for batch ${batch.batchIndex} at times: ${keyframeTimes.map(t => t.toFixed(1)).join(', ')}`);

    for (let i = 0; i < keyframeTimes.length; i++) {
      const timestamp = keyframeTimes[i];
      const keyframeId = `${batch.id}_keyframe_${i}`;
      const imagePath = path.join(this.tempDir, `${keyframeId}.jpg`);

      try {
        // Extract keyframe using FFmpeg
        await this.extractKeyframeAtTime(videoPath, timestamp, imagePath);
        
        const keyframe: BatchKeyframe = {
          id: keyframeId,
          batchId: batch.id,
          keyframeIndex: i,
          timestamp,
          imagePath
        };

        keyframes.push(keyframe);
        
        // Store in database
        await this.storeBatchKeyframe(keyframe);
        
        console.log(`[BATCH-PROCESSOR] ✅ Extracted keyframe ${i + 1}/4 at ${timestamp.toFixed(1)}s`);

      } catch (error) {
        console.error(`[BATCH-PROCESSOR] ❌ Failed to extract keyframe ${i} at ${timestamp.toFixed(1)}s:`, error);
      }
    }

    return keyframes;
  }

  /**
   * Extract keyframe at specific time using FFmpeg
   */
  private async extractKeyframeAtTime(videoPath: string, timestamp: number, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [
        '-i', videoPath,
        '-ss', timestamp.toString(),
        '-vframes', '1',
        '-q:v', '2',
        '-y', // Overwrite output file
        outputPath
      ];

      const ffmpeg = spawn('ffmpeg', args);

      ffmpeg.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`FFmpeg keyframe extraction failed with code ${code}`));
        }
      });

      ffmpeg.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Store batch keyframe in database
   */
  async storeBatchKeyframe(keyframe: BatchKeyframe): Promise<void> {
    const stmt = this.getDb().prepare(`
      INSERT INTO batch_keyframes (
        id, batch_id, keyframe_index, timestamp, image_path, created_at
      ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);

    stmt.run(
      keyframe.id,
      keyframe.batchId,
      keyframe.keyframeIndex,
      keyframe.timestamp,
      keyframe.imagePath
    );
  }

  /**
   * Get keyframes for a batch
   */
  async getBatchKeyframes(batchId: string): Promise<BatchKeyframe[]> {
    const stmt = this.getDb().prepare(`
      SELECT * FROM batch_keyframes 
      WHERE batch_id = ? 
      ORDER BY keyframe_index
    `);

    const rows = stmt.all(batchId);
    return rows.map((row: any) => ({
      id: row.id,
      batchId: row.batch_id,
      keyframeIndex: row.keyframe_index,
      timestamp: row.timestamp,
      imagePath: row.image_path,
      caption: row.caption,
      captionConfidence: row.caption_confidence
    }));
  }

  /**
   * Update batch keyframe with caption
   */
  async updateKeyframeCaption(keyframeId: string, caption: string, confidence?: number): Promise<void> {
    const stmt = this.getDb().prepare(`
      UPDATE batch_keyframes 
      SET caption = ?, caption_confidence = ?
      WHERE id = ?
    `);

    stmt.run(caption, confidence, keyframeId);
    console.log(`[BATCH-PROCESSOR] Updated keyframe ${keyframeId} with caption`);
  }

  /**
   * Update batch with visual data (keyframes + captions)
   */
  async updateBatchVisualData(batchId: string, visualCaptions: string[], visualConfidence?: number): Promise<void> {
    const stmt = this.getDb().prepare(`
      UPDATE processing_batches 
      SET visual_captions = ?, visual_confidence = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    stmt.run(
      JSON.stringify(visualCaptions),
      visualConfidence,
      batchId
    );

    console.log(`[BATCH-PROCESSOR] Updated batch ${batchId} with ${visualCaptions.length} visual captions`);
  }

  /**
   * Update batch with scene reconstruction
   */
  async updateBatchSceneReconstruction(batchId: string, sceneContext: any, sceneCoherence?: number): Promise<void> {
    const stmt = this.getDb().prepare(`
      UPDATE processing_batches 
      SET scene_context = ?, scene_coherence = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    stmt.run(
      JSON.stringify(sceneContext),
      sceneCoherence,
      batchId
    );

    console.log(`[BATCH-PROCESSOR] Updated batch ${batchId} with scene reconstruction`);
  }

  /**
   * Map database row to ProcessingBatch object
   */
  private mapRowToBatch(row: any): ProcessingBatch {
    return {
      id: row.id,
      videoId: row.video_id,
      batchIndex: row.batch_index,
      batchType: row.batch_type || 'audio',
      startTime: row.start_time,
      endTime: row.end_time,
      duration: row.duration || (row.end_time - row.start_time),
      outputPath: row.output_path || row.audio_path,
      audioPath: row.audio_path,
      transcription: row.transcription,
      embedding: row.embedding ? Array.from(new Float32Array(row.embedding.buffer)) : undefined,
      visualCaptions: row.visual_captions ? JSON.parse(row.visual_captions) : undefined,
      sceneContext: row.scene_context ? JSON.parse(row.scene_context) : undefined,
      status: row.status,
      transcriptionConfidence: row.transcription_confidence,
      visualConfidence: row.visual_confidence,
      sceneCoherence: row.scene_coherence,
      createdAt: new Date(row.created_at)
    };
  }
}
