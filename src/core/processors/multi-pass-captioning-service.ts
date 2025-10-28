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
   */
  async analyzeImage(imagePath: string): Promise<MultiPassResult> {
    const config = ConfigManager.getConfig();
    const multiPassConfig = config.multiPass;

    // Phase 1: Comprehensive caption from moondream
    console.log('[MULTI-PASS] Phase 1: Generating comprehensive caption...');
    const captionResult = await this.moondreamService.caption(imagePath, {
      prompt: 'What do you see in this image? Describe everything including the setting, objects, people, activities, colors, lighting, and mood.'
    });

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
    if (multiPassConfig?.phases?.enableExtraction) {
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

    // Phase 3: Spatial analysis (if enabled)
    let spatial: string | undefined;
    if (multiPassConfig?.phases?.enableSpatial && elements.objects.length > 0) {
      console.log('[MULTI-PASS] Phase 3: Spatial analysis...');
      const spatialPrompt = this.queryBuilder.buildSpatialPrompt(elements);
      const spatialResult = await this.moondreamService.caption(imagePath, {
        prompt: spatialPrompt
      });
      spatial = spatialResult.caption;
      tokens.spatial = spatialResult.metadata?.tokens || 0;
      tokens.moondreamOnly += tokens.spatial;
    }

    // Phase 4: Temporal analysis (if enabled)
    let temporal: string | undefined;
    if (multiPassConfig?.phases?.enableTemporal && elements.objects.length > 0) {
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
