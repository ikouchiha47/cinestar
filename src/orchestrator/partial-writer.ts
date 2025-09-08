import { VideoMediaAPI } from '../api/video-media-api';
import { VideoDatabase } from '../core/video-database';
import { detectScenes, createVideoSegments } from '../core/video-processing';

interface PartialWriterOptions {
  overlapSeconds?: number;
  minSegmentLength?: number;
  threshold?: number;
}

/**
 * Attach a safe partial-writer that listens to pipeline events and writes
 * segments to the shared VideoDatabase as soon as segmentation is ready.
 *
 * This does NOT modify existing processors. It recomputes segmentation
 * once per video to persist segments early and avoid blocking search/UI.
 */
export function attachPartialSegmentWriter(api: VideoMediaAPI, opts: PartialWriterOptions = {}) {
  const processed = new Set<string>(); // videoPath
  const writing = new Set<string>();
  const threshold = opts.threshold ?? 0.4;
  const overlapSeconds = opts.overlapSeconds ?? 2;
  const minSegmentLength = opts.minSegmentLength ?? 3;

  async function writeSegmentsFor(videoPath: string) {
    if (processed.has(videoPath) || writing.has(videoPath)) return;
    writing.add(videoPath);

    const videoDb = new VideoDatabase();
    try {
      await videoDb.initialize();
      const file = await videoDb.getVideoFileByPath(videoPath);
      if (!file) {
        // Video row not created yet; try later
        return;
      }

      // Check existing segments to keep idempotent
      const existing = await videoDb.getVideoSegments(file.id);
      if (existing && existing.length > 0) {
        processed.add(videoPath);
        return;
      }

      // Recompute segmentation cheaply to persist segments early
      const sceneCuts = await detectScenes(videoPath, threshold);
      const segments = await createVideoSegments(videoPath, file.id, sceneCuts, overlapSeconds, minSegmentLength);

      // Shape to DB insert structure
      const toStore = segments.map((s, i) => ({
        videoPath,
        startTime: s.startTime,
        endTime: s.endTime,
        duration: s.endTime - s.startTime,
        sceneIndex: i,
        thumbnailPath: s.thumbnailPath,
        keyframePath: s.keyframePath,
        transcription: undefined,
        caption: undefined,
        ocrText: undefined,
        embedding: undefined,
        metadata: undefined,
      }));

      if (toStore.length > 0) {
        await videoDb.addVideoSegmentsBatch(toStore);
        // Update video file totals
        await videoDb.updateVideoFile(file.id, { totalSegments: toStore.length });
      }

      processed.add(videoPath);
    } catch (e) {
      console.warn('[partial-writer] failed to write segments early for', videoPath, e);
    } finally {
      writing.delete(videoPath);
      await videoDb.close();
    }
  }

  // Listen to progress events to learn videoPath and stage order
  const onProgress = (payload: any) => {
    try {
      if (!payload || !payload.videoPath) return;
      if (payload.stage === 'segmentation') {
        // Trigger early segment write once per video
        void writeSegmentsFor(payload.videoPath);
      }
    } catch (e) {
      // swallow
    }
  };

  api.onPipeline('progress', onProgress);

  return () => {
    // Unsubscribe if needed in the future
    // Note: VideoMediaAPI.onPipeline does not yet return an off handle; for now this is a no-op.
  };
}
