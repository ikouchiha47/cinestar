/**
 * Shared types and interfaces for video processing components
 */

export interface VideoProcessingContext {
  jobId: string;
  videoPath: string;
  videoId: string;
  refinementPass: number;
  threshold: number;
}

export interface BatchProcessingResult {
  batchId: string;
  videoPath: string;
  startTime: number;
  endTime: number;
  phase0Complete: boolean;
  phase1Complete: boolean;
  transcription?: string;
  keyframes?: KeyframeData[];
  sceneReconstruction?: string;
  embedding?: Float32Array;
  multiPassData?: MultiPassCaptionData;
}

export interface KeyframeData {
  id: string;
  timestamp: number;
  imagePath: string;
  caption: string;
  spatial?: string;
  temporal?: string;
  elements?: any;
  confidence?: number;
}

export interface SegmentStorageData {
  segmentId: string;
  videoPath: string;
  parentSourceId?: string; // Parent video's sourceId from media.db for FK constraint
  startTime: number;
  endTime: number;
  transcription?: string;
  caption?: string;
  embedding?: Float32Array;
  multiPassData?: MultiPassCaptionData;
}

export interface MultiPassCaptionData {
  caption: string;
  spatial?: string;
  temporal?: string;
  elements?: string[];
  tokens?: number;
}

export interface ProgressUpdate {
  jobId: string;
  progress: number;
  currentPhase: 'phase0' | 'phase1' | 'completed';
  phase0Complete: number;
  phase1Complete: number;
  totalBatches: number;
  actionTitle: string;
  actionDescription: string;
}

export interface BatchCompletionStats {
  phase0: number;
  phase1: number;
  totalBatches: number;
}
