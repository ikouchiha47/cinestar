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
    // Create media items table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS media_items (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        size INTEGER NOT NULL,
        type TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        caption TEXT,
        caption_generated_at TEXT,
        caption_status TEXT NOT NULL DEFAULT 'pending',
        embedding_generated_at TEXT,
        embedding_status TEXT NOT NULL DEFAULT 'pending'
      )
    `);

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
  async addMediaItemWithIdAsync(id: string, item: Omit<MediaItem, 'id'>): Promise<string> {
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
    if ((item as any).embedding && item.embeddingStatus === 'completed') {
      await this.addEmbedding(id, (item as any).embedding as Float32Array);
    }

    return id;
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
   * Enhanced vector similarity search using sqlite-vec
   */
  async searchSimilar(queryEmbedding: Float32Array, limit: number = 10, query?: string): Promise<SearchResult[]> {
    console.log(`🔍 [SQLITE-VEC] Starting vector similarity search with ${queryEmbedding.length}D embedding`);
    if (query) console.log(`🔍 [SQLITE-VEC] Query: "${query}"`);


    // Use sqlite-vec MATCH syntax like the official example
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
    `);

    // Serialize query embedding using struct.pack format like sqlite-vec example
    const queryBuffer = Buffer.alloc(queryEmbedding.length * 4);
    for (let i = 0; i < queryEmbedding.length; i++) {
      queryBuffer.writeFloatLE(queryEmbedding[i], i * 4);
    }
    console.log(`🔍 [SQLITE-VEC-DEBUG] Query buffer length: ${queryBuffer.length} bytes`);
    console.log(`🔍 [SQLITE-VEC-DEBUG] Query buffer first 20 bytes: [${Array.from(queryBuffer.slice(0, 20)).join(', ')}]`);
    
    let rows;
    try {
      rows = stmt.all(queryBuffer, limit); // Use k parameter for limit
      console.log(`🔍 [SQLITE-VEC] Found ${rows.length} raw results from vector search`);
      
      // Debug: show raw distance values from sqlite-vec
      if (rows.length > 0) {
        console.log(`🔍 [SQLITE-VEC-DEBUG] Raw distances from sqlite-vec:`);
        rows.slice(0, 5).forEach((row: any, i: number) => {
          console.log(`  ${i + 1}. ${row.name}: distance=${row.distance.toFixed(6)}`);
        });
      }
    } catch (error) {
      console.error(`🔍 [SQLITE-VEC-ERROR] Search failed:`, error);
      return [];
    }

    // Convert distance to similarity (ENHANCED RANKING TEMPORARILY DISABLED)
    const results: SearchResult[] = [];
    
    for (const row of rows) {
      // Convert cosine distance to similarity (1 - distance)
      const baseSimilarity = 1 - (row as any).distance;
      
      // TEMPORARILY DISABLED: Apply enhanced ranking
      let enhancedScore = baseSimilarity; // Use base similarity only
      let boostFactors: string[] = [];
      
      // DISABLED: Caption boost
      // if (query && (row as any).caption) {
      //   const captionBoost = this.calculateCaptionRelevanceBoost(query, (row as any).caption);
      //   if (captionBoost > 0) {
      //     enhancedScore = baseSimilarity + (captionBoost * 0.1);
      //     boostFactors.push(`caption:+${(captionBoost * 0.1).toFixed(3)}`);
      //   }
      // }
      
      // DISABLED: Technical penalty
      // if (query && this.isHumanRelatedQuery(query)) {
      //   const technicalPenalty = this.calculateTechnicalContentPenalty((row as any).caption || '');
      //   if (technicalPenalty > 0) {
      //     enhancedScore = enhancedScore * (1 - (technicalPenalty * 0.3)); // Up to 60% reduction
      //     boostFactors.push(`tech:*${(1 - (technicalPenalty * 0.3)).toFixed(3)}`);
      //   }
      // }
      
      results.push({
        id: (row as any).id,
        similarity: enhancedScore,
        caption: (row as any).caption || '',
        path: (row as any).path || '',
        name: (row as any).name || '',
        sourceId: (row as any).source_id || '',
        type: (row as any).type || 'image',
        size: Number((row as any).size) || 0
      });
      
      console.log(`🔍 [SQLITE-VEC] ${(row as any).name}: Raw distance=${((row as any).distance).toFixed(6)}, Base similarity ${baseSimilarity.toFixed(4)} (enhanced ranking disabled)`);
    }
    
    // Sort by base similarity and limit results
    const sortedResults = results
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
    
    console.log(`🔍 [SQLITE-VEC] Top ${sortedResults.length} results (enhanced ranking):`);
    sortedResults.forEach((result, index) => {
      console.log(`  ${index + 1}. ${result.name} (${result.similarity.toFixed(4)}) - "${result.caption.substring(0, 80)}..."`);
    });
    
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
    
    // High penalty keywords (very irrelevant for human searches)
    const highPenaltyKeywords = [
      'warhammer', 'miniature', 'fantasy', 'game', 'gaming',
      'bsod', 'blue screen', 'error', 'crash', 'system'
    ];
    
    // Medium penalty keywords (somewhat irrelevant)
    const mediumPenaltyKeywords = [
      'computer', 'screen', 'software', 'hardware', 'code', 
      'programming', 'terminal', 'console', 'technology'
    ];
    
    let penalty = 0;
    
    // Check for high penalty keywords
    for (const keyword of highPenaltyKeywords) {
      if (captionLower.includes(keyword)) {
        penalty += 1.0; // Strong penalty
      }
    }
    
    // Check for medium penalty keywords
    for (const keyword of mediumPenaltyKeywords) {
      if (captionLower.includes(keyword)) {
        penalty += 0.3; // Moderate penalty
      }
    }
    
    return Math.min(penalty, 2.0); // Cap penalty at 2.0 (60% reduction max)
  }

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
    const results = await this.searchSimilar(queryEmbedding, limit);
    return results.map(r => ({
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
   * Calculate cosine similarity (compatibility method - not used with sqlite-vec)
   */
  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    // This method is not used with sqlite-vec but needed for interface compatibility
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
