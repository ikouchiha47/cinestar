import { ConcurrencyLimiter } from '../core/concurrency-limiter';
import { MoondreamService } from '../core/processors/captioning-processor';
import { VideoDatabase } from '../core/video-database';

function pickImagePath(seg: { keyframePath?: string; thumbnailPath?: string }): string | undefined {
  return seg.keyframePath || seg.thumbnailPath;
}

export async function batchCaptionMissingSegments(videoId: string, concurrency = 2): Promise<number> {
  const videoDb = new VideoDatabase();
  await videoDb.initialize();

  const segments = await videoDb.getVideoSegments(videoId);
  const toCaption = segments.filter(s => !s.caption && (s.keyframePath || s.thumbnailPath));
  if (toCaption.length === 0) {
    await videoDb.close();
    return 0;
  }

  const service = new MoondreamService();
  const limiter = new ConcurrencyLimiter(concurrency);

  let completed = 0;
  await Promise.all(
    toCaption.map(seg => limiter.add(async () => {
      const img = pickImagePath(seg);
      if (!img) return;
      try {
        const res = await service.caption(img);
        await videoDb.updateVideoSegment(seg.id, { caption: res.caption });
        completed++;
      } catch (e) {
        // swallow errors for individual segments; log and continue
        console.warn(`[batch-caption] Failed for segment ${seg.id}:`, e);
      }
    }))
  );

  await videoDb.close();
  return completed;
}
