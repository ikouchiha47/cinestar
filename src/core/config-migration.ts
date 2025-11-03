/**
 * Config Migration Utility
 * 
 * Migrates old aiServices config format to new LLM provider format
 */

import { LLMConfig } from './llm/types';
import { ProviderManager } from './llm/provider-manager';

export interface OldAIServicesConfig {
  transcription?: {
    baseUrl?: string;
    model?: string;
    enabled?: boolean;
  };
  captioning?: {
    baseUrl?: string;
    model?: string;
    enabled?: boolean;
  };
  sceneReconstruction?: {
    baseUrl?: string;
    model?: string;
    enabled?: boolean;
  };
}

export interface OldConfig {
  aiServices?: OldAIServicesConfig;
  ai?: {
    captionUrl?: string;
    embedUrl?: string;
    visionModel?: string;
    generalPurposeModel?: string;
    embeddingModel?: string;
  };
}

export class ConfigMigration {
  /**
   * Check if config needs migration
   */
  static needsMigration(config: any): boolean {
    // If llm config already exists, no migration needed
    if (config.llm) {
      return false;
    }
    
    // If old aiServices or ai config exists, migration needed
    return !!(config.aiServices || config.ai);
  }

  /**
   * Migrate old config to new LLM provider format
   */
  static migrate(oldConfig: OldConfig): LLMConfig {
    console.log('[CONFIG-MIGRATION] Starting migration from old config format...');
    
    // Start with default config
    const llmConfig = ProviderManager.getDefaultConfig();
    
    // Extract old config values
    const captionUrl = oldConfig.aiServices?.captioning?.baseUrl 
      || oldConfig.ai?.captionUrl 
      || 'http://localhost:11434';
      
    const embedUrl = oldConfig.aiServices?.sceneReconstruction?.baseUrl
      || oldConfig.ai?.embedUrl
      || 'http://localhost:11434';
      
    const visionModel = oldConfig.aiServices?.captioning?.model
      || oldConfig.ai?.visionModel
      || 'moondream:v2';
      
    const textModel = oldConfig.aiServices?.sceneReconstruction?.model
      || oldConfig.ai?.generalPurposeModel
      || 'qwen3:4b';
      
    const embeddingModel = oldConfig.ai?.embeddingModel
      || 'qllama/bge-large-en-v1.5:latest';

    // Update Ollama provider with migrated values
    llmConfig.providers['ollama-local'].config.baseUrl = captionUrl;
    llmConfig.providers['ollama-local'].config.models = [
      { task: 'vision', modelName: visionModel, displayName: visionModel },
      { task: 'embedding', modelName: embeddingModel, displayName: embeddingModel },
      { task: 'text', modelName: textModel, displayName: textModel }
    ];
    
    console.log('[CONFIG-MIGRATION] ✅ Migration complete');
    console.log('[CONFIG-MIGRATION] Migrated settings:', {
      baseUrl: captionUrl,
      visionModel,
      textModel,
      embeddingModel
    });
    
    return llmConfig;
  }

  /**
   * Apply migration to config object
   */
  static applyMigration(config: any): any {
    if (!this.needsMigration(config)) {
      console.log('[CONFIG-MIGRATION] No migration needed');
      return config;
    }
    
    console.log('[CONFIG-MIGRATION] Applying migration...');
    
    // Migrate to new format
    const llmConfig = this.migrate(config);
    
    // Add llm config to existing config
    const migratedConfig = {
      ...config,
      llm: llmConfig,
      _migrated: {
        from: 'aiServices',
        to: 'llm',
        timestamp: new Date().toISOString()
      }
    };
    
    console.log('[CONFIG-MIGRATION] ✅ Migration applied successfully');
    
    return migratedConfig;
  }

  /**
   * Get migration summary for logging
   */
  static getMigrationSummary(oldConfig: OldConfig, newConfig: LLMConfig): string {
    const summary = [
      'Config Migration Summary:',
      '========================',
      '',
      'Old Config:',
      `  Caption URL: ${oldConfig.aiServices?.captioning?.baseUrl || oldConfig.ai?.captionUrl || 'N/A'}`,
      `  Vision Model: ${oldConfig.aiServices?.captioning?.model || oldConfig.ai?.visionModel || 'N/A'}`,
      `  Text Model: ${oldConfig.aiServices?.sceneReconstruction?.model || oldConfig.ai?.generalPurposeModel || 'N/A'}`,
      `  Embedding Model: ${oldConfig.ai?.embeddingModel || 'N/A'}`,
      '',
      'New Config:',
      `  Active Provider: ${newConfig.activeProvider}`,
      `  Privacy Mode: ${newConfig.privacyMode}`,
      `  Base URL: ${newConfig.providers[newConfig.activeProvider]?.config.baseUrl || 'N/A'}`,
      `  Models: ${newConfig.providers[newConfig.activeProvider]?.config.models.length || 0} configured`,
      ''
    ];
    
    return summary.join('\n');
  }
}
