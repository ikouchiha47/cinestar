-- sql: db:image_search
-- Create sqlite-vec virtual table for image embeddings in image_search.db
PRAGMA foreign_keys=ON;

-- meta to track embedding_dim (optional; code will reconcile if mismatch)
CREATE TABLE IF NOT EXISTS vector_meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Default dimension (code may recreate to match configured model)
INSERT OR IGNORE INTO vector_meta(key, value) VALUES('embedding_dim', '1024');

-- image embeddings virtual table
CREATE VIRTUAL TABLE IF NOT EXISTS image_vec_embeddings USING vec0(
  item_id TEXT PRIMARY KEY,
  embedding FLOAT[1024]
);
