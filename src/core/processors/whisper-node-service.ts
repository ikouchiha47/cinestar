import { TranscriptionService } from './transcription-processor';
import path from 'path';
import fs from 'fs/promises';
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';

export class WhisperNodeService implements TranscriptionService {
  public name = 'whisper-node';
  private initialized = false;

  constructor(private config: {
    modelName?: string;
    modelPath?: string;
    language?: string;
    outputFormat?: string[];
  } = {}) {
    this.config = {
      modelName: 'base.en',
      language: 'auto',
      outputFormat: ['txt', 'json'],
      ...config
    };
  }

  private async initializeWhisper(): Promise<void> {
    if (this.initialized) return;
    // For nodejs-whisper CLI usage, there's no in-process init. We'll just verify npx works.
    try {
      await this.verifyCliAvailable();
      this.initialized = true;
      console.log(`[WhisperNode] CLI available. Model: ${this.config.modelName}`);
    } catch (error) {
      console.error('[WhisperNode] CLI not available:', error);
      throw new Error('nodejs-whisper CLI not available. Install with: npx nodejs-whisper --help');
    }
  }

  async transcribe(inputPath: string, options: any = {}) {
    await this.initializeWhisper();

    const transcribeOptions = {
      modelName: options.modelName || this.config.modelName,
      language: options.language || this.config.language,
      outputFormat: options.outputFormat || this.config.outputFormat,
      ...options
    };

    // Ensure we have a 16kHz mono WAV for best results
    const isWav = path.extname(inputPath).toLowerCase() === '.wav';
    const audioPath = isWav ? inputPath : await this.extractAudio(inputPath);

    console.log(`[WhisperNode] Transcribing via CLI: ${path.basename(audioPath)}`);
    console.log(`[WhisperNode] Options:`, transcribeOptions);

    try {
      const cliResult = await this.runCliTranscribe(audioPath, transcribeOptions);
      const { text, segments, language } = cliResult;
      console.log(`[WhisperNode] Transcription completed: ${text.length} characters, ${segments.length} segments`);
      // Cleanup temp audio if we created it
      if (!isWav) await this.cleanup(audioPath);
      return {
        text: (text || '').trim(),
        segments: segments || [],
        language: language || transcribeOptions.language
      };
    } catch (error) {
      console.error('[WhisperNode] Transcription failed:', error);
      // Cleanup temp audio if we created it
      if (!isWav) await this.cleanup(audioPath).catch(() => {});
      throw error;
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.verifyCliAvailable();
      return true;
    } catch {
      return false;
    }
  }

  // Extract audio from video file using ffmpeg
  async extractAudio(videoPath: string, outputPath?: string): Promise<string> {
    if (!ffmpegPath) {
      throw new Error('ffmpeg-static not available');
    }

    const audioPath = outputPath || videoPath.replace(path.extname(videoPath), '.wav');
    
    return new Promise<string>((resolve, reject) => {
      console.log(`[WhisperNode] Extracting audio: ${path.basename(videoPath)} -> ${path.basename(audioPath)}`);
      
      const proc = spawn(ffmpegPath, [
        '-i', videoPath,
        '-vn', // No video
        '-acodec', 'pcm_s16le', // PCM 16-bit
        '-ar', '16000', // 16kHz sample rate (optimal for Whisper)
        '-ac', '1', // Mono
        '-y', // Overwrite output
        audioPath
      ]);

      proc.stderr.on('data', (data) => {
        // ffmpeg outputs progress to stderr
        const output = data.toString();
        if (output.includes('time=')) {
          // Could parse progress here if needed
        }
      });

      proc.on('close', (code) => {
        if (code === 0) {
          console.log(`[WhisperNode] Audio extraction completed: ${audioPath}`);
          resolve(audioPath);
        } else {
          reject(new Error(`ffmpeg process exited with code ${code}`));
        }
      });

      proc.on('error', reject);
    });
  }

