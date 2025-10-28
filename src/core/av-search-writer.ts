import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

/**
 * Writer for av_search.db - handles video/audio embeddings and transcriptions
 * Complements the read-only AVSearchStoreSqlite
 */
export class AVSearchWriter {
  private db: Database.Database;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    
    // Load sqlite-vec extension (required for video_segment_vec and audio_segment_vec tables)
    this.loadVecExtension();
  }

  private loadVecExtension(): void {
    try {
      const platform = process.platform;
      const arch = process.arch;
      
      // Determine base path for extensions
      const isDev = !!process.env.VITE_DEV_SERVER_URL;
      const basePath = isDev 
        ? '.'
        : path.join((process as any).resourcesPath || path.dirname(process.execPath), 'app.asar.unpacked');
      
      let extensionPath: string;
      if (platform === 'darwin' && arch === 'arm64') {
        extensionPath = path.resolve(basePath, 'node_modules/sqlite-vec-darwin-arm64/vec0.dylib');
      } else if (platform === 'darwin' && arch === 'x64') {
        extensionPath = path.resolve(basePath, 'node_modules/sqlite-vec-darwin-x64/vec0.dylib');
      } else if (platform === 'linux' && arch === 'x64') {
        extensionPath = path.resolve(basePath, 'node_modules/sqlite-vec-linux-x64/vec0.so');
      } else if (platform === 'linux' && arch === 'arm64') {
        extensionPath = path.resolve(basePath, 'node_modules/sqlite-vec-linux-arm64/vec0.so');
      } else if (platform === 'win32' && arch === 'x64') {
        extensionPath = path.resolve(basePath, 'node_modules/sqlite-vec-windows-x64/vec0.dll');
      } else {
        throw new Error(`Unsupported platform: ${platform}-${arch}`);
      }
      
      if (!fs.existsSync(extensionPath)) {
        throw new Error(`Extension not found at: ${extensionPath}`);
      }
      
      this.db.loadExtension(extensionPath);
      console.log(`[AV-SEARCH-WRITER] ✅ sqlite-vec extension loaded from ${extensionPath}`);
    } catch (error) {
      console.error('[AV-SEARCH-WRITER] ❌ Failed to load sqlite-vec extension:', error);
      throw error;
    }
  }

  /**
   * Update or insert video segment embedding
   */
  updateVideoSegmentEmbedding(itemId: string, segmentId: string, embedding: Float32Array, model: string = 'default'): void {
    // Convert Float32Array to Buffer
    const buffer = Buffer.alloc(embedding.length * 4);
    for (let i = 0; i < embedding.length; i++) {
      buffer.writeFloatLE(embedding[i], i * 4);
    }

    // Insert into embeddings table
    this.db.prepare(`
      INSERT INTO video_segment_embeddings(id, item_id, segment_id, model, vector, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET 
        item_id = excluded.item_id,
        segment_id = excluded.segment_id,
        vector = excluded.vector,
        created_at = excluded.created_at
    `).run(segmentId, itemId, segmentId, model, buffer);

    // Also update vec0 virtual table for similarity search
    // Note: Virtual tables don't support ON CONFLICT, so we delete first then insert
    this.db.prepare(`DELETE FROM video_segment_vec WHERE segment_id = ?`).run(segmentId);
    this.db.prepare(`INSERT INTO video_segment_vec(segment_id, embedding) VALUES (?, ?)`).run(segmentId, buffer);
  }

  /**
   * Update or insert audio segment embedding
   */
  updateAudioSegmentEmbedding(itemId: string, segmentId: string, embedding: Float32Array, model: string = 'default'): void {
    const buffer = Buffer.alloc(embedding.length * 4);
    for (let i = 0; i < embedding.length; i++) {
      buffer.writeFloatLE(embedding[i], i * 4);
    }

    this.db.prepare(`
      INSERT INTO audio_segment_embeddings(id, item_id, segment_id, model, vector, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET 
        item_id = excluded.item_id,
        segment_id = excluded.segment_id,
        vector = excluded.vector,
        created_at = excluded.created_at
    `).run(segmentId, itemId, segmentId, model, buffer);

    // Virtual tables don't support ON CONFLICT, so we delete first then insert
    this.db.prepare(`DELETE FROM audio_segment_vec WHERE segment_id = ?`).run(segmentId);
    this.db.prepare(`INSERT INTO audio_segment_vec(segment_id, embedding) VALUES (?, ?)`).run(segmentId, buffer);
  }

  /**
   * Update or insert transcription in FTS index
   */
  updateTranscription(segmentId: string, transcription: string): void {
    // FTS5 virtual tables don't support ON CONFLICT, so we delete first then insert
    this.db.prepare(`DELETE FROM transcripts_fts WHERE segment_id = ?`).run(segmentId);
    this.db.prepare(`INSERT INTO transcripts_fts(segment_id, transcript) VALUES (?, ?)`).run(segmentId, transcription);
  }

  /**
   * Update metadata cache for video/audio segment
   */
  updateAVMetaCache(data: {
    itemId: string;
    segmentId: string;
    mediaType: 'video' | 'audio';
    path: string;
    startMs?: number;
    endMs?: number;
    durationMs?: number;
    title?: string;
    createdAt?: string;
    caption?: string;
    captionElements?: any;
    captionSpatial?: string;
    captionTemporal?: string;
    captionTokens?: any;
  }): void {
    this.db.prepare(`
      INSERT INTO av_meta_cache(
        item_id, segment_id, media_type, path, start_ms, end_ms, duration_ms, title, created_at,
        caption, caption_elements, caption_spatial, caption_temporal, caption_tokens
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(item_id, segment_id, media_type) DO UPDATE SET
        path = excluded.path,
        start_ms = excluded.start_ms,
        end_ms = excluded.end_ms,
        duration_ms = excluded.duration_ms,
        title = excluded.title,
        created_at = excluded.created_at,
        caption = excluded.caption,
        caption_elements = excluded.caption_elements,
        caption_spatial = excluded.caption_spatial,
        caption_temporal = excluded.caption_temporal,
        caption_tokens = excluded.caption_tokens
    `).run(
      data.itemId,
      data.segmentId,
      data.mediaType,
      data.path,
      data.startMs ?? null,
      data.endMs ?? null,
      data.durationMs ?? null,
      data.title ?? null,
      data.createdAt || new Date().toISOString(),
      data.caption ?? null,
      data.captionElements ? JSON.stringify(data.captionElements) : null,
      data.captionSpatial ?? null,
      data.captionTemporal ?? null,
      data.captionTokens ? JSON.stringify(data.captionTokens) : null
    );
  }

  /**
   * Update multi-pass caption data for a segment
   */
  updateMultiPassCaption(data: {
    itemId: string;
    segmentId: string;
    mediaType: 'video' | 'audio';
    caption: string;
    elements?: any;
    spatial?: string;
    temporal?: string;
    tokens?: any;
  }): void {
    // Update av_meta_cache with multi-pass data
    this.db.prepare(`
      UPDATE av_meta_cache
      SET 
        caption = ?,
        caption_elements = ?,
        caption_spatial = ?,
        caption_temporal = ?,
        caption_tokens = ?
      WHERE item_id = ? AND segment_id = ? AND media_type = ?
    `).run(
      data.caption,
      data.elements ? JSON.stringify(data.elements) : null,
      data.spatial ?? null,
      data.temporal ?? null,
      data.tokens ? JSON.stringify(data.tokens) : null,
      data.itemId,
      data.segmentId,
      data.mediaType
    );

    // Update FTS index with combined text for enhanced search
    const combinedText = this.buildCombinedSearchText(
      data.caption,
      data.spatial,
      data.temporal,
      data.elements
    );
    this.updateTranscription(data.segmentId, combinedText);
  }

  /**
   * Build combined search text from multi-pass caption data
   * This enhances FTS search by including spatial, temporal, and structured metadata
   */
  private buildCombinedSearchText(
    caption: string,
    spatial?: string,
    temporal?: string,
    elements?: any
  ): string {
    const parts: string[] = [caption];

    // Add spatial description
    if (spatial) {
      parts.push(spatial);
    }

    // Add temporal description
    if (temporal) {
      parts.push(temporal);
    }

    // Add structured elements as keywords
    if (elements) {
      const keywords = this.elementsToKeywords(elements);
      if (keywords) {
        parts.push(keywords);
      }
    }

    return parts.filter(Boolean).join(' ');
  }

  /**
   * Convert structured elements to searchable keywords
   */
  private elementsToKeywords(elements: any): string {
    const keywords: string[] = [];

    // Add objects
    if (elements.objects && Array.isArray(elements.objects)) {
      keywords.push(...elements.objects);
    }

    // Add people
    if (elements.people && Array.isArray(elements.people)) {
      keywords.push(...elements.people);
    }

    // Add colors
    if (elements.colors && Array.isArray(elements.colors)) {
      keywords.push(...elements.colors);
    }

    // Add lighting
    if (elements.lighting) {
      keywords.push(elements.lighting);
    }

    // Add time
    if (elements.time) {
      keywords.push(elements.time);
    }

    // Add setting
    if (elements.setting) {
      keywords.push(elements.setting);
    }

    // Add mood
    if (elements.mood) {
      keywords.push(elements.mood);
    }

    return keywords.filter(Boolean).join(' ');
  }

  /**
   * Batch update video segment embeddings for better performance
   */
  batchUpdateVideoEmbeddings(items: Array<{ itemId: string; segmentId: string; embedding: Float32Array; model?: string }>): void {
    const transaction = this.db.transaction((batch: typeof items) => {
      for (const item of batch) {
        this.updateVideoSegmentEmbedding(item.itemId, item.segmentId, item.embedding, item.model);
      }
    });
    transaction(items);
  }

  /**
   * Batch update transcriptions
   */
  batchUpdateTranscriptions(items: Array<{ segmentId: string; transcription: string }>): void {
    const transaction = this.db.transaction((batch: typeof items) => {
      for (const item of batch) {
        this.updateTranscription(item.segmentId, item.transcription);
      }
    });
    transaction(items);
  }

  /**
   * Batch update metadata cache
   */
  batchUpdateMetaCache(items: Array<Parameters<typeof this.updateAVMetaCache>[0]>): void {
    const transaction = this.db.transaction((batch: typeof items) => {
      for (const item of batch) {
        this.updateAVMetaCache(item);
      }
    });
    transaction(items);
  }
}
