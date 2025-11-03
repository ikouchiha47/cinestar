import { OllamaCaptioningService } from './ollama-captioning-service.js';
import { LLMExtractionService, ExtractedElements } from './llm-extraction-service.js';
import { PhaseQueryBuilder } from './phase-query-builder.js';
import { ConfigManager } from '../config.js';

/**
 * Result from multi-pass captioning
 */
export interface MultiPassResult {
  caption: string;
  elements: ExtractedElements;
  spatial?: string;
  temporal?: string;
  tokens: {
    caption: number;
    extraction: number;
    spatial?: number;
    temporal?: number;
    total: number;
    moondreamOnly: number;
  };
}

/**
 * Multi-pass captioning service using LLM extraction chain approach
 * 
 * Flow:
 * 1. Phase 1: Moondream generates comprehensive caption
 * 2. Phase 2: LLM (llama3.2) extracts structured elements
 * 3. Phase 3: Moondream spatial analysis (optional)
 * 4. Phase 4: Moondream temporal analysis (optional)
 */
export class MultiPassCaptioningService {
  private moondreamService: OllamaCaptioningService;
  private extractionService: LLMExtractionService;
  private queryBuilder: PhaseQueryBuilder;

  constructor() {
    this.moondreamService = new OllamaCaptioningService();
    this.extractionService = new LLMExtractionService();
    this.queryBuilder = new PhaseQueryBuilder();
  }

  /**
   * Perform multi-pass analysis on an image
   * @param imagePath Path to the image file
   * @param context Optional context: 'image' for standalone images, 'video' for video keyframes
   */
  async analyzeImage(imagePath: string, context: 'image' | 'video' = 'image'): Promise<MultiPassResult> {
    const config = ConfigManager.getConfig();
    const multiPassConfig = config.multiPass;
    const contextConfig = context === 'image' ? multiPassConfig?.image : multiPassConfig?.video;

    // Phase 1: Comprehensive caption from moondream
    const useSinglePass = contextConfig?.singlePassMode ?? false;
    const prompt = useSinglePass
      ? `Describe this image in detail, including:
1. CONTENT: What objects, people, and elements are present?
2. SPATIAL: Where are things positioned? What's in the foreground, middle ground, and background? How are elements arranged in depth?
3. TEMPORAL: What actions, movements, or dynamic elements are visible? What sense of motion or time is conveyed?
4. CONTEXT: Setting, colors, lighting, and overall mood.

Provide a rich, comprehensive description covering all these aspects.`
      : 'What do you see in this image? Describe everything including the setting, objects, people, activities, colors, lighting, and mood.';
    
    const captionResult = await this.moondreamService.caption(imagePath, { prompt });

    const tokens = {
      caption: captionResult.metadata?.tokens || 0,
      extraction: 0,
      spatial: undefined as number | undefined,
      temporal: undefined as number | undefined,
      total: 0,
      moondreamOnly: captionResult.metadata?.tokens || 0
    };

    // Phase 2: Extract structured elements (if enabled)
    let elements: ExtractedElements;
    if (contextConfig?.enableExtraction) {
      console.log('[MULTI-PASS] Phase 2: Extracting structured elements...');
      elements = await this.extractionService.extractElements(captionResult.caption);
      tokens.extraction = 58; // Approximate token count for extraction
    } else {
      // Fallback to empty elements
      elements = {
        objects: [],
        people: [],
        colors: [],
        lighting: 'unknown',
        time: 'unknown',
        setting: 'unknown'
      };
    }

    // Phase 3: Spatial analysis (if enabled and not in single-pass mode)
    let spatial: string | undefined;
    if (contextConfig?.enableSpatial && elements.objects.length > 0) {
      console.log('[MULTI-PASS] Phase 3: Spatial analysis...');
      const spatialPrompt = this.queryBuilder.buildSpatialPrompt(elements);
      const spatialResult = await this.moondreamService.caption(imagePath, {
        prompt: spatialPrompt
      });
      spatial = spatialResult.caption;
      tokens.spatial = spatialResult.metadata?.tokens || 0;
      tokens.moondreamOnly += tokens.spatial;
    }

    // Phase 4: Temporal analysis (if enabled and not in single-pass mode)
    let temporal: string | undefined;
    if (contextConfig?.enableTemporal && elements.objects.length > 0) {
      console.log('[MULTI-PASS] Phase 4: Temporal analysis...');
      const temporalPrompt = this.queryBuilder.buildTemporalPrompt(elements);
      const temporalResult = await this.moondreamService.caption(imagePath, {
        prompt: temporalPrompt
      });
      temporal = temporalResult.caption;
      tokens.temporal = temporalResult.metadata?.tokens || 0;
      tokens.moondreamOnly += tokens.temporal;
    }

    // Calculate total tokens
    tokens.total = tokens.caption + tokens.extraction + (tokens.spatial || 0) + (tokens.temporal || 0);

    console.log('[MULTI-PASS] Complete:', {
      totalTokens: tokens.total,
      moondreamTokens: tokens.moondreamOnly,
      phases: {
        caption: tokens.caption,
        extraction: tokens.extraction,
        spatial: tokens.spatial,
        temporal: tokens.temporal
      }
    });

    return {
      caption: captionResult.caption,
      elements,
      spatial,
      temporal,
      tokens
    };
  }

  /**
   * Check if all required services are available
   */
  async isAvailable(): Promise<boolean> {
    const moondreamAvailable = await this.moondreamService.isAvailable();
    const extractionAvailable = await this.extractionService.isAvailable();
    
    return moondreamAvailable && extractionAvailable;
  }
}
