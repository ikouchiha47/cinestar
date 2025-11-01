/**
 * Provider Configuration Manager
 * 
 * Manages LLM provider configurations including model listings,
 * defaults, and API key management.
 */

import type { ProviderConfig, ModelCapability } from './provider-config.types';
import openaiConfig from './openai-models-config.json';
import ollamaConfig from './ollama-models-config.json';
import litellmConfig from './litellm-models-config.json';

export class ProviderConfigManager {
  private configs: Map<string, ProviderConfig>;
  private customConfigs: Map<string, ProviderConfig>;

  constructor() {
    this.configs = new Map();
    this.customConfigs = new Map();
    this.loadBuiltInConfigs();
  }

  /**
   * Load built-in provider configurations
   */
  private loadBuiltInConfigs(): void {
    this.configs.set('openai', openaiConfig as ProviderConfig);
    this.configs.set('ollama', ollamaConfig as ProviderConfig);
    this.configs.set('litellm', litellmConfig as ProviderConfig);
  }

  /**
   * Get configuration for a specific provider
   */
  getConfig(providerId: string): ProviderConfig | undefined {
    return this.customConfigs.get(providerId) || this.configs.get(providerId);
  }

  /**
   * Get all available provider configurations
   */
  getAllConfigs(): ProviderConfig[] {
    const allConfigs = new Map([...this.configs, ...this.customConfigs]);
    return Array.from(allConfigs.values());
  }

  /**
   * Get all provider IDs
   */
  getProviderIds(): string[] {
    const allConfigs = new Map([...this.configs, ...this.customConfigs]);
    return Array.from(allConfigs.keys());
  }

  /**
   * Add or update a custom provider configuration
   */
  setCustomConfig(config: ProviderConfig): void {
    this.customConfigs.set(config.provider, config);
  }

  /**
   * Remove a custom provider configuration
   */
  removeCustomConfig(providerId: string): boolean {
    return this.customConfigs.delete(providerId);
  }

  /**
   * Get default model for a specific task
   */
  getDefaultModel(providerId: string, task: keyof ProviderConfig['defaults']): string | undefined {
    const config = this.getConfig(providerId);
    return config?.defaults[task];
  }

  /**
   * Get all models for a specific provider
   */
  getAllModels(providerId: string): ModelCapability[] {
    const config = this.getConfig(providerId);
    if (!config) return [];

    const models: ModelCapability[] = [];
    for (const category of Object.values(config.categories)) {
      models.push(...category.models);
    }
    return models;
  }

  /**
   * Get models by category
   */
  getModelsByCategory(providerId: string, categoryId: string): ModelCapability[] {
    const config = this.getConfig(providerId);
    return config?.categories[categoryId]?.models || [];
  }

  /**
   * Get models by capability
   */
  getModelsByCapability(providerId: string, capability: string): ModelCapability[] {
    const allModels = this.getAllModels(providerId);
    return allModels.filter(model => model.capabilities.includes(capability));
  }

  /**
   * Find a model by ID across all categories
   */
  findModel(providerId: string, modelId: string): ModelCapability | undefined {
    const allModels = this.getAllModels(providerId);
    return allModels.find(model => model.id === modelId);
  }

  /**
   * Get the default model for a category
   */
  getDefaultModelForCategory(providerId: string, categoryId: string): ModelCapability | undefined {
    const models = this.getModelsByCategory(providerId, categoryId);
    return models.find(model => model.default) || models[0];
  }

  /**
   * Validate if a model exists for a provider
   */
  isValidModel(providerId: string, modelId: string): boolean {
    return this.findModel(providerId, modelId) !== undefined;
  }

  /**
   * Get API key configuration for a provider
   */
  getApiKeyConfig(providerId: string) {
    const config = this.getConfig(providerId);
    return config?.apiKey;
  }

  /**
   * Check if a provider requires an API key
   */
  requiresApiKey(providerId: string): boolean {
    const apiKeyConfig = this.getApiKeyConfig(providerId);
    return apiKeyConfig?.required ?? false;
  }

  /**
   * Get documentation URL for a provider
   */
  getDocsUrl(providerId: string): string | undefined {
    const config = this.getConfig(providerId);
    return config?.docsUrl;
  }

  /**
   * Export configuration as JSON
   */
  exportConfig(providerId: string): string | undefined {
    const config = this.getConfig(providerId);
    return config ? JSON.stringify(config, null, 2) : undefined;
  }

  /**
   * Import configuration from JSON
   */
  importConfig(jsonString: string): boolean {
    try {
      const config = JSON.parse(jsonString) as ProviderConfig;
      
      // Validate required fields
      if (!config.provider || !config.name || !config.baseUrl) {
        return false;
      }

      this.setCustomConfig(config);
      return true;
    } catch (error) {
      console.error('Failed to import config:', error);
      return false;
    }
  }

  /**
   * Create a template for a custom provider configuration
   */
  createConfigTemplate(providerId: string, name: string, baseUrl: string): ProviderConfig {
    return {
      provider: providerId,
      name,
      baseUrl,
      docsUrl: '',
      apiKey: {
        required: true,
        editable: true,
        envVar: `${providerId.toUpperCase()}_API_KEY`,
        label: `${name} API Key`,
        placeholder: 'Enter your API key'
      },
      defaults: {
        text: '',
        vision: '',
        embedding: ''
      },
      categories: {
        text: {
          label: 'Text Models',
          description: 'Models for text generation',
          models: []
        }
      }
    };
  }
}

// Singleton instance
export const providerConfigManager = new ProviderConfigManager();
