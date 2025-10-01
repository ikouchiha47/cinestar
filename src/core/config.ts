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
    baseUrl: string;
    useLoadBalancer: boolean;
    loadBalancerUrl: string;
    // Specialized service URLs for optimal performance
    embedUrl: string;        // Embedding service (BGE-large, tinyllama) - /embed path
    captionUrl: string;      // Vision/captioning service (moondream:v2) - /caption path  
    transcriptionUrl: string; // Transcription service (whisper) - /asr path
    // Legacy URLs (deprecated but kept for backward compatibility)
    searchUrl: string;       // Direct Ollama for search embeddings (no queuing)
    indexingUrl: string;     // Load-balanced Ollama for indexing operations
    embeddingModel: string;
    embeddingDimensions: number;
    visionModel: string;
    visionModelDims: [number, number];
    maxTokens: number;
    temperature: number;
  };
  video?: {
    pipeline?: {
      parallel?: boolean;
      maxWorkers?: number;
      concurrencyLimit?: number;
      threadsPerProcess?: number;
    };
    frameSelection?: {
      maxCandidateFrames: number;
      maxFinalFrames: number;
      sampleInterval: number;
      sceneThreshold: number;
      similarityThreshold: number;
    };
    thumbnails?: {
      width: number;
      height: number;
      quality: number;
    };
    keyframes?: {
      mode: 'scene' | 'rate' | 'progressive';
      fps: number;           // when > 0, sample this many frames per second
      targetTotal: number;   // when > 0 and fps === 0, evenly sample this many frames
      maxTotal: number;      // hard limit on total frames extracted
      maxPerSegment?: number; // maximum keyframes per segment to prevent excessive generation
      sceneThreshold?: number; // scene detection threshold for keyframe extraction
    };
  };
  captioning?: {
    batchSize: number;        // outer batch size
    concurrency: number;      // per-batch concurrency
    timeoutMs: number;        // request timeout; 0 disables
    retries: number;          // retry attempts; 0 disables
    retryDelayMs: number;     // base delay for backoff
    captionKeyframes: boolean;
    captionThumbnails: boolean;
  };
  debug: {
    enabled: boolean;
    saveCompressedImages: boolean;
    saveLLaVAOutputs: boolean;
    outputDir: string;
    persistTempFiles: boolean;     // Keep temp files after processing
    cleanupOnExit: boolean;        // Clean temp files on app exit
    maxTempSizeGB: number;         // Max temp storage (GB)
  };
  vectorDbPath: string; // NEW: unified DB path for vectors
}

import os from 'os';
import path from 'path';

// Use project-relative path for development, system path for production
const isDev = process.env.NODE_ENV === 'development' || process.env.DEBUG_MODE === 'true';
const defaultDbPath = process.env.VECTOR_DB_PATH || 
  (isDev ? './data/vector.db' : path.join(os.homedir(), '.clipwise', 'vector.db'));

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
    baseUrl: 'http://localhost:11343',
    useLoadBalancer: false,
    loadBalancerUrl: 'http://localhost:9001',
    // Specialized service URLs for optimal performance
    embedUrl: 'http://localhost:9001/embed',     // Embedding service via nginx
    captionUrl: 'http://localhost:9001/caption', // Vision/captioning service via nginx
    transcriptionUrl: 'http://localhost:9001/asr', // Transcription service via nginx
    // Legacy URLs (deprecated but kept for backward compatibility)
    searchUrl: 'http://localhost:11343',      // Direct Ollama instance 1 (fast, no queuing)
    indexingUrl: 'http://localhost:9001',     // Nginx load balancer for Ollama (distributed)
    embeddingModel: 'qllama/bge-large-en-v1.5:latest',
    embeddingDimensions: 1024,
    visionModel: 'moondream:v2',
    visionModelDims: [378, 378], // Moondream v2 dimensions
    maxTokens: 2048,
    temperature: 0.1,
  },
  video: {
    pipeline: {
      parallel: true,
      maxWorkers: Math.max(1, Math.min((os.cpus()?.length || 4) - 1, parseInt(process.env.VIDEO_MAX_WORKERS || '4', 10))),
      concurrencyLimit: 4, // Frame processing concurrency limit
      threadsPerProcess: parseInt(process.env.VIDEO_FFMPEG_THREADS || '2', 10), // Single-threaded ffmpeg by default
    },
    frameSelection: {
      maxCandidateFrames: 150,   // Stage 1: FFmpeg analysis candidates (increased for longer videos)
      maxFinalFrames: 60,        // Stage 6: Final selected frames per segment (1 frame every ~1-2 seconds)
      sampleInterval: 30,        // Sample every N frames
      sceneThreshold: 0.15,      // Scene detection threshold
      similarityThreshold: 0.15, // Frame similarity threshold
    },
    thumbnails: {
      width: 320,               // Default thumbnail width
      height: 240,              // Default thumbnail height
      quality: 2,               // JPEG quality (1-31, lower is better)
    },
    keyframes: {
      mode: 'progressive',       // 'scene' | 'rate' | 'progressive'
      fps: 0,
      targetTotal: 0,
      maxTotal: 500,
      maxPerSegment: 5,          // Maximum keyframes per segment to prevent excessive generation
      sceneThreshold: 0.6,       // Higher threshold for keyframe scene detection (vs 0.4 for segmentation)
      // progressive extraction settings are handled in visual-processor/progressive-keyframe-extractor
    },
  },
  captioning: {
    batchSize: 4,
    concurrency: 4,
    timeoutMs: 0,         // disabled by default
    retries: 0,           // disabled by default
    retryDelayMs: 1000,
    captionKeyframes: true,
    captionThumbnails: false,
  },
  debug: {
    enabled: process.env.DEBUG_MODE === 'true', // Enable with DEBUG_MODE=true
    saveCompressedImages: process.env.DEBUG_MODE === 'true',
    saveLLaVAOutputs: process.env.DEBUG_MODE === 'true',
    outputDir: process.env.DEBUG_OUTPUT_DIR || './debug-output',
    persistTempFiles: process.env.DEBUG_MODE === 'true', // Keep temp files in debug mode
    cleanupOnExit: process.env.DEBUG_MODE !== 'true',    // Clean up unless debugging
    maxTempSizeGB: parseFloat(process.env.MAX_TEMP_SIZE_GB || '5.0') // 5GB default limit
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
      video: {
        ...(this.config.video || {}),
        ...(updates.video || {}),
        pipeline: {
          ...((this.config.video || {}).pipeline || {}),
          ...((updates.video || {}).pipeline || {}),
        }
      },
      captioning: ({
        ...this.config.captioning,
        ...((updates.captioning || {}) as Partial<AppConfig['captioning']>),
      } as AppConfig['captioning']),
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
      outputDir: outputDir || './debug-output',
      persistTempFiles: true,
      cleanupOnExit: false,
      maxTempSizeGB: 5.0
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
    this.config.debug.persistTempFiles = false;
    this.config.debug.cleanupOnExit = true;
    console.log('🐛 [DEBUG] Debug mode disabled');
  }

  /**
   * Get debug configuration
   */
  static getDebugConfig() {
    return { ...this.config.debug };
  }
}
