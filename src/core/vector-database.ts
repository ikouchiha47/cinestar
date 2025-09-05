/**
 * Vector database implementation using better-sqlite3
 * Separates image captioning from embedding generation
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

export interface MediaItem {
  id: string;
  sourceId: string;
  name: string;
  path: string;
  size: number;
  type: string;
  createdAt: Date;
  updatedAt: Date;
  // Phase 1: Caption data
  caption?: string;
  captionGeneratedAt?: Date;
  // Phase 2: Embedding data
  embedding?: Float32Array;
  embeddingGeneratedAt?: Date;
  // Processing status
  captionStatus: 'pending' | 'processing' | 'completed' | 'failed';
  embeddingStatus: 'pending' | 'processing' | 'completed' | 'failed';
}

export interface VectorSearchResult {
  item: MediaItem;
  similarity: number;
}

export class VectorDatabase {
  private db: Database.Database;
  private dbPath: string;

  constructor(dbPath: string = './data/vector.db') {
    this.dbPath = dbPath;
    
    // Ensure directory exists with proper error handling
    const dir = path.dirname(dbPath);
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`Created database directory: ${dir}`);
      }
    } catch (error) {
      console.error(`Failed to create database directory ${dir}:`, error);
      throw error;
    }

    // Ensure the database file path is absolute and has .db extension
    let absolutePath = path.resolve(dbPath);
    if (!absolutePath.endsWith('.db')) {
      absolutePath += '.db';
    }
    
    try {
      this.db = new Database(absolutePath);
      this.initializeTables();
    } catch (error) {
      console.error(`Failed to open database at ${absolutePath}:`, error);
      throw error;
    }
  }

  private initializeTables(): void {
    // Enable WAL mode for better performance
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA synchronous = NORMAL');
    this.db.exec('PRAGMA cache_size = 1000000');
    this.db.exec('PRAGMA temp_store = memory');

    // Create media items table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS media_items (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        name TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        size INTEGER NOT NULL,
        type TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        
        -- Phase 1: Caption data
        caption TEXT,
        caption_generated_at TEXT,
        caption_status TEXT DEFAULT 'pending',
        
        -- Phase 2: Embedding data  
        embedding BLOB,
        embedding_generated_at TEXT,
        embedding_status TEXT DEFAULT 'pending'
      )
    `);

    // Create indexes for better performance
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_media_source_id ON media_items(source_id);
      CREATE INDEX IF NOT EXISTS idx_media_caption_status ON media_items(caption_status);
      CREATE INDEX IF NOT EXISTS idx_media_embedding_status ON media_items(embedding_status);
      CREATE INDEX IF NOT EXISTS idx_media_updated_at ON media_items(updated_at);
    `);

    console.log('Vector database initialized');
  }

  /**
   * Add or update a media item (Phase 1: without caption/embedding)
   */
  addMediaItem(item: Omit<MediaItem, 'caption' | 'embedding' | 'captionGeneratedAt' | 'embeddingGeneratedAt'>): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO media_items (
        id, source_id, name, path, size, type, created_at, updated_at,
        caption_status, embedding_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      item.id,
      item.sourceId,
      item.name,
      item.path,
      item.size,
      item.type,
      item.createdAt.toISOString(),
      item.updatedAt.toISOString(),
      item.captionStatus,
      item.embeddingStatus
    );
  }

  /**
   * Update caption for a media item (Phase 1 completion)
   */
  updateCaption(id: string, caption: string, status: 'completed' | 'failed' = 'completed'): void {
    const stmt = this.db.prepare(`
      UPDATE media_items 
      SET caption = ?, caption_generated_at = ?, caption_status = ?, updated_at = ?
      WHERE id = ?
    `);

    stmt.run(
      caption,
      new Date().toISOString(),
      status,
      new Date().toISOString(),
      id
    );
  }

  /**
   * Update embedding for a media item (Phase 2 completion)
   */
  updateEmbedding(id: string, embedding: Float32Array, status: 'completed' | 'failed' = 'completed'): void {
    const stmt = this.db.prepare(`
      UPDATE media_items 
      SET embedding = ?, embedding_generated_at = ?, embedding_status = ?, updated_at = ?
      WHERE id = ?
    `);

    // Convert Float32Array to Buffer for storage
    const buffer = Buffer.from(embedding.buffer);

    stmt.run(
      buffer,
      new Date().toISOString(),
      status,
      new Date().toISOString(),
      id
    );
  }

  /**
   * Update processing status
   */
  updateStatus(id: string, captionStatus?: string, embeddingStatus?: string): void {
    const updates: string[] = [];
    const values: any[] = [];

    if (captionStatus) {
      updates.push('caption_status = ?');
      values.push(captionStatus);
    }

    if (embeddingStatus) {
      updates.push('embedding_status = ?');
      values.push(embeddingStatus);
    }

    if (updates.length === 0) return;

    updates.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    const stmt = this.db.prepare(`
      UPDATE media_items SET ${updates.join(', ')} WHERE id = ?
    `);

    stmt.run(...values);
  }

  /**
   * Get items that need caption generation (Phase 1)
   */
  getItemsNeedingCaptions(limit: number = 50): MediaItem[] {
    const stmt = this.db.prepare(`
      SELECT * FROM media_items 
      WHERE caption_status = 'pending' 
      ORDER BY created_at ASC 
      LIMIT ?
    `);

    return stmt.all(limit).map(this.rowToMediaItem);
  }

  /**
   * Get items that need embedding generation (Phase 2)
   */
  getItemsNeedingEmbeddings(limit: number = 50): MediaItem[] {
    const stmt = this.db.prepare(`
      SELECT * FROM media_items 
      WHERE caption_status = 'completed' AND embedding_status = 'pending'
      ORDER BY caption_generated_at ASC 
      LIMIT ?
    `);

    return stmt.all(limit).map(this.rowToMediaItem);
  }

  /**
   * Get media item by ID
   */
  getMediaItem(id: string): MediaItem | null {
    const stmt = this.db.prepare('SELECT * FROM media_items WHERE id = ?');
    const row = stmt.get(id);
    return row ? this.rowToMediaItem(row) : null;
  }

  /**
   * Search by text using vector similarity
   */
  async searchByText(queryEmbedding: Float32Array, limit: number = 10): Promise<VectorSearchResult[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM media_items 
      WHERE embedding IS NOT NULL AND embedding_status = 'completed'
    `);

    const items = stmt.all().map(this.rowToMediaItem);
    const results: VectorSearchResult[] = [];

    for (const item of items) {
      if (!item.embedding) continue;

      const similarity = this.cosineSimilarity(queryEmbedding, item.embedding);
      results.push({ item, similarity });
    }

    // Sort by similarity (highest first) and limit results
    return results
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  /**
   * Get processing statistics
   */
  getStats(): {
    total: number;
    captionsCompleted: number;
    captionsPending: number;
    captionsFailed: number;
    embeddingsCompleted: number;
    embeddingsPending: number;
    embeddingsFailed: number;
  } {
    const totalStmt = this.db.prepare('SELECT COUNT(*) as count FROM media_items');
    const captionsCompletedStmt = this.db.prepare('SELECT COUNT(*) as count FROM media_items WHERE caption_status = "completed"');
    const captionsPendingStmt = this.db.prepare('SELECT COUNT(*) as count FROM media_items WHERE caption_status = "pending"');
    const captionsFailedStmt = this.db.prepare('SELECT COUNT(*) as count FROM media_items WHERE caption_status = "failed"');
    const embeddingsCompletedStmt = this.db.prepare('SELECT COUNT(*) as count FROM media_items WHERE embedding_status = "completed"');
    const embeddingsPendingStmt = this.db.prepare('SELECT COUNT(*) as count FROM media_items WHERE embedding_status = "pending"');
    const embeddingsFailedStmt = this.db.prepare('SELECT COUNT(*) as count FROM media_items WHERE embedding_status = "failed"');

    return {
      total: totalStmt.get().count,
      captionsCompleted: captionsCompletedStmt.get().count,
      captionsPending: captionsPendingStmt.get().count,
      captionsFailed: captionsFailedStmt.get().count,
      embeddingsCompleted: embeddingsCompletedStmt.get().count,
      embeddingsPending: embeddingsPendingStmt.get().count,
      embeddingsFailed: embeddingsFailedStmt.get().count,
    };
  }

  /**
   * Convert database row to MediaItem
   */
  private rowToMediaItem(row: any): MediaItem {
    return {
      id: row.id,
      sourceId: row.source_id,
      name: row.name,
      path: row.path,
      size: row.size,
      type: row.type,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      caption: row.caption || undefined,
      captionGeneratedAt: row.caption_generated_at ? new Date(row.caption_generated_at) : undefined,
      embedding: row.embedding ? new Float32Array(row.embedding.buffer) : undefined,
      embeddingGeneratedAt: row.embedding_generated_at ? new Date(row.embedding_generated_at) : undefined,
      captionStatus: row.caption_status,
      embeddingStatus: row.embedding_status,
    };
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have the same length');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
  }
}
