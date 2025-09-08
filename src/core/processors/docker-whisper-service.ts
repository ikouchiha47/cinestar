import { TranscriptionService } from './transcription-processor.js';
import fs from 'fs/promises';
import fetch from 'node-fetch';

export class DockerWhisperService implements TranscriptionService {
  name = 'DockerWhisper';
  private baseUrl: string;
  private healthCheckUrl: string;

  constructor(baseUrl = 'http://localhost:9000') {
    this.baseUrl = baseUrl;
    this.healthCheckUrl = `${baseUrl}/`;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(this.healthCheckUrl, {
        method: 'GET'
      });
      return response.ok;
    } catch (error: any) {
      console.warn(`Docker Whisper service not available: ${error.message}`);
      return false;
    }
  }

  async transcribe(audioPath: string, options: any = {}): Promise<{
    text: string;
    segments?: Array<{ start: number; end: number; text: string }>;
    language?: string;
  }> {
    try {
      // Check if service is available
      if (!(await this.isAvailable())) {
        throw new Error('Docker Whisper service is not available');
      }

      // Read the audio file
      const audioBuffer = await fs.readFile(audioPath);
      
      // Create form data using built-in FormData (Node.js 18+)
      const form = new FormData();
      const blob = new Blob([audioBuffer], { type: 'audio/wav' });
      form.append('audio_file', blob, 'audio.wav');

      // Add optional parameters
      if (options.language) {
        form.append('language', options.language);
      }
      form.append('task', 'transcribe');

      console.info(`Sending audio file to Docker Whisper: ${audioPath}`);

      // Make the request with output=json as URL parameter
      const response = await fetch(`${this.baseUrl}/asr?output=json`, {
        method: 'POST',
        body: form
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Docker Whisper API error: ${response.status} - ${errorText}`);
      }

      const responseText = await response.text();
      console.info(`Docker Whisper raw response: ${responseText.substring(0, 200)}...`);
      
      let result: any;
      try {
        result = JSON.parse(responseText);
      } catch (parseError) {
        throw new Error(`Docker Whisper JSON parse error: ${parseError}. Raw response: ${responseText.substring(0, 500)}`);
      }
      
      console.info(`Docker Whisper transcription completed: ${result.text?.length || 0} characters`);

      return {
        text: result.text || '',
        segments: result.segments || [],
        language: result.language || options.language || 'en'
      };

    } catch (error: any) {
      console.error(`Docker Whisper transcription failed: ${error.message}`);
      throw error;
    }
  }

  async checkHealth(): Promise<boolean> {
    return this.isAvailable();
  }
}
