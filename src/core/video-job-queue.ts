import { EventEmitter } from 'events';
import { VideoSegment, ProcessingContext } from './video-pipeline.js';

export interface VideoJob {
  id: string;
  videoId: string;
  videoPath: string;
  stage: string;
  segment: VideoSegment;
  dependencies: string[]; // Job IDs this job depends on
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: ProcessingContext;
  error?: string;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

export class VideoJobQueue extends EventEmitter {
  private jobs: Map<string, VideoJob> = new Map();
  private runningJobs: Set<string> = new Set();
  private maxConcurrency: number;

  constructor(maxConcurrency = 3) {
    super();
    this.maxConcurrency = maxConcurrency;
  }

  addJob(job: Omit<VideoJob, 'status' | 'createdAt'>): string {
    const fullJob: VideoJob = {
      ...job,
      status: 'pending',
      createdAt: new Date()
    };
    
    this.jobs.set(job.id, fullJob);
    this.emit('job:added', fullJob);
    
    // Try to process immediately
    this.processNext();
    
    return job.id;
  }

  private async processNext(): Promise<void> {
    if (this.runningJobs.size >= this.maxConcurrency) {
      return;
    }

    // Find next job that can run (dependencies completed)
    const readyJob = this.findReadyJob();
    if (!readyJob) {
      return;
    }

    this.runningJobs.add(readyJob.id);
    readyJob.status = 'running';
    readyJob.startedAt = new Date();
    
    this.emit('job:started', readyJob);

    try {
      // Job processing will be handled by the pipeline
      // This is just the queue management
    } catch (error: any) {
      readyJob.status = 'failed';
      readyJob.error = error.message;
      readyJob.completedAt = new Date();
      this.emit('job:failed', readyJob);
    }

    this.runningJobs.delete(readyJob.id);
    
    // Process next job
    setImmediate(() => this.processNext());
  }

  private findReadyJob(): VideoJob | null {
    for (const job of this.jobs.values()) {
      if (job.status !== 'pending') continue;
      
      // Check if all dependencies are completed
      const dependenciesCompleted = job.dependencies.every(depId => {
        const depJob = this.jobs.get(depId);
        return depJob && depJob.status === 'completed';
      });
      
      if (dependenciesCompleted) {
        return job;
      }
    }
    return null;
  }

  completeJob(jobId: string, result: ProcessingContext): void {
    const job = this.jobs.get(jobId);
    if (!job) return;

    job.status = 'completed';
    job.result = result;
    job.completedAt = new Date();
    
    this.emit('job:completed', job);
    
    // Process next jobs
    this.processNext();
  }

  failJob(jobId: string, error: string): void {
    const job = this.jobs.get(jobId);
    if (!job) return;

    job.status = 'failed';
    job.error = error;
    job.completedAt = new Date();
    
    this.emit('job:failed', job);
    
    // Process next jobs
    this.processNext();
  }

  getJob(jobId: string): VideoJob | undefined {
    return this.jobs.get(jobId);
  }

  getJobsByVideo(videoId: string): VideoJob[] {
    return Array.from(this.jobs.values()).filter(job => job.videoId === videoId);
  }

  getJobsByStage(stage: string): VideoJob[] {
    return Array.from(this.jobs.values()).filter(job => job.stage === stage);
  }

  getPendingJobs(): VideoJob[] {
    return Array.from(this.jobs.values()).filter(job => job.status === 'pending');
  }

  getRunningJobs(): VideoJob[] {
    return Array.from(this.jobs.values()).filter(job => job.status === 'running');
  }

  clear(): void {
    this.jobs.clear();
    this.runningJobs.clear();
  }
}
