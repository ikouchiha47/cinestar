/**
 * VisionService
 * 
 * Provider-agnostic vision/captioning service that uses ProviderManager
 * to support multiple LLM providers (Ollama, OpenAI, Gemini, LiteLLM)
 */

import { CaptioningService } from './captioning-processor';
import { ProviderManager } from '../llm/provider-manager';
import { ImageProcessingUtils } from '../image-processing-utils';
import { ConfigManager } from '../config';

export class VisionService implements CaptioningService {
  public name = 'vision-service';
  private providerManager: ProviderManager;

  constructor(providerManager: ProviderManager) {
    this.providerManager = providerManager;
    console.log('[VISION-SERVICE] Initialized with ProviderManager');
  }

  /**
   * Caption an image using the active provider's vision model
   */
  async caption(imagePath: string, options: any = {}): Promise<{
    caption: string;
    confidence?: number;
    metadata?: Record<string, any>;
  }> {
    try {
      // Get the active provider and model for vision tasks
      const adapter = this.providerManager.getProviderForTask('vision');
      const model = this.providerManager.getModelForTask('vision');
      const activeProvider = this.providerManager.getActiveProvider();

      console.log(`[VISION-SERVICE] Using provider: ${activeProvider.name}, model: ${model}`);

      // Prepare image data
      const imageData = await this.prepareImage(imagePath, options);

      // Build prompt
      const prompt = options.prompt || 'Describe this image in detail.';

      // Call provider's vision API
      const response = await adapter.vision(imageData, prompt, {
        model,
        maxTokens: options.maxTokens,
        detail: options.detail
      });

      console.log(`[VISION-SERVICE] Caption generated: ${response.content.substring(0, 100)}...`);

      return {
        caption: response.content || '',
        confidence: 1.0,
        metadata: {
          model: response.model || model,
          provider: activeProvider.id,
          usage: response.usage
        }
      };
    } catch (error) {
      console.error('[VISION-SERVICE] Caption failed:', error);
      throw new Error(`Vision service error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Check if vision service is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const adapter = this.providerManager.getProviderForTask('vision');
      return await adapter.isAvailable();
    } catch (error) {
      console.error('[VISION-SERVICE] Availability check failed:', error);
      return false;
    }
  }

  /**
   * Prepare image for vision API
   * Handles image processing and format conversion based on provider
   */
  private async prepareImage(imagePath: string, options: any = {}): Promise<string> {
    const activeProvider = this.providerManager.getActiveProvider();
    const config = ConfigManager.getConfig();

    // For Ollama and Gemini, we need base64 data
    // For OpenAI, we can use file:// URLs or data URLs
    if (activeProvider.adapter === 'ollama' || activeProvider.adapter === 'gemini') {
      // Use ImageProcessingUtils for consistent image processing
      let imageBuffer: Buffer;
      
      try {
        imageBuffer = await ImageProcessingUtils.prepareForVisionModel(
          imagePath,
          config.ai.visionModelDims,
          {
            forceQuality: options.quality,
            format: 'jpeg'
          }
        );
      } catch (imageError) {
        throw new Error(`Image processing failed: ${imageError instanceof Error ? imageError.message : 'Unknown error'}`);
      }

      const base64 = imageBuffer.toString('base64');
      
      // Ollama expects plain base64, Gemini and OpenAI expect data URLs
      if (activeProvider.adapter === 'ollama') {
        return base64;
      } else {
        return `data:image/jpeg;base64,${base64}`;
      }
    }

    // For OpenAI and LiteLLM, return file path (adapter will handle conversion)
    return imagePath;
  }

  /**
   * Get the current provider information
   */
  getProviderInfo(): { id: string; name: string; model: string } {
    const activeProvider = this.providerManager.getActiveProvider();
    const model = this.providerManager.getModelForTask('vision');
    
    return {
      id: activeProvider.id,
      name: activeProvider.name,
      model
    };
  }
}
