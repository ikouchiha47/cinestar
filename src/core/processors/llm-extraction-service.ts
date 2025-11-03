import { ProviderManager } from '../llm/provider-manager';

/**
 * Structured elements extracted from image captions
 */
export interface ExtractedElements {
  objects: string[];
  people: string[];
  colors: string[];
  lighting: string;
  time: string;
  setting: string;
  mood?: string;
}

/**
 * LLM-based extraction service for converting natural language captions
 * into structured metadata using any configured LLM provider
 */
export class LLMExtractionService {
  private providerManager: ProviderManager;

  constructor(providerManager: ProviderManager) {
    this.providerManager = providerManager;
    const activeProvider = providerManager.getActiveProvider();
    const model = providerManager.getModelForTask('text');
    console.log(`[LLM-EXTRACTION] Using provider: ${activeProvider.name}, model: ${model}`);
  }

  /**
   * Extract structured elements from a natural language caption
   */
  async extractElements(caption: string): Promise<ExtractedElements> {
    const prompt = this.buildExtractionPrompt(caption);
    
    const activeProvider = this.providerManager.getActiveProvider();
    const model = this.providerManager.getModelForTask('text');
    
    console.log(`[LLM-EXTRACTION] Extracting from caption (${caption.length} chars)...`);
    console.log(`[LLM-EXTRACTION] Using provider: ${activeProvider.name}, model: ${model}`);
    
    try {
      const adapter = this.providerManager.getProviderForTask('text');
      
      // Use chat API with system message for extraction
      const response = await adapter.chat([
        {
          role: 'system',
          content: 'You are a helpful assistant that extracts structured information from image descriptions.'
        },
        {
          role: 'user',
          content: prompt
        }
      ], {
        model,
        temperature: 0.7,
        maxTokens: 500
      });

      const extractedText = response.content?.trim() || '';
      
      console.log(`[LLM-EXTRACTION] Response length: ${extractedText.length} chars`);
      console.log(`[LLM-EXTRACTION] Response preview:`, extractedText.substring(0, 200));
      
      if (!extractedText) {
        console.warn('[LLM-EXTRACTION] ⚠️  Empty response from LLM, using fallback values');
        console.warn('[LLM-EXTRACTION] Caption was:', caption.substring(0, 200));
        return this.getFallbackElements();
      }

      const parsed = this.parseExtractedElements(extractedText);
      console.log(`[LLM-EXTRACTION] ✅ Extracted:`, {
        objects: parsed.objects.length,
        people: parsed.people.length,
        colors: parsed.colors.length
      });
      
      return parsed;
      
    } catch (error) {
      console.error('[LLM-EXTRACTION] ❌ Extraction failed:', error);
      console.error('[LLM-EXTRACTION] Caption was:', caption.substring(0, 200));
      return this.getFallbackElements();
    }
  }

  /**
   * Build extraction prompt for llama3.2
   */
  private buildExtractionPrompt(caption: string): string {
    return `Extract structured information from this image description. Return ONLY a concise list in this exact format:

OBJECTS: [comma-separated list]
PEOPLE: [comma-separated list or 'none']
COLORS: [comma-separated list]
LIGHTING: [brief description]
TIME: [time of day]
SETTING: [brief location description]
MOOD: [optional mood/atmosphere]

/nothink

Description: ${caption}`;
  }

  /**
   * Parse LLM response into structured elements
   */
  private parseExtractedElements(text: string): ExtractedElements {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    
    try {
      const objects = this.extractLine(lines, 'OBJECTS:')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      
      const people = this.extractLine(lines, 'PEOPLE:')
        .split(',')
        .map(s => s.trim())
        .filter(s => s && s.toLowerCase() !== 'none');
      
      const colors = this.extractLine(lines, 'COLORS:')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      
      const lighting = this.extractLine(lines, 'LIGHTING:') || 'unknown';
      const time = this.extractLine(lines, 'TIME:') || 'unknown';
      const setting = this.extractLine(lines, 'SETTING:') || 'unknown';
      const mood = this.extractLine(lines, 'MOOD:') || undefined;

      return {
        objects: objects.length > 0 ? objects : ['unknown'],
        people: people.length > 0 ? people : [],
        colors: colors.length > 0 ? colors : ['unknown'],
        lighting,
        time,
        setting,
        mood
      };
      
    } catch (error) {
      console.error('[LLM-EXTRACTION] Parsing failed:', error);
      return this.getFallbackElements();
    }
  }

  /**
   * Extract a line value from parsed lines
   */
  private extractLine(lines: string[], prefix: string): string {
    const line = lines.find(l => l.toUpperCase().startsWith(prefix.toUpperCase()));
    if (!line) return '';
    
    const value = line.substring(prefix.length).trim();
    // Remove common prefixes like brackets
    return value.replace(/^\[|\]$/g, '').trim();
  }

  /**
   * Fallback elements when extraction fails
   */
  private getFallbackElements(): ExtractedElements {
    return {
      objects: ['unknown'],
      people: [],
      colors: ['unknown'],
      lighting: 'unknown',
      time: 'unknown',
      setting: 'unknown',
      mood: undefined
    };
  }

  /**
   * Check if LLM service is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const adapter = this.providerManager.getProviderForTask('text');
      return await adapter.isAvailable();
    } catch (error) {
      console.error('[LLM-EXTRACTION] Availability check failed:', error);
      return false;
    }
  }
}
