import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';

function openDb(file: string, mustExist = true) {
  const exists = fs.existsSync(file);
  if (mustExist && !exists) throw new Error(`DB missing: ${file}`);
  const db = new Database(file, { fileMustExist: exists });
  
  // Load vec0 extension for databases that need it (image_search.db, av_search.db, vector.db)
  // Important: Backfill queries legacy vector.db's vec_embeddings BEFORE the global loader runs,
  // so we must ensure the extension is loaded here for vector.db as well.
  if (
    file.includes('image_search.db') ||
    file.includes('av_search.db') ||
    file.includes('vector.db')
  ) {
    try {
      // Find the platform-specific vec0 binary
      const platform = process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : 'linux';
      const arch = process.arch;
      
      // ESM-compatible: resolve the package path manually instead of using require.resolve
      const packageName = `sqlite-vec-${platform}-${arch}`;
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      
      // Try to find the package in node_modules
      let vec0Path: string;
      const possiblePaths = [
        path.join(__dirname, '../../node_modules', packageName, 'vec0.dylib'),
        path.join(process.cwd(), 'node_modules', packageName, 'vec0.dylib'),
      ];
      
      vec0Path = possiblePaths.find(p => fs.existsSync(p)) || possiblePaths[0];
      
      if (fs.existsSync(vec0Path)) {
        db.loadExtension(vec0Path);
      } else {
        console.warn(`[WARN] vec0 extension not found at ${vec0Path}`);
      }
    } catch (e) {
      console.warn(`[WARN] Failed to load vec0 extension for ${file}:`, e);
    }
  }
  
  return db;
}

function listTables(db: Database.Database, label: string) {
  try {
    const rows = db.prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table','view') ORDER BY name;").all();
    console.log(`[DB-SCHEMA-DEBUG] ${label} tables/views (${rows.length})`);
  } catch (e) {
    console.warn(`[WARN] Failed to list tables for ${label}:`, e);
  }
}

function ensureImageMetaCache(mediaDb: Database.Database, imageDb: Database.Database) {
  imageDb.exec(`CREATE TABLE IF NOT EXISTS image_meta_cache (
    item_id TEXT PRIMARY KEY,
    path TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    size INTEGER,
    checksum TEXT,
    tags_json TEXT,
    created_at TEXT,
    updated_at TEXT
  );`);
  const count = (imageDb.prepare('SELECT COUNT(1) AS c FROM image_meta_cache').get() as any)?.c || 0;
  console.log(`[BACKFILL] image_meta_cache count: ${count}`);
  if (count === 0) {
    console.log('[BACKFILL] Filling image_meta_cache from media.db...');
    const rows = mediaDb.prepare(`SELECT id, path, width, height, size, checksum, created_at, modified_at AS updated_at
                                  FROM media_items WHERE type='image'`).all();
    console.log(`[BACKFILL] Found ${rows.length} images to backfill`);
    const upsert = imageDb.prepare(`INSERT INTO image_meta_cache(item_id, path, width, height, size, checksum, tags_json, created_at, updated_at)
                                    VALUES (@id, @path, @width, @height, @size, @checksum, '[]', @created_at, @updated_at)
                                    ON CONFLICT(item_id) DO UPDATE SET
                                      path=excluded.path,
                                      width=excluded.width,
                                      height=excluded.height,
                                      size=excluded.size,
                                      checksum=excluded.checksum,
                                      created_at=excluded.created_at,
                                      updated_at=excluded.updated_at`);
    const trx = imageDb.transaction((batch: any[]) => { for (const r of batch) upsert.run(r); });
    trx(rows);
    console.log('[SUCCESS] image_meta_cache seeded');
  }
}

