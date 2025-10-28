#!/usr/bin/env node

// Phase 2 backfill: populate image_search.db and av_search.db from existing data
// Strategy:
// - Log actual schemas of legacy DBs (video-rag.db, vector.db) and new DBs
// - Populate meta caches from media.db (safe, idempotent)
// - Leave embedding/transcript backfill as explicit steps once legacy table names are confirmed
//
// Logging follows the AI Agent Debugging Guide.

import fs from 'fs';
import path from 'path';
import process from 'process';
import Database from 'better-sqlite3';

function log(msg, ...args) { console.log(msg, ...args); }
function err(msg, ...args) { console.error(msg, ...args); }

function resolveDataDir() {
  const isDev = process.env.NODE_ENV === 'development' || !!process.env.VITE_DEV_SERVER_URL;
  const override = process.env.CINESTAR_DATA_DIR;
  const dir = override || (isDev ? path.join(process.cwd(), 'data') : path.join(process.cwd(), 'data'));
  log(`[DEBUG] Data dir: ${dir} (override=${!!override}, isDev=${isDev})`);
  return dir;
}

function openDb(file) {
  const exists = fs.existsSync(file);
  log(`[DEBUG] Opening DB: ${file} (exists=${exists})`);
  return new Database(file, { fileMustExist: exists });
}

function listTables(db, label) {
  try {
    const rows = db.prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table','view') ORDER BY name;").all();
    log(`[DB-SCHEMA-DEBUG] ${label} tables/views (${rows.length}):`, rows);
  } catch (e) {
    err(`[ERROR] Failed to list tables for ${label}:`, e);
  }
}

function backfillImageMetaCache(mediaDb, imageDb) {
  log('[BACKFILL] image_meta_cache: start');
  // Create table if missing (idempotent)
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

  // Upsert from media.media_items where type='image'
  const rows = mediaDb.prepare(`SELECT id, path, width, height, size, checksum, created_at, modified_at AS updated_at
                                FROM media_items WHERE type='image'`).all();
  log(`[DB-INSERT-DEBUG] Preparing image_meta_cache upsert for ${rows.length} rows`);

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

  const trx = imageDb.transaction((batch) => {
    for (const r of batch) upsert.run(r);
  });
  trx(rows);
  log('[SUCCESS] image_meta_cache backfill complete');
}

function backfillAvMetaCache(mediaDb, avDb) {
  log('[BACKFILL] av_meta_cache: start');
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

  // Items without segments (audio files without segmentation yet): insert item-level rows
  const items = mediaDb.prepare(`SELECT id, type, path, duration_ms, created_at, modified_at AS updated_at
                                 FROM media_items WHERE type IN ('video','audio')`).all();

  // Segments (video/audio) from media.segments
  const segments = mediaDb.prepare(`SELECT s.id AS segment_id, s.item_id, s.kind AS media_type, i.path, s.start_ms, s.end_ms, (s.end_ms - s.start_ms) AS duration_ms, i.created_at, i.modified_at AS updated_at
                                    FROM segments s JOIN media_items i ON i.id = s.item_id`).all();

  log(`[DB-INSERT-DEBUG] Preparing av_meta_cache upsert for ${items.length} items and ${segments.length} segments`);

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

  const trx = avDb.transaction((itemsBatch, segmentsBatch) => {
    for (const i of itemsBatch) {
      upsert.run({
        item_id: i.id,
        segment_id: null,
        media_type: i.type,
        path: i.path,
        start_ms: null,
        end_ms: null,
        duration_ms: i.duration_ms || null,
        title: null,
        created_at: i.created_at,
        updated_at: i.updated_at
      });
    }
    for (const s of segmentsBatch) {
      upsert.run({
        item_id: s.item_id,
        segment_id: s.segment_id,
        media_type: s.media_type,
        path: s.path,
        start_ms: s.start_ms,
        end_ms: s.end_ms,
        duration_ms: s.duration_ms,
        title: null,
        created_at: s.created_at,
        updated_at: s.updated_at
      });
    }
  });

  trx(items, segments);
  log('[SUCCESS] av_meta_cache backfill complete');
}

