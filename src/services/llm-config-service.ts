/**
 * LLM Configuration Service
 * 
 * Renderer-side service for interacting with LLM configuration via IPC.
 * Provides a clean API for React components to manage LLM settings.
 */

import type { UserLLMConfig } from '../core/llm/user-config.types';

export class LLMConfigService {
  /**
   * Get full user configuration
   */
  async getUserConfig(): Promise<UserLLMConfig> {
    return window.electron.invoke('llm:getUserConfig');
  }

  /**
   * Save full user configuration
   */
  async saveUserConfig(config: UserLLMConfig): Promise<void> {
    await window.electron.invoke('llm:saveUserConfig', config);
  }

  /**
   * Get currently active provider ID
   */
  async getActiveProvider(): Promise<string> {
    const config = await this.getUserConfig();
    return config.activeProvider;
  }

  /**
   * Set active provider
   */
  async setActiveProvider(providerId: string): Promise<void> {
    await window.electron.invoke('llm:setActiveProvider', providerId);
  }

  /**
   * Get API key for a provider
   */
  async getApiKey(providerId: string): Promise<string | undefined> {
    return window.electron.invoke('llm:getApiKey', providerId);
  }

  /**
   * Set API key for a provider
   */
  async setApiKey(providerId: string, apiKey: string): Promise<void> {
    await window.electron.invoke('llm:setApiKey', providerId, apiKey);
  }

  /**
   * Get selected model for a task
   */
  async getSelectedModel(providerId: string, task: string): Promise<string | undefined> {
    return window.electron.invoke('llm:getSelectedModel', providerId, task);
  }

  /**
   * Set selected model for a task
   */
  async setSelectedModel(providerId: string, task: string, modelId: string): Promise<void> {
    await window.electron.invoke('llm:setSelectedModel', providerId, task, modelId);
  }

  /**
   * Enable or disable a provider
   */
  async setProviderEnabled(providerId: string, enabled: boolean): Promise<void> {
    await window.electron.invoke('llm:setProviderEnabled', providerId, enabled);
  }
}

// Singleton instance
export const llmConfigService = new LLMConfigService();
