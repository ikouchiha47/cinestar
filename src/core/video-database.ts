import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { EmbeddingService } from './embedding-service';
import { getDataDir } from './utils/data-dir';
import { UnifiedMigrator } from './unified-migrator';

export interface VideoSegment {
  id: string;
  videoPath: string;
  startTime: number;
  endTime: number;
  duration: number;
  sceneIndex: number;
  thumbnailPath?: string;
  keyframePath?: string;
  audioPath?: string;
  transcription?: string;
  caption?: string;
  ocrText?: string;
  reconstructedScene?: string;
  embedding?: Float32Array;
  metadata?: Record<string, any>;
  createdAt: Date;
}

export interface VideoFile {
  id: string;
  filePath: string;
  fileName: string;
  fileSize: number;
  duration: number;
  width?: number;
  height?: number;
  frameRate?: number;
  bitrate?: number;
  codec?: string;
  totalSegments: number;
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed';
  processingError?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface VideoProcessingJob {
  id: string;
  videoPath: string;
  fileName: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'scheduled';
  progress: number;
  error?: string;
  startTime?: Date;
  endTime?: Date;
  segmentCount?: number;
  totalSegments?: number;
  currentStage?: string;
  // Progressive refinement fields
  refinementPass?: number;
  threshold?: number;
  parentJobId?: string;
  triggerCondition?: 'immediate' | 'delayed' | 'conditional';
  scheduledAt?: Date;
  // Batch processing notification fields
  metadata?: string;        // JSON string for batch processing metadata
  statusMessage?: string;   // User-friendly status message for notifications
  createdAt: Date;
  updatedAt: Date;
}

export interface SearchResult {
  segment: VideoSegment;
  video: VideoFile;
  score: number;
  matchType: 'text' | 'vector' | 'hybrid';
  snippet?: string;
}

export class VideoDatabase {
  private db: Database.Database;
  private dbPath: string;
  private initialized = false;
  // private embeddingService: EmbeddingService; // Commented out to fix compilation
  // Global init cache to avoid re-running migrations across multiple instances
  private static globalInitPromises: Map<string, Promise<void>> = new Map();
  private static globallyInitialized: Set<string> = new Set();

  /**
   * Get the underlying database instance for advanced operations
   * Used by BatchProcessor and other components that need direct SQL access
   */
  get database(): Database.Database {
    return this.db;
  }

  constructor(_embeddingService?: EmbeddingService) {
    // Use the same data directory as the main app
    const baseDir = getDataDir();
    this.dbPath = path.join(baseDir, 'video-rag.db');

    // Ensure base directory exists
    fs.mkdirSync(baseDir, { recursive: true });

    this.db = new Database(this.dbPath);

    // Initialize embedding service
    // this.embeddingService = embeddingService; // Commented out to fix compilation || new EmbeddingService();

    // Enable WAL mode for better performance
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('cache_size = 10000');
  }

  async getRefinedKeyframesMissingCaption(limit = 50): Promise<Array<{ id: string; videoId: string; segmentId: string; imagePath: string; label: string }>> {
    const stmt = this.db.prepare(`
      SELECT id, video_id, segment_id, image_path, label
      FROM video_keyframes
      WHERE caption IS NULL OR TRIM(caption) = ''
      ORDER BY created_at ASC
      LIMIT ?
    `);
    const rows = stmt.all(limit) as any[];
    return rows.map(r => ({ id: r.id, videoId: r.video_id, segmentId: r.segment_id, imagePath: r.image_path, label: r.label }));
  }

  async updateRefinedKeyframeCaption(id: string, caption: string): Promise<void> {
    const stmt = this.db.prepare(`UPDATE video_keyframes SET caption = ? WHERE id = ?`);
    stmt.run(caption, id);
  }

