/**
 * Subprocess-based Ollama provider to isolate API calls from Node.js event loop
 * This may resolve model runner crashes by using external processes
 */

import { spawn } from 'child_process';
import { LLMProvider } from './llm-provider';
import { ConfigManager } from './config';
import * as fs from 'fs';

export class SubprocessOllamaProvider implements LLMProvider {
  private visionModel: string;
  private embeddingModel: string;

  constructor(visionModel?: string, embeddingModel?: string) {
    const config = ConfigManager.getConfig();
    this.visionModel = visionModel || config.ai.visionModel;
    this.embeddingModel = embeddingModel || config.ai.embeddingModel;
  }

  getName(): string {
    return 'Subprocess Ollama';
  }

  getModel(): string {
    return `Vision: ${this.visionModel}, Embedding: ${this.embeddingModel}`;
  }

  async isAvailable(): Promise<boolean> {
    console.log('[SUBPROCESS] isAvailable() called');
    try {
      console.log('[SUBPROCESS] Executing ollama list command');
      const result = await this.executeOllamaCommand(['list']);
      console.log('[SUBPROCESS] Ollama list result:', result.substring(0, 100) + '...');
      console.log('[SUBPROCESS] Ollama available: true');
      return true;
    } catch (error) {
      console.error('[SUBPROCESS] Ollama list failed:', (error as Error).message);
      console.log('[SUBPROCESS] Ollama available: false');
      return false;
    }
  }

  /**
   * Execute ollama command via subprocess
   */
  private async executeOllamaCommand(args: string[], input?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      console.log('[SUBPROCESS] Spawning ollama with args:', args);
      const process = spawn('ollama', args, {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      if (input) {
        process.stdin.write(input);
        process.stdin.end();
      }

      process.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('close', (code) => {
        console.log('[SUBPROCESS] Ollama process closed with code:', code);
        console.log('[SUBPROCESS] Stdout:', stdout.substring(0, 200));
        console.log('[SUBPROCESS] Stderr:', stderr);
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(`Ollama process failed with code ${code}: ${stderr}`));
        }
      });

      process.on('error', (error) => {
        console.error('[SUBPROCESS] Failed to start ollama process:', error);
        reject(new Error(`Failed to start ollama process: ${error.message}`));
      });
    });
  }

  /**
   * Generate image description using subprocess
   */
  async generateImageDescription(imagePath: string, originalImagePath?: string): Promise<string> {
    console.log(`[SUBPROCESS] Generating description for image ${imagePath} using ${this.visionModel}`);
    
    // Try compressed image first, then original if available
    const imagesToTry = [imagePath];
    if (originalImagePath && originalImagePath !== imagePath) {
      imagesToTry.push(originalImagePath);
    }
    
    for (let i = 0; i < imagesToTry.length; i++) {
      const currentImagePath = imagesToTry[i];
      const isOriginal = i > 0;
      
      try {
        console.log(`[SUBPROCESS] Trying ${isOriginal ? 'original' : 'compressed'} image: ${currentImagePath}`);
        
        // Read and encode the image
        const imageBuffer = await fs.promises.readFile(currentImagePath);
        const base64Image = imageBuffer.toString('base64');
        console.log(`[SUBPROCESS] Image encoded, size: ${Math.round(base64Image.length / 1024)}KB`);

        // Create JSON payload for ollama
        const payload = {
          model: this.visionModel,
          prompt: "Describe this image in detail. Focus on the main subjects, objects, colors, and overall composition.",
          images: [base64Image],
          stream: false
        };

        console.log(`[SUBPROCESS] Calling Ollama API with ${this.visionModel}`);
        // Use curl via subprocess to call Ollama API
        const curlArgs = [
          '-X', 'POST',
          'http://localhost:11434/api/generate',
          '-H', 'Content-Type: application/json',
          '-d', JSON.stringify(payload)
        ];

        const result = await this.executeCurlCommand(curlArgs);
        const data = JSON.parse(result);
        console.log(`[SUBPROCESS] Ollama response for ${isOriginal ? 'original' : 'compressed'} image:`, data.response ? 'SUCCESS' : 'EMPTY');

        if (data.response && data.response.trim() !== '') {
          console.log(`[SUBPROCESS] Got description from ${isOriginal ? 'original' : 'compressed'} image`);
          return data.response.trim();
        }
        
        console.log(`[SUBPROCESS] Empty response from vision model`);
        console.log(`[SUBPROCESS] Base64 image length: ${base64Image.length}, First 100 chars: ${base64Image.substring(0, 100)}`);
        console.log(`[SUBPROCESS] No description from ${isOriginal ? 'original' : 'compressed'} image, trying next...`);
      } catch (error) {
        console.error(`[SUBPROCESS] Error with ${isOriginal ? 'original' : 'compressed'} image:`, (error as Error).message);
        if (i === imagesToTry.length - 1) {
          // Last attempt failed
          return 'Error generating description';
        }
      }
    }
    
    throw new Error('Empty response from vision model after trying all image variants');
  }

  /**
   * Generate text embedding using subprocess
   */
  async generateEmbedding(text: string): Promise<Float32Array> {
    try {
      console.log(`Generating text embedding for "${text.substring(0, 50)}..." using ${this.embeddingModel} (subprocess)`);

      // Create JSON payload for ollama embeddings
      const payload = {
        model: this.embeddingModel,
        prompt: text
      };

      const curlArgs = [
        '-X', 'POST',
        'http://localhost:11434/api/embeddings',
        '-H', 'Content-Type: application/json',
        '-d', JSON.stringify(payload)
      ];

      const result = await this.executeCurlCommand(curlArgs);
      const data = JSON.parse(result);

      if (!data.embedding || !Array.isArray(data.embedding)) {
        throw new Error('Invalid embedding response format');
      }

      return new Float32Array(data.embedding);
    } catch (error) {
      console.error(`Error generating embedding via subprocess:`, error);
      // Return random embedding as fallback
      const randomArray = new Array(2560).fill(0).map(() => Math.random() - 0.5);
      return new Float32Array(randomArray);
    }
  }

  /**
   * Execute curl command via subprocess
   */
  private async executeCurlCommand(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const process = spawn('curl', args, {
        stdio: ['pipe', 'pipe', 'pipe']
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
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(`Curl process failed with code ${code}: ${stderr}`));
        }
      });

      process.on('error', (error) => {
        reject(new Error(`Failed to start curl process: ${error.message}`));
      });
    });
  }

  /**
   * Generate image embedding (combines description + embedding)
   */
  async generateImageEmbedding(imagePath: string): Promise<Float32Array> {
    try {
      // First get the image description
      const description = await this.generateImageDescription(imagePath);
      
      // Then generate embedding from the description
      return await this.generateEmbedding(description);
    } catch (error) {
      console.error('Error generating image embedding via subprocess:', error);
      // Return random embedding as fallback
      const randomArray = new Array(2560).fill(0).map(() => Math.random() - 0.5);
      return new Float32Array(randomArray);
    }
  }
}