function ensureAvMetaCache(mediaDb: Database.Database, avDb: Database.Database) {
  avDb.exec(`CREATE TABLE IF NOT EXISTS av_meta_cache (
    item_id TEXT NOT NULL,
    segment_id TEXT,
    media_type TEXT NOT NULL CHECK(media_type IN ('video','audio')),
    path TEXT NOT NULL,
    start_ms INTEGER,
    end_ms INTEGER,
    duration_ms INTEGER,
    title TEXT,
    tags_json TEXT,
    created_at TEXT,
    updated_at TEXT,
    PRIMARY KEY (item_id, segment_id, media_type)
  );`);
  const count = (avDb.prepare('SELECT COUNT(1) AS c FROM av_meta_cache').get() as any)?.c || 0;
  if (count === 0) {
    const items = mediaDb.prepare(`SELECT id, type, path, duration_ms, created_at, modified_at AS updated_at
                                   FROM media_items WHERE type IN ('video','audio')`).all();
    const segments = mediaDb.prepare(`SELECT s.id AS segment_id, s.item_id, s.kind AS media_type, i.path, s.start_ms, s.end_ms, (s.end_ms - s.start_ms) AS duration_ms, i.created_at, i.modified_at AS updated_at
                                      FROM segments s JOIN media_items i ON i.id = s.item_id`).all();
    const upsert = avDb.prepare(`INSERT INTO av_meta_cache(item_id, segment_id, media_type, path, start_ms, end_ms, duration_ms, title, tags_json, created_at, updated_at)
                                 VALUES (@item_id, @segment_id, @media_type, @path, @start_ms, @end_ms, @duration_ms, @title, '[]', @created_at, @updated_at)
                                 ON CONFLICT(item_id, segment_id, media_type) DO UPDATE SET
                                   path=excluded.path,
                                   start_ms=excluded.start_ms,
                                   end_ms=excluded.end_ms,
                                   duration_ms=excluded.duration_ms,
                                   title=excluded.title,
                                   created_at=excluded.created_at,
                                   updated_at=excluded.updated_at`);
    const trx = avDb.transaction((itemsBatch: any[], segmentsBatch: any[]) => {
      for (const i of itemsBatch) {
        upsert.run({ item_id: i.id, segment_id: null, media_type: i.type, path: i.path, start_ms: null, end_ms: null, duration_ms: i.duration_ms || null, title: null, created_at: i.created_at, updated_at: i.updated_at });
      }
      for (const s of segmentsBatch) {
        upsert.run({ item_id: s.item_id, segment_id: s.segment_id, media_type: s.media_type, path: s.path, start_ms: s.start_ms, end_ms: s.end_ms, duration_ms: s.duration_ms, title: null, created_at: s.created_at, updated_at: s.updated_at });
      }
    });
    trx(items, segments);
    console.log('[SUCCESS] av_meta_cache seeded');
  }
}

function maybeBackfillMediaItems(mediaDb: Database.Database, vectorDbPath: string) {
  // Only backfill if media.db is empty AND vector.db exists and has data
  const count = (mediaDb.prepare('SELECT COUNT(1) AS c FROM media_items').get() as any)?.c || 0;
  console.log(`[BACKFILL] media_items count: ${count}`);
  
  if (count > 0) {
    console.log('[BACKFILL] media_items already has data, skipping backfill');
    return;
  }
  
  if (!fs.existsSync(vectorDbPath)) {
    console.log('[BACKFILL] vector.db not found, skipping media_items backfill');
    return;
  }
  
  const legacyVecDb = openDb(vectorDbPath);
  try {
    // Check if vector.db has media_items table and data
    let vectorCount = 0;
    try {
      vectorCount = (legacyVecDb.prepare('SELECT COUNT(1) AS c FROM media_items').get() as any)?.c || 0;
    } catch (e) {
      console.log('[BACKFILL] vector.db has no media_items table, skipping backfill');
      return;
    }
    
    if (vectorCount === 0) {
      console.log('[BACKFILL] vector.db media_items is empty, skipping backfill');
      return;
    }
    
    console.log(`[BACKFILL] Backfilling ${vectorCount} items from vector.db to media.db...`);
    
    const rows = legacyVecDb.prepare(`
      SELECT 
        id,
        source_id,
        type,
        path,
        size,
        mime_type,
        created_at,
        modified_at,
        duration,
        width,
        height
      FROM media_items
    `).all();
    
    const insert = mediaDb.prepare(`
      INSERT OR IGNORE INTO media_items (
        id, source_id, type, path, checksum, size, mime,
        created_at, modified_at, duration_ms, width, height,
        fps, exif_json, status, deleted_at
      ) VALUES (
        @id, @source_id, @type, @path, NULL, @size, @mime_type,
        COALESCE(@created_at, CURRENT_TIMESTAMP), @modified_at,
        ROUND(COALESCE(@duration, 0) * 1000.0), @width, @height,
        NULL, NULL, 'indexed', NULL
      )
    `);
    
    const trx = mediaDb.transaction((batch: any[]) => {
      for (const r of batch) insert.run(r);
    });
    
    trx(rows);
    
    const finalCount = (mediaDb.prepare('SELECT COUNT(1) AS c FROM media_items').get() as any)?.c || 0;
    console.log(`[SUCCESS] media_items backfilled: ${finalCount} items (${vectorCount - finalCount} duplicates removed)`);
  } catch (e) {
    console.warn('[WARN] Failed to backfill media_items from vector.db:', e);
  } finally {
    legacyVecDb.close();
  }
}

