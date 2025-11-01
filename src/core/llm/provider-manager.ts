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
    
    switch (provider.adapter) {
      case 'ollama':
        return new OllamaAdapter(provider.config);
      case 'litellm':
        return new LiteLLMAdapter(provider.config);
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
              { task: 'text', modelName: 'qwen3:4b', displayName: 'Qwen3 4B' }
            ],
            timeout: 300000
          },
          enabled: true
        }
      }
    };
  }
}
