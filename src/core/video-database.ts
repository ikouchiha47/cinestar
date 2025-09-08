import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { EmbeddingService, RRFFusion } from './embedding-service';

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
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  error?: string;
  startTime?: Date;
  endTime?: Date;
  segmentCount?: number;
  totalSegments?: number;
  currentStage?: string;
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
  private embeddingService: EmbeddingService;

  constructor(embeddingService?: EmbeddingService) {
    // Choose database directory similar to Media Search
    const isDev = process.env.NODE_ENV === 'development' || process.env.DEBUG_MODE === 'true';
    const defaultDir = isDev ? path.resolve(process.cwd(), 'data') : path.join(os.homedir(), '.driller');
    const baseDir = process.env.VIDEO_DB_DIR || process.env.MAIN_DB_DIR || defaultDir;
    this.dbPath = path.join(baseDir, 'video-rag.db');

    // Ensure base directory exists
    fs.mkdirSync(baseDir, { recursive: true });

    this.db = new Database(this.dbPath);

    // Initialize embedding service
    this.embeddingService = embeddingService || new EmbeddingService();

    // Enable WAL mode for better performance
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('cache_size = 10000');
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Load sqlite-vec extension
      // Note: You'll need to have sqlite-vec compiled and available
      // For now, we'll create the tables without vector extension
      // and add vector support later when sqlite-vec is available
      
      // Create tables
      this.createTables();
      
      // Create indexes
      this.createIndexes();
      
      this.initialized = true;
      console.log('VideoDatabase initialized at:', this.dbPath);
    } catch (error) {
      console.error('Failed to initialize VideoDatabase:', error);
      throw error;
    }
  }

  private createTables(): void {
    // Video files table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS video_files (
        id TEXT PRIMARY KEY,
        file_path TEXT UNIQUE NOT NULL,
        file_name TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        duration REAL NOT NULL,
        width INTEGER,
        height INTEGER,
        frame_rate REAL,
        bitrate INTEGER,
        codec TEXT,
        total_segments INTEGER DEFAULT 0,
        processing_status TEXT DEFAULT 'pending',
        processing_error TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Video segments table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS video_segments (
        id TEXT PRIMARY KEY,
        video_id TEXT NOT NULL,
        video_path TEXT NOT NULL,
        start_time REAL NOT NULL,
        end_time REAL NOT NULL,
        duration REAL NOT NULL,
        scene_index INTEGER NOT NULL,
        thumbnail_path TEXT,
        keyframe_path TEXT,
        audio_path TEXT,
        transcription TEXT,
        caption TEXT,
        ocr_text TEXT,
        embedding BLOB,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (video_id) REFERENCES video_files (id) ON DELETE CASCADE
      )
    `);

    // Video processing jobs table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS video_processing_jobs (
        id TEXT PRIMARY KEY,
        video_path TEXT NOT NULL,
        file_name TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        progress INTEGER DEFAULT 0,
        error TEXT,
        start_time DATETIME,
        end_time DATETIME,
        segment_count INTEGER DEFAULT 0,
        total_segments INTEGER,
        current_stage TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Full-text search table for segments
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS segments_fts USING fts5(
        segment_id,
        transcription,
        caption,
        ocr_text,
        content='video_segments',
        content_rowid='rowid'
      )
    `);

    // Triggers to keep FTS in sync
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS segments_fts_insert AFTER INSERT ON video_segments
      BEGIN
        INSERT INTO segments_fts(segment_id, transcription, caption, ocr_text)
        VALUES (NEW.id, NEW.transcription, NEW.caption, NEW.ocr_text);
      END
    `);

    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS segments_fts_update AFTER UPDATE ON video_segments
      BEGIN
        UPDATE segments_fts SET
          transcription = NEW.transcription,
          caption = NEW.caption,
          ocr_text = NEW.ocr_text
        WHERE segment_id = NEW.id;
      END
    `);

    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS segments_fts_delete AFTER DELETE ON video_segments
      BEGIN
        DELETE FROM segments_fts WHERE segment_id = OLD.id;
      END
    `);
  }

  private createIndexes(): void {
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_segments_video_id ON video_segments(video_id);
      CREATE INDEX IF NOT EXISTS idx_segments_time ON video_segments(start_time, end_time);
      CREATE INDEX IF NOT EXISTS idx_segments_scene ON video_segments(scene_index);
      CREATE INDEX IF NOT EXISTS idx_files_path ON video_files(file_path);
      CREATE INDEX IF NOT EXISTS idx_files_status ON video_files(processing_status);
    `);
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
  async textSearch(query: string, limit = 10): Promise<SearchResult[]> {
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
      LIMIT ?
    `);

    const rows = stmt.all(query, limit) as any[];
    return rows.map(row => ({
      segment: this.mapSegmentRow(row),
      video: this.mapVideoFileRow(row),
      score: row.rank || 0,
      matchType: 'text' as const,
      snippet: this.extractSnippet(row, query)
    }));
  }

  async vectorSearch(embedding: Float32Array, limit = 10): Promise<SearchResult[]> {
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
        .slice(0, limit);
    } catch (error) {
      console.error('Vector search failed:', error);
      return [];
    }
  }

  async hybridSearch(query: string, embedding?: Float32Array, limit = 10): Promise<SearchResult[]> {
    try {
      // Get text search results
      const textResults = await this.textSearch(query, limit * 2);
      
      // Get vector search results if embedding provided
      let vectorResults: SearchResult[] = [];
      if (embedding) {
        vectorResults = await this.vectorSearch(embedding, limit * 2);
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
        .slice(0, limit)
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
    
    const stmt = this.db.prepare(`
      INSERT INTO video_processing_jobs (
        id, video_path, file_name, status, progress, error,
        start_time, end_time, segment_count, total_segments,
        current_stage, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
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
      now,
      now
    );
    
    return id;
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
    return this.getJobs('processing');
  }

  async getPendingJobs(): Promise<VideoProcessingJob[]> {
    return this.getJobs('pending');
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
        embedding, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

        stmt.run(
          id, videoId, segment.videoPath, segment.startTime, segment.endTime,
          segment.duration, segment.sceneIndex, segment.thumbnailPath,
          segment.keyframePath, segment.transcription, segment.caption,
          segment.ocrText, segment.embedding ? Buffer.from(segment.embedding.buffer) : null,
          segment.metadata ? JSON.stringify(segment.metadata) : null
        );
      }
      return ids;
    });

    return transaction(segments);
  }
}
