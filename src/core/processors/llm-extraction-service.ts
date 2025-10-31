import { ConfigManager } from '../config.js';

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
 * into structured metadata using llama3.2:3b
 */
export class LLMExtractionService {
  private baseUrl: string;
  private model: string;

  constructor(baseUrl?: string, model?: string) {
    const config = ConfigManager.getConfig();
    this.baseUrl = (baseUrl || config.ai.embedUrl).replace(/\/$/, '');
    this.model = model || config.ai.generalPurposeModel || 'qwen3:4b';
    console.log(`[LLM-EXTRACTION] Using model: ${this.model} at ${this.baseUrl}`);
  }

  /**
   * Extract structured elements from a natural language caption
   */
  async extractElements(caption: string): Promise<ExtractedElements> {
    const prompt = this.buildExtractionPrompt(caption);
    
    try {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt,
          stream: false,
          options: {
            temperature: 0.1, // Low temperature for consistent extraction
            num_predict: 200
          }
        })
      });

      if (!response.ok) {
        throw new Error(`LLM extraction failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const extractedText = data.response?.trim() || '';
      
      if (!extractedText) {
        console.warn('[LLM-EXTRACTION] Empty response from LLM, using fallback values');
        return this.getFallbackElements();
      }

      return this.parseExtractedElements(extractedText);
      
    } catch (error) {
      console.error('[LLM-EXTRACTION] Extraction failed:', error);
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
      const response = await fetch(`${this.baseUrl}/api/tags`, { method: 'GET' });
      if (!response.ok) return false;
      
      const data = await response.json();
      return data.models?.some((m: any) => m.name.includes(this.model)) || false;
    } catch {
      return false;
    }
  }
}
