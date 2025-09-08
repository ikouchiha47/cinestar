import * as fs from 'fs/promises';
import * as path from 'path';
import { VideoDatabase } from '../core/video-database';
import { EmbeddingService } from '../core/embedding-service';

export interface StorylineOptions {
  outDir?: string; // default data/storylines
}

export async function buildStorylineJson(videoId: string, opts: StorylineOptions = {}): Promise<string> {
  const embeddingService = new EmbeddingService();
  const videoDb = new VideoDatabase(embeddingService);
  await videoDb.initialize();

  const segments = await videoDb.getVideoSegments(videoId);
  const outDir = opts.outDir || path.resolve(process.cwd(), 'data', 'storylines');
  await fs.mkdir(outDir, { recursive: true });

  const doc = {
    videoId,
    segments: segments.map(s => ({
      id: s.id,
      start: s.startTime,
      end: s.endTime,
      asr: s.transcription || undefined,
      captions: s.caption || undefined,
      ocr: s.ocrText || undefined,
      keyframePath: s.keyframePath || undefined,
    }))
  };

  const outPath = path.join(outDir, `${videoId}.json`);
  await fs.writeFile(outPath, JSON.stringify(doc, null, 2), 'utf-8');
  await videoDb.close();
  return outPath;
}
