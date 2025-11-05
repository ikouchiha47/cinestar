/**
 * Ollama Model Validator
 * 
 * Validates that models listed in config actually exist in Ollama.
 * Uses Ollama's /api/show endpoint to check model availability.
 */

interface OllamaModelInfo {
  modelfile: string;
  parameters: string;
  template: string;
  details: {
    format: string;
    family: string;
    families: string[];
    parameter_size: string;
    quantization_level: string;
  };
}

interface ValidationResult {
  modelId: string;
  exists: boolean;
  error?: string;
  details?: OllamaModelInfo;
}

export class OllamaModelValidator {
  private baseUrl: string;
  private cache: Map<string, ValidationResult> = new Map();

  constructor(baseUrl: string = 'http://localhost:11434') {
    this.baseUrl = baseUrl;
  }

  /**
   * Check if a specific model exists in Ollama
   */
  async validateModel(modelId: string): Promise<ValidationResult> {
    // Check cache first
    if (this.cache.has(modelId)) {
      return this.cache.get(modelId)!;
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/show`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: modelId }),
      });

      if (response.ok) {
        const data: OllamaModelInfo = await response.json();
        const result: ValidationResult = {
          modelId,
          exists: true,
          details: data,
        };
        this.cache.set(modelId, result);
        return result;
      } else {
        const result: ValidationResult = {
          modelId,
          exists: false,
          error: `Model not found (HTTP ${response.status})`,
        };
        this.cache.set(modelId, result);
        return result;
      }
    } catch (error) {
      // Silently fail validation - don't spam console with 404s during onboarding
      const result: ValidationResult = {
        modelId,
        exists: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
      this.cache.set(modelId, result);
      return result;
    }
  }

  /**
   * Validate multiple models at once
   */
  async validateModels(modelIds: string[]): Promise<ValidationResult[]> {
    const results = await Promise.all(
      modelIds.map(id => this.validateModel(id))
    );
    return results;
  }

  /**
   * Get list of all available models from Ollama
   */
  async getAvailableModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (response.ok) {
        const data = await response.json();
        return data.models?.map((m: any) => m.name) || [];
      }
      return [];
    } catch (error) {
      console.error('[OLLAMA-VALIDATOR] Failed to fetch available models:', error);
      return [];
    }
  }

  /**
   * Clear validation cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Check if Ollama is running
   */
  async isOllamaRunning(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
      });
      return response.ok;
    } catch (error) {
      return false;
    }
  }
}

// Singleton instance
export const ollamaValidator = new OllamaModelValidator();
