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
  private model: string;
  
  constructor(model: string = 'llava:7b') {
    this.model = model;
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
    try {
      console.log(`Generating text embedding for "${text.substring(0, 30)}..." using nomic-embed-text`);
      
      const response = await fetch('http://localhost:11434/api/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'nomic-embed-text',
          prompt: text
        })
      });
      
      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status}`);
      }
      
      const data = await response.json();
      return new Float32Array(data.embedding);
    } catch (error) {
      console.error('Error generating text embedding:', error);
      // Fallback to random embeddings
      const randomArray = new Array(768).fill(0).map(() => Math.random() - 0.5);
      return new Float32Array(randomArray);
    }
  }
  
  async generateImageDescription(imagePath: string): Promise<string> {
    try {
      console.log(`Generating description for image ${imagePath} using LLaVA`);
      
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
          model: this.model,
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
      return data.response || 'No description available';
    } catch (error) {
      console.error('Error generating image description:', error);
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
    return this.model;
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
  static createProvider(type: 'ollama' | 'litellm', config?: any): LLMProvider {
    switch (type) {
      case 'ollama':
        return new OllamaProvider(config?.model);
      case 'litellm':
        return new LiteLLMProvider(config?.model, config?.apiKey);
      default:
        throw new Error(`Unknown LLM provider type: ${type}`);
    }
  }
}
