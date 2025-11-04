import { MultiPassCaptioningService } from '../processors/multi-pass-captioning-service';
import { LLMExtractionService } from '../processors/llm-extraction-service';
import { PhaseQueryBuilder } from '../processors/phase-query-builder';
import { VisionService } from '../processors/vision-service';
import { ConfigManager } from '../config';
import { ProviderManager } from '../llm/provider-manager';
import { KeyframeData } from './types';

/**
 * CaptioningCoordinator
 * 
 * Responsibilities:
 * - Coordinate multi-pass captioning for keyframes
 * - Generate scene reconstructions from transcription + visual captions
 * - Handle fallback to simple captioning when multi-pass fails
 * - Manage captioning service lifecycle
 */
export class CaptioningCoordinator {
  private providerManager: ProviderManager;
  private multiPassService?: MultiPassCaptioningService;
  private extractionService?: LLMExtractionService;
  private visionService?: VisionService;
  private queryBuilder?: PhaseQueryBuilder;
  private multiPassEnabled: boolean = false;

  constructor(providerManager: ProviderManager) {
    this.providerManager = providerManager;
    const config = ConfigManager.getConfig();
    this.multiPassEnabled = config.multiPass?.enabled || false;

    if (this.multiPassEnabled) {
      try {
        this.multiPassService = new MultiPassCaptioningService(providerManager);
        this.extractionService = new LLMExtractionService(providerManager);
        this.queryBuilder = new PhaseQueryBuilder();
        console.log('[CAPTIONING-COORDINATOR] ✅ Multi-pass captioning enabled');
      } catch (error) {
        console.error('[CAPTIONING-COORDINATOR] ⚠️ Failed to initialize multi-pass services:', error);
        this.multiPassEnabled = false;
      }
    } else {
      console.log('[CAPTIONING-COORDINATOR] Multi-pass captioning disabled');
    }
    
    // Initialize vision service for simple captioning fallback
    this.visionService = new VisionService(providerManager);
  }

  /**
   * Caption multiple keyframes with multi-pass analysis
   * Returns structured caption data including spatial, temporal, and element information
   */
  async captionKeyframes(keyframes: any[]): Promise<KeyframeData[]> {
    if (!keyframes || keyframes.length === 0) {
      console.warn('[CAPTIONING-COORDINATOR] No keyframes to caption');
      return [];
    }

    console.log(`[CAPTIONING-COORDINATOR] Captioning ${keyframes.length} keyframes...`);
    const results: KeyframeData[] = [];

    for (const keyframe of keyframes) {
      try {
        const captionData = await this.captionSingleKeyframe(keyframe);
        results.push(captionData);
      } catch (error) {
        console.error(`[CAPTIONING-COORDINATOR] Failed to caption keyframe ${keyframe.id}:`, error);
        // Add fallback caption on error
        results.push({
          id: keyframe.id,
          timestamp: keyframe.timestamp,
          imagePath: keyframe.imagePath,
          caption: 'Visual content',
          confidence: 0.0
        });
      }
    }

    console.log(`[CAPTIONING-COORDINATOR] ✅ Captioned ${results.length}/${keyframes.length} keyframes`);
    return results;
  }

  /**
   * Caption a single keyframe
   * Uses multi-pass if enabled, falls back to simple captioning otherwise
   */
  private async captionSingleKeyframe(keyframe: any): Promise<KeyframeData> {
    if (this.multiPassEnabled && this.multiPassService) {
      try {
        // Multi-pass captioning with spatial, temporal, and element extraction
        const multiPassResult = await this.multiPassService.analyzeImage(keyframe.imagePath);
        
        return {
          id: keyframe.id,
          timestamp: keyframe.timestamp,
          imagePath: keyframe.imagePath,
          caption: multiPassResult.caption,
          spatial: multiPassResult.spatial,
          temporal: multiPassResult.temporal,
          elements: multiPassResult.elements,
          confidence: 1.0
        };
      } catch (error) {
        console.warn(`[CAPTIONING-COORDINATOR] Multi-pass failed for ${keyframe.id}, falling back to simple captioning:`, error);
        // Fall through to simple captioning
      }
    }

    // Simple captioning fallback
    const caption = await this.simpleCaptioning(keyframe.imagePath);
    return {
      id: keyframe.id,
      timestamp: keyframe.timestamp,
      imagePath: keyframe.imagePath,
      caption,
      confidence: 0.8
    };
  }

