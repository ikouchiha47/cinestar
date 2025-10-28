import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

/**
 * Writer for image_search.db - handles embeddings and captions
 * Complements the read-only ImageModalityVecDatabase
 */
export class ImageSearchWriter {
  private db: Database.Database;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');

    // Load sqlite-vec extension (required for image_vec_embeddings table)
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
      console.log(`[IMAGE-SEARCH-WRITER] ✅ sqlite-vec extension loaded from ${extensionPath}`);
    } catch (error) {
      console.error('[IMAGE-SEARCH-WRITER] ❌ Failed to load sqlite-vec extension:', error);
      throw error;
    }
  }

  /**
   * Update or insert caption in FTS index
   */
  updateCaption(itemId: string, caption: string): void {
    // FTS5 doesn't support UPSERT, so delete then insert
    this.db.prepare(`DELETE FROM image_fts WHERE item_id = ?`).run(itemId);
    this.db.prepare(`INSERT INTO image_fts(item_id, text) VALUES (?, ?)`).run(itemId, caption);
  }

  /**
   * Update or insert embedding vector
   */
  updateEmbedding(itemId: string, embedding: Float32Array, model: string = 'default'): void {
    // Convert Float32Array to Buffer
    const buffer = Buffer.alloc(embedding.length * 4);
    for (let i = 0; i < embedding.length; i++) {
      buffer.writeFloatLE(embedding[i], i * 4);
    }

    // Insert into embeddings table
    this.db.prepare(`
      INSERT INTO image_embeddings(id, item_id, model, vector, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET 
        vector = excluded.vector,
        created_at = excluded.created_at
    `).run(itemId, itemId, model, buffer);

    // Also update vec0 virtual table for similarity search
    // Note: sqlite-vec virtual tables don't support UPSERT, so we delete first
    this.db.prepare(`DELETE FROM image_vec_embeddings WHERE item_id = ?`).run(itemId);
    this.db.prepare(`
      INSERT INTO image_vec_embeddings(item_id, embedding)
      VALUES (?, ?)
    `).run(itemId, buffer);
  }

  /**
   * Update metadata cache (path, size, etc.)
   */
  updateMetaCache(itemId: string, data: {
    path: string;
    width?: number;
    height?: number;
    size?: number;
    checksum?: string;
    createdAt?: string;
    updatedAt?: string;
    caption?: string;
    captionElements?: any;
    captionSpatial?: string;
    captionTemporal?: string;
    captionTokens?: any;
  }): void {
    this.db.prepare(`
      INSERT INTO image_meta_cache(
        item_id, path, width, height, size, checksum, tags_json, created_at, updated_at,
        caption, caption_elements, caption_spatial, caption_temporal, caption_tokens
      )
      VALUES (?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(item_id) DO UPDATE SET
        path = excluded.path,
        width = excluded.width,
        height = excluded.height,
        size = excluded.size,
        checksum = excluded.checksum,
        updated_at = excluded.updated_at,
        caption = excluded.caption,
        caption_elements = excluded.caption_elements,
        caption_spatial = excluded.caption_spatial,
        caption_temporal = excluded.caption_temporal,
        caption_tokens = excluded.caption_tokens
    `).run(
      itemId,
      data.path,
      data.width || null,
      data.height || null,
      data.size || null,
      data.checksum || null,
      data.createdAt || new Date().toISOString(),
      data.updatedAt || new Date().toISOString(),
      data.caption || null,
      data.captionElements ? JSON.stringify(data.captionElements) : null,
      data.captionSpatial || null,
      data.captionTemporal || null,
      data.captionTokens ? JSON.stringify(data.captionTokens) : null
    );
  }

  /**
   * Update multi-pass caption data for an image
   */
  updateMultiPassCaption(itemId: string, data: {
    caption: string;
    elements?: any;
    spatial?: string;
    temporal?: string;
    tokens?: any;
  }): void {
    // Update image_meta_cache with multi-pass data
    this.db.prepare(`
      UPDATE image_meta_cache
      SET 
        caption = ?,
        caption_elements = ?,
        caption_spatial = ?,
        caption_temporal = ?,
        caption_tokens = ?
      WHERE item_id = ?
    `).run(
      data.caption,
      data.elements ? JSON.stringify(data.elements) : null,
      data.spatial || null,
      data.temporal || null,
      data.tokens ? JSON.stringify(data.tokens) : null,
      itemId
    );

    // Update FTS index with combined text for enhanced search
    const combinedText = this.buildCombinedSearchText(
      data.caption,
      data.spatial,
      data.temporal,
      data.elements
    );
    this.updateFTS(itemId, combinedText);
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
   * Batch update for better performance
   */
  batchUpdateEmbeddings(items: Array<{ itemId: string; embedding: Float32Array; model?: string }>): void {
    const transaction = this.db.transaction((batch: typeof items) => {
      for (const item of batch) {
        this.updateEmbedding(item.itemId, item.embedding, item.model);
      }
    });
    transaction(items);
  }

  /**
   * Batch update captions
   */
  batchUpdateCaptions(items: Array<{ itemId: string; caption: string }>): void {
    const transaction = this.db.transaction((batch: typeof items) => {
      for (const item of batch) {
        this.updateCaption(item.itemId, item.caption);
      }
    });
    transaction(items);
  }
}
