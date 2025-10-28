// Script migration: 038_seed_modality
// Idempotent seeding for modality-local databases after SQL migrations
// Exports: async function run(ctx)

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

function loadVecExtension(db) {
  const platform = process.platform;
  const arch = process.arch;
  const isDev = !!process.env.VITE_DEV_SERVER_URL;
  const basePath = isDev ? '.' : path.join((process).resourcesPath || path.dirname(process.execPath), 'app.asar.unpacked');
  let extensionPath;
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
  if (!fs.existsSync(extensionPath)) throw new Error(`vec0 not found at ${extensionPath}`);
  db.loadExtension(extensionPath);
}

function openDb(file, mustExist = true) {
  const exists = fs.existsSync(file);
  if (mustExist && !exists) throw new Error(`DB missing: ${file}`);
  return new Database(file, { fileMustExist: exists });
}

function listTables(db, label) {
  try {
    const rows = db.prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table','view') ORDER BY name;").all();
    console.log(`[SCRIPT-DBG] ${label} tables/views: ${rows.length}`);
  } catch (e) {
    console.warn(`[SCRIPT-DBG] Failed to list tables for ${label}:`, e.message);
  }
}

function ensureImageMetaCache(mediaDb, imageDb) {
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
  const count = (imageDb.prepare('SELECT COUNT(*) AS c FROM image_meta_cache').get() || {}).c || 0;
  if (count === 0) {
    const rows = mediaDb.prepare(`SELECT id, path, width, height, size, checksum, created_at, modified_at AS updated_at
                                  FROM media_items WHERE type='image'`).all();
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
    const trx = imageDb.transaction(batch => { for (const r of batch) upsert.run(r); });
    trx(rows);
    console.log('[SCRIPT] ✅ image_meta_cache seeded');
  } else {
    console.log('[SCRIPT] ⏭️  image_meta_cache already populated');
  }
}

function ensureAvMetaCache(mediaDb, avDb) {
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
  const count = (avDb.prepare('SELECT COUNT(*) AS c FROM av_meta_cache').get() || {}).c || 0;
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
    const trx = avDb.transaction((itemsBatch, segmentsBatch) => {
      for (const i of itemsBatch) upsert.run({ item_id: i.id, segment_id: null, media_type: i.type, path: i.path, start_ms: null, end_ms: null, duration_ms: i.duration_ms || null, title: null, created_at: i.created_at, updated_at: i.updated_at });
      for (const s of segmentsBatch) upsert.run({ item_id: s.item_id, segment_id: s.segment_id, media_type: s.media_type, path: s.path, start_ms: s.start_ms, end_ms: s.end_ms, duration_ms: s.duration_ms, title: null, created_at: s.created_at, updated_at: s.updated_at });
    });
    trx(items, segments);
    console.log('[SCRIPT] ✅ av_meta_cache seeded');
  } else {
    console.log('[SCRIPT] ⏭️  av_meta_cache already populated');
  }
}

function maybeBackfillImageEmbeddings(mediaDb, imageDb, vectorDbPath) {
  const hasTable = imageDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='image_vec_embeddings'").get();
  if (!hasTable) { console.log('[SCRIPT] ⚠️ image_vec_embeddings missing, skip.'); return; }
  try { loadVecExtension(imageDb); } catch (e) { console.warn('[SCRIPT] ⚠️ Failed to load vec0 for imageDb:', e && e.message ? e.message : e); }
  const count = (imageDb.prepare('SELECT COUNT(*) AS c FROM image_vec_embeddings').get() || {}).c || 0;
  if (count > 0) { console.log('[SCRIPT] ⏭️  image_vec_embeddings already populated'); return; }
  if (!fs.existsSync(vectorDbPath)) { console.log('[SCRIPT] ⏭️  legacy vector.db not found'); return; }
  const legacyVecDb = openDb(vectorDbPath);
  try { loadVecExtension(legacyVecDb); } catch (e) { console.warn('[SCRIPT] ⚠️ Failed to load vec0 for legacy vector.db:', e && e.message ? e.message : e); }
  try {
    let imageIds = new Set((mediaDb.prepare("SELECT id FROM media_items WHERE type='image'").all()).map(r => r.id));
    if (imageIds.size === 0) {
      try {
        const legacyImageIds = legacyVecDb.prepare("SELECT id FROM media_items WHERE type='image'").all();
        imageIds = new Set(legacyImageIds.map(r => r.id));
        console.log(`[SCRIPT] ℹ️  media.db had 0 images; falling back to legacy vector.db media_items (${imageIds.size} ids)`);
      } catch (e2) {
        console.warn('[SCRIPT] ⚠️ Failed to read legacy image ids:', e2 && e2.message ? e2.message : e2);
      }
    }
    const rows = legacyVecDb.prepare('SELECT item_id, embedding FROM vec_embeddings').all();
    const insert = imageDb.prepare('INSERT OR REPLACE INTO image_vec_embeddings(item_id, embedding) VALUES(?, ?)');
    const trx = imageDb.transaction(batch => { for (const r of batch) { if (imageIds.has(r.item_id)) insert.run(r.item_id, r.embedding); } });
    trx(rows);
    console.log('[SCRIPT] ✅ image_vec_embeddings seeded from legacy vector.db');
  } catch (e) {
    console.warn('[SCRIPT] ⚠️ Failed to backfill image_vec_embeddings:', e.message);
  } finally {
    try { legacyVecDb.close(); } catch {}
  }
}