  /**
   * Reconstruct scene description from transcription and visual captions
   * Combines audio and visual context using LLM to create coherent scene description
   */
  async reconstructScene(
    transcription: string,
    keyframes: KeyframeData[]
  ): Promise<string> {
    if (!transcription && (!keyframes || keyframes.length === 0)) {
      console.warn('[CAPTIONING-COORDINATOR] No content for scene reconstruction');
      return 'Scene content';
    }

    try {
      // Build rich visual context from multi-pass data
      const visualContext = this.buildVisualContext(keyframes);

      // Build prompt for scene reconstruction
      const prompt = this.buildSceneReconstructionPrompt(transcription, visualContext);

      // Call LLM for scene reconstruction
      const sceneDescription = await this.callLLMForSceneReconstruction(prompt);

      console.log(`[CAPTIONING-COORDINATOR] ✅ Scene reconstruction: ${sceneDescription.substring(0, 100)}...`);
      return sceneDescription;
    } catch (error) {
      console.error('[CAPTIONING-COORDINATOR] Scene reconstruction failed:', error);
      // Fallback to transcription or simple description
      return transcription?.substring(0, 200) || 'Scene content';
    }
  }

  /**
   * Build visual context string from keyframe data
   * Includes spatial and temporal information if available from multi-pass
   */
  private buildVisualContext(keyframes: KeyframeData[]): string {
    if (!keyframes || keyframes.length === 0) {
      return '';
    }

    return keyframes
      .filter(kf => kf.caption && kf.caption !== 'Visual content')
      .map((kf, idx) => {
        const parts = [`Frame ${idx + 1}: ${kf.caption}`];
        
        if (kf.spatial) {
          parts.push(`  Spatial: ${kf.spatial}`);
        }
        
        if (kf.temporal) {
          parts.push(`  Temporal: ${kf.temporal}`);
        }
        
        return parts.join('\n');
      })
      .join('\n\n');
  }

  /**
   * Build prompt for scene reconstruction
   */
  private buildSceneReconstructionPrompt(transcription: string, visualContext: string): string {
    return `Based on the following audio transcription and visual descriptions, 
provide a concise scene description (2-3 sentences):

Audio: ${transcription || 'No audio'}

Visual Context:
${visualContext || 'No visual context'}

Scene Description:`;
  }

  /**
   * Call LLM API for scene reconstruction
   */
  private async callLLMForSceneReconstruction(prompt: string): Promise<string> {
    try {
      const adapter = this.providerManager.getProviderForTask('text');
      const model = this.providerManager.getModelForTask('text');

      const response = await adapter.chat([
        {
          role: 'system',
          content: 'You are a helpful assistant that creates concise scene descriptions from audio and visual context.'
        },
        {
          role: 'user',
          content: prompt
        }
      ], {
        model,
        temperature: 0.7,
        maxTokens: 1500
      });

      return response.content?.trim() || '';
    } catch (error) {
      console.error('[CAPTIONING-COORDINATOR] Scene reconstruction LLM call failed:', error);
      throw error;
    }
  }

  /**
   * Simple captioning fallback
   * Returns a basic caption when multi-pass is unavailable or fails
   */
  private async simpleCaptioning(imagePath: string): Promise<string> {
    if (!this.visionService) {
      console.warn(`[CAPTIONING-COORDINATOR] No vision service available for ${imagePath}`);
      return 'Visual content';
    }
    
    try {
      console.log(`[CAPTIONING-COORDINATOR] Using simple captioning for ${imagePath}`);
      const result = await this.visionService.caption(imagePath);
      return result.caption || 'Visual content';
    } catch (error) {
      console.error(`[CAPTIONING-COORDINATOR] Simple captioning failed:`, error);
      return 'Visual content';
    }
  }

  /**
   * Check if multi-pass captioning is enabled and available
   */
  isMultiPassEnabled(): boolean {
    return this.multiPassEnabled && !!this.multiPassService;
  }

  /**
   * Get captioning statistics
   */
  getStats(): { multiPassEnabled: boolean; servicesInitialized: boolean } {
    return {
      multiPassEnabled: this.multiPassEnabled,
      servicesInitialized: !!(this.multiPassService && this.extractionService && this.queryBuilder)
    };
  }
}
