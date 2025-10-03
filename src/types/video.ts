/**
 * Video-related type definitions
 */

export interface VideoSegment {
  id: string;
  videoPath: string;
  startTime: number;
  endTime: number;
  duration: number;
  sceneIndex: number;
  thumbnailPath?: string;
  keyframePath?: string;
  audioPath?: string;
  transcription?: string;
  caption?: string;
  ocrText?: string;
  reconstructedScene?: string;
  embedding?: Float32Array;
  metadata?: Record<string, any>;
  createdAt: Date;
}

export interface VideoFile {
  id: string;
  filePath: string;
  fileName: string;
  fileSize: number;
  duration: number;
  width?: number;
  height?: number;
  frameRate?: number;
  bitrate?: number;
  codec?: string;
  totalSegments: number;
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed';
  processingError?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface VideoProcessingJob {
  id: string;
  videoPath: string;
  fileName: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'scheduled';
  progress: number;
  error?: string;
  startTime?: Date;
  endTime?: Date;
  segmentCount?: number;
  totalSegments?: number;
  currentStage?: string;
  // Progressive refinement fields
  refinementPass?: number;
  threshold?: number;
  parentJobId?: string;
  triggerCondition?: 'immediate' | 'delayed' | 'conditional';
  scheduledAt?: Date;
  // Batch processing notification fields
  metadata?: string;        // JSON string for batch processing metadata
  statusMessage?: string;   // User-friendly status message for notifications
  createdAt: Date;
  updatedAt: Date;
}

export interface SearchResult {
  segment: VideoSegment;
  video: VideoFile;
  score: number;
  matchType: 'text' | 'vector' | 'hybrid';
  snippet?: string;
}

export interface VideoSearchQuery {
  text: string;
  limit?: number;
  offset?: number;
}