  async getRefinedKeyframesMissingEmbedding(limit = 64): Promise<Array<{ id: string; caption: string }>> {
    const stmt = this.db.prepare(`
      SELECT id, caption
      FROM video_keyframes
      WHERE caption IS NOT NULL AND TRIM(caption) <> '' AND embedding IS NULL
      ORDER BY created_at ASC
      LIMIT ?
    `);
    const rows = stmt.all(limit) as any[];
    return rows.map(r => ({ id: r.id, caption: r.caption }));
  }

  async updateRefinedKeyframeEmbedding(id: string, embedding: Float32Array): Promise<void> {
    const stmt = this.db.prepare(`UPDATE video_keyframes SET embedding = ? WHERE id = ?`);
    stmt.run(Buffer.from(embedding.buffer), id);
  }

  // Refined keyframes operations
  async addRefinedKeyframe(params: { videoId: string; segmentId: string; imagePath: string; label: string; caption?: string; embedding?: Float32Array | null; }): Promise<string> {
    const id = `kfr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const stmt = this.db.prepare(`
      INSERT INTO video_keyframes (id, video_id, segment_id, image_path, label, caption, embedding)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      params.videoId,
      params.segmentId,
      params.imagePath,
      params.label,
      params.caption ?? null,
      params.embedding ? Buffer.from(params.embedding.buffer) : null
    );
    return id;
  }

