import { BaseVideoProcessor, ProcessingContext, ProcessingResult } from '../video-pipeline';
// import { DockerWhisperService } from './docker-whisper-service';
// import { WhisperCppService } from './whisper-cpp-service';
// import { WhisperCliService } from './whisper-cli-service';
import path from 'path';
import fs from 'fs/promises';

// Pluggable transcription interface
export interface TranscriptionService {
  name: string;
  transcribe(audioPath: string, options?: any): Promise<{
    text: string;
    segments?: Array<{ start: number; end: number; text: string }>;
    language?: string;
  }>;
  isAvailable(): Promise<boolean>;
}

// Whisper-node implementation moved to separate file to avoid conflicts

// HTTP service implementation (for external ASR services)
export class HttpTranscriptionService implements TranscriptionService {
  public name = 'http-transcription';
  private endpoint: string;

  constructor(endpoint: string = 'http://localhost:8002/transcribe') {
    this.endpoint = endpoint;
  }

  async transcribe(audioPath: string, options: any = {}) {
    const audioBuffer = await fs.readFile(audioPath);
    const formData = new FormData();
    formData.append('audio', new Blob([new Uint8Array(audioBuffer.buffer)]));
    
    if (options.language) {
      formData.append('language', options.language);
    }

    const response = await fetch(this.endpoint, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      throw new Error(`Transcription service error: ${response.statusText}`);
    }

    return await response.json();
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.endpoint}/health`, { method: 'GET' });
      return response.ok;
    } catch {
      return false;
    }
  }
}

export class TranscriptionProcessor extends BaseVideoProcessor {
  public name = 'transcription';
  public version = '1.0.0';
  private services: TranscriptionService[] = [];
  private activeService?: TranscriptionService;

  constructor(config: {
    language?: string;
    extractAudio?: boolean;
    services?: TranscriptionService[];
  } = {}) {
    super();
    this.setConfig({
      language: 'auto',
      extractAudio: true,
      ...config
    });

    // Register default services (can be extended)
    this.services = config.services || [
      new HttpTranscriptionService()
    ];
  }

  // Add a new transcription service
  addService(service: TranscriptionService): void {
    this.services.push(service);
  }

  // Remove a service by name
  removeService(serviceName: string): boolean {
    const index = this.services.findIndex(s => s.name === serviceName);
    if (index === -1) return false;
    
    this.services.splice(index, 1);
    if (this.activeService?.name === serviceName) {
      this.activeService = undefined;
    }
    return true;
  }

  // Find the first available service
  private async findAvailableService(): Promise<TranscriptionService | undefined> {
    for (const service of this.services) {
      if (await service.isAvailable()) {
        return service;
      }
    }
    return undefined;
  }

  async process(context: ProcessingContext): Promise<ProcessingResult> {
    try {
      const { segment } = context;
      const config = this.getConfig();

      this.log('info', `Processing transcription for segment: ${segment.id}`);

      // Find an available transcription service
      if (!this.activeService) {
        this.activeService = await this.findAvailableService();
        if (!this.activeService) {
          this.log('warn', 'No transcription services available, skipping');
          return {
            success: true,
            data: { transcription: null, reason: 'no_service_available' }
          };
        }
        this.log('info', `Using transcription service: ${this.activeService.name}`);
      }

      // Use pre-extracted audio if available, otherwise use video directly
      let audioPath = segment.videoPath;
      this.log('info', `Segment audioPath from pipeline: ${segment.audioPath || 'undefined'}`);
      this.log('info', `Segment videoPath: ${segment.videoPath}`);
      
      if (segment.audioPath) {
        // Use the audioPath set by the audio extraction processor
        audioPath = path.isAbsolute(segment.audioPath) 
          ? segment.audioPath 
          : path.resolve(segment.audioPath);
        this.log('info', `Using pipeline audioPath: ${path.basename(audioPath)}`);
      } else if (config.extractAudio) {
        this.log('warn', 'Audio extraction requested but no audioPath in segment');
      }

      // Perform transcription
      const transcriptionResult = await this.activeService.transcribe(audioPath, {
        language: config.language
      });

      this.log('info', `Transcription completed: ${transcriptionResult.text.length} characters`);

      return {
        success: true,
        data: {
          transcription: transcriptionResult,
          service: this.activeService.name,
          audioPath: audioPath !== segment.videoPath ? audioPath : undefined
        },
        metadata: {
          processingTime: Date.now(),
          config: this.getConfig()
        }
      };
    } catch (error) {
      this.log('error', 'Transcription failed', error);
      this.log('error', `Failed segment details: ${JSON.stringify({
        segmentId: context.segment.id,
        videoPath: context.segment.videoPath,
        startTime: context.segment.startTime,
        endTime: context.segment.endTime,
        duration: context.segment.endTime - context.segment.startTime,
        audioPath: context.data.audioPath
      }, null, 2)}`);
      
      // Try next available service on failure
      this.activeService = undefined;
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown transcription error'
      };
    }
  }

  // Get available services status
  async getServicesStatus(): Promise<Array<{ name: string; available: boolean }>> {
    const status = [];
    for (const service of this.services) {
      status.push({
        name: service.name,
        available: await service.isAvailable()
      });
    }
    return status;
  }
}
