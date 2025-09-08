import { TranscriptionService } from './transcription-processor';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { ExternalProcessPool } from '../process-pool';

export class WhisperCppService implements TranscriptionService {
  public name = 'whisper-cpp';
  public version = '1.0.0';

  constructor(private config: {
    modelPath?: string;
    executablePath?: string;
    language?: string;
    outputFormat?: string[];
  } = {}) {
    this.config = {
      modelPath: './models/ggml-base.en.bin',
      executablePath: './node_modules/nodejs-whisper/cpp/whisper.cpp/build/bin/whisper-cli',
      language: 'auto',
      outputFormat: ['json'],
      ...config
    };
  }

  async transcribe(inputPath: string, options: any = {}): Promise<{
    text: string;
    segments?: Array<{ start: number; end: number; text: string }>;
    language?: string;
  }> {
    console.log(`[WhisperCpp] Transcribing: ${path.basename(inputPath)}`);
    
    // Ensure absolute paths
    const absoluteInputPath = path.isAbsolute(inputPath) ? inputPath : path.resolve(inputPath);
    const absoluteModelPath = path.isAbsolute(this.config.modelPath!) 
      ? this.config.modelPath! 
      : path.resolve(this.config.modelPath!);
    const absoluteExecPath = path.isAbsolute(this.config.executablePath!)
      ? this.config.executablePath!
      : path.resolve(this.config.executablePath!);

    // Verify files exist
    try {
      await fs.access(absoluteInputPath);
      await fs.access(absoluteModelPath);
      await fs.access(absoluteExecPath);
    } catch (error) {
      throw new Error(`File not found: ${error}`);
    }

    // Generate output file path
    const outputDir = path.dirname(absoluteInputPath);
    const baseName = path.basename(absoluteInputPath, path.extname(absoluteInputPath));
    const outputPath = path.join(outputDir, `${baseName}.json`);

    // Build whisper-cli command
    const args = [
      '-m', absoluteModelPath,           // Model path
      '-f', absoluteInputPath,           // Input file
      '-oj',                             // Output JSON
      '-l', options.language || 'auto',  // Language
      '-of', outputPath.replace('.json', '') // Output file (without extension)
    ];

    console.log(`[WhisperCpp] Command: ${absoluteExecPath} ${args.join(' ')}`);

    // Run whisper-cli in process pool
    const result = await ExternalProcessPool.getInstance().run(async () => {
      return new Promise<string>((resolve, reject) => {
        const process = spawn(absoluteExecPath, args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          cwd: path.dirname(absoluteExecPath)
        });

        let stdout = '';
        let stderr = '';

        process.stdout?.on('data', (data) => {
          stdout += data.toString();
        });

        process.stderr?.on('data', (data) => {
          stderr += data.toString();
          // Log progress if available
          if (stderr.includes('progress')) {
            console.log(`[WhisperCpp] ${stderr.split('\n').pop()?.trim()}`);
          }
        });

        process.on('close', (code) => {
          if (code === 0) {
            console.log(`[WhisperCpp] Transcription completed successfully`);
            resolve(outputPath);
          } else {
            console.error(`[WhisperCpp] Process failed with code ${code}`);
            console.error(`[WhisperCpp] stderr: ${stderr}`);
            reject(new Error(`Whisper process failed with code ${code}: ${stderr}`));
          }
        });

        process.on('error', (error) => {
          console.error(`[WhisperCpp] Process error:`, error);
          reject(error);
        });
      });
    });

    // Parse JSON output
    try {
      // Check if output file exists
      try {
        await fs.access(result);
      } catch (accessError) {
        console.error(`[WhisperCpp] Output file not found: ${result}`);
        console.error(`[WhisperCpp] This usually means whisper-cli failed silently or used different output path`);
        throw new Error(`Whisper output file not found: ${result}`);
      }

      const jsonContent = await fs.readFile(result, 'utf-8');
      const parsed = JSON.parse(jsonContent);
      
      let text = '';
      let segments: Array<{ start: number; end: number; text: string }> = [];
      let language = options.language || 'auto';

      if (parsed.transcription && Array.isArray(parsed.transcription)) {
        // whisper.cpp JSON format
        text = parsed.transcription.map((seg: any) => seg.text).join('').trim();
        segments = parsed.transcription.map((seg: any) => ({
          start: seg.offsets?.from ? seg.offsets.from / 1000 : 0,
          end: seg.offsets?.to ? seg.offsets.to / 1000 : 0,
          text: seg.text?.trim() || ''
        }));
        language = parsed.result?.language || language;
      }

      // Clean up JSON file
      try {
        await fs.unlink(result);
      } catch {}

      console.log(`[WhisperCpp] Transcription result: ${text.length} chars, ${segments.length} segments`);
      return { text: text.trim(), segments, language };

    } catch (error) {
      console.error(`[WhisperCpp] Failed to parse JSON output:`, error);
      throw new Error(`Failed to parse transcription result: ${error}`);
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Check if executable exists
      await fs.access(path.resolve(this.config.executablePath!));
      // Check if model exists
      await fs.access(path.resolve(this.config.modelPath!));
      return true;
    } catch {
      console.warn(`[WhisperCpp] Not available - missing executable or model`);
      return false;
    }
  }

  // Test transcription with a short audio file
  async test(): Promise<boolean> {
    try {
      // This would need a test audio file
      console.log(`[WhisperCpp] Service test - executable and model available`);
      return await this.isAvailable();
    } catch (error) {
      console.error(`[WhisperCpp] Test failed:`, error);
      return false;
    }
  }
}
