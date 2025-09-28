/**
 * SQLite-vec based vector database for efficient similarity search
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { ConfigManager } from './config';

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

export interface SearchResult {
  id: string;
  similarity: number;
  caption: string;
  path: string;
  name: string;
  sourceId: string;
  type: string;
  size: number;
  distance: number;
}

export class SqliteVecDatabase {
  private db: Database.Database;
  private expectedDim: number;

  constructor(dbPath?: string) {
    const cfg = ConfigManager.getConfig();
    const finalPath = dbPath || process.env.VECTOR_DB_PATH || cfg.vectorDbPath;
    // Ensure directory exists
    const dir = path.dirname(finalPath);
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`Created database directory: ${dir}`);
      }
    } catch (error) {
      console.error(`Failed to create database directory ${dir}:`, error);
      throw error;
    }

    // Initialize database
    this.db = new Database(finalPath);
    this.db.pragma('journal_mode = WAL');
    
    // Load sqlite-vec extension
    try {
      // Detect platform and architecture for the correct extension
      const platform = process.platform;
      const arch = process.arch;
      
      let extensionPath: string;
      if (platform === 'darwin' && arch === 'arm64') {
        extensionPath = path.resolve('./node_modules/sqlite-vec-darwin-arm64/vec0.dylib');
      } else if (platform === 'darwin' && arch === 'x64') {
        extensionPath = path.resolve('./node_modules/sqlite-vec-darwin-x64/vec0.dylib');
      } else if (platform === 'linux' && arch === 'x64') {
        extensionPath = path.resolve('./node_modules/sqlite-vec-linux-x64/vec0.so');
      } else if (platform === 'linux' && arch === 'arm64') {
        extensionPath = path.resolve('./node_modules/sqlite-vec-linux-arm64/vec0.so');
      } else if (platform === 'win32' && arch === 'x64') {
        extensionPath = path.resolve('./node_modules/sqlite-vec-windows-x64/vec0.dll');
      } else {
        throw new Error(`Unsupported platform: ${platform}-${arch}`);
      }
      
      this.db.loadExtension(extensionPath);
      console.log(`✅ sqlite-vec extension loaded successfully from ${extensionPath}`);
    } catch (error) {
      console.error('❌ Failed to load sqlite-vec extension:', error);
      throw error;
    }

    // Determine expected embedding dimension based on current embedding model
    this.expectedDim = this.getExpectedDim();

    this.initializeTables();
  }

  private initializeTables(): void {
    // Skip creating media_items table - it should be created by migrations
    // The main database migrations handle the media_items table with proper foreign keys

    // Meta table to track embedding model/dimension
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS vector_meta (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `);

    // Ensure vec_embeddings exists with the expected dimension; migrate if needed
    this.ensureVectorTableDimension();

    console.log('✅ SQLite-vec tables initialized');
  }

  /**
   * Add or update media item (compatible with VectorDatabase interface)
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
   * Add or update media item (async version)
   */
  async addMediaItemAsync(item: Omit<MediaItem, 'id'>): Promise<string> {
    const id = this.generateId();
    
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO media_items (
        id, source_id, name, path, size, type, created_at, updated_at,
        caption, caption_generated_at, caption_status,
        embedding_generated_at, embedding_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      item.sourceId,
      item.name,
      item.path,
      item.size,
      item.type,
      item.createdAt.toISOString(),
      item.updatedAt.toISOString(),
      item.caption || null,
      item.captionGeneratedAt?.toISOString() || null,
      item.captionStatus,
      item.embeddingGeneratedAt?.toISOString() || null,
      item.embeddingStatus
    );

    // Add embedding to vector table if available
    if (item.embedding && item.embeddingStatus === 'completed') {
      await this.addEmbedding(id, item.embedding);
    }

    return id;
  }

  /**
   * Add or update media item with a specific ID (to align with main DB)
   */
  async addMediaItemWithIdAsync(id: string, item: Partial<MediaItem>): Promise<void> {
    try {
      // First check if item already exists by path hash (since id is generated fresh each time)
      const { getHashPrefix } = await import('./utils/crypto-utils');
      const hashPrefix = await getHashPrefix(item.path || '');
      const { DATABASE_CONSTANTS } = await import('./constants/database-constants');
      const existingStmt = this.db.prepare(DATABASE_CONSTANTS.QUERIES.FIND_EXISTING_ITEM);
      const existing = existingStmt.get(item.path, `%${hashPrefix}%`) as any;

      const stmt = this.db.prepare(DATABASE_CONSTANTS.QUERIES.UPSERT_MEDIA_ITEM);

      // Preserve existing status and data if item already exists
      const captionStatus = existing?.caption_status || item.captionStatus || 'pending';
      const embeddingStatus = existing?.embedding_status || item.embeddingStatus || 'pending';
      const caption = existing?.caption || item.caption || null;
      const embedding = existing?.embedding || (item.embedding ? JSON.stringify(item.embedding) : null);
      const captionGeneratedAt = existing?.caption_generated_at || item.captionGeneratedAt?.toISOString() || null;
      const embeddingGeneratedAt = existing?.embedding_generated_at || item.embeddingGeneratedAt?.toISOString() || null;

      stmt.run(
        id,
        item.sourceId,
        item.name,
        item.path,
        item.size,
        item.type,
        item.createdAt?.toISOString() || new Date().toISOString(),
        item.updatedAt?.toISOString() || new Date().toISOString(),
        caption,
        captionGeneratedAt,
        captionStatus,
        embedding,
        embeddingGeneratedAt,
        embeddingStatus
      );
    } catch (error) {
      throw error;
    }
  }

  /**
   * Update caption for a media item
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
   * Update embedding for a media item
   */
  updateEmbedding(id: string, embedding: Float32Array, status: 'completed' | 'failed' = 'completed'): void {
    const stmt = this.db.prepare(`
      UPDATE media_items 
      SET embedding_generated_at = ?, embedding_status = ?, updated_at = ?
      WHERE id = ?
    `);

    stmt.run(
      new Date().toISOString(),
      status,
      new Date().toISOString(),
      id
    );

    // Add to vector table
    if (status === 'completed') {
      this.addEmbedding(id, embedding);
    }
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
   * Get a single media item by ID
   */
  getMediaItem(id: string): MediaItem | null {
    const stmt = this.db.prepare(`
      SELECT * FROM media_items WHERE id = ?
    `);
    
    const row = stmt.get(id);
    return row ? this.rowToMediaItem(row) : null;
  }

  /**
   * Search for media items by file path
   */
  searchByPath(path: string): MediaItem[] {
    const stmt = this.db.prepare(`
      SELECT * FROM media_items WHERE path = ?
    `);
    
    const rows = stmt.all(path);
    return rows.map(row => this.rowToMediaItem(row));
  }

  /**
   * Get items that need caption generation
   */
  getItemsNeedingCaptions(limit: number = 50): MediaItem[] {
    const stmt = this.db.prepare(`
      SELECT * FROM media_items 
      WHERE caption_status = 'pending' 
      ORDER BY created_at ASC 
      LIMIT ?
    `);

    return stmt.all(limit).map(this.rowToMediaItem.bind(this));
  }

  /**
   * Get items that need embedding generation
   */
  getItemsNeedingEmbeddings(limit: number = 50): MediaItem[] {
    const stmt = this.db.prepare(`
      SELECT * FROM media_items 
      WHERE caption_status = 'completed' AND embedding_status = 'pending'
      ORDER BY caption_generated_at ASC 
      LIMIT ?
    `);

    return stmt.all(limit).map(this.rowToMediaItem.bind(this));
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
      embedding: undefined, // Not needed for most operations
      embeddingGeneratedAt: row.embedding_generated_at ? new Date(row.embedding_generated_at) : undefined,
      captionStatus: row.caption_status,
      embeddingStatus: row.embedding_status,
    };
  }

  /**
   * Add embedding to vector table
   */
  private addEmbedding(itemId: string, embedding: Float32Array): void {
    // First try to delete existing embedding
    const deleteStmt = this.db.prepare(`DELETE FROM vec_embeddings WHERE item_id = ?`);
    deleteStmt.run(itemId);
    
    // Then insert new embedding
    const insertStmt = this.db.prepare(`
      INSERT INTO vec_embeddings (item_id, embedding)
      VALUES (?, ?)
    `);

    try {
      // Serialize embedding using struct.pack format like sqlite-vec example
      const buffer = Buffer.alloc(embedding.length * 4);
      for (let i = 0; i < embedding.length; i++) {
        buffer.writeFloatLE(embedding[i], i * 4);
      }
      insertStmt.run(itemId, buffer);
      console.log(`🔍 [EMBEDDING-STORE] Stored embedding for ${itemId}: ${embedding.length} dimensions`);
    } catch (error) {
      const message = String((error as any)?.message || error);
      console.warn(`Failed to add embedding for ${itemId}:`, message);
      // Auto-migrate dimension if mismatch is detected, then retry once
      if (message.includes('Dimension mismatch') || message.includes('received')) {
        console.warn('⚠️ Detected dimension mismatch. Attempting to migrate vec_embeddings to expected dimension:', this.expectedDim);
        this.recreateVectorTable(this.expectedDim);
        // Retry once after migration
        try {
          const buffer = Buffer.alloc(embedding.length * 4);
          for (let i = 0; i < embedding.length; i++) {
            buffer.writeFloatLE(embedding[i], i * 4);
          }
          insertStmt.run(itemId, buffer);
          console.log(`🔁 [EMBEDDING-STORE] Stored embedding for ${itemId} after migration`);
        } catch (e2) {
          console.error('❌ Retry after migration failed:', e2);
        }
      }
    }
  }

  /**
   * Determine expected embedding dimension based on the configured embedding model
   */
  private getExpectedDim(): number {
    try {
      const model = (ConfigManager.getConfig().ai.embeddingModel || '').toLowerCase();
      if (model.includes('nomic-embed-text')) return 768;
      if (model.includes('bge-large')) return 1024;
      if (model.includes('bge-small')) return 384;
      if (model.includes('text-embedding-3-small')) return 1536; // example for OpenAI
      if (model.includes('text-embedding-3-large')) return 3072; // example for OpenAI
      return 768; // sensible default
    } catch {
      return 768;
    }
  }

  /**
   * Ensure vec_embeddings virtual table matches expected dimension; migrate if mismatch
   */
  private ensureVectorTableDimension(): void {
    // Read stored dimension
    const row = this.db.prepare("SELECT value FROM vector_meta WHERE key = 'embedding_dim'").get() as any;
    const currentDim = row ? Number(row.value) : undefined;

    if (!currentDim) {
      // First-time setup: create vec_embeddings with expected dimension
      this.recreateVectorTable(this.expectedDim, /*skipReset*/ true);
      return;
    }

    if (currentDim !== this.expectedDim) {
      console.warn(`⚠️ Vector table dimension mismatch detected. Current: ${currentDim}, Expected: ${this.expectedDim}. Rebuilding table and resetting embeddings to pending.`);
      this.recreateVectorTable(this.expectedDim);
    }
  }

  /**
   * Drop and recreate vec_embeddings with the given dimension, update meta, and reset embedding statuses.
   */
  private recreateVectorTable(dim: number, skipReset: boolean = false): void {
    try {
      this.db.exec('DROP TABLE IF EXISTS vec_embeddings');
      this.db.exec(`
        CREATE VIRTUAL TABLE vec_embeddings USING vec0(
          item_id TEXT PRIMARY KEY,
          embedding FLOAT[${dim}]
        )
      `);
      this.db.prepare("INSERT OR REPLACE INTO vector_meta (key, value) VALUES ('embedding_dim', ?)").run(String(dim));
      this.db.prepare("INSERT OR REPLACE INTO vector_meta (key, value) VALUES ('embedding_model', ?)").run(ConfigManager.getConfig().ai.embeddingModel);
      if (!skipReset) {
        // We cannot recover prior vectors; mark for regeneration
        this.db.exec(`UPDATE media_items SET embedding_generated_at = NULL, embedding_status = 'pending'`);
      }
      console.log(`✅ vec_embeddings table created with dimension ${dim}`);
    } catch (e) {
      console.error('❌ Failed to recreate vec_embeddings table:', e);
      throw e;
    }
  }

  /**
   * Enhanced vector similarity search using sqlite-vec with pagination
   */
  async searchSimilar(queryEmbedding: Float32Array, limit: number = 10, offset: number = 0, query?: string): Promise<{results: SearchResult[], total: number, hasMore: boolean}> {
    console.log(`🔍 [SQLITE-VEC] Starting vector similarity search with ${queryEmbedding.length}D embedding`);
    if (query) console.log(`🔍 [SQLITE-VEC] Query: "${query}"`);


    // Get total count first for pagination (use reasonable k for count)
    const countStmt = this.db.prepare(`
      SELECT COUNT(*) as total
      FROM vec_embeddings v
      JOIN media_items m ON v.item_id = m.id
      WHERE m.embedding_status = 'completed'
        AND v.embedding MATCH ?
        AND k = 1000
    `);

    // Use sqlite-vec MATCH syntax with pagination
    const stmt = this.db.prepare(`
      SELECT 
        m.id, m.name, m.path, m.caption, m.source_id, m.type, m.size,
        distance
      FROM vec_embeddings v
      JOIN media_items m ON v.item_id = m.id
      WHERE m.embedding_status = 'completed'
        AND v.embedding MATCH ?
        AND k = ?
      ORDER BY distance ASC
      LIMIT ? OFFSET ?
    `);

    // Serialize query embedding using struct.pack format like sqlite-vec example
    const queryBuffer = Buffer.alloc(queryEmbedding.length * 4);
    for (let i = 0; i < queryEmbedding.length; i++) {
      queryBuffer.writeFloatLE(queryEmbedding[i], i * 4);
    }
    console.log(`🔍 [SQLITE-VEC-DEBUG] Query buffer length: ${queryBuffer.length} bytes, limit: ${limit}, offset: ${offset}`);
    
    let rows;
    let totalCount = 0;
    try {
      // Get total count (use larger k for count query)
      const countResult = countStmt.get(queryBuffer) as {total: number};
      totalCount = countResult?.total || 0;
      
      // Get paginated results - k should be at least limit + offset but reasonable for performance
      const kValue = Math.min(Math.max(limit + offset, 50), 1000);
      rows = stmt.all(queryBuffer, kValue, limit, offset);
      console.log(`🔍 [SQLITE-VEC] Found ${rows.length} results (${offset}-${offset + rows.length} of ${totalCount} total)`);
      
      // Debug: show raw distance values from sqlite-vec
      if (rows.length > 0) {
        console.log(`🔍 [SQLITE-VEC-DEBUG] Raw distances from sqlite-vec:`);
        rows.slice(0, 3).forEach((row: any, i: number) => {
          console.log(`  ${i + 1}. ${row.name}: distance=${row.distance.toFixed(6)}`);
        });
      }
    } catch (error) {
      console.error(`🔍 [SQLITE-VEC-ERROR] Search failed:`, error);
      return { results: [], total: 0, hasMore: false };
    }

    // Convert distance to similarity and build results
    const results: SearchResult[] = [];
    
    for (const row of rows) {
      // Convert cosine distance to similarity (1 - distance)
      const baseSimilarity = 1 - (row as any).distance;
      
      results.push({
        id: (row as any).id,
        name: (row as any).name,
        path: (row as any).path,
        caption: (row as any).caption || '',
        sourceId: (row as any).source_id,
        type: (row as any).type,
        size: (row as any).size,
        similarity: Math.max(0, Math.min(1, baseSimilarity)),
        distance: (row as any).distance
      });
    }

    const hasMore = offset + results.length < totalCount;
    
    console.log(`🔍 [SQLITE-VEC] Returning ${results.length} results, hasMore: ${hasMore}`);
    
    return {
      results,
      total: totalCount,
      hasMore
    };
  }

  /**
   * Calculate relevance boost based on caption content matching query
   * Currently disabled but kept for future use
   */
  // private calculateCaptionRelevanceBoost(query: string, caption: string): number {
  //   const queryLower = query.toLowerCase();
  //   const captionLower = caption.toLowerCase();
  //   
  //   let boost = 0;
  //   
  //   // Direct keyword match
  //   if (captionLower.includes(queryLower)) {
  //     boost += 1.0;
  //   }
  //   
  //   // Semantic keyword matching for common queries
  //   const semanticMatches = this.getSemanticMatches(queryLower);
  //   for (const match of semanticMatches) {
  //     if (captionLower.includes(match)) {
  //       boost += 0.5;
  //     }
  //   }
  //   
  //   return Math.min(boost, 2.0); // Cap boost at 2.0
  // }

  /**
   * Get semantic matches for common query terms
   * Currently disabled but kept for future use
   */
  // private getSemanticMatches(query: string): string[] {
  //   const semanticMap: { [key: string]: string[] } = {
  //     'woman': ['female', 'lady', 'girl', 'person'],
  //     'man': ['male', 'guy', 'person'],
  //     'person': ['human', 'individual', 'people'],
  //     'car': ['vehicle', 'automobile', 'auto'],
  //     'house': ['home', 'building', 'residence'],
  //     'dog': ['canine', 'puppy', 'pet'],
  //     'cat': ['feline', 'kitten', 'pet']
  //   };
  //   
  //   return semanticMap[query] || [];
  // }

  /**
   * Check if query is human-related
   * Currently disabled but kept for future use
   */
  // private isHumanRelatedQuery(query: string): boolean {
  //   const humanKeywords = ['woman', 'man', 'person', 'people', 'human', 'girl', 'boy', 'lady', 'guy', 'individual'];
  //   return humanKeywords.some(keyword => query.toLowerCase().includes(keyword));
  // }

  /**
   * Calculate penalty for technical content when searching for human-related terms
   * Currently disabled but kept for future use
   */
  // private calculateTechnicalContentPenalty(caption: string): number {
  //   const captionLower = caption.toLowerCase();
  //   const technicalKeywords = [
  //     'bsod', 'blue screen', 'error', 'crash', 'system', 'computer', 'screen',
  //     'software', 'hardware', 'code', 'programming', 'terminal', 'console',
  //     'warhammer', 'game', 'gaming', 'fantasy', 'miniature'
  //   ];
  //   
  //   let penalty = 0;
  //   for (const keyword of technicalKeywords) {
  //     if (captionLower.includes(keyword)) {
  //       penalty += 0.5;
  //     }
  //   }
  //   
  //   return Math.min(penalty, 2.0); // Cap penalty at 2.0
  // }

  /**
   * Calculate cosine similarity between two vectors
   * Currently disabled but kept for future use
   */
  // private cosineSimilarity(a: Float32Array, b: Float32Array): number {
  //   if (a.length !== b.length) {
  //     throw new Error('Vectors must have the same length');
  //   }

  //   let dotProduct = 0;
  //   let normA = 0;
  //   let normB = 0;

  //   for (let i = 0; i < a.length; i++) {
  //     dotProduct += a[i] * b[i];
  //     normA += a[i] * a[i];
  //     normB += b[i] * b[i];
  //   }

  //   const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  //   return magnitude === 0 ? 0 : dotProduct / magnitude;
  // }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
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
   * Search by text using vector similarity (compatibility method)
   */
  async searchByText(queryEmbedding: Float32Array, limit: number = 10): Promise<any[]> {
    const paginatedResults = await this.searchSimilar(queryEmbedding, limit, 0);
    return paginatedResults.results.map((r: SearchResult) => ({
      item: {
        id: r.id,
        name: r.name,
        path: r.path,
        caption: r.caption
      },
      similarity: r.similarity
    }));
  }

  /**
   * Remove media item and its embedding
   */
  removeMediaItem(id: string): void {
    // Remove from media_items table
    const deleteItemStmt = this.db.prepare(`DELETE FROM media_items WHERE id = ?`);
    deleteItemStmt.run(id);
    
    // Remove from vec_embeddings table
    const deleteEmbeddingStmt = this.db.prepare(`DELETE FROM vec_embeddings WHERE item_id = ?`);
    deleteEmbeddingStmt.run(id);
    
    console.log(`[SQLITE-VEC] Removed media item and embedding: ${id}`);
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
  }
}
