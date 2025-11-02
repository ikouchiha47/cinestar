/**
 * Direct Whisper Service - Bypasses nodejs-whisper package issues
 * 
 * This service directly spawns whisper-cli binary, avoiding ASAR path issues
 * Works cross-platform by dynamically resolving binary paths
 */

import { TranscriptionService } from './transcription-processor.js';
import { spawn } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs';
import * as https from 'https';

export class WhisperDirectService implements TranscriptionService {
  public name = 'whisper-direct';
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
  
  async isAvailable(): Promise<boolean> {
    try {
      const binaryPath = this.getWhisperBinaryPath();
      return fs.existsSync(binaryPath);
    } catch {
      return false;
    }
  }
  
  /**
   * Resolve whisper-cli binary path dynamically
   * Handles both ASAR packed and unpacked scenarios
   */
  private getWhisperBinaryPath(): string {
    // Runtime diagnostics
    console.log('[WhisperDebug]', {
      cwd: process.cwd(),
      resourcesPath: process.resourcesPath,
      argv: process.argv,
      platform: process.platform,
      arch: process.arch,
    });
    
    // Check if we have resourcesPath (production DMG)
    if (process.resourcesPath && fs.existsSync(process.resourcesPath)) {
      // Production: Binary is in app.asar.unpacked
      // process.resourcesPath = /Applications/Cinestar.app/Contents/Resources
      // Binary location = /Applications/Cinestar.app/Contents/Resources/app.asar.unpacked/node_modules/...
      const binaryPath = path.join(
        process.resourcesPath,
        'app.asar.unpacked',
        'node_modules',
        'nodejs-whisper',
        'cpp',
        'whisper.cpp',
        'build',
        'bin',
        process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'
      );
      
      console.log('[WhisperDirect] Production mode - checking unpacked binary:', binaryPath);
      
      if (!fs.existsSync(binaryPath)) {
        console.error('[WhisperDirect] ❌ Binary not found at:', binaryPath);
        throw new Error(`Whisper binary not found at: ${binaryPath}`);
      }
      
      console.log('[WhisperDirect] ✅ Using unpacked binary');
      return binaryPath;
    }
    
    // Development: Try multiple possible locations
    const possiblePaths = [
      // Try relative to current working directory
      path.join(process.cwd(), 'node_modules', 'nodejs-whisper', 'cpp', 'whisper.cpp', 'build', 'bin'),
      // Try relative to this file's directory (works in dev with ts-node)
      path.join(__dirname, '..', '..', '..', 'node_modules', 'nodejs-whisper', 'cpp', 'whisper.cpp', 'build', 'bin'),
    ];
    
    const binaryName = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';
    
    for (const basePath of possiblePaths) {
      const binaryPath = path.join(basePath, binaryName);
      console.log('[WhisperDirect] Dev mode - checking binary:', binaryPath);
      
      if (fs.existsSync(binaryPath)) {
        console.log('[WhisperDirect] ✅ Using dev binary:', binaryPath);
        return binaryPath;
      }
    }
    
    console.error('[WhisperDirect] ❌ Binary not found in any location. Tried:', possiblePaths);
    throw new Error(`Whisper binary not found. Tried: ${possiblePaths.join(', ')}`);
  }
  
  /**
   * Get whisper models directory path
   */
  private getWhisperModelsPath(): string {
    if (this.config.whisperCachePath) {
      return this.config.whisperCachePath;
    }
    
    const isDev = process.env.NODE_ENV === 'development' || process.env.DEBUG_MODE === 'true';
    
    if (isDev) {
      const dataDir = process.env.CINESTAR_DATA_DIR || path.join(process.cwd(), 'data');
      return path.join(dataDir, 'whisper-models');
    } else {
      const appDataPath = process.env.APPDATA || 
                          path.join(os.homedir(), process.platform === 'darwin' ? 'Library/Application Support' : '.config');
      return path.join(appDataPath, 'Cinestar', 'whisper-models');
    }
  }
  
