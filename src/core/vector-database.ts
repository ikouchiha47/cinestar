/**
 * Vector database implementation using better-sqlite3
 * Separates image captioning from embedding generation
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { DEFAULT_CONFIG } from './config';

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

export interface SearchResult {
  id: string;
  similarity: number;
  caption: string;
  path: string;
  name: string;
}

export class VectorDatabase {
  private db: Database.Database;

  constructor(dbPath?: string) {
    // Use config vectorDbPath if not provided
    const resolvedDbPath = dbPath || DEFAULT_CONFIG.vectorDbPath;
    const dir = path.dirname(resolvedDbPath);
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`Created database directory: ${dir}`);
      }
    } catch (error) {
      console.error(`Failed to create database directory ${dir}:`, error);
      throw error;
    }
    let absolutePath = path.resolve(resolvedDbPath);
    if (!absolutePath.endsWith('.db')) {
      absolutePath += '.db';
    }
    try {
      console.log(`[VectorDatabase] Using DB path: ${absolutePath}`);
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
   * Search similar items using enhanced ranking algorithm with semantic relevance
   */
  async searchSimilar(queryEmbedding: Float32Array, limit: number = 10, query?: string): Promise<SearchResult[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM media_items 
      WHERE embedding IS NOT NULL AND embedding_status = 'completed'
    `);

    const items = stmt.all().map(this.rowToMediaItem);
    const results: SearchResult[] = [];
    
    console.log(`🔍 [SEARCH] Vector-only similarity search with ${items.length} items`);
    if (query) console.log(`🔍 [SEARCH] Query: "${query}"`);
    
    for (const item of items) {
      if (item.embedding && item.embeddingStatus === 'completed') {
        const similarity = this.cosineSimilarity(queryEmbedding, item.embedding);
        results.push({
          id: item.id,
          similarity,
          caption: item.caption || '',
          path: item.path || '',
          name: item.name || ''
        });
        console.log(`🔍 [SEARCH] Item: ${item.name}, Similarity: ${similarity.toFixed(4)}, Caption: "${(item.caption || '').substring(0, 50)}..."`);
      }
    }
    // Sort by similarity (highest first) and limit results
    let sortedResults = results
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
    console.log(`🔍 [SEARCH] Top ${Math.min(limit, sortedResults.length)} results (vector-only):`);
    sortedResults.forEach((result, index) => {
      console.log(`  ${index + 1}. ${result.name} (${result.similarity.toFixed(4)}) - "${result.caption.substring(0, 80)}..."`);
    });
    // Caption fallback: if all similarities are low (<0.1), fallback to caption keyword search
    if (query && sortedResults.length > 0 && sortedResults[0].similarity < 0.1) {
      console.log('🔍 [SEARCH] All vector similarities low, falling back to caption keyword search.');
      const captionMatches = items.filter(item => item.caption && item.caption.toLowerCase().includes(query.toLowerCase()));
      sortedResults = captionMatches.map(item => ({
        id: item.id,
        similarity: 0,
        caption: item.caption || '',
        path: item.path || '',
        name: item.name || ''
      })).slice(0, limit);
      sortedResults.forEach((result, index) => {
        console.log(`  [FALLBACK] ${index + 1}. ${result.name} (caption match) - "${result.caption.substring(0, 80)}..."`);
      });
    }
    return sortedResults;
  }

  /**
   * Calculate relevance boost based on caption content matching query
   */
  private calculateCaptionRelevanceBoost(query: string, caption: string): number {
    const queryLower = query.toLowerCase();
    const captionLower = caption.toLowerCase();
    
    let boost = 0;
    
    // Direct keyword match
    if (captionLower.includes(queryLower)) {
      boost += 1.0;
    }
    
    // Semantic keyword matching for common queries
    const semanticMatches = this.getSemanticMatches(queryLower);
    for (const match of semanticMatches) {
      if (captionLower.includes(match)) {
        boost += 0.5;
      }
    }
    
    return Math.min(boost, 2.0); // Cap boost at 2.0
  }

  /**
   * Get semantic matches for common query terms
   */
  private getSemanticMatches(query: string): string[] {
    const semanticMap: { [key: string]: string[] } = {
      'woman': ['female', 'lady', 'girl', 'person'],
      'man': ['male', 'guy', 'person'],
      'person': ['human', 'individual', 'people'],
      'car': ['vehicle', 'automobile', 'auto'],
      'house': ['home', 'building', 'residence'],
      'dog': ['canine', 'puppy', 'pet'],
      'cat': ['feline', 'kitten', 'pet']
    };
    
    return semanticMap[query] || [];
  }

  /**
   * Check if query is human-related
   */
  private isHumanRelatedQuery(query: string): boolean {
    const humanKeywords = ['woman', 'man', 'person', 'people', 'human', 'girl', 'boy', 'lady', 'guy', 'individual'];
    return humanKeywords.some(keyword => query.toLowerCase().includes(keyword));
  }

  /**
   * Calculate penalty for technical content when searching for human-related terms
   */
  private calculateTechnicalContentPenalty(caption: string): number {
    const captionLower = caption.toLowerCase();
    const technicalKeywords = [
      'bsod', 'blue screen', 'error', 'crash', 'system', 'computer', 'screen',
      'software', 'hardware', 'code', 'programming', 'terminal', 'console',
      'warhammer', 'game', 'gaming', 'fantasy', 'miniature'
    ];
    
    let penalty = 0;
    for (const keyword of technicalKeywords) {
      if (captionLower.includes(keyword)) {
        penalty += 0.5;
      }
    }
    
    return Math.min(penalty, 2.0); // Cap penalty at 2.0
  }

/**
 * Get statistics about the database
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
      total: (totalStmt.get() as any).count,
      captionsCompleted: (captionsCompletedStmt.get() as any).count,
      captionsPending: (captionsPendingStmt.get() as any).count,
      captionsFailed: (captionsFailedStmt.get() as any).count,
      embeddingsCompleted: (embeddingsCompletedStmt.get() as any).count,
      embeddingsPending: (embeddingsPendingStmt.get() as any).count,
      embeddingsFailed: (embeddingsFailedStmt.get() as any).count,
    };
  }

  /**
   * Convert database row to MediaItem
   */
  private rowToMediaItem(row: any): MediaItem {
    let embedding: Float32Array | undefined = undefined;
    
    if (row.embedding) {
      try {
        // SQLite returns BLOB as Buffer, convert to Float32Array
        const buffer = Buffer.isBuffer(row.embedding) ? row.embedding : Buffer.from(row.embedding);
        embedding = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4);
      } catch (error) {
        console.warn(`Failed to convert embedding for ${row.name}:`, error);
      }
    }
    
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
      embedding,
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
