/**
 * LLM Configuration IPC Handler
 * 
 * Handles IPC communication between renderer and main process for LLM configuration.
 * Manages user config persistence in userData directory (works with ASAR).
 */

import { ipcMain } from 'electron';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import type { UserLLMConfig } from '../core/llm/user-config.types';
import { DEFAULT_USER_CONFIG } from '../core/llm/user-config.types';

export class LLMConfigHandler {
  private configPath: string;
  private userConfig: UserLLMConfig | null = null;

  constructor() {
    // Use same path resolution as DataMigrator
    const dataDir = this.getDataDirectory();
    this.configPath = path.join(dataDir, 'llm-config.json');
    this.registerHandlers();
  }

  /**
   * Get data directory (same logic as DataMigrator)
   */
  private getDataDirectory(): string {
    const isDev = process.env.NODE_ENV === 'development' || !!process.env.VITE_DEV_SERVER_URL;
    if (isDev) {
      return path.join(process.cwd(), 'data');
    }
    return app?.getPath('userData') || path.join(os.homedir(), '.cinestar-app');
  }

  /**
   * Initialize and load user config
   */
  async initialize(): Promise<void> {
    await this.loadUserConfig();
  }

  /**
   * Register all IPC handlers
   */
  private registerHandlers(): void {
    // Get full user config
    ipcMain.handle('llm:getUserConfig', async () => {
      if (!this.userConfig) {
        await this.loadUserConfig();
      }
      return this.userConfig;
    });

    // Get active provider
    ipcMain.handle('llm:getActiveProvider', async () => {
      if (!this.userConfig) {
        await this.loadUserConfig();
      }
      return this.userConfig!.activeProvider;
    });

    // Set active provider
    ipcMain.handle('llm:setActiveProvider', async (_, providerId: string) => {
      if (!this.userConfig) {
        await this.loadUserConfig();
      }
      this.userConfig!.activeProvider = providerId;
      await this.saveUserConfig();
      return { success: true };
    });

    // Get API key for provider
    ipcMain.handle('llm:getApiKey', async (_, providerId: string) => {
      if (!this.userConfig) {
        await this.loadUserConfig();
      }
      return this.userConfig!.providers[providerId]?.apiKey;
    });

    // Set API key for provider
    ipcMain.handle('llm:setApiKey', async (_, providerId: string, apiKey: string) => {
      if (!this.userConfig) {
        await this.loadUserConfig();
      }
      
      if (!this.userConfig!.providers[providerId]) {
        this.userConfig!.providers[providerId] = {
          enabled: true,
          selectedModels: {}
        };
      }
      
      this.userConfig!.providers[providerId].apiKey = apiKey;
      await this.saveUserConfig();
      return { success: true };
    });

    // Set selected model for task
    ipcMain.handle('llm:setSelectedModel', async (_, providerId: string, task: string, modelId: string) => {
      if (!this.userConfig) {
        await this.loadUserConfig();
      }
      
      if (!this.userConfig!.providers[providerId]) {
        this.userConfig!.providers[providerId] = {
          enabled: true,
          selectedModels: {}
        };
      }
      
      (this.userConfig!.providers[providerId].selectedModels as any)[task] = modelId;
      await this.saveUserConfig();
      return { success: true };
    });

    // Get selected model for task
    ipcMain.handle('llm:getSelectedModel', async (_, providerId: string, task: string) => {
      if (!this.userConfig) {
        await this.loadUserConfig();
      }
      return (this.userConfig!.providers[providerId]?.selectedModels as any)?.[task];
    });

    // Enable/disable provider
    ipcMain.handle('llm:setProviderEnabled', async (_, providerId: string, enabled: boolean) => {
      if (!this.userConfig) {
        await this.loadUserConfig();
      }
      
      if (!this.userConfig!.providers[providerId]) {
        this.userConfig!.providers[providerId] = {
          enabled,
          selectedModels: {}
        };
      } else {
        this.userConfig!.providers[providerId].enabled = enabled;
      }
      
      await this.saveUserConfig();
      return { success: true };
    });

    // Save entire config (for bulk updates)
    ipcMain.handle('llm:saveUserConfig', async (_, config: UserLLMConfig) => {
      this.userConfig = config;
      await this.saveUserConfig();
      return { success: true };
    });
  }

  /**
   * Load user config from disk
   */
  private async loadUserConfig(): Promise<void> {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf-8');
        this.userConfig = JSON.parse(data);
        
        // Migrate if needed
        this.userConfig = this.migrateConfig(this.userConfig);
      } else {
        // First run - create default config
        this.userConfig = { ...DEFAULT_USER_CONFIG };
        await this.saveUserConfig();
      }
    } catch (error) {
      console.error('[LLM-CONFIG] Failed to load user config:', error);
      this.userConfig = { ...DEFAULT_USER_CONFIG };
    }
  }

  /**
   * Save user config to disk
   */
  private async saveUserConfig(): Promise<void> {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      fs.writeFileSync(
        this.configPath,
        JSON.stringify(this.userConfig, null, 2),
        'utf-8'
      );
    } catch (error) {
      console.error('[LLM-CONFIG] Failed to save user config:', error);
      throw error;
    }
  }

  /**
   * Migrate config to latest version
   */
  private migrateConfig(config: any): UserLLMConfig {
    // Handle future migrations here
    if (!config.version || config.version === '1.0.0') {
      return config as UserLLMConfig;
    }
    
    // Add migration logic for future versions
    return config as UserLLMConfig;
  }

  /**
   * Get current user config (for internal use)
   */
  getUserConfig(): UserLLMConfig | null {
    return this.userConfig;
  }
}

// Singleton instance
let configHandler: LLMConfigHandler | null = null;

export function initializeLLMConfigHandler(): LLMConfigHandler {
  if (!configHandler) {
    configHandler = new LLMConfigHandler();
  }
  return configHandler;
}

export function getLLMConfigHandler(): LLMConfigHandler {
  if (!configHandler) {
    throw new Error('LLMConfigHandler not initialized. Call initializeLLMConfigHandler() first.');
  }
  return configHandler;
}