  // Extract audio segment from video
  async extractAudioSegment(
    videoPath: string, 
    startTime: number, 
    endTime: number, 
    outputPath?: string
  ): Promise<string> {
    if (!ffmpegPath) {
      throw new Error('ffmpeg-static not available');
    }

    const duration = endTime - startTime;
    const audioPath = outputPath || `${videoPath}_${startTime}_${endTime}.wav`;
    
    return new Promise<string>((resolve, reject) => {
      console.log(`[WhisperNode] Extracting audio segment: ${startTime}s-${endTime}s from ${path.basename(videoPath)}`);
      
      const proc = spawn(ffmpegPath, [
        '-i', videoPath,
        '-ss', startTime.toString(), // Start time
        '-t', duration.toString(), // Duration
        '-vn', // No video
        '-acodec', 'pcm_s16le', // PCM 16-bit
        '-ar', '16000', // 16kHz sample rate
        '-ac', '1', // Mono
        '-y', // Overwrite output
        audioPath
      ]);

      proc.on('close', (code) => {
        if (code === 0) {
          console.log(`[WhisperNode] Audio segment extraction completed: ${audioPath}`);
          resolve(audioPath);
        } else {
          reject(new Error(`ffmpeg process exited with code ${code}`));
        }
      });

      proc.on('error', reject);
    });
  }

  // Cleanup temporary audio files
  async cleanup(audioPath: string): Promise<void> {
    try {
      await fs.unlink(audioPath);
      console.log(`[WhisperNode] Cleaned up temporary audio file: ${audioPath}`);
    } catch (error) {
      console.warn(`[WhisperNode] Failed to cleanup audio file: ${audioPath}`, error);
    }
  }

  // Verify nodejs-whisper CLI is available
  private async verifyCliAvailable(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn('npx', ['--yes', 'nodejs-whisper', '--help']);
      let done = false;
      proc.on('close', (code) => {
        if (done) return; done = true;
        if (code === 0) resolve(); else reject(new Error(`nodejs-whisper help exited with ${code}`));
      });
      proc.on('error', (err) => { if (done) return; done = true; reject(err); });
    });
  }

  // Run nodejs-whisper CLI and parse JSON output
  private async runCliTranscribe(audioPath: string, opts: { modelName: string; language: string; outputFormat: string[] }): Promise<{ text: string; segments: Array<{ start: number; end: number; text: string }>; language?: string; }>{
    // We'll request JSON output; many CLIs write to stdout. If not, we will look for a sidecar .json next to the audio.
    const args = ['--yes', 'nodejs-whisper', 'transcribe', '--input', audioPath, '--model', opts.modelName, '--output-format', 'json', '--language', opts.language];
    const jsonChunks: Buffer[] = [];
    const proc = spawn('npx', args);

    return new Promise((resolve, reject) => {
      proc.stdout.on('data', (data) => jsonChunks.push(Buffer.from(data)));
      proc.stderr.on('data', (data) => {
        const s = String(data);
        if (s.toLowerCase().includes('download') && s.toLowerCase().includes(opts.modelName.toLowerCase())) {
          console.log(`[WhisperNode] Model download in progress: ${opts.modelName}`);
        }
      });
      proc.on('close', async (code) => {
        try {
          if (code !== 0) {
            // Fallback: try reading sidecar JSON file if CLI wrote to disk
            const sidecar = `${audioPath}.json`;
            try {
              const raw = await fs.readFile(sidecar, 'utf-8');
              const parsed = JSON.parse(raw);
              return resolve({ text: parsed.text || '', segments: parsed.segments || [], language: parsed.language });
            } catch {}
            return reject(new Error(`nodejs-whisper exited with code ${code}`));
          }

          const raw = Buffer.concat(jsonChunks).toString('utf-8').trim();
          // Some CLIs print extra logs; try to find JSON blob
          const firstBrace = raw.indexOf('{');
          const lastBrace = raw.lastIndexOf('}');
          const jsonStr = firstBrace >= 0 && lastBrace > firstBrace ? raw.substring(firstBrace, lastBrace + 1) : raw;
          const parsed = JSON.parse(jsonStr);
          resolve({ text: parsed.text || '', segments: parsed.segments || [], language: parsed.language });
        } catch (e) {
          reject(e);
        }
      });
      proc.on('error', reject);
    });
  }
}
