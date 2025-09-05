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
    try {
      await this.executeOllamaCommand(['list']);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Execute ollama command via subprocess
   */
  private async executeOllamaCommand(args: string[], input?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const process = spawn('ollama', args, {
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
          reject(new Error(`Ollama process failed with code ${code}: ${stderr}`));
        }
      });

      process.on('error', (error) => {
        reject(new Error(`Failed to start ollama process: ${error.message}`));
      });

      // Send input if provided
      if (input) {
        process.stdin.write(input);
      }
      process.stdin.end();
    });
  }

  /**
   * Generate image description using subprocess
   */
  async generateImageDescription(imagePath: string): Promise<string> {
    try {
      console.log(`Generating description for image ${imagePath} using ${this.visionModel} (subprocess)`);
      
      // Check if image exists
      if (!fs.existsSync(imagePath)) {
        throw new Error(`Image file not found: ${imagePath}`);
      }

      // Convert image to base64
      const imageBuffer = fs.readFileSync(imagePath);
      const base64Image = imageBuffer.toString('base64');

      // Create JSON payload for ollama
      const payload = {
        model: this.visionModel,
        prompt: "Describe this image in detail. Focus on the main subjects, objects, colors, and overall composition.",
        images: [base64Image],
        stream: false
      };

      // Use curl via subprocess to call Ollama API
      const curlArgs = [
        '-X', 'POST',
        'http://localhost:11434/api/generate',
        '-H', 'Content-Type: application/json',
        '-d', JSON.stringify(payload)
      ];

      const result = await this.executeCurlCommand(curlArgs);
      const data = JSON.parse(result);

      if (!data.response || data.response.trim() === '') {
        return 'No description available';
      }

      return data.response.trim();
    } catch (error) {
      console.error(`Error generating image description via subprocess:`, error);
      return 'Error generating description';
    }
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
