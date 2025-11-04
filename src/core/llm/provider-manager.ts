/**
 * Provider Manager
 * 
 * Centralized management of LLM providers with privacy mode tracking
 */

import { EventEmitter } from 'events';
import {
  ILLMAdapter,
  LLMProvider,
  LLMConfig,
  ProviderType,
  PrivacyMode,
  TaskType
} from './types';
import { LiteLLMAdapter } from './litellm-adapter';
import { OllamaAdapter } from './ollama-adapter';
import { OpenAIAdapter } from './openai-adapter';
import { GeminiAdapter } from './gemini-adapter';

export class ProviderManager extends EventEmitter {
  private providers: Map<string, LLMProvider>;
  private adapters: Map<string, ILLMAdapter>;
  private activeProviderId: string;
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    super();
    this.config = config;
    this.providers = new Map();
    this.adapters = new Map();
    this.activeProviderId = config.activeProvider;

    this.loadProviders(config.providers);
  }

  /**
   * Load providers from config
   */
  private loadProviders(providers: Record<string, LLMProvider>): void {
    for (const [id, provider] of Object.entries(providers)) {
      if (provider.enabled !== false) {
        this.providers.set(id, provider);
      }
    }

    console.log(`[PROVIDER-MANAGER] Loaded ${this.providers.size} providers`);
  }

  /**
   * Get active provider adapter
   */
  getProvider(providerId?: string): ILLMAdapter {
    const id = providerId || this.activeProviderId;

    // Return cached adapter if available
    if (this.adapters.has(id)) {
      return this.adapters.get(id)!;
    }

    const provider = this.providers.get(id);
    if (!provider) {
      throw new Error(`Provider ${id} not found`);
    }

    // Create and cache adapter
    const adapter = this.createAdapter(provider);
    this.adapters.set(id, adapter);

    return adapter;
  }

  /**
   * Get adapter for specific task
   */
  getProviderForTask(task: TaskType, providerId?: string): ILLMAdapter {
    const id = providerId || this.activeProviderId;
    const provider = this.providers.get(id);

    if (!provider) {
      throw new Error(`Provider ${id} not found`);
    }

    // Verify provider has model for this task
    const hasModel = provider.config.models.some(m => m.task === task);
    if (!hasModel) {
      throw new Error(`Provider ${id} does not support task: ${task}`);
    }

    return this.getProvider(id);
  }

  /**
   * Get model name for specific task
   */
  getModelForTask(task: TaskType, providerId?: string): string {
    const id = providerId || this.activeProviderId;
    const provider = this.providers.get(id);

    if (!provider) {
      throw new Error(`Provider ${id} not found`);
    }

    const model = provider.config.models.find(m => m.task === task);
    if (!model) {
      throw new Error(`Provider ${id} has no model for task: ${task}`);
    }

    return model.modelName;
  }

  /**
   * Create adapter instance
   */
  private createAdapter(provider: LLMProvider): ILLMAdapter {
    console.log(`[PROVIDER-MANAGER] Creating ${provider.adapter} adapter for ${provider.id}`);

    // Validate API key for cloud providers
    if ((provider.adapter === 'openai' || provider.adapter === 'gemini') && !provider.config.apiKey) {
      throw new Error(`API key is required for ${provider.adapter} provider`);
    }

    // Validate baseUrl is present
    if (!provider.config.baseUrl && provider.adapter !== 'openai' && provider.adapter !== 'gemini') {
      throw new Error(`Base URL is required for ${provider.adapter} provider`);
    }

    switch (provider.adapter) {
      case 'ollama':
        return new OllamaAdapter(provider.config);
      case 'litellm':
        return new LiteLLMAdapter(provider.config);
      case 'openai':
        return new OpenAIAdapter(provider.config);
      case 'gemini':
        return new GeminiAdapter(provider.config);
      default:
        throw new Error(`Unknown adapter type: ${provider.adapter}`);
    }
  }

  /**
   * Switch active provider
   */
  async switchProvider(providerId: string): Promise<void> {
    if (!this.providers.has(providerId)) {
      throw new Error(`Provider ${providerId} not found`);
    }

    const provider = this.providers.get(providerId)!;

    // Check if provider is available
    const adapter = this.getProvider(providerId);
    const isAvailable = await adapter.isAvailable();

    if (!isAvailable) {
      throw new Error(`Provider ${providerId} is not available`);
    }

    const oldProviderId = this.activeProviderId;
    const oldPrivacyMode = this.getPrivacyMode();

    this.activeProviderId = providerId;
    this.config.activeProvider = providerId;

    const newPrivacyMode = provider.privacy;
    this.config.privacyMode = newPrivacyMode;

    // Emit events
    this.emit('provider-changed', {
      from: oldProviderId,
      to: providerId
    });

    if (oldPrivacyMode !== newPrivacyMode) {
      this.emit('privacy-mode-changed', {
        from: oldPrivacyMode,
        to: newPrivacyMode
      });
    }

    console.log(`[PROVIDER-MANAGER] Switched from ${oldProviderId} to ${providerId}`);
    console.log(`[PROVIDER-MANAGER] Privacy mode: ${newPrivacyMode}`);

    // Save config
    await this.saveConfig();
  }

  /**
   * Add new provider
   */
  async addProvider(provider: LLMProvider): Promise<void> {
    // Validate provider
    if (this.providers.has(provider.id)) {
      throw new Error(`Provider ${provider.id} already exists`);
    }

    // Test provider availability
    const adapter = this.createAdapter(provider);
    const isAvailable = await adapter.isAvailable();

    if (!isAvailable) {
      throw new Error(`Provider ${provider.id} is not available`);
    }

    // Add to providers
    this.providers.set(provider.id, provider);
    this.config.providers[provider.id] = provider;

    this.emit('provider-added', provider);

    console.log(`[PROVIDER-MANAGER] Added provider: ${provider.id}`);

    await this.saveConfig();
  }

  /**
   * Remove provider
   */
  async removeProvider(providerId: string): Promise<void> {
    if (providerId === this.activeProviderId) {
      throw new Error('Cannot remove active provider');
    }

    if (!this.providers.has(providerId)) {
      throw new Error(`Provider ${providerId} not found`);
    }

    this.providers.delete(providerId);
    delete this.config.providers[providerId];
    this.adapters.delete(providerId);

    this.emit('provider-removed', providerId);

    console.log(`[PROVIDER-MANAGER] Removed provider: ${providerId}`);

    await this.saveConfig();
  }

  /**
   * Update provider config
   */
  async updateProvider(providerId: string, updates: Partial<LLMProvider>): Promise<void> {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new Error(`Provider ${providerId} not found`);
    }

    const updatedProvider = { ...provider, ...updates };

    // Test updated provider
    const adapter = this.createAdapter(updatedProvider);
    const isAvailable = await adapter.isAvailable();

    if (!isAvailable) {
      throw new Error(`Updated provider ${providerId} is not available`);
    }

    this.providers.set(providerId, updatedProvider);
    this.config.providers[providerId] = updatedProvider;

    // Clear cached adapter
    this.adapters.delete(providerId);

    this.emit('provider-updated', updatedProvider);

    console.log(`[PROVIDER-MANAGER] Updated provider: ${providerId}`);

    await this.saveConfig();
  }

  /**
   * Get all providers
   */
  getAllProviders(): LLMProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Get active provider
   */
  getActiveProvider(): LLMProvider {
    const provider = this.providers.get(this.activeProviderId);
    if (!provider) {
      throw new Error(`Active provider ${this.activeProviderId} not found`);
    }
    return provider;
  }

  /**
   * Get current privacy mode
   */
  getPrivacyMode(): PrivacyMode {
    const provider = this.providers.get(this.activeProviderId);
    return provider?.privacy || 'private';
  }

  /**
   * Check if current mode is private
   */
  isPrivate(): boolean {
    return this.getPrivacyMode() === 'private';
  }

  /**
   * Get providers by type
   */
  getProvidersByType(type: ProviderType): LLMProvider[] {
    return Array.from(this.providers.values()).filter(p => p.type === type);
  }

  /**
   * Get providers by privacy mode
   */
  getProvidersByPrivacy(privacy: PrivacyMode): LLMProvider[] {
    return Array.from(this.providers.values()).filter(p => p.privacy === privacy);
  }

  /**
   * Validate provider configuration
   */
  async validateProvider(providerId: string): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    
    try {
      const provider = this.providers.get(providerId);
      if (!provider) {
        errors.push(`Provider ${providerId} not found`);
        return { valid: false, errors };
      }

      // Validate API key for cloud providers
      if ((provider.adapter === 'openai' || provider.adapter === 'gemini') && !provider.config.apiKey) {
        errors.push(`API key is required for ${provider.adapter} provider`);
      }

      // Validate baseUrl
      if (!provider.config.baseUrl) {
        errors.push('Base URL is required');
      } else {
        // Test baseUrl reachability with timeout
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 5000);
          
          const adapter = this.createAdapter(provider);
          const isAvailable = await adapter.isAvailable();
          
          clearTimeout(timeout);
          
          if (!isAvailable) {
            errors.push(`Provider ${providerId} is not reachable or not available`);
          }
        } catch (error) {
          errors.push(`Failed to connect to provider: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }

      // Validate models are configured
      if (!provider.config.models || provider.config.models.length === 0) {
        errors.push('No models configured for provider');
      }

      return {
        valid: errors.length === 0,
        errors
      };
    } catch (error) {
      errors.push(`Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return { valid: false, errors };
    }
  }

  /**
   * Save config to disk
   */
  private async saveConfig(): Promise<void> {
    try {
      // Use IPC to save config
      if (window.ipcRenderer) {
        const fullConfig = await window.ipcRenderer.invoke('config:get');
        fullConfig.llm = this.config;
        await window.ipcRenderer.invoke('config:set', fullConfig);
        console.log('[PROVIDER-MANAGER] Config saved');
      }
    } catch (error) {
      console.error('[PROVIDER-MANAGER] Failed to save config:', error);
      throw error;
    }
  }

  /**
   * Get default provider configuration
   */
  static getDefaultConfig(): LLMConfig {
    return {
      activeProvider: 'ollama-local',
      privacyMode: 'private',
      providers: {
        'ollama-local': {
          id: 'ollama-local',
          name: 'Ollama (Local)',
          type: 'local',
          adapter: 'ollama',
          privacy: 'private',
          config: {
            baseUrl: 'http://localhost:11434',
            models: [
              { task: 'vision', modelName: 'moondream:v2', displayName: 'Moondream v2' },
              { task: 'embedding', modelName: 'qllama/bge-large-en-v1.5:latest', displayName: 'BGE Large' },
              { task: 'text', modelName: 'phi3:3.8b', displayName: 'Phi-3 3.8B' }
            ],
            timeout: 300000
          },
          enabled: true
        },
        'openai-cloud': {
          id: 'openai-cloud',
          name: 'OpenAI',
          type: 'cloud',
          adapter: 'openai',
          privacy: 'cloud',
          config: {
            baseUrl: 'https://api.openai.com/v1',
            apiKey: '',
            models: [
              { task: 'vision', modelName: 'gpt-4-vision-preview', displayName: 'GPT-4 Vision' },
              { task: 'embedding', modelName: 'text-embedding-3-large', displayName: 'Text Embedding 3 Large' },
              { task: 'text', modelName: 'gpt-4', displayName: 'GPT-4' }
            ],
            timeout: 60000
          },
          enabled: false
        },
        'gemini-cloud': {
          id: 'gemini-cloud',
          name: 'Google Gemini',
          type: 'cloud',
          adapter: 'gemini',
          privacy: 'cloud',
          config: {
            baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
            apiKey: '',
            models: [
              { task: 'vision', modelName: 'gemini-pro-vision', displayName: 'Gemini Pro Vision' },
              { task: 'embedding', modelName: 'text-embedding-004', displayName: 'Text Embedding 004' },
              { task: 'text', modelName: 'gemini-pro', displayName: 'Gemini Pro' }
            ],
            timeout: 60000
          },
          enabled: false
        },
        'litellm-proxy': {
          id: 'litellm-proxy',
          name: 'LiteLLM Proxy',
          type: 'cloud',
          adapter: 'litellm',
          privacy: 'cloud',
          config: {
            baseUrl: 'http://localhost:4000',
            apiKey: '',
            models: [
              { task: 'vision', modelName: 'gpt-4-vision-preview', displayName: 'GPT-4 Vision (via LiteLLM)' },
              { task: 'embedding', modelName: 'text-embedding-3-large', displayName: 'Text Embedding (via LiteLLM)' },
              { task: 'text', modelName: 'gpt-4', displayName: 'GPT-4 (via LiteLLM)' }
            ],
            timeout: 60000
          },
          enabled: false
        }
      }
    };
  }
}