async function main() {
  try {
    const dataDir = resolveDataDir();
    const mediaDbPath = path.join(dataDir, 'media.db');
    const imageDbPath = path.join(dataDir, 'image_search.db');
    const avDbPath = path.join(dataDir, 'av_search.db');
    const jobsDbPath = path.join(dataDir, 'jobs.db');
    const configDbPath = path.join(dataDir, 'config.db');
    const legacyVectorPath = path.join(dataDir, 'vector.db');
    const legacyVideoPath = path.join(dataDir, 'video-rag.db');

    const mediaDb = openDb(mediaDbPath);
    const imageDb = openDb(imageDbPath);
    const avDb = openDb(avDbPath);
    const legacyVecDb = fs.existsSync(legacyVectorPath) ? openDb(legacyVectorPath) : null;
    const legacyVideoDb = fs.existsSync(legacyVideoPath) ? openDb(legacyVideoPath) : null;

    // Introspection logs
    listTables(mediaDb, 'media.db');
    listTables(imageDb, 'image_search.db');
    listTables(avDb, 'av_search.db');
    // Legacy overview
    try { listTables(openDb(legacyVectorPath), 'legacy vector.db'); } catch {}
    try { listTables(openDb(legacyVideoPath), 'legacy video-rag.db'); } catch {}

    // Phase 2.1: backfill meta caches from canonical media.db (safe)
    backfillImageMetaCache(mediaDb, imageDb);
    backfillAvMetaCache(mediaDb, avDb);

    // Phase 2.2: Image embeddings backfill from legacy vector.db -> image_search.image_vec_embeddings
    try {
      if (legacyVecDb) {
        log('[BACKFILL] image_vec_embeddings: start');
        // Ensure image_vec_embeddings exists (dimension set by migration; we do not recreate here)
        const hasTable = imageDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='image_vec_embeddings'").get();
        if (!hasTable) {
          err('[ERROR] image_vec_embeddings not found. Run migrations first.');
        } else {
          // Select image ids from media.db to restrict copy to images only
          const imageIds = new Set(mediaDb.prepare("SELECT id FROM media_items WHERE type='image'").all().map(r => r.id));
          log(`[DEBUG] Found ${imageIds.size} image ids in media.db for embedding copy.`);

          // Read embeddings from legacy vec_embeddings table
          const rows = legacyVecDb.prepare("SELECT item_id, embedding FROM vec_embeddings").all();
          log(`[DB-DEBUG] legacy vec_embeddings rows: ${rows.length}`);
          const insert = imageDb.prepare("INSERT OR REPLACE INTO image_vec_embeddings(item_id, embedding) VALUES(?, ?)");
          const trx = imageDb.transaction((batch) => {
            for (const r of batch) {
              if (!imageIds.has(r.item_id)) continue;
              insert.run(r.item_id, r.embedding);
            }
          });
          trx(rows);
          log('[SUCCESS] image_vec_embeddings backfill complete');
        }
      } else {
        log('[BACKFILL] Skipping image embeddings: legacy vector.db not found');
      }
    } catch (e) {
      err('[ERROR] Image embeddings backfill failed:', e);
    }

    // Phase 2.3: AV transcripts FTS seed from legacy video-rag.db -> av_search.transcripts_fts
    try {
      if (legacyVideoDb) {
        log('[BACKFILL] transcripts_fts: start');
        // Ensure FTS table exists
        const hasFts = avDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='transcripts_fts'").get();
        if (!hasFts) {
          err('[ERROR] transcripts_fts not found in av_search.db. Run migrations first.');
        } else {
          // Heuristic: find a table that has transcript text and segment ID
          // Common names: transcription_segments(transcript,text, segment_id) or video_segments
          let segRows = [];
          try {
            segRows = legacyVideoDb.prepare("SELECT id as segment_id, transcript FROM transcription_segments WHERE transcript IS NOT NULL AND transcript != ''").all();
          } catch {}
          if (segRows.length === 0) {
            try {
              segRows = legacyVideoDb.prepare("SELECT id as segment_id, transcript FROM video_segments WHERE transcript IS NOT NULL AND transcript != ''").all();
            } catch {}
          }
          log(`[DB-DEBUG] legacy transcript segments: ${segRows.length}`);
          const insertFts = avDb.prepare("INSERT INTO transcripts_fts(rowid, transcript) VALUES(?, ?)");
          const clearFts = avDb.prepare("DELETE FROM transcripts_fts");
          // Idempotent reset for now (acceptable for test backfill)
          clearFts.run();
          const trx = avDb.transaction((batch) => {
            for (const r of batch) insertFts.run(r.segment_id, r.transcript);
          });
          trx(segRows);
          log('[SUCCESS] transcripts_fts backfill complete');
        }
      } else {
        log('[BACKFILL] Skipping transcripts: legacy video-rag.db not found');
      }
    } catch (e) {
      err('[ERROR] AV transcripts backfill failed:', e);
    }

    log('[SUCCESS] Backfill complete (meta caches + image embeddings + AV transcripts).');
  } catch (e) {
    err('[ERROR] Backfill failed:', e);
    process.exit(1);
  }
}

main();
