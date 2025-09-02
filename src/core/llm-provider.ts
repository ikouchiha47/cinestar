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
  generateEmbedding(text: string): Promise<number[]>;
  
  /**
   * Generate embeddings for image content
   */
  generateImageEmbedding(imagePath: string): Promise<number[]>;
  
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
      // Simple check - in a real implementation this would ping the Ollama API
      return true;
    } catch (error) {
      console.error('Ollama availability check failed:', error);
      return false;
    }
  }
  
  async generateEmbedding(text: string): Promise<number[]> {
    // Simplified implementation - would call Ollama API
    console.log(`Generating embedding for text "${text.substring(0, 30)}..." using Ollama model ${this.model}`);
    return new Array(384).fill(0).map(() => Math.random() - 0.5);
  }
  
  async generateImageEmbedding(imagePath: string): Promise<number[]> {
    // Simplified implementation - would call Ollama API with image
    console.log(`Generating embedding for image ${imagePath} using Ollama model ${this.model}`);
    return new Array(384).fill(0).map(() => Math.random() - 0.5);
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
  
  async generateEmbedding(text: string): Promise<number[]> {
    // Simplified implementation - would call LiteLLM API
    console.log(`Generating embedding for text "${text.substring(0, 30)}..." using LiteLLM model ${this.model}`);
    return new Array(384).fill(0).map(() => Math.random() - 0.5);
  }
  
  async generateImageEmbedding(imagePath: string): Promise<number[]> {
    // Simplified implementation - would call LiteLLM API with image
    console.log(`Generating embedding for image ${imagePath} using LiteLLM model ${this.model}`);
    return new Array(384).fill(0).map(() => Math.random() - 0.5);
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
