/**
 * ModelManager - Manages Ollama model downloads and availability checks
 * 
 * Handles:
 * - Checking if required models are installed
 * - Downloading missing models via Ollama API
 * - Progress tracking for downloads
 * - Error handling and retries
 */

export interface ModelInfo {
  name: string;
  purpose: string;
  size: string;
  required: boolean;
}

export interface ModelStatus {
  name: string;
  installed: boolean;
  size?: number;
  modifiedAt?: string;
}

export interface DownloadProgress {
  model: string;
  status: string;
  total?: number;
  completed?: number;
  percentage?: number;
}

export class ModelManager {
  private baseUrl: string;
  
  // Required models for the application
  static readonly REQUIRED_MODELS: ModelInfo[] = [
    {
      name: 'moondream:v2',
      purpose: 'Vision/Captioning',
      size: '~1.7GB',
      required: true
    },
    {
      name: 'qllama/bge-large-en-v1.5:latest',
      purpose: 'Text Embeddings',
      size: '~340MB',
      required: true
    },
    {
      name: 'hf.co/gpustack/bge-m3-GGUF:Q6_K',
      purpose: 'Multilingual Embeddings',
      size: '~1.2GB',
      required: true
    },
    {
      name: 'qwen3:4b',
      purpose: 'Text Generation',
      size: '~2.5GB',
      required: false // Usually already installed
    }
  ];

  constructor(baseUrl: string = 'http://localhost:11434') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  /**
   * Check if Ollama is running
   */
  async isOllamaRunning(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });
      return response.ok;
    } catch (error) {
      console.error('[MODEL-MANAGER] Ollama not running:', error);
      return false;
    }
  }

  /**
   * Get list of installed models
   */
  async getInstalledModels(): Promise<ModelStatus[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.statusText}`);
      }

      const data = await response.json();
      return data.models.map((model: any) => ({
        name: model.name,
        installed: true,
        size: model.size,
        modifiedAt: model.modified_at
      }));
    } catch (error) {
      console.error('[MODEL-MANAGER] Failed to get installed models:', error);
      throw error;
    }
  }

  /**
   * Check if a specific model is installed
   */
  async checkModel(modelName: string): Promise<boolean> {
    try {
      const models = await this.getInstalledModels();
      return models.some(m => m.name === modelName);
    } catch (error) {
      console.error(`[MODEL-MANAGER] Failed to check model ${modelName}:`, error);
      return false;
    }
  }

  /**
   * Check all required models and return status
   */
  async checkRequiredModels(): Promise<{
    missing: ModelInfo[];
    existing: ModelInfo[];
    all: ModelInfo[];
  }> {
    try {
      const installedModels = await this.getInstalledModels();
      const installedNames = new Set(installedModels.map(m => m.name));

      const missing: ModelInfo[] = [];
      const existing: ModelInfo[] = [];

      for (const model of ModelManager.REQUIRED_MODELS) {
        if (installedNames.has(model.name)) {
          existing.push(model);
        } else {
          missing.push(model);
        }
      }

      console.log(`[MODEL-MANAGER] Model status: ${existing.length} installed, ${missing.length} missing`);
      
      return {
        missing,
        existing,
        all: ModelManager.REQUIRED_MODELS
      };
    } catch (error) {
      console.error('[MODEL-MANAGER] Failed to check required models:', error);
      throw error;
    }
  }

  /**
   * Pull (download) a model from Ollama
   * @param modelName - Name of the model to download
   * @param onProgress - Optional callback for progress updates
   */
  async pullModel(
    modelName: string,
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<void> {
    console.log(`[MODEL-MANAGER] Starting download of ${modelName}...`);

    try {
      const response = await fetch(`${this.baseUrl}/api/pull`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: modelName,
          stream: true // Enable streaming for progress updates
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to pull model: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const progress = JSON.parse(line);
            
            // Calculate percentage if total and completed are available
            if (progress.total && progress.completed) {
              progress.percentage = Math.round((progress.completed / progress.total) * 100);
            }

            console.log(`[MODEL-MANAGER] ${modelName}: ${progress.status}${progress.percentage ? ` (${progress.percentage}%)` : ''}`);

            if (onProgress) {
              onProgress({
                model: modelName,
                ...progress
              });
            }

            // Check for completion or error
            if (progress.status === 'success') {
              console.log(`[MODEL-MANAGER] ✅ Successfully downloaded ${modelName}`);
              return;
            }

            if (progress.error) {
              throw new Error(progress.error);
            }
          } catch (parseError) {
            console.warn('[MODEL-MANAGER] Failed to parse progress:', line);
          }
        }
      }
    } catch (error) {
      console.error(`[MODEL-MANAGER] Failed to pull model ${modelName}:`, error);
      throw error;
    }
  }

  /**
   * Download all missing required models
   * @param onProgress - Optional callback for progress updates
   */
  async downloadMissingModels(
    onProgress?: (model: string, progress: DownloadProgress) => void
  ): Promise<void> {
    const { missing } = await this.checkRequiredModels();

    if (missing.length === 0) {
      console.log('[MODEL-MANAGER] All required models are already installed');
      return;
    }

    console.log(`[MODEL-MANAGER] Downloading ${missing.length} missing models...`);

    for (const model of missing) {
      console.log(`[MODEL-MANAGER] Downloading ${model.name} (${model.purpose})...`);
      
      try {
        await this.pullModel(model.name, (progress) => {
          if (onProgress) {
            onProgress(model.name, progress);
          }
        });
      } catch (error) {
        console.error(`[MODEL-MANAGER] Failed to download ${model.name}:`, error);
        throw new Error(`Failed to download ${model.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    console.log('[MODEL-MANAGER] ✅ All required models downloaded successfully');
  }

  /**
   * Download models in parallel (faster but more resource intensive)
   */
  async downloadMissingModelsParallel(
    onProgress?: (model: string, progress: DownloadProgress) => void
  ): Promise<void> {
    const { missing } = await this.checkRequiredModels();

    if (missing.length === 0) {
      console.log('[MODEL-MANAGER] All required models are already installed');
      return;
    }

    console.log(`[MODEL-MANAGER] Downloading ${missing.length} models in parallel...`);

    const downloadPromises = missing.map(model => 
      this.pullModel(model.name, (progress) => {
        if (onProgress) {
          onProgress(model.name, progress);
        }
      })
    );

    try {
      await Promise.all(downloadPromises);
      console.log('[MODEL-MANAGER] ✅ All required models downloaded successfully');
    } catch (error) {
      console.error('[MODEL-MANAGER] Failed to download models:', error);
      throw error;
    }
  }

  /**
   * Get human-readable size from bytes
   */
  static formatSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }
}
