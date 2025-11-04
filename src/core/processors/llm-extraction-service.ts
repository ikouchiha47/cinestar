import { ProviderManager } from '../llm/provider-manager';
import { ConfigManager } from '../config';

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

  constructor(providerManager?: ProviderManager) {
    // Create default ProviderManager if not provided
    if (!providerManager) {
      const config = ConfigManager.getConfig();
      const llmConfig = (config as any).llm || ProviderManager.getDefaultConfig();
      providerManager = new ProviderManager(llmConfig);
    }
    
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
      
      // Define JSON schema for structured extraction
      const jsonSchema = {
        type: 'object',
        properties: {
          objects: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of objects visible in the image'
          },
          people: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of people or their descriptions'
          },
          colors: {
            type: 'array',
            items: { type: 'string' },
            description: 'Dominant colors in the image'
          },
          lighting: {
            type: 'string',
            description: 'Brief description of lighting conditions'
          },
          time: {
            type: 'string',
            description: 'Time of day (e.g., morning, afternoon, evening, night)'
          },
          setting: {
            type: 'string',
            description: 'Brief location or setting description'
          },
          mood: {
            type: 'string',
            description: 'Optional mood or atmosphere'
          }
        },
        required: ['objects', 'people', 'colors', 'lighting', 'time', 'setting']
      };
      
      // Use chat API with JSON schema for structured output
      const response = await adapter.chat([
        {
          role: 'user',
          content: prompt
        }
      ], {
        model,
        temperature: 0.3,
        maxTokens: 500,
        format: jsonSchema
      });

      const extractedText = response.content?.trim() || '';
      
      console.log(`[LLM-EXTRACTION] Response length: ${extractedText.length} chars`);
      console.log(`[LLM-EXTRACTION] Response preview:`, extractedText.substring(0, 200));
      
      if (!extractedText) {
        console.warn('[LLM-EXTRACTION] ⚠️  Empty response from LLM, using fallback values');
        console.warn('[LLM-EXTRACTION] Caption was:', caption.substring(0, 200));
        return this.getFallbackElements();
      }

      // Parse JSON response
      const parsed = this.parseJsonResponse(extractedText);
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
   * Build extraction prompt for JSON output
   */
  private buildExtractionPrompt(caption: string): string {
    return `Extract structured information from this image description and return it as JSON.

Description: ${caption}

Extract:
- objects: array of objects visible in the image
- people: array of people descriptions (empty array if none)
- colors: array of dominant colors
- lighting: brief description of lighting conditions
- time: time of day (morning/afternoon/evening/night/unknown)
- setting: brief location description
- mood: optional mood or atmosphere

Return valid JSON only.`;
  }

  /**
   * Parse JSON response into structured elements
   */
  private parseJsonResponse(text: string): ExtractedElements {
    try {
      const json = JSON.parse(text);
      
      return {
        objects: Array.isArray(json.objects) && json.objects.length > 0 ? json.objects : ['unknown'],
        people: Array.isArray(json.people) ? json.people : [],
        colors: Array.isArray(json.colors) && json.colors.length > 0 ? json.colors : ['unknown'],
        lighting: json.lighting || 'unknown',
        time: json.time || 'unknown',
        setting: json.setting || 'unknown',
        mood: json.mood || undefined
      };
    } catch (error) {
      console.error('[LLM-EXTRACTION] JSON parse failed:', error);
      console.error('[LLM-EXTRACTION] Raw text:', text);
      // Fallback to old parsing method
      return this.parseExtractedElements(text);
    }
  }
  
  /**
   * Parse LLM response into structured elements (fallback for non-JSON)
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
