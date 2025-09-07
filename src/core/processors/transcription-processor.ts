import { BaseVideoProcessor, ProcessingContext, ProcessingResult } from '../video-pipeline';
import { WhisperNodeService } from './whisper-node-service';
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
    formData.append('audio', new Blob([audioBuffer]));
    
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
      new HttpTranscriptionService(),
      new WhisperNodeService()
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
  private async findAvailableService(): Promise<TranscriptionService | null> {
    for (const service of this.services) {
      if (await service.isAvailable()) {
        return service;
      }
    }
    return null;
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

      // Extract audio if needed (placeholder - would use ffmpeg)
      let audioPath = segment.videoPath;
      if (config.extractAudio) {
        // TODO: Extract audio segment using ffmpeg
        // audioPath = await this.extractAudioSegment(segment);
        this.log('info', 'Audio extraction not implemented yet');
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
