// Migration 050: Backfill processing_batches from video-rag.db to jobs.db
// This is a one-time migration to move existing batch data to the new location

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function up(context) {
  const { dataDir } = context;
  
  const videoRagPath = path.join(dataDir, 'video-rag.db');
  const jobsDbPath = path.join(dataDir, 'jobs.db');
  
  // Skip if video-rag.db doesn't exist (fresh install)
  if (!fs.existsSync(videoRagPath)) {
    console.log('[BACKFILL-050] video-rag.db not found, skipping backfill');
    return;
  }
  
  const videoRagDb = new Database(videoRagPath, { readonly: true });
  const jobsDb = new Database(jobsDbPath);
  
  try {
    // Check if processing_batches exists in video-rag.db
    const hasTable = videoRagDb.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='processing_batches'"
    ).get();
    
    if (!hasTable) {
      console.log('[BACKFILL-050] No processing_batches table in video-rag.db, skipping');
      return;
    }
    
    // Get existing batches from video-rag.db
    const batches = videoRagDb.prepare(`
      SELECT 
        id, video_id, batch_index, batch_type,
        start_time, end_time, duration, audio_path,
        transcription, embedding, visual_captions, scene_context,
        status, transcription_confidence, visual_confidence, scene_coherence,
        created_at, updated_at
      FROM processing_batches
    `).all();
    
    if (batches.length === 0) {
      console.log('[BACKFILL-050] No batches to migrate');
      return;
    }
    
    console.log(`[BACKFILL-050] Migrating ${batches.length} batches from video-rag.db to jobs.db`);
    
    // Insert into jobs.db (use INSERT OR IGNORE to handle duplicates)
    const insertStmt = jobsDb.prepare(`
      INSERT OR IGNORE INTO processing_batches (
        id, job_run_id, video_id, batch_index, batch_type,
        start_time, end_time, duration, audio_path,
        transcription, embedding, visual_captions, scene_context,
        status, transcription_confidence, visual_confidence, scene_coherence,
        created_at, updated_at
      ) VALUES (
        ?, 'legacy_migration', ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?
      )
    `);
    
    const transaction = jobsDb.transaction((batchList) => {
      for (const batch of batchList) {
        insertStmt.run(
          batch.id,
          batch.video_id,
          batch.batch_index,
          batch.batch_type || 'audio',
          batch.start_time,
          batch.end_time,
          batch.duration,
          batch.audio_path,
          batch.transcription,
          batch.embedding,
          batch.visual_captions,
          batch.scene_context,
          batch.status || 'audio_only',
          batch.transcription_confidence,
          batch.visual_confidence,
          batch.scene_coherence,
          batch.created_at || new Date().toISOString(),
          batch.updated_at
        );
      }
    });
    
    transaction(batches);
    
    const finalCount = jobsDb.prepare('SELECT COUNT(*) as count FROM processing_batches').get();
    console.log(`[BACKFILL-050] ✅ Migration complete: ${finalCount.count} batches in jobs.db`);
    
  } catch (error) {
    console.error('[BACKFILL-050] ❌ Migration failed:', error);
    throw error;
  } finally {
    videoRagDb.close();
    jobsDb.close();
  }
}

export function down(context) {
  // No rollback - backfill is idempotent
  console.log('[BACKFILL-050] Rollback not needed (idempotent migration)');
}