  /**
   * Download model if not present
   */
  private async ensureModelDownloaded(): Promise<string> {
    const modelsPath = this.getWhisperModelsPath();
    const modelName = this.config.modelName || 'base.en';
    const modelPath = path.join(modelsPath, `ggml-${modelName}.bin`);

    if (fs.existsSync(modelPath)) {
      console.log(`[WhisperDirect] Model found: ${modelPath}`);
      return modelPath;
    }

    console.log(`[WhisperDirect] Model not found, downloading...`);

    // Create directory
    if (!fs.existsSync(modelsPath)) {
      fs.mkdirSync(modelsPath, { recursive: true });
    }

    const modelUrl = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${modelName}.bin`;
    console.log(`[WhisperDirect] Download from: ${modelUrl}`);
    console.log(`[WhisperDirect] To: ${modelPath}`);

    // Download with redirects and basic verification
    await new Promise<void>((resolve, reject) => {
      const maxRedirects = 5;

      const download = (url: string, redirectsLeft: number) => {
        const file = fs.createWriteStream(modelPath);
        const request = https.get(url, (response) => {
          // Handle redirects
          if (response.statusCode && [301, 302, 303, 307, 308].includes(response.statusCode)) {
            file.close();
            fs.unlinkSync(modelPath);
            const location = response.headers.location;
            if (!location) {
              return reject(new Error('Redirect without Location header'));
            }
            if (redirectsLeft <= 0) {
              return reject(new Error('Too many redirects while downloading model'));
            }
            console.log(`[WhisperDirect] Redirecting to: ${location}`);
            return download(location, redirectsLeft - 1);
          }

          if (response.statusCode !== 200) {
            file.close();
            try { fs.unlinkSync(modelPath); } catch {}
            return reject(new Error(`Failed to download model: HTTP ${response.statusCode}`));
          }

          response.pipe(file);
          file.on('finish', () => {
            file.close();
            // Basic file check
            try {
              const stats = fs.statSync(modelPath);
              if (stats.size < 1024 * 1024) { // < 1MB is suspicious
                return reject(new Error(`Downloaded model too small (${stats.size} bytes)`));
              }
              console.log(`[WhisperDirect] ✅ Model downloaded (${Math.round(stats.size / (1024 * 1024))} MB)`);
              resolve();
            } catch (e) {
              reject(e);
            }
          });
        });

        request.on('error', (err) => {
          try { file.close(); } catch {}
          try { fs.unlinkSync(modelPath); } catch {}
          reject(err);
        });
      };

      download(modelUrl, maxRedirects);
    });

    return modelPath;
  }
  
  async transcribe(inputPath: string, options: any = {}): Promise<{
    text: string;
    segments?: Array<{ start: number; end: number; text: string }>;
    language?: string;
  }> {
    console.log(`[WhisperDirect] Transcribing: ${path.basename(inputPath)}`);
    
    try {
      const binaryPath = this.getWhisperBinaryPath();
      const modelPath = await this.ensureModelDownloaded();
      
      // Build whisper-cli arguments
      const args = [
        '-m', modelPath,
        '-f', inputPath,
        '--output-txt',
        '--output-json',
        '--language', options.language || 'auto'
      ];
      
      console.log(`[WhisperDirect] Running: ${binaryPath} ${args.join(' ')}`);
      
      return new Promise((resolve, reject) => {
        const process = spawn(binaryPath, args, {
          cwd: path.dirname(inputPath)
        });
        
        let stdout = '';
        let stderr = '';
        
        process.stdout.on('data', (data) => {
          stdout += data.toString();
        });
        
        process.stderr.on('data', (data) => {
          stderr += data.toString();
        });
        
        process.on('close', (code) => {
          if (code !== 0) {
            reject(new Error(`Whisper failed with code ${code}: ${stderr}`));
            return;
          }
          
          // Parse output (simplified)
          const text = stdout.trim();
          
          resolve({
            text,
            language: options.language || 'en'
          });
        });
        
        process.on('error', (error) => {
          reject(new Error(`Failed to spawn whisper: ${error.message}`));
        });
      });
      
    } catch (error) {
      console.error('[WhisperDirect] Transcription failed:', error);
      throw error;
    }
  }
}
