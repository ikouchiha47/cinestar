# Orchestrator: Batched, Resource-Aware VideoRAG Pipeline

This module introduces a job-driven orchestrator that runs the existing processors in a safer, batched, and resource-aware way without modifying current functionality.

Goals:
- Per-video stages run sequentially to guarantee data flow correctness.
- Parallelism is batched at segment- and modality-level with strict resource pools.
- Durable jobs model (plug in SQLite later), non-blocking search, and idempotent writes.

Directory structure
- types.ts: shared types for jobs, stages, contexts.
- resource-pools.ts: concurrency limiters for CPU/GPU/IO.
- job-queue.ts: in-memory job queue with dependency handling.
- job-store.ts: in-memory job store (stub). Add SQLite implementation later.
- pipeline-runner.ts: orchestrates per-video flow and batched segment processing.
- index.ts: public entrypoints to start and observe jobs.

Batching model
- Video-level: multiple videos in parallel (small N), each video’s stages sequential.
- Segment-level: micro-batch heavy ops:
  - Moondream v2 captions: batch 8–16 frames.
  - OCR crops: batch 8–16 (engine dependent).
  - Text embeddings (qllama/bge-large-en-v1.5): batch 32–128 texts.

Processing order (sequential per video)
1) Discovery → enqueue job (per video)
2) Extract audio → Transcribe full audio (ASR with timestamps)
3) Scene/shot segmentation (+Nyquist padding)
4) Align ASR to segments (timestamps)
5) Per-segment enrichment in micro-batches: keyframes → Moondream v2 → OCR (optional)
6) Storyline reconstruction (JSON with timestamps) in a separate job
7) Embeddings and indexing (micro-batched); commit frequently for non-blocking search

Reusing existing processors
- AudioExtractionProcessor → provides `data.audioPath`, set `context.segment.audioPath`
- TranscriptionProcessor → `data.asr` with timestamps
- SegmentationProcessor → `data.segments` with start/end
- VisualProcessor → `data.keyframePath`/`data.thumbnailPath`
- CaptioningProcessor (Moondream) → `data.captions`, `data.objects`
- OCRProcessor (optional) → `data.ocrText`

Notes
- No filesystem polling for orchestration. The orchestrator passes data between processors in-memory.
- SQLite job store + schema can replace the in-memory store later.
