/**
 * Database constants and configuration values
 */

export const DATABASE_CONSTANTS = {
  // Default paths
  DEFAULT_VECTOR_DB_PATH: './data/vector.db',
  DEFAULT_VIDEO_DB_PATH: './data/video-rag.db',
  
  // Vector dimensions
  DEFAULT_EMBEDDING_DIM: 1024,
  
  // Processing batch sizes
  DEFAULT_BATCH_SIZE: 10,
  COMPRESSION_BATCH_SIZE: 5,
  
  // Status values
  PROCESSING_STATUS: {
    PENDING: 'pending' as const,
    COMPLETED: 'completed' as const,
    FAILED: 'failed' as const
  },
  
  // SQL queries
  QUERIES: {
    FIND_EXISTING_ITEM: `
      SELECT caption_status, embedding_status, caption, embedding, 
             caption_generated_at, embedding_generated_at 
      FROM media_items 
      WHERE path = ? OR id LIKE ?
    `,
    
    UPSERT_MEDIA_ITEM: `
      INSERT OR REPLACE INTO media_items (
        id, source_id, name, path, size, type, created_at, updated_at,
        caption, caption_generated_at, caption_status,
        embedding, embedding_generated_at, embedding_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    
    UPDATE_CAPTION: `
      UPDATE media_items 
      SET caption = ?, caption_generated_at = ?, caption_status = ?, updated_at = ?
      WHERE id = ?
    `,
    
    UPDATE_EMBEDDING: `
      UPDATE media_items 
      SET embedding = ?, embedding_generated_at = ?, embedding_status = ?, updated_at = ?
      WHERE id = ?
    `
  }
} as const;