function maybeSeedTranscripts(avDb, videoRagPath) {
  const hasFts = avDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='transcripts_fts'").get();
  if (!hasFts) { console.log('[SCRIPT] ⚠️ transcripts_fts missing, skip.'); return; }
  const count = (avDb.prepare('SELECT COUNT(*) AS c FROM transcripts_fts').get() || {}).c || 0;
  if (count > 0) { console.log('[SCRIPT] ⏭️  transcripts_fts already populated'); return; }
  if (!fs.existsSync(videoRagPath)) { console.log('[SCRIPT] ⏭️  legacy video-rag.db not found'); return; }
  const legacyVideoDb = openDb(videoRagPath);
  try {
    let segRows = [];
    try { segRows = legacyVideoDb.prepare("SELECT id as segment_id, transcript FROM transcription_segments WHERE transcript IS NOT NULL AND transcript != ''").all(); } catch {}
    if (segRows.length === 0) {
      try { segRows = legacyVideoDb.prepare("SELECT id as segment_id, transcript FROM video_segments WHERE transcript IS NOT NULL AND transcript != ''").all(); } catch {}
    }
    if (segRows.length === 0) { console.log('[SCRIPT] ⏭️  No transcripts to seed'); return; }
    const insertFts = avDb.prepare('INSERT INTO transcripts_fts(rowid, transcript) VALUES(?, ?)');
    const trx = avDb.transaction(batch => { for (const r of batch) insertFts.run(r.segment_id, r.transcript); });
    trx(segRows);
    console.log('[SCRIPT] ✅ transcripts_fts seeded from legacy video-rag.db');
  } catch (e) {
    console.warn('[SCRIPT] ⚠️ Failed to seed transcripts_fts:', e.message);
  } finally {
    try { legacyVideoDb.close(); } catch {}
  }
}

export async function run(ctx) {
  try {
    const baseDir = ctx?.dataDir || process.cwd();
    const mediaDbPath = ctx?.dbPaths?.media || path.join(baseDir, 'media.db');
    const imageDbPath = ctx?.dbPaths?.image_search || path.join(baseDir, 'image_search.db');
    const avDbPath = ctx?.dbPaths?.av_search || path.join(baseDir, 'av_search.db');
    const vectorDbPath = ctx?.dbPaths?.vector || path.join(baseDir, 'vector.db');
    const videoRagDbPath = ctx?.dbPaths?.video || path.join(baseDir, 'video-rag.db');

    const mediaDb = openDb(mediaDbPath, true);
    const imageDb = openDb(imageDbPath, true);
    const avDb = openDb(avDbPath, true);
    try { loadVecExtension(imageDb); } catch (e) { console.warn('[SCRIPT] ⚠️ vec0 load (imageDb):', e && e.message ? e.message : e); }

    listTables(mediaDb, 'media.db');
    listTables(imageDb, 'image_search.db');
    listTables(avDb, 'av_search.db');

    ensureImageMetaCache(mediaDb, imageDb);
    ensureAvMetaCache(mediaDb, avDb);
    maybeBackfillImageEmbeddings(mediaDb, imageDb, vectorDbPath);
    maybeSeedTranscripts(avDb, videoRagDbPath);

    try { mediaDb.close(); } catch {}
    try { imageDb.close(); } catch {}
    try { avDb.close(); } catch {}
  } catch (e) {
    console.warn('[SCRIPT] Modality seed encountered a non-fatal error:', e && e.message ? e.message : e);
  }
}

export default { run };
