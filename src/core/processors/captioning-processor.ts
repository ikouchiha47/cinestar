import { BaseVideoProcessor, ProcessingContext, ProcessingResult } from '../video-pipeline';
import fs from 'fs/promises';

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

    // Register default services
    this.services = config.services || [
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

  private async findAvailableService(): Promise<CaptioningService | null> {
    for (const service of this.services) {
      if (await service.isAvailable()) {
        return service;
      }
    }
    return null;
  }

  private async processImageBatch(
    imagePaths: string[], 
    service: CaptioningService
  ): Promise<Array<{ path: string; caption: string; error?: string }>> {
    const results = [];
    
    for (const imagePath of imagePaths) {
      try {
        const result = await service.caption(imagePath);
        results.push({
          path: imagePath,
          caption: result.caption
        });
      } catch (error) {
        results.push({
          path: imagePath,
          caption: '',
          error: error instanceof Error ? error.message : 'Unknown error'
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
