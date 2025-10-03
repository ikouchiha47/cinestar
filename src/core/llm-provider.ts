import { RetryQueue } from './retry-queue';
import { ConfigManager } from './config';

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
  generateImageDescription(imagePath: string, originalImagePath?: string): Promise<string>;

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

  /**
   * Transform natural language question into optimized search query
   */
  transformQuestionToQuery(question: string): Promise<string>;

  /**
   * Extract key entities and concepts from natural language query
   */
  extractSearchEntities(question: string): Promise<string[]>;
}

const CaptionQuery = "Describe the: Objects, Actions, Intent of Action, Scene and Interractions between objects in the image."

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
      const config = ConfigManager.getConfig();
      const response = await fetch(`${config.ai.searchUrl}/api/tags`);
      if (!response.ok) return false;
      const data = await response.json();
      // Check for configured vision model instead of hardcoded 'llava'
      const visionModel = config.ai.visionModel;
      return data.models && data.models.some((model: any) => model.name.includes(visionModel.split(':')[0]));
    } catch (error) {
      console.error('Ollama availability check failed:', error);
      return false;
    }
  }

  async generateEmbedding(text: string): Promise<Float32Array> {
    const operation = async (): Promise<Float32Array> => {
      console.log(`Generating text embedding for "${text.substring(0, 30)}..." using ${this.embeddingModel}`);

      const config = ConfigManager.getConfig();
      const response = await fetch(`${config.ai.searchUrl}/api/embeddings`, {
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
      // Fallback to random embeddings using configured dimension
      const dim = ConfigManager.getConfig().ai.embeddingDimensions || 768;
      const randomArray = new Array(dim).fill(0).map(() => Math.random() - 0.5);
      return new Float32Array(randomArray);
    }
  }

  async generateImageDescription(imagePath: string, _originalImagePath?: string): Promise<string> {
    const operation = async (): Promise<string> => {
      console.log(`Generating description for image ${imagePath} using ${this.visionModel}`);

      // Read and encode the image
      const fs = await import('fs');
      const imageBuffer = await fs.promises.readFile(imagePath);
      const base64Image = imageBuffer.toString('base64');

      const config = ConfigManager.getConfig();
      const response = await fetch(`${config.ai.indexingUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.visionModel,
          prompt: CaptionQuery,
          images: [base64Image],
          stream: false
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${await response.text()}`);
      }

      const data = await response.json();
      console.log(' Ollama response for compressed image:', response.status, data);

      if (!data.response || data.response.trim() === '') {
        console.log('Empty response from vision model');
        console.log('Base64 image length:', base64Image.length, 'First 100 chars:', base64Image);
        throw new Error('Empty response from vision model');
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
      // Fallback to random embeddings in case of error, dimension per config
      const dim = ConfigManager.getConfig().ai.embeddingDimensions || 768;
      const randomArray = new Array(dim).fill(0).map(() => Math.random() - 0.5);
      return new Float32Array(randomArray);
    }
  }

  getName(): string {
    return 'Ollama';
  }

  getModel(): string {
    return `Vision: ${this.visionModel}, Embedding: ${this.embeddingModel}`;
  }

  async transformQuestionToQuery(question: string): Promise<string> {
    const operation = async (): Promise<string> => {
      console.log(`[QA-TRANSFORM] Transforming question: "${question}"`);
      
      const config = ConfigManager.getConfig();
      
      // Use general purpose model for question transformation
      const model = config.ai.generalPurposeModel;
      
      const prompt = `Transform this question into search keywords. Remove question words, keep only important terms.

Question: "${question}"

Keywords:`;

      let url = config.ai.embedUrl;
      url = `${url}/api/generate`
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          prompt,
          stream: false,
          options: {
            temperature: 0.2,
            num_predict: 30,
            max_tokens: 50
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Query transformation failed: ${response.status}`);
      }

      const data = await response.json();
      let transformed = data.response?.trim() || question;
      
      // Strip out common preamble patterns and clean up
      transformed = transformed
        .replace(/^Here are (?:some )?(?:key )?(?:search )?(?:terms?|keywords?).*?:\s*/i, '')
        .replace(/^(?:Keywords?|Terms?|Query).*?:\s*/i, '')
        .replace(/^\d+\.\s*/gm, '') // Remove numbered list markers
        .replace(/\n/g, ' ') // Join multi-line into single line
        .trim();
      
      // If result is empty or too long, fall back to original
      if (!transformed || transformed.length > 150) {
        transformed = question;
      }
      
      console.log(`[QA-TRANSFORM] Transformed: "${question}" → "${transformed}"`);
      return transformed;
    };

    try {
      return await this.retryQueue.addTask(operation, `question-transform-${question.substring(0, 20)}`, 3);
    } catch (error) {
      console.warn('[QA-TRANSFORM] Falling back to original question:', error);
      return question; // Fallback to original question
    }
  }

  async extractSearchEntities(question: string): Promise<string[]> {
    const operation = async (): Promise<string[]> => {
      console.log(`[QA-ENTITIES] Extracting entities from: "${question}"`);
      
      const config = ConfigManager.getConfig();
      const model = config.ai.generalPurposeModel;
      
      const prompt = `Extract keywords from: "${question}"

Return ONLY a comma-separated list, no explanations:
`;

      let url = config.ai.embedUrl;
      url = `${url}/api/generate`

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          prompt,
          stream: false,
          options: {
            temperature: 0.2,
            num_predict: 50
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Entity extraction failed: ${response.status}`);
      }

      const data = await response.json();
      let entitiesText = data.response?.trim() || '';
      
      // Strip out common preamble patterns
      entitiesText = entitiesText
        .replace(/^Here are (?:some )?(?:important )?keywords?.*?:\s*/i, '')
        .replace(/^(?:Keywords?|Entities|Terms).*?:\s*/i, '')
        .replace(/^\d+\.\s*/gm, '') // Remove numbered list markers
        .trim();
      
      // Parse comma-separated entities or newline-separated
      let entities: string[];
      if (entitiesText.includes(',')) {
        entities = entitiesText.split(',');
      } else {
        entities = entitiesText.split('\n');
      }
      
      entities = entities
        .map((e: string) => e.trim())
        .filter((e: string) => e.length > 0 && e.length < 50) // Filter out long explanatory text
        .slice(0, 5); // Limit to top 5 entities
      
      console.log(`[QA-ENTITIES] Extracted: [${entities.join(', ')}]`);
      return entities.length > 0 ? entities : [question]; // Fallback to original
    };

    try {
      return await this.retryQueue.addTask(operation, `entity-extract-${question.substring(0, 20)}`, 3);
    } catch (error) {
      console.warn('[QA-ENTITIES] Falling back to simple keywords:', error);
      
      // Fallback: simple keyword extraction
      const keywords = question.toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length > 3 && !['which', 'what', 'have', 'with', 'about', 'videos', 'video'].includes(word));
      
      return keywords.length > 0 ? keywords : [question];
    }
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

  async generateImageDescription(imagePath: string, _originalImagePath?: string): Promise<string> {
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

  async transformQuestionToQuery(question: string): Promise<string> {
    // LiteLLM implementation would use actual API
    console.log(`[QA-TRANSFORM] LiteLLM transforming: "${question}"`);
    return question; // Placeholder - implement with actual LiteLLM API
  }

  async extractSearchEntities(question: string): Promise<string[]> {
    // LiteLLM implementation would use actual API
    console.log(`[QA-ENTITIES] LiteLLM extracting from: "${question}"`);
    return [question]; // Placeholder - implement with actual LiteLLM API
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
      case 'litellm':
        return new LiteLLMProvider(config);
      default:
        throw new Error(`Unknown LLM provider type: ${type}`);
    }
  }
}
