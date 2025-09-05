import { RetryQueue } from './retry-queue';
import { ConfigManager } from './config';
import { SubprocessOllamaProvider } from './subprocess-ollama-provider';

/**
 * Interface for LLM providers (Ollama, LiteLLM, etc.)
 * This allows for easy swapping between different LLM backends
 */
export interface LLMProvider {
  /**
   * Check if the LLM provider is available
   */
  isAvailable(): Promise<boolean>;
  
  /**
   * Generate embeddings for text content
   */
  generateEmbedding(text: string): Promise<Float32Array>;
  
  /**
   * Generate description for image content
   */
  generateImageDescription(imagePath: string): Promise<string>;
  
  /**
   * Generate embeddings for image content
   */
  generateImageEmbedding(imagePath: string): Promise<Float32Array>;
  
  /**
   * Get the name of the provider
   */
  getName(): string;
  
  /**
   * Get the model being used
   */
  getModel(): string;
}

/**
 * Ollama LLM provider implementation
 */
export class OllamaProvider implements LLMProvider {
  private visionModel: string;
  private embeddingModel: string;
  private retryQueue: RetryQueue;
  
  constructor(visionModel?: string, embeddingModel?: string) {
    const config = ConfigManager.getConfig();
    this.visionModel = visionModel || config.ai.visionModel;
    this.embeddingModel = embeddingModel || config.ai.embeddingModel;
    this.retryQueue = RetryQueue.getInstance();
  }
  
  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch('http://localhost:11434/api/tags');
      if (!response.ok) return false;
      const data = await response.json();
      return data.models && data.models.some((model: any) => model.name.includes('llava'));
    } catch (error) {
      console.error('Ollama availability check failed:', error);
      return false;
    }
  }
  
  async generateEmbedding(text: string): Promise<Float32Array> {
    const operation = async (): Promise<Float32Array> => {
      console.log(`Generating text embedding for "${text.substring(0, 30)}..." using ${this.embeddingModel}`);
      
      const response = await fetch('http://localhost:11434/api/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.embeddingModel,
          prompt: text
        })
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ollama API error: ${response.status} ${errorText}`);
      }
      
      const data = await response.json();
      return new Float32Array(data.embedding);
    };

    try {
      return await this.retryQueue.addTask(operation, `text-embedding-${text.substring(0, 20)}`, 5);
    } catch (error) {
      console.error('Error generating text embedding after retries:', error);
      // Fallback to random embeddings
      const randomArray = new Array(768).fill(0).map(() => Math.random() - 0.5);
      return new Float32Array(randomArray);
    }
  }
  
  async generateImageDescription(imagePath: string): Promise<string> {
    const operation = async (): Promise<string> => {
      console.log(`Generating description for image ${imagePath} using ${this.visionModel}`);
      
      // Read the image file as base64
      const fs = await import('fs');
      const imageBuffer = fs.readFileSync(imagePath);
      const base64Image = imageBuffer.toString('base64');
      
      // Call Ollama API for image description
      const response = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.visionModel,
          prompt: 'Describe this image in detail, including objects, colors, scene, and any text visible:',
          images: [base64Image],
          stream: false
        })
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ollama API error: ${response.status} ${errorText}`);
      }
      
      const data = await response.json();
      console.log(`[DEBUG] Ollama response:`, JSON.stringify(data, null, 2));
      
      if (!data.response || data.response.trim() === '') {
        console.warn(`[DEBUG] Empty or missing response from Ollama:`, data);
        return 'No description available';
      }
      
      return data.response.trim();
    };

    try {
      const fileName = imagePath.split('/').pop() || 'unknown';
      return await this.retryQueue.addTask(operation, `image-description-${fileName}`, 5);
    } catch (error) {
      console.error('Error generating image description after retries:', error);
      return 'Error generating description';
    }
  }
  
  async generateImageEmbedding(imagePath: string): Promise<Float32Array> {
    try {
      // First get the image description
      const description = await this.generateImageDescription(imagePath);
      console.log(`Generated description: ${description.substring(0, 100)}...`);
      
      // Then generate embedding from the description
      return await this.generateEmbedding(description);
    } catch (error) {
      console.error('Error generating image embedding:', error);
      // Fallback to random embeddings in case of error
      const randomArray = new Array(768).fill(0).map(() => Math.random() - 0.5);
      return new Float32Array(randomArray);
    }
  }
  
  getName(): string {
    return 'Ollama';
  }
  
  getModel(): string {
    return `Vision: ${this.visionModel}, Embedding: ${this.embeddingModel}`;
  }
}

/**
 * LiteLLM provider implementation
 */
export class LiteLLMProvider implements LLMProvider {
  private model: string;
  private apiKey: string;
  
  constructor(model: string = 'openai/clip', apiKey: string = '') {
    this.model = model;
    this.apiKey = apiKey;
  }
  
  async isAvailable(): Promise<boolean> {
    try {
      // Check if API key is provided
      if (!this.apiKey) {
        console.warn('LiteLLM API key not provided');
        return false;
      }
      
      // In a real implementation, this would make a test call to the LiteLLM API
      return true;
    } catch (error) {
      console.error('LiteLLM availability check failed:', error);
      return false;
    }
  }
  
  async generateEmbedding(text: string): Promise<Float32Array> {
    // Simplified implementation - would call LiteLLM API
    console.log(`Generating embedding for text "${text.substring(0, 30)}..." using LiteLLM model ${this.model}`);
    const randomArray = new Array(384).fill(0).map(() => Math.random() - 0.5);
    return new Float32Array(randomArray);
  }
  
  async generateImageDescription(imagePath: string): Promise<string> {
    // Simplified implementation - would call LiteLLM API with image
    console.log(`Generating description for image ${imagePath} using LiteLLM model ${this.model}`);
    return 'LiteLLM image description placeholder';
  }
  
  async generateImageEmbedding(imagePath: string): Promise<Float32Array> {
    // Simplified implementation - would call LiteLLM API with image
    console.log(`Generating embedding for image ${imagePath} using LiteLLM model ${this.model}`);
    const randomArray = new Array(384).fill(0).map(() => Math.random() - 0.5);
    return new Float32Array(randomArray);
  }
  
  getName(): string {
    return 'LiteLLM';
  }
  
  getModel(): string {
    return this.model;
  }
}

/**
 * Factory for creating LLM providers
 */
export class LLMProviderFactory {
  static createProvider(type: 'ollama' | 'litellm' | 'subprocess' = 'ollama', config?: any): LLMProvider {
    switch (type) {
      case 'ollama':
        return new OllamaProvider(config?.visionModel, config?.embeddingModel);
      case 'subprocess':
        return new SubprocessOllamaProvider(config?.visionModel, config?.embeddingModel);
      case 'litellm':
        return new LiteLLMProvider(config);
      default:
        throw new Error(`Unknown LLM provider type: ${type}`);
    }
  }
}
