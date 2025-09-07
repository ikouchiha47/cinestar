/**
 * Application configuration settings
 */
export interface AppConfig {
  indexing: {
    concurrencyLimit: number;
    batchSize: number;
    retryAttempts: number;
    retryDelayMs: number;
    reindexOnStartup: boolean; // NEW: force re-index on startup
  };
  compression: {
    enabled: boolean;
    minSizeKB: number;
    maxWidth: number;
    maxHeight: number;
    quality: number;
  };
  ai: {
    provider: string;
    embeddingModel: string;
    visionModel: string;
    visionModelDims: [number, number];
  };
  debug: {
    enabled: boolean;
    saveCompressedImages: boolean;
    saveLLaVAOutputs: boolean;
    outputDir: string;
  };
  vectorDbPath: string; // NEW: unified DB path for vectors
}

import os from 'os';
import path from 'path';

// Use project-relative path for development, system path for production
const isDev = process.env.NODE_ENV === 'development' || process.env.DEBUG_MODE === 'true';
const defaultDbPath = process.env.VECTOR_DB_PATH || 
  (isDev ? './data/vector.db' : path.join(os.homedir(), '.driller', 'vector.db'));

export const DEFAULT_CONFIG: AppConfig = {
  indexing: {
    concurrencyLimit: 3, // Process 1 image at a time to avoid Ollama crashes
    batchSize: 10, // Standard batch size
    retryAttempts: 3,
    retryDelayMs: 1000,
    reindexOnStartup: true // Default: do not re-index on startup
  },
  compression: {
    enabled: true,
    minSizeKB: 100, // Only compress files larger than 100KB
    maxWidth: 1920,
    maxHeight: 1080,
    quality: 80
  },
  ai: {
    provider: 'ollama',
    embeddingModel: 'qllama/bge-large-en-v1.5:latest', // 1024-d embeddings (previous default)
    // visionModel: 'llava:7b',
    visionModelDims: [378, 378], // Default for LLaVA; change to [378, 378] for Moondream
    visionModel: 'moondream:v2',
  },
  debug: {
    enabled: process.env.DEBUG_MODE === 'true', // Enable with DEBUG_MODE=true
    saveCompressedImages: process.env.DEBUG_MODE === 'true',
    saveLLaVAOutputs: process.env.DEBUG_MODE === 'true',
    outputDir: process.env.DEBUG_OUTPUT_DIR || './debug-output'
  },
  vectorDbPath: defaultDbPath // Unified vector DB path
};

console.log(`📦 [CONFIG] Vector DB path: ${DEFAULT_CONFIG.vectorDbPath}`);

/**
 * Configuration manager for the application
 */
export class ConfigManager {
  private static config: AppConfig = { ...DEFAULT_CONFIG };

  /**
   * Get current configuration
   */
  static getConfig(): AppConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  static updateConfig(updates: Partial<AppConfig>): void {
    this.config = {
      ...this.config,
      ...updates,
      indexing: { ...this.config.indexing, ...updates.indexing },
      compression: { ...this.config.compression, ...updates.compression },
      ai: { ...this.config.ai, ...updates.ai },
      // Ensure visionModelDims is always present
      ...(updates.ai?.visionModelDims ? { ai: { ...this.config.ai, visionModelDims: updates.ai.visionModelDims } } : {})
    };
    
    console.log('📋 [CONFIG] Configuration updated:', this.config);
  }

  /**
   * Get indexing concurrency limit
   */
  static getConcurrencyLimit(): number {
    return this.config.indexing.concurrencyLimit;
  }

  /**
   * Set indexing concurrency limit
   */
  static setConcurrencyLimit(limit: number): void {
    if (limit < 1 || limit > 10) {
      throw new Error('Concurrency limit must be between 1 and 10');
    }
    
    this.config.indexing.concurrencyLimit = limit;
    console.log(`📋 [CONFIG] Concurrency limit set to: ${limit}`);
  }

  /**
   * Detect if GPU is available for Ollama
   */
  static async hasGPU(): Promise<boolean> {
    try {
      // Check if we're on macOS with Metal support
      if (process.platform === 'darwin') {
        return true; // macOS typically has Metal GPU support
      }
      
      // For other platforms, we could check for NVIDIA/AMD GPUs
      // For now, assume no GPU on non-macOS systems
      return false;
    } catch (error) {
      console.warn('GPU detection failed:', error);
      return false;
    }
  }

  /**
   * Get optimal concurrency based on file count and GPU availability
   */
  static async getOptimalConcurrency(fileCount: number): Promise<number> {
    const baseLimit = this.config.indexing.concurrencyLimit;
    const hasGPU = await this.hasGPU();
    
    // If no GPU, force concurrency to 1 to avoid overwhelming CPU
    if (!hasGPU) {
      console.log(`📋 [CONFIG] No GPU detected, using concurrency: 1`);
      return 1;
    }
    
    // For small batches, use lower concurrency
    if (fileCount <= 5) {
      return Math.min(2, baseLimit);
    } else if (fileCount <= 10) {
      return Math.min(2, baseLimit);
    } else if (fileCount <= 20) {
      return Math.min(3, baseLimit);
    } else {
      return baseLimit;
    }
  }

  /**
   * Reset to default configuration
   */
  static resetToDefaults(): void {
    this.config = { ...DEFAULT_CONFIG };
    console.log('📋 [CONFIG] Configuration reset to defaults');
  }

  /**
   * Enable debug mode with optional settings
   */
  static enableDebugMode(saveImages: boolean = true, saveLLaVAOutputs: boolean = true, outputDir?: string): void {
    this.config.debug = {
      enabled: true,
      saveCompressedImages: saveImages,
      saveLLaVAOutputs: saveLLaVAOutputs,
      outputDir: outputDir || './debug-output'
    };
    console.log('🐛 [DEBUG] Debug mode enabled:', this.config.debug);
  }

  /**
   * Disable debug mode
   */
  static disableDebugMode(): void {
    this.config.debug.enabled = false;
    this.config.debug.saveCompressedImages = false;
    this.config.debug.saveLLaVAOutputs = false;
    console.log('🐛 [DEBUG] Debug mode disabled');
  }

  /**
   * Get debug configuration
   */
  static getDebugConfig() {
    return { ...this.config.debug };
  }
}
