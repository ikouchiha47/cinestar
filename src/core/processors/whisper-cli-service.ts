//NOTE: Remove this - Unused transcription service
//NOTE: The main implementation uses DockerWhisperService in docker-whisper-service.ts
//NOTE: This CLI-based service is not being used in the current pipeline

import { TranscriptionService } from './transcription-processor.js';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

export class WhisperCliService implements TranscriptionService {
  public name = 'whisper-cli';
  private containerName = 'driller-whisper';

  async transcribe(audioPath: string, options: any = {}) {
    try {
      // First, ensure the audio is properly formatted WAV
      const processedAudioPath = await this.prepareAudio(audioPath);
      
      // Copy audio file to container
      const containerPath = `/tmp/audio_${Date.now()}.wav`;
      await this.copyToContainer(processedAudioPath, containerPath);
      
      // Run whisper CLI in container
      const result = await this.runWhisperCli(containerPath, options);
      
      // Clean up container file
      await this.cleanupContainer(containerPath);
      
      // Clean up processed audio if it's different from original
      if (processedAudioPath !== audioPath) {
        await fs.unlink(processedAudioPath).catch(() => {});
      }
      
      return result;
    } catch (error) {
      console.error('Whisper CLI transcription failed:', error);
      throw error;
    }
  }

  private async prepareAudio(audioPath: string): Promise<string> {
    const ext = path.extname(audioPath).toLowerCase();
    
    // If already WAV, check if it's properly formatted
    if (ext === '.wav') {
      return audioPath;
    }
    
    // Convert to proper WAV format
    const outputPath = audioPath.replace(path.extname(audioPath), '_converted.wav');
    
    return new Promise((resolve, reject) => {
      const ffmpegBin = process.env.FFMPEG_PATH || 'ffmpeg';
      const proc = spawn(ffmpegBin, [
        '-i', audioPath,
        '-acodec', 'pcm_s16le',
        '-ac', '1',
        '-ar', '16000',
        '-f', 'wav',
        '-y', // Overwrite output file
        outputPath
      ]);

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(outputPath);
        } else {
          reject(new Error(`Audio conversion failed with code ${code}`));
        }
      });

      proc.on('error', reject);
    });
  }

  private async copyToContainer(localPath: string, containerPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn('docker', [
        'cp', localPath, `${this.containerName}:${containerPath}`
      ]);

      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Docker cp failed with code ${code}`));
        }
      });

      proc.on('error', reject);
    });
  }

  private async runWhisperCli(containerPath: string, options: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const outputDir = '/tmp';
      const args = [
        'exec', this.containerName,
        'whisper', containerPath,
        '--model', options.model || 'base.en',
        '--output_format', 'json',
        '--output_dir', outputDir,
        '--word_timestamps', 'True'
      ];

      if (options.language) {
        args.push('--language', options.language);
      }

      const proc = spawn('docker', args);
      
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', async (code) => {
        if (code === 0) {
          try {
            // Read the JSON output file
            const basename = path.basename(containerPath, '.wav');
            const jsonPath = `${outputDir}/${basename}.json`;
            
            const readProc = spawn('docker', [
              'exec', this.containerName,
              'cat', jsonPath
            ]);

            let jsonOutput = '';
            readProc.stdout.on('data', (data) => {
              jsonOutput += data.toString();
            });

            readProc.on('close', (readCode) => {
              if (readCode === 0) {
                try {
                  const result = JSON.parse(jsonOutput);
                  resolve({
                    text: result.text || '',
                    segments: result.segments || [],
                    language: result.language || options.language || 'en'
                  });
                } catch (parseError) {
                  reject(new Error(`JSON parse error: ${parseError}`));
                }
              } else {
                reject(new Error(`Failed to read JSON output: ${readCode}`));
              }
            });
          } catch (error) {
            reject(error);
          }
        } else {
          reject(new Error(`Whisper CLI failed: ${stderr || stdout}`));
        }
      });

      proc.on('error', reject);
    });
  }

  private async cleanupContainer(containerPath: string): Promise<void> {
    return new Promise((resolve) => {
      const proc = spawn('docker', [
        'exec', this.containerName,
        'rm', '-f', containerPath
      ]);

      proc.on('close', () => resolve()); // Always resolve, cleanup is best effort
      proc.on('error', () => resolve());
    });
  }

  async isAvailable(): Promise<boolean> {
    try {
      return new Promise((resolve) => {
        const proc = spawn('docker', ['ps', '--filter', `name=${this.containerName}`, '--format', '{{.Names}}']);
        
        let output = '';
        proc.stdout.on('data', (data) => {
          output += data.toString();
        });

        proc.on('close', (code) => {
          resolve(code === 0 && output.trim() === this.containerName);
        });

        proc.on('error', () => resolve(false));
      });
    } catch {
      return false;
    }
  }
}
