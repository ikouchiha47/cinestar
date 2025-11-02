import { BaseVideoProcessor, ProcessingContext, ProcessingResult } from '../video-pipeline';
import { NodeJsWhisperService } from './whisper-node-service';
import { WhisperDirectService } from './whisper-direct-service';
import { DockerWhisperService } from './docker-whisper-service';
// import { WhisperCppService } from './whisper-cpp-service';
// import { WhisperCliService } from './whisper-cli-service';
import { ProcessingBatch } from './batch-processor';
import { ConfigManager } from '../config';
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

  constructor(endpoint?: string) {
    // Use config-based transcription URL for nginx path routing
    const config = ConfigManager.getConfig();
    this.endpoint = endpoint || config.ai.transcriptionUrl;
  }

  async transcribe(audioPath: string, options: any = {}) {
    const audioBuffer = await fs.readFile(audioPath);
    const formData = new FormData();
    
    // Create a proper file blob with filename
    const audioBlob = new Blob([new Uint8Array(audioBuffer.buffer as ArrayBuffer)], { type: 'audio/wav' });
    formData.append('audio_file', audioBlob, path.basename(audioPath));
    
    // Build query parameters
    const params = new URLSearchParams();
    params.append('output', 'json');
    params.append('word_timestamps', 'true');
    
    if (options.language && options.language !== 'auto') {
      params.append('language', options.language);
    }

    const url = `${this.endpoint}?${params.toString()}`;
    const response = await fetch(url, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      throw new Error(`Transcription service error: ${response.statusText}`);
    }

    const result = await response.json();
    
    // Transform the result to match expected format
    return {
      text: result.text || '',
      segments: result.segments || [],
      language: result.language || 'unknown'
    };
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Check if the transcription service is available via config URL
      const config = ConfigManager.getConfig();
      const response = await fetch(`${config.ai.transcriptionUrl}`, { method: 'GET' });
      // Whisper service returns 405 Method Not Allowed for GET, which means it's available
      return response.ok || response.status === 405;
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
    baseUrl?: string;
    enabled?: boolean;
  } = {}) {
    super();
    this.setConfig({
      language: 'auto',
      extractAudio: true,
      ...config
    });

    // Register default services (can be extended)
    if (config.services) {
      this.services = config.services;
    } else {
      // Priority order: WhisperDirect (bypasses ASAR issues) -> Docker -> HTTP fallback
      const baseUrl = config.baseUrl || 'http://localhost:9001';
      this.services = [
        new WhisperDirectService(), // PRIMARY: Direct binary execution, bypasses nodejs-whisper ASAR issues
        new DockerWhisperService(baseUrl), // FALLBACK: If user has Docker running
        new HttpTranscriptionService() // LAST RESORT: External service
      ];
    }
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

  /**
   * Batch processing methods for immediate searchability
   */

  // Transcribe a single batch (for concurrent processing)
  async transcribeBatch(batch: ProcessingBatch): Promise<{
    text: string;
    segments?: Array<{ start: number; end: number; text: string; confidence?: number }>;
    language?: string;
    confidence?: number;
  }> {
    if (!batch.audioPath) {
      throw new Error(`Batch ${batch.id} has no audio path`);
    }

    // Find an available transcription service
    if (!this.activeService) {
      this.activeService = await this.findAvailableService();
      if (!this.activeService) {
        throw new Error('No transcription services available');
      }
      this.log('info', `Using transcription service for batch: ${this.activeService.name}`);
    }

    const config = this.getConfig();
    
    this.log('info', `Transcribing batch ${batch.batchIndex} (${batch.startTime}s-${batch.endTime}s)`);
    
    try {
      const result = await this.activeService.transcribe(batch.audioPath, {
        language: config.language
      });

      this.log('info', `Batch ${batch.batchIndex} transcription complete: ${result.text.length} chars, ${result.segments?.length || 0} segments`);
      
      return result;
    } catch (error) {
      this.log('error', `Batch ${batch.batchIndex} transcription failed: ${error}`);
      
      // Try next available service on failure
      this.activeService = undefined;
      throw error;
    }
  }

  // Transcribe multiple batches concurrently
  async transcribeBatchesConcurrent(batches: ProcessingBatch[]): Promise<Array<{
    batchId: string;
    batchIndex: number;
    result?: {
      text: string;
      segments?: Array<{ start: number; end: number; text: string; confidence?: number }>;
      language?: string;
      confidence?: number;
    };
    error?: string;
    duration: number;
  }>> {
    this.log('info', `Starting concurrent transcription of ${batches.length} batches`);
    
    const startTime = Date.now();
    
    // Create transcription promises for all batches
    const transcriptionPromises = batches.map(async (batch) => {
      const batchStartTime = Date.now();
      
      try {
        const result = await this.transcribeBatch(batch);
        const batchDuration = Date.now() - batchStartTime;
        
        return {
          batchId: batch.id,
          batchIndex: batch.batchIndex,
          result,
          duration: batchDuration
        };
      } catch (error) {
        const batchDuration = Date.now() - batchStartTime;
        
        return {
          batchId: batch.id,
          batchIndex: batch.batchIndex,
          error: error instanceof Error ? error.message : 'Unknown error',
          duration: batchDuration
        };
      }
    });

    // Wait for all transcriptions to complete
    const results = await Promise.all(transcriptionPromises);
    
    const totalDuration = Date.now() - startTime;
    const successCount = results.filter(r => !r.error).length;
    
    this.log('info', `Concurrent transcription complete: ${successCount}/${batches.length} successful in ${totalDuration}ms`);
    
    return results;
  }

  // Check if transcription service is ready for batch processing
  async isReadyForBatchProcessing(): Promise<boolean> {
    try {
      const service = await this.findAvailableService();
      return !!service;
    } catch (error) {
      return false;
    }
  }
}
