import { VideoDatabase } from '../core/video-database';
import { EmbeddingService } from '../core/embedding-service';
import { MoondreamService } from '../core/processors/captioning-processor';

// Polling intervals can be tuned via env
const CAPTION_POLL_MS = Number(process.env.REFINED_CAPTION_POLL_MS || 10_000);
const EMBEDDING_POLL_MS = Number(process.env.REFINED_EMBED_POLL_MS || 15_000);
const CAPTION_BATCH = Number(process.env.REFINED_CAPTION_BATCH || 16);
const EMBEDDING_BATCH = Number(process.env.REFINED_EMBED_BATCH || 64);

let captionTimer: NodeJS.Timeout | undefined;
let embedTimer: NodeJS.Timeout | undefined;

async function runCaptionPass() {
  const db = new VideoDatabase();
  await db.initialize();
  try {
    const pending = await db.getRefinedKeyframesMissingCaption(CAPTION_BATCH);
    if (pending.length === 0) return;

    const service = new MoondreamService();
    const results: Array<{ id: string; caption: string }> = [];

    for (const row of pending) {
      try {
        const res = await service.caption(row.imagePath);
        results.push({ id: row.id, caption: res.caption || '' });
      } catch (e) {
        // continue on individual failure
        // console.warn(`[refined-caption] Failed for ${row.id}`, e);
      }
    }

    for (const r of results) {
      await db.updateRefinedKeyframeCaption(r.id, r.caption);
    }
  } finally {
    await db.close();
  }
}

async function runEmbeddingPass() {
  const db = new VideoDatabase();
  await db.initialize();
  try {
    const pending = await db.getRefinedKeyframesMissingEmbedding(EMBEDDING_BATCH);
    if (pending.length === 0) return;

    const texts = pending.map(p => p.caption);
    const svc = new EmbeddingService();
    const vectors = await svc.embed(texts);

    for (let i = 0; i < pending.length; i++) {
      const row = pending[i];
      const vec = vectors[i];
      try {
        await db.updateRefinedKeyframeEmbedding(row.id, vec);
      } catch (e) {
        // continue on individual failure
        // console.warn(`[refined-embed] Failed for ${row.id}`, e);
      }
    }
  } finally {
    await db.close();
  }
}

export function startRefinedWorkers() {
  if (!captionTimer) captionTimer = setInterval(() => { runCaptionPass().catch(() => {}); }, CAPTION_POLL_MS);
  if (!embedTimer) embedTimer = setInterval(() => { runEmbeddingPass().catch(() => {}); }, EMBEDDING_POLL_MS);
}

export function stopRefinedWorkers() {
  if (captionTimer) clearInterval(captionTimer);
  if (embedTimer) clearInterval(embedTimer);
  captionTimer = undefined;
  embedTimer = undefined;
}
