#!/usr/bin/env node

/**
 * Backfill script to populate vec_embeddings virtual table from existing media_items embeddings
 * 
 * Problem: Video segments have embeddings stored in media_items.embedding column
 * but they were never added to the vec_embeddings virtual table, causing 0 search results.
 * 
 * This script reads all items with embedding_status='completed' and adds their embeddings
 * to the vec_embeddings virtual table so they become searchable.
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Determine the correct sqlite-vec extension path
function getSqliteVecExtensionPath() {
  const platform = process.platform;
  const arch = process.arch;
  
  let extensionPath;
  if (platform === 'darwin' && arch === 'arm64') {
    extensionPath = path.resolve('node_modules/sqlite-vec-darwin-arm64/vec0.dylib');
  } else if (platform === 'darwin' && arch === 'x64') {
    extensionPath = path.resolve('node_modules/sqlite-vec-darwin-x64/vec0.dylib');
  } else if (platform === 'linux' && arch === 'x64') {
    extensionPath = path.resolve('node_modules/sqlite-vec-linux-x64/vec0.so');
  } else if (platform === 'linux' && arch === 'arm64') {
    extensionPath = path.resolve('node_modules/sqlite-vec-linux-arm64/vec0.so');
  } else if (platform === 'win32' && arch === 'x64') {
    extensionPath = path.resolve('node_modules/sqlite-vec-windows-x64/vec0.dll');
  } else {
    throw new Error(`Unsupported platform: ${platform}-${arch}`);
  }
  
  if (!fs.existsSync(extensionPath)) {
    throw new Error(`sqlite-vec extension not found at: ${extensionPath}`);
  }
  
  return extensionPath;
}

async function backfillVecEmbeddings() {
  const dbPath = path.resolve('data/vector.db');
  
  console.log(`[BACKFILL] Opening database: ${dbPath}`);
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  
  // Load sqlite-vec extension
  const extensionPath = getSqliteVecExtensionPath();
  console.log(`[BACKFILL] Loading sqlite-vec extension from: ${extensionPath}`);
  db.loadExtension(extensionPath);
  console.log(`[BACKFILL] ✅ sqlite-vec extension loaded`);
  
  // Get all items with completed embeddings
  const stmt = db.prepare(`
    SELECT id, name, type, embedding, embedding_status
    FROM media_items
    WHERE embedding_status = 'completed' AND embedding IS NOT NULL
  `);
  
  const items = stmt.all();
  console.log(`[BACKFILL] Found ${items.length} items with completed embeddings`);
  
  if (items.length === 0) {
    console.log(`[BACKFILL] No items to backfill. Exiting.`);
    db.close();
    return;
  }
  
  // Check current vec_embeddings count
  const countStmt = db.prepare(`SELECT COUNT(*) as count FROM vec_embeddings_rowids`);
  const beforeCount = countStmt.get().count;
  console.log(`[BACKFILL] Current vec_embeddings count: ${beforeCount}`);
  
  // Prepare insert statement for vec_embeddings
  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO vec_embeddings (item_id, embedding)
    VALUES (?, ?)
  `);
  
  let successCount = 0;
  let errorCount = 0;
  
  // Process each item
  for (const item of items) {
    try {
      // Parse the JSON-stored embedding
      const embeddingObj = JSON.parse(item.embedding);
      
      // Convert object with numeric keys to array
      // The embedding is stored as {"0": val, "1": val, ...}
      const embeddingArray = Object.keys(embeddingObj)
        .sort((a, b) => parseInt(a) - parseInt(b))
        .map(key => embeddingObj[key]);
      
      console.log(`[BACKFILL-DEBUG] Item ${item.id}: parsed ${embeddingArray.length} dimensions`);
      
      // Convert to Float32Array
      const float32Array = new Float32Array(embeddingArray);
      
      // Serialize to buffer (same format as addEmbedding method)
      const buffer = Buffer.alloc(float32Array.length * 4);
      for (let i = 0; i < float32Array.length; i++) {
        buffer.writeFloatLE(float32Array[i], i * 4);
      }
      
      // Insert into vec_embeddings
      insertStmt.run(item.id, buffer);
      successCount++;
      
      if (successCount % 10 === 0) {
        console.log(`[BACKFILL] Progress: ${successCount}/${items.length} items processed...`);
      }
    } catch (error) {
      console.error(`[BACKFILL] ❌ Failed to process item ${item.id} (${item.name}):`, error.message);
      errorCount++;
    }
  }
  
  // Check final vec_embeddings count
  const afterCount = countStmt.get().count;
  console.log(`[BACKFILL] Final vec_embeddings count: ${afterCount}`);
  console.log(`[BACKFILL] ✅ Backfill complete!`);
  console.log(`[BACKFILL] Summary: ${successCount} succeeded, ${errorCount} failed, ${afterCount - beforeCount} new embeddings added`);
  
  db.close();
}

// Run the backfill
backfillVecEmbeddings().catch(error => {
  console.error('[BACKFILL] Fatal error:', error);
  process.exit(1);
});
