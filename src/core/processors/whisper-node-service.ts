/**
 * NodeJS Whisper Service - Uses nodejs-whisper package
 * 
 * This service uses the nodejs-whisper npm package which wraps whisper.cpp
 * No Docker required - binaries are bundled with the Electron app
 */

import { TranscriptionService } from './transcription-processor.js';
import { nodewhisper } from 'nodejs-whisper';
import path from 'path';
import os from 'os';
import fs from 'fs';

export class NodeJsWhisperService implements TranscriptionService {
  public name = 'nodejs-whisper';
  public version = '1.0.0';
  
  constructor(private config: {
    modelName?: string;
    whisperCachePath?: string;
  } = {}) {
    this.config = {
      modelName: 'base.en',
      ...config
    };
  }
  
  /**
   * Get the whisper models directory path
   * Uses app data directory in production, project data directory in development
   */
  private getWhisperModelsPath(): string {
    if (this.config.whisperCachePath) {
      return this.config.whisperCachePath;
    }
    
    // Check if running in development mode
    const isDev = process.env.NODE_ENV === 'development' || process.env.DEBUG_MODE === 'true';
    
    if (isDev) {
      // Development: use project data directory
      const dataDir = process.env.CINESTAR_DATA_DIR || path.join(process.cwd(), 'data');
      return path.join(dataDir, 'whisper-models');
    } else {
      // Production: use app data directory (persistent across updates)
      // macOS: ~/Library/Application Support/Cinestar/whisper-models/
      // Linux: ~/.config/Cinestar/whisper-models/
      // Windows: %APPDATA%/Cinestar/whisper-models/
      const appDataPath = process.env.APPDATA || 
                          path.join(os.homedir(), process.platform === 'darwin' ? 'Library/Application Support' : '.config');
      
      return path.join(appDataPath, 'Cinestar', 'whisper-models');
    }
  }
  
  /**
   * Check if model is downloaded, download if not
   */
  private async ensureModelDownloaded(): Promise<boolean> {
    const modelsPath = this.getWhisperModelsPath();
    const modelName = this.config.modelName || 'base.en';
    const modelPath = path.join(modelsPath, `ggml-${modelName}.bin`);
    
    // Check if model already exists
    if (fs.existsSync(modelPath)) {
      console.log(`[NodeJsWhisper] Model already downloaded: ${modelPath}`);
      return true;
    }
    
    console.log(`[NodeJsWhisper] Model not found, will download on first transcription`);
    console.log(`[NodeJsWhisper] Download location: ${modelsPath}`);
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(modelsPath)) {
      fs.mkdirSync(modelsPath, { recursive: true });
    }
    
    return false;
  }
  
  async transcribe(inputPath: string, options: any = {}): Promise<{
    text: string;
    segments?: Array<{ start: number; end: number; text: string }>;
    language?: string;
  }> {
    console.log(`[NodeJsWhisper] Transcribing: ${path.basename(inputPath)}`);
    console.log(`[NodeJsWhisper] Model: ${this.config.modelName}`);
    
    // Ensure model is downloaded (will download on first use)
    await this.ensureModelDownloaded();
    
    // Set models path for nodejs-whisper
    const modelsPath = this.getWhisperModelsPath();
    console.log(`[NodeJsWhisper] Using whisper models: ${modelsPath}`);
    process.env.NODEJS_WHISPER_CACHE = modelsPath;
    
    try {
      const modelName = this.config.modelName || 'base.en';
      const result = await nodewhisper(inputPath, {
        modelName: modelName,
        autoDownloadModelName: modelName, // Auto-download if missing
        removeWavFileAfterTranscription: true,
        withCuda: false,
        whisperOptions: {
          outputInJson: true,
          outputInText: false,
          outputInSrt: false,
          outputInVtt: false,
          wordTimestamps: true,
          translateToEnglish: false,
          splitOnWord: true,
          timestamps_length: 20
        }
      });
      
      console.log(`[NodeJsWhisper] Transcription completed: ${result.length} chars`);
      
      // Parse result - nodejs-whisper returns text directly
      return {
        text: result.trim(),
        segments: [], // TODO: Parse segments from result if available
        language: options.language || 'en'
      };
      
    } catch (error) {
      console.error(`[NodeJsWhisper] Transcription failed:`, error);
      throw new Error(`NodeJS Whisper transcription failed: ${error}`);
    }
  }
  
  async isAvailable(): Promise<boolean> {
    try {
      const modelsPath = this.getWhisperModelsPath();
      const modelName = this.config.modelName || 'base.en';
      const modelPath = path.join(modelsPath, `ggml-${modelName}.bin`);
      
      // Service is available even if model not downloaded yet
      // It will auto-download on first use
      if (!fs.existsSync(modelPath)) {
        console.log(`[NodeJsWhisper] Service available - model will download on first use`);
        console.log(`[NodeJsWhisper] Download location: ${modelsPath}`);
        return true; // Still available, just needs download
      }
      
      console.log(`[NodeJsWhisper] Service available - model already downloaded at ${modelPath}`);
      return true;
      
    } catch (error) {
      console.error(`[NodeJsWhisper] Availability check failed:`, error);
      return false;
    }
  }
  
  async test(): Promise<boolean> {
    try {
      console.log(`[NodeJsWhisper] Testing service availability...`);
      return await this.isAvailable();
    } catch (error) {
      console.error(`[NodeJsWhisper] Test failed:`, error);
      return false;
    }
  }
}