function maybeBackfillImageEmbeddings(mediaDb: Database.Database, imageDb: Database.Database, vectorDbPath: string) {
  const hasTable = imageDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='image_vec_embeddings'").get();
  if (!hasTable) return;
  const count = (imageDb.prepare('SELECT COUNT(1) AS c FROM image_vec_embeddings').get() as any)?.c || 0;
  if (count > 0) return;
  if (!fs.existsSync(vectorDbPath)) return;
  const legacyVecDb = openDb(vectorDbPath);
  try {
    const imageIds = new Set(mediaDb.prepare("SELECT id FROM media_items WHERE type='image'").all().map((r: any) => r.id));
    const rows = legacyVecDb.prepare('SELECT item_id, embedding FROM vec_embeddings').all();
    // Note: sqlite-vec virtual tables don't support INSERT OR REPLACE, use DELETE + INSERT
    const deleteStmt = imageDb.prepare('DELETE FROM image_vec_embeddings WHERE item_id = ?');
    const insert = imageDb.prepare('INSERT INTO image_vec_embeddings(item_id, embedding) VALUES(?, ?)');
    const trx = imageDb.transaction((batch: any[]) => { 
      for (const r of batch) { 
        if (imageIds.has(r.item_id)) {
          deleteStmt.run(r.item_id);
          insert.run(r.item_id, r.embedding);
        }
      } 
    });
    trx(rows);
    console.log('[SUCCESS] image_vec_embeddings seeded from legacy vector.db');
  } catch (e) {
    console.warn('[WARN] Failed to backfill image_vec_embeddings:', e);
  } finally {
    legacyVecDb.close();
  }
}

function maybeSeedTranscripts(avDb: Database.Database, videoRagPath: string) {
  const hasFts = avDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='transcripts_fts'").get();
  if (!hasFts) return;
  const count = (avDb.prepare('SELECT COUNT(1) AS c FROM transcripts_fts').get() as any)?.c || 0;
  if (count > 0) return;
  if (!fs.existsSync(videoRagPath)) return;
  const legacyVideoDb = openDb(videoRagPath);
  try {
    let segRows: any[] = [];
    try { segRows = legacyVideoDb.prepare("SELECT id as segment_id, transcript FROM transcription_segments WHERE transcript IS NOT NULL AND transcript != ''").all(); } catch {}
    if (segRows.length === 0) {
      try { segRows = legacyVideoDb.prepare("SELECT id as segment_id, transcript FROM video_segments WHERE transcript IS NOT NULL AND transcript != ''").all(); } catch {}
    }
    if (segRows.length === 0) return;
    const insertFts = avDb.prepare('INSERT INTO transcripts_fts(rowid, transcript) VALUES(?, ?)');
    const trx = avDb.transaction((batch: any[]) => { for (const r of batch) insertFts.run(r.segment_id, r.transcript); });
    trx(segRows);
    console.log('[SUCCESS] transcripts_fts seeded from legacy video-rag.db');
  } catch (e) {
    console.warn('[WARN] Failed to seed transcripts_fts:', e);
  } finally {
    legacyVideoDb.close();
  }
}

export function runModalityBackfillIfNeeded(baseDir: string) {
  try {
    console.log('[BACKFILL] 🚀 Starting modality backfill...');
    const dataDir = baseDir; // baseDir is already resolved by caller
    const mediaDbPath = path.join(dataDir, 'media.db');
    const imageDbPath = path.join(dataDir, 'image_search.db');
    const avDbPath = path.join(dataDir, 'av_search.db');
    const vectorDbPath = path.join(dataDir, 'vector.db');
    const videoRagDbPath = path.join(dataDir, 'video-rag.db');

    console.log('[BACKFILL] 📂 Database paths:');
    console.log(`  media.db: ${mediaDbPath}`);
    console.log(`  image_search.db: ${imageDbPath}`);
    console.log(`  av_search.db: ${avDbPath}`);

    const mediaDb = openDb(mediaDbPath, true);
    const imageDb = openDb(imageDbPath, true);
    const avDb = openDb(avDbPath, true);
    
    // Check source data
    const imageCount = (mediaDb.prepare("SELECT COUNT(*) as c FROM media_items WHERE type='image'").get() as any)?.c || 0;
    const videoCount = (mediaDb.prepare("SELECT COUNT(*) as c FROM media_items WHERE type='video'").get() as any)?.c || 0;
    console.log(`[BACKFILL] 📊 media.db has: ${imageCount} images, ${videoCount} videos`);
    
    const imageCacheCount = (imageDb.prepare("SELECT COUNT(*) as c FROM image_meta_cache").get() as any)?.c || 0;
    const avCacheCount = (avDb.prepare("SELECT COUNT(*) as c FROM av_meta_cache").get() as any)?.c || 0;
    console.log(`[BACKFILL] 📊 Current cache counts: image_meta_cache=${imageCacheCount}, av_meta_cache=${avCacheCount}`);

    // introspection (light)
    listTables(mediaDb, 'media.db');
    listTables(imageDb, 'image_search.db');
    listTables(avDb, 'av_search.db');

    // FIRST: Backfill media_items from vector.db to media.db if needed
    // This must happen BEFORE cache population since caches read from media.db
    maybeBackfillMediaItems(mediaDb, vectorDbPath);

    // meta caches
    ensureImageMetaCache(mediaDb, imageDb);
    ensureAvMetaCache(mediaDb, avDb);

    // embeddings + transcripts (only if empty)
    maybeBackfillImageEmbeddings(mediaDb, imageDb, vectorDbPath);
    maybeSeedTranscripts(avDb, videoRagDbPath);

    mediaDb.close();
    imageDb.close();
    avDb.close();
  } catch (e) {
    console.warn('[MODALITY-BACKFILL] Non-fatal backfill error:', e);
  }
}
