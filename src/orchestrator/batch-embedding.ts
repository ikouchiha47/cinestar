import { EmbeddingService } from '../core/embedding-service';
import { VideoDatabase } from '../core/video-database';

function buildCombinedText(seg: {
  transcription?: string;
  caption?: string;
  ocrText?: string;
}): string {
  return [seg.transcription, seg.caption, seg.ocrText].filter(Boolean).join(' ').trim();
}

export async function batchEmbedMissingSegments(videoId: string, batchSize = 64): Promise<number> {
  const embeddingService = new EmbeddingService();
  const videoDb = new VideoDatabase(embeddingService);
  await videoDb.initialize();

  const segments = await videoDb.getVideoSegments(videoId);
  const missing = segments.filter(s => !s.embedding);
  if (missing.length === 0) {
    return 0;
  }

  let updated = 0;
  for (let i = 0; i < missing.length; i += batchSize) {
    const batch = missing.slice(i, i + batchSize);
    const texts = batch.map(buildCombinedText);

    // Guard: empty texts shouldn't be sent to embeddings service
    const indicesToEmbed: number[] = [];
    const inputs: string[] = [];
    texts.forEach((t, idx) => {
      if (t && t.length > 0) {
        indicesToEmbed.push(idx);
        inputs.push(t);
      }
    });

    if (inputs.length === 0) continue;

    // Depending on provider, this may internally call embedSingle per item; still benefits from fewer round trips with OpenAI-compatible backends
    const vectors = await embeddingService.embed(inputs);

    // Write back embeddings to DB
    for (let j = 0; j < indicesToEmbed.length; j++) {
      const localIdx = indicesToEmbed[j];
      const seg = batch[localIdx];
      const vec = vectors[j];
      try {
        await videoDb.updateVideoSegment(seg.id, { embedding: vec });
        updated++;
      } catch (e) {
        console.warn(`[batch-embed] Failed to update segment ${seg.id}:`, e);
      }
    }
  }

  await videoDb.close();
  return updated;
}
