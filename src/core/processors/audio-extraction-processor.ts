import { BaseVideoProcessor, ProcessingContext, ProcessingResult } from '../video-pipeline';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import path from 'path';
import fs from 'fs/promises';
import { ExternalProcessPool } from '../process-pool';

export class AudioExtractionProcessor extends BaseVideoProcessor {
  public name = 'audio-extraction';
  public version = '1.0.0';

  constructor(config: {
    format?: 'wav' | 'mp3';
    sampleRate?: number;
    channels?: number;
    bitrate?: string;
    outputDir?: string;
  } = {}) {
    super();
    this.setConfig({
      format: 'wav',
      sampleRate: 16000, // Whisper prefers 16kHz
      channels: 1, // Mono for transcription
      bitrate: '64k',
      outputDir: './tmp/audio',
      ...config
    });

    if (ffmpegPath) {
      ffmpeg.setFfmpegPath(ffmpegPath);
    }
  }

  async process(context: ProcessingContext): Promise<ProcessingResult> {
    try {
      const { segment } = context;
      const config = this.getConfig();

      this.log('info', `Extracting audio for segment: ${segment.id}`);

      // Create output directory and generate audio file path
      const absoluteOutputDir = path.resolve(config.outputDir);
      await fs.mkdir(absoluteOutputDir, { recursive: true });

      const audioFileName = `${segment.id}.${config.format}`;
      const audioPath = path.join(absoluteOutputDir, audioFileName);

      // Extract audio using fluent-ffmpeg in process pool
      await ExternalProcessPool.getInstance().run(async () => {
        return new Promise<void>((resolve, reject) => {
          this.log('info', `Starting audio extraction from: ${segment.videoPath}`);
          this.log('info', `Output path: ${audioPath}`);
          this.log('info', `Segment timing: ${segment.startTime}s - ${segment.endTime}s`);

          let command = ffmpeg(segment.videoPath)
            .audioCodec('pcm_s16le')  // Always use PCM for WAV
            .audioChannels(config.channels)
            .audioFrequency(config.sampleRate)
            .format('wav')  // Force WAV format
            .output(audioPath);

          // Add segment timing if available
          if (segment.startTime !== undefined && segment.endTime !== undefined) {
            const duration = segment.endTime - segment.startTime;
            this.log('info', `Extracting segment: start=${segment.startTime}s, duration=${duration}s`);
            command = command
              .seekInput(segment.startTime)
              .duration(duration);
          }

          command
            .on('start', (commandLine) => {
              this.log('info', `FFmpeg command: ${commandLine}`);
            })
            .on('progress', (progress) => {
              if (progress.percent) {
                this.log('info', `Audio extraction progress: ${Math.round(progress.percent)}%`);
              }
            })
            .on('end', () => {
              this.log('info', `Audio extracted successfully: ${audioPath}`);
              resolve();
            })
            .on('error', (error) => {
              this.log('error', `Audio extraction failed: ${error.message}`);
              this.log('error', `FFmpeg stderr: ${error.message}`);
              reject(error);
            })
            .run();
        });
      });

      // Verify output file exists
      const stats = await fs.stat(audioPath);
      
      return {
        success: true,
        data: {
          audioPath,
          format: config.format,
          sampleRate: config.sampleRate,
          channels: config.channels,
          fileSize: stats.size,
          duration: segment.endTime - segment.startTime
        },
        metadata: {
          processingTime: Date.now(),
          config: this.getConfig()
        }
      };
    } catch (error) {
      this.log('error', 'Audio extraction failed', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown audio extraction error'
      };
    }
  }

  // Clean up extracted audio files
  async cleanup(audioPath: string): Promise<void> {
    try {
      await fs.unlink(audioPath);
      this.log('info', `Cleaned up audio file: ${audioPath}`);
    } catch (error) {
      this.log('warn', `Failed to cleanup audio file: ${audioPath}`, error);
    }
  }

  // Extract audio from entire video file (not just segment)
  async extractFullAudio(videoPath: string, outputPath?: string): Promise<string> {
    const config = this.getConfig();
    
    if (!outputPath) {
      const videoName = path.basename(videoPath, path.extname(videoPath));
      outputPath = path.join(config.outputDir, `${videoName}.${config.format}`);
    }

    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    await ExternalProcessPool.getInstance().run(async () => {
      return new Promise<void>((resolve, reject) => {
        ffmpeg(videoPath)
          .audioCodec(config.format === 'wav' ? 'pcm_s16le' : 'mp3')
          .audioChannels(config.channels)
          .audioFrequency(config.sampleRate)
          .format(config.format)
          .output(outputPath!)
          .on('end', () => resolve())
          .on('error', (error) => reject(error))
          .run();
      });
    });

    return outputPath;
  }
}
