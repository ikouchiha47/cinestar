import { BaseVideoProcessor, ProcessingContext, ProcessingResult } from '../video-pipeline';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import sharp from 'sharp';
import { ConfigManager } from '../config';
import { OllamaCaptioningService } from './ollama-captioning-service';

// Pluggable captioning interface
export interface CaptioningService {
  name: string;
  caption(imagePath: string, options?: any): Promise<{
    caption: string;
    confidence?: number;
    metadata?: Record<string, any>;
  }>;
  isAvailable(): Promise<boolean>;
}

// Moondream v2 HTTP service implementation
export class MoondreamService implements CaptioningService {
  public name = 'moondream-v2';
  private endpoint: string;

  constructor(endpoint: string = 'http://localhost:8003/caption') {
    this.endpoint = endpoint;
  }

  async caption(imagePath: string, options: any = {}) {
    const imageBuffer = await fs.readFile(imagePath);
    const base64Image = imageBuffer.toString('base64');

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        image_base64: base64Image,
        ...options 
      })
    });

    if (!response.ok) {
      throw new Error(`Captioning service error: ${response.statusText}`);
    }

    const result = await response.json();
    return {
      caption: result.caption,
      confidence: result.confidence,
      metadata: result.metadata
    };
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.endpoint.replace('/caption', '/health')}`, { 
        method: 'GET' 
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

// Generic HTTP captioning service
export class HttpCaptioningService implements CaptioningService {
  public name: string;
  private endpoint: string;

  constructor(name: string, endpoint: string) {
    this.name = name;
    this.endpoint = endpoint;
  }

  async caption(imagePath: string, options: any = {}) {
    const imageBuffer = await fs.readFile(imagePath);
    const base64Image = imageBuffer.toString('base64');

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        image: base64Image,
        ...options 
      })
    });

    if (!response.ok) {
      throw new Error(`Captioning service error: ${response.statusText}`);
    }

    return await response.json();
  }

  async isAvailable(): Promise<boolean> {
    try {
      const healthEndpoint = this.endpoint.replace(/\/[^/]*$/, '/health');
      const response = await fetch(healthEndpoint, { method: 'GET' });
      return response.ok;
    } catch {
      return false;
    }
  }
}

export class CaptioningProcessor extends BaseVideoProcessor {
  public name = 'captioning';
  public version = '1.0.0';
  private services: CaptioningService[] = [];
  private activeService?: CaptioningService;

  constructor(config: {
    captionKeyframes?: boolean;
    captionThumbnails?: boolean;
    batchSize?: number;
    services?: CaptioningService[];
  } = {}) {
    super();
    this.setConfig({
      captionKeyframes: true,
      captionThumbnails: true,
      batchSize: 4, // Process images in batches
      ...config
    });

    // Register default services - prefer Ollama, fallback to HTTP service
    this.services = config.services || [
      new OllamaCaptioningService(),
      new MoondreamService()
    ];
  }

  addService(service: CaptioningService): void {
    this.services.push(service);
  }

  removeService(serviceName: string): boolean {
    const index = this.services.findIndex(s => s.name === serviceName);
    if (index === -1) return false;
    
    this.services.splice(index, 1);
    if (this.activeService?.name === serviceName) {
      this.activeService = undefined;
    }
    return true;
  }

  private async findAvailableService(): Promise<CaptioningService | undefined> {
    for (const service of this.services) {
      if (await service.isAvailable()) {
        return service;
      }
    }
    return undefined;
  }

  private async processImageBatch(
    imagePaths: string[], 
    service: CaptioningService
  ): Promise<Array<{ path: string; caption: string; error?: string }>> {
    const results = [];
    
    for (const imagePath of imagePaths) {
      try {
        // Optionally compress large images to reduce payload/timeout errors
        let inputPath = imagePath;
        try {
          const st = await fs.stat(imagePath);
          const sizeKB = Math.round((st.size || 0) / 1024);
          let usedCompressed = false;
          if (st.size > 1_500_000) {
            const tmpDir = path.join(os.tmpdir(), 'driller-caption');
            await fs.mkdir(tmpDir, { recursive: true });
            const base = path.basename(imagePath).replace(/\.[^.]+$/, '');
            const outPath = path.join(tmpDir, `${base}_c.jpg`);
            try {
              const config = ConfigManager.getConfig();
              const [maxWidth, maxHeight] = config.ai.visionModelDims;
              await sharp(await fs.readFile(imagePath))
                .resize({ width: maxWidth, height: maxHeight, fit: 'inside', withoutEnlargement: true })
                .jpeg({ quality: 80 })
                .toFile(outPath);
              const st2 = await fs.stat(outPath);
              const sizeKB2 = Math.round((st2.size || 0) / 1024);
              this.log('debug', `Compressing image for captioning: ${path.basename(imagePath)} ${sizeKB}KB -> ${sizeKB2}KB`);
              inputPath = outPath;
              usedCompressed = true;
            } catch (e) {
              this.log('warn', `Image compression failed, using original: ${path.basename(imagePath)}`);
            }
          }
          if (!usedCompressed) {
            this.log('debug', `Captioning image: ${path.basename(imagePath)} ~${sizeKB}KB`);
          }
        } catch { /* ignore compression errors */ }

        const result = await service.caption(inputPath);
        results.push({
          path: imagePath,
          caption: result.caption
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        // Per-image failure logging with path and concise error
        this.log('error', `Captioning failed for image: ${imagePath}`, msg);
        results.push({
          path: imagePath,
          caption: '',
          error: msg || 'Unknown error'
        });
      }
    }
    
    return results;
  }

  async process(context: ProcessingContext): Promise<ProcessingResult> {
    try {
      const { segment } = context;
      const config = this.getConfig();

      this.log('info', `Processing captions for segment: ${segment.id}`);

      // Find an available captioning service
      if (!this.activeService) {
        this.activeService = await this.findAvailableService();
        if (!this.activeService) {
          this.log('warn', 'No captioning services available, skipping');
          return {
            success: true,
            data: { captions: null, reason: 'no_service_available' }
          };
        }
        this.log('info', `Using captioning service: ${this.activeService.name}`);
      }

      const imagesToProcess: string[] = [];
      
      // Collect images to caption
      if (config.captionKeyframes && context.data.keyframes) {
        imagesToProcess.push(...context.data.keyframes);
      }
      
      if (config.captionThumbnails && context.data.thumbnails) {
        imagesToProcess.push(...context.data.thumbnails);
      }

      if (imagesToProcess.length === 0) {
        this.log('warn', 'No images available for captioning');
        return {
          success: true,
          data: { captions: [], reason: 'no_images_available' }
        };
      }

      this.log('info', `Captioning ${imagesToProcess.length} images`);
      this.log('info', `Caption batch size: ${config.batchSize}`);

      // Process images in batches
      const allCaptions = [];
      const batchSize = config.batchSize;
      
      for (let i = 0; i < imagesToProcess.length; i += batchSize) {
        const batch = imagesToProcess.slice(i, i + batchSize);
        const batchResults = await this.processImageBatch(batch, this.activeService);
        allCaptions.push(...batchResults);
        
        this.log('info', `Processed batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(imagesToProcess.length / batchSize)}`);
      }

      const successfulCaptions = allCaptions.filter(c => !c.error);
      const failedCaptions = allCaptions.filter(c => c.error);

      this.log('info', `Captioning completed: ${successfulCaptions.length} success, ${failedCaptions.length} failed`);
      if (failedCaptions.length > 0) {
        // Log a compact sample of errors to aid diagnostics
        const sample = failedCaptions.slice(0, 5).map((f) => ({ path: f.path, error: f.error }));
        this.log('warn', `Captioning failure samples (showing up to 5 of ${failedCaptions.length}):`, sample);
        // Summarize top error types/frequencies
        const freq = new Map<string, number>();
        for (const f of failedCaptions) {
          const key = (f.error || 'Unknown').slice(0, 120);
          freq.set(key, (freq.get(key) || 0) + 1);
        }
        const top = Array.from(freq.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3);
        if (top.length) {
          this.log('warn', 'Top captioning error types:', top.map(([k, v]) => `${v}x ${k}`));
        }
      }

      return {
        success: true,
        data: {
          captions: allCaptions,
          successCount: successfulCaptions.length,
          failureCount: failedCaptions.length,
          service: this.activeService.name
        },
        metadata: {
          processingTime: Date.now(),
          config: this.getConfig()
        }
      };
    } catch (error) {
      this.log('error', 'Captioning failed', error);
      
      // Try next available service on failure
      this.activeService = undefined;
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown captioning error'
      };
    }
  }

  async getServicesStatus(): Promise<Array<{ name: string; available: boolean }>> {
    const status = [];
    for (const service of this.services) {
      status.push({
        name: service.name,
        available: await service.isAvailable()
      });
    }
    return status;
  }
}
