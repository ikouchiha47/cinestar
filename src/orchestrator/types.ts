import type { ProcessingContext, ProcessingResult, VideoProcessor, VideoSegment } from '../core/video-pipeline';

export type { ProcessingContext, ProcessingResult, VideoProcessor, VideoSegment };

export type StageName =
  | 'discover'
  | 'audio-extraction'
  | 'transcription'
  | 'segmentation'
  | 'align-asr'
  | 'visual'
  | 'captioning'
  | 'ocr'
  | 'storyline'
  | 'embeddings'
  | 'indexing';

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'canceled';

export interface OrchestratorConfig {
  videoConcurrency: number; // how many videos in flight
  gpuBatchSize: number;     // frames per VLM batch
  ocrBatchSize: number;
  embeddingBatchSize: number;
}

export interface OrchestratorEventMap {
  'job:added': (job: Job) => void;
  'job:started': (job: Job) => void;
  'job:completed': (job: Job) => void;
  'job:failed': (job: Job) => void;
  'stage:start': (job: Job, stage: StageName) => void;
  'stage:complete': (job: Job, stage: StageName, durationMs: number) => void;
  'stage:error': (job: Job, stage: StageName, error: Error) => void;
}

export interface Job {
  id: string;
  videoPath: string;
  videoId?: string;
  status: JobStatus;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
}

export interface StageJobDependency {
  jobId: string;
  dependsOnJobId: string;
}

export interface JobEvent {
  id?: string;
  jobId: string;
  ts: Date;
  level: 'info' | 'warn' | 'error';
  message: string;
  payloadJson?: string;
}

export interface JobStore {
  create(job: Omit<Job, 'status' | 'createdAt'>): Job;
  get(id: string): Job | undefined;
  update(id: string, patch: Partial<Job>): Job | undefined;
  list(status?: JobStatus): Job[];
  addEvent(event: JobEvent): void;
}

export interface StorylineDoc {
  videoId: string;
  segments: Array<{
    id: string;
    start: number;
    end: number;
    asr?: string;
    captions?: string;
    ocr?: string;
    objects?: string[];
    keyframePath?: string;
  }>;
}