  async addRefinedKeyframesBatch(rows: Array<{ videoId: string; segmentId: string; imagePath: string; label: string; caption?: string; embedding?: Float32Array | null; }>): Promise<string[]> {
    const stmt = this.db.prepare(`
      INSERT INTO video_keyframes (id, video_id, segment_id, image_path, label, caption, embedding)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const tx = this.db.transaction((items: any[]) => {
      const ids: string[] = [];
      for (const r of items) {
        const id = `kfr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        ids.push(id);
        stmt.run(
          id,
          r.videoId,
          r.segmentId,
          r.imagePath,
          r.label,
          r.caption ?? null,
          r.embedding ? Buffer.from(r.embedding.buffer) : null
        );
      }
      return ids;
    });
    return tx(rows);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // If this DB path has already been initialized globally, just mark this instance and return
    if (VideoDatabase.globallyInitialized.has(this.dbPath)) {
      this.initialized = true;
      return;
    }

    // If another instance is already initializing this DB path, await it
    const existing = VideoDatabase.globalInitPromises.get(this.dbPath);
    if (existing) {
      await existing;
      this.initialized = true;
      return;
    }

    // Create a shared initialization promise so concurrent callers don't duplicate work
    const initPromise = (async () => {
      try {
        // Use unified migration system for schema management
        const migrator = new UnifiedMigrator(path.dirname(this.dbPath));

        console.log('VideoDatabase: Running unified migrations...');
        const result = await migrator.migrate();

        if (!result.success) {
          throw new Error(`Video database migration failed: ${result.error}`);
        }

        if (result.migrationsRun.length > 0) {
          console.log(`VideoDatabase: Applied ${result.migrationsRun.length} migrations`);
        }

        VideoDatabase.globallyInitialized.add(this.dbPath);
        console.log('VideoDatabase initialized at:', this.dbPath);
      } catch (error) {
        console.error('Failed to initialize VideoDatabase:', error);
        throw error;
      }
    })();

    VideoDatabase.globalInitPromises.set(this.dbPath, initPromise);
    try {
      await initPromise;
      this.initialized = true;
    } finally {
      VideoDatabase.globalInitPromises.delete(this.dbPath);
    }
  }


  // Video file operations
  async addVideoFile(video: Omit<VideoFile, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    const id = `video_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const stmt = this.db.prepare(`
      INSERT INTO video_files (
        id, file_path, file_name, file_size, duration, width, height,
        frame_rate, bitrate, codec, total_segments, processing_status, processing_error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    try {
      stmt.run(
        id, video.filePath, video.fileName, video.fileSize, video.duration,
        video.width, video.height, video.frameRate, video.bitrate, video.codec,
        video.totalSegments, video.processingStatus, video.processingError
      );
      return id;
    } catch (e: any) {
      const message = String(e?.message || e);
      if (message.includes('UNIQUE') && message.includes('video_files.file_path')) {
        // Row exists: return existing id and update basic fields
        const existing = await this.getVideoFileByPath(video.filePath);
        if (existing) {
          await this.updateVideoFile(existing.id, {
            fileName: video.fileName,
            fileSize: video.fileSize,
            duration: video.duration,
            width: video.width,
            height: video.height,
            frameRate: video.frameRate,
            bitrate: video.bitrate,
            codec: video.codec,
            totalSegments: video.totalSegments ?? existing.totalSegments,
            processingStatus: video.processingStatus ?? existing.processingStatus,
            processingError: undefined,
          });
          return existing.id;
        }
      }
      throw e;
    }
  }

  async getVideoFile(id: string): Promise<VideoFile | undefined> {
    const stmt = this.db.prepare('SELECT * FROM video_files WHERE id = ?');
    const row = stmt.get(id) as any;
    return row ? this.mapVideoFileRow(row) : undefined;
  }

  async getVideoFileByPath(filePath: string): Promise<VideoFile | undefined> {
    const stmt = this.db.prepare('SELECT * FROM video_files WHERE file_path = ?');
    const row = stmt.get(filePath) as any;
    return row ? this.mapVideoFileRow(row) : undefined;
  }

  async resetFailedVideo(videoId: string): Promise<void> {
    const stmt = this.db.prepare(`
      UPDATE video_files 
      SET processing_status = 'pending', processing_error = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    stmt.run(videoId);
    
    // Also delete any partial segments for this video
    const deleteSegments = this.db.prepare('DELETE FROM video_segments WHERE video_id = ?');
    deleteSegments.run(videoId);
  }

  async resetFailedVideoByPath(filePath: string): Promise<boolean> {
    const video = await this.getVideoFileByPath(filePath);
    if (video && video.processingStatus === 'failed') {
      await this.resetFailedVideo(video.id);
      return true;
    }
    return false;
  }

  async getFailedVideos(): Promise<VideoFile[]> {
    const stmt = this.db.prepare('SELECT * FROM video_files WHERE processing_status = ?');
    const rows = stmt.all('failed') as any[];
    return rows.map(row => this.mapVideoFileRow(row));
  }

  async getSegmentCount(videoId: string): Promise<number> {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM video_segments WHERE video_id = ?');
    const result = stmt.get(videoId) as any;
    return result.count;
  }

  async updateVideoFile(id: string, updates: Partial<VideoFile>): Promise<void> {
    const fields = Object.keys(updates).filter(key => key !== 'id' && key !== 'createdAt');
    if (fields.length === 0) return;

    const setClause = fields.map(field => `${this.camelToSnake(field)} = ?`).join(', ');
    const values = fields.map(field => (updates as any)[field]);
    values.push(new Date().toISOString()); // updatedAt
    values.push(id);

    const stmt = this.db.prepare(`
      UPDATE video_files SET ${setClause}, updated_at = ? WHERE id = ?
    `);
    stmt.run(...values);
  }

  // Video segment operations
  async addVideoSegment(segment: Omit<VideoSegment, 'id' | 'createdAt'>): Promise<string> {
    const id = `segment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const stmt = this.db.prepare(`
      INSERT INTO video_segments (
        id, video_id, video_path, start_time, end_time, duration, scene_index,
        thumbnail_path, keyframe_path, transcription, caption, ocr_text,
        embedding, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Get video_id from video_path
    const videoFile = await this.getVideoFileByPath(segment.videoPath);
    const videoId = videoFile?.id || 'unknown';

    stmt.run(
      id, videoId, segment.videoPath, segment.startTime, segment.endTime,
      segment.duration, segment.sceneIndex, segment.thumbnailPath,
      segment.keyframePath, segment.transcription, segment.caption,
      segment.ocrText, segment.embedding ? Buffer.from(segment.embedding.buffer) : null,
      segment.metadata ? JSON.stringify(segment.metadata) : null
    );

    return id;
  }

  async getVideoSegments(videoId: string): Promise<VideoSegment[]> {
    const stmt = this.db.prepare('SELECT * FROM video_segments WHERE video_id = ? ORDER BY start_time');
    const rows = stmt.all(videoId) as any[];
    return rows.map(row => this.mapSegmentRow(row));
  }

  async updateVideoSegment(id: string, updates: Partial<VideoSegment>): Promise<void> {
    const fields = Object.keys(updates).filter(key => key !== 'id' && key !== 'createdAt');
    if (fields.length === 0) return;

    const setClause = fields.map(field => `${this.camelToSnake(field)} = ?`).join(', ');
    const values = fields.map(field => {
      const value = (updates as any)[field];
      if (field === 'embedding' && value instanceof Float32Array) {
        return Buffer.from(value.buffer);
      }
      if (field === 'metadata' && typeof value === 'object') {
        return JSON.stringify(value);
      }
      return value;
    });
    values.push(id);

    const stmt = this.db.prepare(`UPDATE video_segments SET ${setClause} WHERE id = ?`);
    stmt.run(...values);
  }

  // Search operations
  async textSearch(query: string, limit = 10, offset = 0): Promise<SearchResult[]> {
    // Validate and sanitize query for FTS5
    if (!query || query.trim().length === 0) {
      console.warn('[TEXT-SEARCH] Empty query provided, returning empty results');
      return [];
    }
    
    // Escape FTS5 special characters and handle quotes
    const sanitizedQuery = query.trim()
      .replace(/['"]/g, '') // Remove quotes that cause syntax errors
      .replace(/[()]/g, '') // Remove parentheses
      .replace(/\s+/g, ' '); // Normalize whitespace
    
    if (sanitizedQuery.length === 0) {
      console.warn('[TEXT-SEARCH] Query became empty after sanitization, returning empty results');
      return [];
    }

    try {
      const stmt = this.db.prepare(`
        SELECT 
          s.*,
          v.*,
          fts.rank
        FROM segments_fts fts
        JOIN video_segments s ON s.id = fts.segment_id
        JOIN video_files v ON v.id = s.video_id
        WHERE segments_fts MATCH ?
        ORDER BY fts.rank
        LIMIT ? OFFSET ?
      `);

      const rows = stmt.all(sanitizedQuery, limit, offset) as any[];
      return rows.map(row => ({
        segment: this.mapSegmentRow(row),
        video: this.mapVideoFileRow(row),
        score: row.rank || 0,
        matchType: 'text' as const,
        snippet: this.extractSnippet(row, query)
      }));
    } catch (error) {
      console.error('[TEXT-SEARCH] FTS5 query failed:', error, 'Query:', sanitizedQuery);
      return [];
    }
  }

  async vectorSearch(embedding: Float32Array, limit = 10, offset = 0): Promise<SearchResult[]> {
    try {
      // Get all segments with embeddings
      const stmt = this.db.prepare(`
        SELECT s.*, v.*
        FROM video_segments s
        JOIN video_files v ON v.id = s.video_id
        WHERE s.embedding IS NOT NULL
      `);
      
      const rows = stmt.all() as any[];
      
      if (rows.length === 0) {
        return [];
      }

      // Calculate similarities
      const similarities = rows.map(row => {
        const segmentEmbedding = new Float32Array(row.embedding);
        const similarity = EmbeddingService.cosineSimilarity(embedding, segmentEmbedding);
        
        return {
          segment: this.mapSegmentRow(row),
          video: this.mapVideoFileRow(row),
          score: similarity,
          matchType: 'vector' as const,
        };
      });

      // Sort by similarity and return top results
      return similarities
        .sort((a, b) => b.score - a.score)
        .slice(offset, offset + limit);
    } catch (error) {
      console.error('Vector search failed:', error);
      return [];
    }
  }

  async hybridSearch(query: string, embedding?: Float32Array, limit = 10, offset = 0): Promise<SearchResult[]> {
    try {
      // Get text search results
      const textResults = await this.textSearch(query, limit * 2, 0);
      
      // Get vector search results if embedding provided
      let vectorResults: SearchResult[] = [];
      if (embedding) {
        vectorResults = await this.vectorSearch(embedding, limit * 2, 0);
      }

      // If no vector results, return text results
      if (vectorResults.length === 0) {
        return textResults.slice(0, limit);
      }

      // Combine using RRF fusion
      const textItems = textResults.map(r => ({ item: r.segment.id, score: r.score }));
      const vectorItems = vectorResults.map(r => ({ item: r.segment.id, score: r.score }));
      
      const fusedResults = RRFFusion.combineSearchResults(textItems, vectorItems);
      
      // Map back to full results
      const segmentMap = new Map<string, SearchResult>();
      [...textResults, ...vectorResults].forEach(result => {
        segmentMap.set(result.segment.id, result);
      });

      return fusedResults
        .slice(offset, offset + limit)
        .map(fused => {
          const result = segmentMap.get(fused.item)!;
          return {
            ...result,
            score: fused.score,
            matchType: 'hybrid' as const,
          };
        });
    } catch (error) {
      console.error('Hybrid search failed:', error);
      return this.textSearch(query, limit);
    }
  }

  // Utility methods
  private mapVideoFileRow(row: any): VideoFile {
    return {
      id: row.id,
      filePath: row.file_path,
      fileName: row.file_name,
      fileSize: row.file_size,
      duration: row.duration,
      width: row.width,
      height: row.height,
      frameRate: row.frame_rate,
      bitrate: row.bitrate,
      codec: row.codec,
      totalSegments: row.total_segments,
      processingStatus: row.processing_status,
      processingError: row.processing_error,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at || row.created_at)
    };
  }

  private mapSegmentRow(row: any): VideoSegment {
    return {
      id: row.id,
      videoPath: row.video_path,
      startTime: row.start_time,
      endTime: row.end_time,
      duration: row.duration,
      sceneIndex: row.scene_index,
      thumbnailPath: row.thumbnail_path,
      keyframePath: row.keyframe_path,
      audioPath: row.audio_path,
      transcription: row.transcription,
      caption: row.caption,
      ocrText: row.ocr_text,
      embedding: row.embedding ? new Float32Array(row.embedding) : undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      createdAt: new Date(row.created_at)
    };
  }

  private camelToSnake(str: string): string {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  }

  // Video Processing Jobs methods
async createJob(job: Omit<VideoProcessingJob, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
  const id = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const now = new Date().toISOString();
  
  console.log(`[VIDEO-DB-CREATE] 🚀 Creating new video job:`, {
    id,
    videoPath: job.videoPath,
    fileName: job.fileName,
    status: job.status,
    triggerCondition: job.triggerCondition
  });
  
  const stmt = this.db.prepare(`
    INSERT INTO video_processing_jobs (
      id, video_path, file_name, status, progress, error,
      start_time, end_time, segment_count, total_segments,
      current_stage, refinement_pass, threshold, parent_job_id,
      trigger_condition, scheduled_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  try {
    stmt.run(
      id,
      job.videoPath,
      job.fileName,
      job.status,
      job.progress,
      job.error || null,
      job.startTime?.toISOString() || null,
      job.endTime?.toISOString() || null,
      job.segmentCount || 0,
      job.totalSegments || null,
      job.currentStage || null,
      job.refinementPass || 1,
      job.threshold || 0.8,
      job.parentJobId || null,
      job.triggerCondition || 'immediate',
      job.scheduledAt?.toISOString() || null,
      now,
      now
    );
    
    console.log(`[VIDEO-DB-CREATE] ✅ Successfully created job ${id} in database`);
    
    // Verify the job was actually inserted
    const verifyStmt = this.db.prepare(`SELECT id, status FROM video_processing_jobs WHERE id = ?`);
    const inserted = verifyStmt.get(id);
    console.log(`[VIDEO-DB-CREATE] 🔍 Verification - Job exists in DB:`, !!inserted, inserted);
    
    return id;
  } catch (error) {
    console.error(`[VIDEO-DB-CREATE] ❌ Failed to create job ${id}:`, error);
    throw error;
  }
}

  async updateJob(id: string, updates: Partial<Omit<VideoProcessingJob, 'id' | 'createdAt'>>): Promise<void> {
    const fields = [];
    const values = [];
    
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        const dbKey = this.camelToSnake(key);
        fields.push(`${dbKey} = ?`);
        
        if (value instanceof Date) {
          values.push(value.toISOString());
        } else {
          values.push(value);
        }
      }
    }
    
    if (fields.length === 0) return;
    
    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);
    
    const stmt = this.db.prepare(`
      UPDATE video_processing_jobs 
      SET ${fields.join(', ')} 
      WHERE id = ?
    `);
    
    stmt.run(...values);
  }

  async getJob(id: string): Promise<VideoProcessingJob | null> {
    const stmt = this.db.prepare('SELECT * FROM video_processing_jobs WHERE id = ?');
    const row = stmt.get(id);
    return row ? this.mapJobRow(row) : null;
  }

  async getJobs(status?: string): Promise<VideoProcessingJob[]> {
    let stmt;
    if (status) {
      stmt = this.db.prepare('SELECT * FROM video_processing_jobs WHERE status = ? ORDER BY created_at DESC');
      return stmt.all(status).map(row => this.mapJobRow(row));
    } else {
      stmt = this.db.prepare('SELECT * FROM video_processing_jobs ORDER BY created_at DESC');
      return stmt.all().map(row => this.mapJobRow(row));
    }
  }

  async deleteJob(id: string): Promise<void> {
    const stmt = this.db.prepare('DELETE FROM video_processing_jobs WHERE id = ?');
    stmt.run(id);
  }

  async getActiveJobs(): Promise<VideoProcessingJob[]> {
    // Get all active jobs (processing, running, scheduled)
    console.log(`[VIDEO-DB-ACTIVE] 🔍 Querying for active jobs...`);
    
    const stmt = this.db.prepare(`
      SELECT * FROM video_processing_jobs 
      WHERE status IN ('processing', 'running', 'scheduled') 
      ORDER BY created_at DESC
    `);
    const rows = stmt.all() as any[];
    
    console.log(`[VIDEO-DB-ACTIVE] 📊 Found ${rows.length} active jobs in database:`, 
      rows.map(r => ({ id: r.id, status: r.status, video_path: r.video_path })));
    
    const jobs = rows.map(row => this.mapJobRow(row));
    console.log(`[VIDEO-DB-ACTIVE] 🎯 Mapped jobs:`, 
      jobs.map(j => ({ id: j.id, status: j.status, videoPath: j.videoPath })));
    
    return jobs;
  }

  async getPendingJobs(limit: number = 5): Promise<VideoProcessingJob[]> {
    // Get pending jobs in batches with priority ordering
    console.log(`[VIDEO-DB-PENDING] 🔍 Querying for pending jobs (limit: ${limit})...`);
    
    const stmt = this.db.prepare(`
      SELECT * FROM video_processing_jobs 
      WHERE status IN ('pending', 'scheduled') 
      ORDER BY 
        CASE WHEN refinement_pass = 1 THEN 1 ELSE 2 END, -- Prioritize initial processing
        created_at ASC -- FIFO within same priority
      LIMIT ?
    `);
    
    const rows = stmt.all(limit) as any[];
    console.log(`[VIDEO-DB-PENDING] 📊 Found ${rows.length} pending/scheduled jobs:`, 
      rows.map(r => ({ id: r.id, status: r.status, video_path: r.video_path, created_at: r.created_at })));
    
    const jobs = rows.map(row => this.mapJobRow(row));
    console.log(`[VIDEO-DB-PENDING] 🎯 Mapped pending/scheduled jobs:`, 
      jobs.map(j => ({ id: j.id, status: j.status, videoPath: j.videoPath, createdAt: j.createdAt })));
    
    return jobs;
  }

  private mapJobRow(row: any): VideoProcessingJob {
    return {
      id: row.id,
      videoPath: row.video_path,
      fileName: row.file_name,
      status: row.status,
      progress: row.progress,
      error: row.error,
      startTime: row.start_time ? new Date(row.start_time) : undefined,
      endTime: row.end_time ? new Date(row.end_time) : undefined,
      segmentCount: row.segment_count,
      totalSegments: row.total_segments,
      currentStage: row.current_stage,
      refinementPass: row.refinement_pass,
      threshold: row.threshold,
      parentJobId: row.parent_job_id,
      triggerCondition: row.trigger_condition,
      scheduledAt: row.scheduled_at ? new Date(row.scheduled_at) : undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at || row.created_at)
    };
  }

  private extractSnippet(row: any, query: string): string {
    const text = [row.transcription, row.caption, row.ocr_text]
      .filter(Boolean)
      .join(' ');
    
    if (!text) return '';
    
    const words = query.toLowerCase().split(/\s+/);
    const textLower = text.toLowerCase();
    
    for (const word of words) {
      const index = textLower.indexOf(word);
      if (index !== -1) {
        const start = Math.max(0, index - 50);
        const end = Math.min(text.length, index + word.length + 50);
        return '...' + text.slice(start, end) + '...';
      }
    }
    
    return text.slice(0, 100) + (text.length > 100 ? '...' : '');
  }

  async close(): Promise<void> {
    this.db.close();
  }


  // Batch operations for performance
  async addVideoSegmentsBatch(segments: Omit<VideoSegment, 'id' | 'createdAt'>[]): Promise<string[]> {
    const stmt = this.db.prepare(`
      INSERT INTO video_segments (
        id, video_id, video_path, start_time, end_time, duration, scene_index,
        thumbnail_path, keyframe_path, transcription, caption, ocr_text,
        embedding, metadata, reconstructed_scene
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = this.db.transaction((segments: any[]) => {
      const ids: string[] = [];
      for (const segment of segments) {
        const id = `segment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        ids.push(id);

        // Get video_id from video_path (this is inefficient, should be passed in)
        const videoStmt = this.db.prepare('SELECT id FROM video_files WHERE file_path = ?');
        const videoRow = videoStmt.get(segment.videoPath) as any;
        const videoId = videoRow?.id || 'unknown';

        // Convert text fields to strings and log the parameters being passed to the database
        const transcriptionStr = segment.transcription ? String(segment.transcription) : null;
        const captionStr = segment.caption ? String(segment.caption) : null;
        const ocrTextStr = segment.ocrText ? String(segment.ocrText) : null;
        
        const params = [
          id, videoId, segment.videoPath, segment.startTime, segment.endTime,
          segment.duration, segment.sceneIndex, segment.thumbnailPath,
          segment.keyframePath, transcriptionStr, captionStr,
          ocrTextStr, segment.embedding ? Buffer.from(segment.embedding.buffer) : null,
          segment.metadata ? JSON.stringify(segment.metadata) : null,
          segment.reconstructedScene || null
        ];
        
        console.log(`[DB-INSERT-DEBUG] Inserting segment with ${params.length} parameters:`, {
          id,
          videoId,
          videoPath: segment.videoPath,
          startTime: segment.startTime,
          endTime: segment.endTime,
          duration: segment.duration,
          sceneIndex: segment.sceneIndex,
          thumbnailPath: segment.thumbnailPath,
          keyframePath: segment.keyframePath,
          transcription: transcriptionStr ? `"${transcriptionStr.substring(0, 30)}..."` : null,
          caption: captionStr ? `"${captionStr.substring(0, 30)}..."` : null,
          ocrText: ocrTextStr ? `"${ocrTextStr.substring(0, 30)}..."` : null,
          hasEmbedding: !!segment.embedding,
          hasMetadata: !!segment.metadata
        });
        
        stmt.run(...params);
      }
      return ids;
    });

    return transaction(segments);
  }
}
