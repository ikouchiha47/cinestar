import { BaseVideoProcessor, ProcessingContext, ProcessingResult } from '../video-pipeline';
import fs from 'fs/promises';

// Pluggable OCR interface - can be easily extended
export interface OCRService {
  name: string;
  extractText(imagePath: string, options?: any): Promise<{
    text: string;
    confidence?: number;
    boundingBoxes?: Array<{
      text: string;
      x: number;
      y: number;
      width: number;
      height: number;
      confidence?: number;
    }>;
  }>;
  isAvailable(): Promise<boolean>;
}

// Tesseract.js implementation (pure JS, slower but no dependencies)
export class TesseractService implements OCRService {
  public name = 'tesseract-js';

  async extractText(_imagePath: string, _options: any = {}): Promise<{
    text: string;
    confidence?: number;
    boundingBoxes?: Array<{
      text: string;
      x: number;
      y: number;
      width: number;
      height: number;
      confidence?: number;
    }>;
  }> {
    // Note: Tesseract.js would be imported here when needed
    // For now, this is a placeholder that can be easily implemented
    throw new Error('Tesseract.js not implemented yet - pluggable architecture ready');
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Check if tesseract.js is available
      // const Tesseract = await import('tesseract.js');
      return false; // Placeholder
    } catch {
      return false;
    }
  }
}

// PaddleOCR HTTP service implementation (faster, external service)
export class PaddleOCRService implements OCRService {
  public name = 'paddle-ocr';
  private endpoint: string;

  constructor(endpoint: string = 'http://localhost:8004/ocr') {
    this.endpoint = endpoint;
  }

  async extractText(imagePath: string, options: any = {}) {
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
      throw new Error(`OCR service error: ${response.statusText}`);
    }

    const result = await response.json();
    return {
      text: result.text || '',
      confidence: result.confidence,
      boundingBoxes: result.boxes || []
    };
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.endpoint.replace('/ocr', '/health')}`, { 
        method: 'GET' 
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

// Generic HTTP OCR service
export class HttpOCRService implements OCRService {
  public name: string;
  private endpoint: string;

  constructor(name: string, endpoint: string) {
    this.name = name;
    this.endpoint = endpoint;
  }

  async extractText(imagePath: string, options: any = {}) {
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
      throw new Error(`OCR service error: ${response.statusText}`);
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

export class OCRProcessor extends BaseVideoProcessor {
  public name = 'ocr';
  public version = '1.0.0';
  private services: OCRService[] = [];
  private activeService?: OCRService;

  constructor(config: {
    processKeyframes?: boolean;
    processThumbnails?: boolean;
    batchSize?: number;
    minTextLength?: number;
    services?: OCRService[];
  } = {}) {
    super();
    this.setConfig({
      processKeyframes: true,
      processThumbnails: false, // Usually keyframes are better for OCR
      batchSize: 3,
      minTextLength: 3, // Ignore very short text extractions
      ...config
    });

    // Register default services (OCR is optional, so start with empty array)
    this.services = config.services || [
      new PaddleOCRService(),
      new TesseractService()
    ];
  }

  addService(service: OCRService): void {
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

  private async findAvailableService(): Promise<OCRService | undefined> {
    for (const service of this.services) {
      if (await service.isAvailable()) {
        return service;
      }
    }
    return undefined;
  }

  private async processImageBatch(
    imagePaths: string[], 
    service: OCRService
  ): Promise<Array<{ path: string; text: string; confidence?: number; error?: string }>> {
    const results = [];
    
    for (const imagePath of imagePaths) {
      try {
        const result = await service.extractText(imagePath);
        results.push({
          path: imagePath,
          text: result.text,
          confidence: result.confidence
        });
      } catch (error) {
        results.push({
          path: imagePath,
          text: '',
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

      this.log('info', `Processing OCR for segment: ${segment.id}`);

      // OCR is optional - if no services available, skip gracefully
      if (!this.activeService) {
        this.activeService = await this.findAvailableService();
        if (!this.activeService) {
          this.log('info', 'No OCR services available, skipping OCR processing');
          return {
            success: true,
            data: { ocr: null, reason: 'no_service_available' }
          };
        }
        this.log('info', `Using OCR service: ${this.activeService.name}`);
      }

      const imagesToProcess: string[] = [];
      
      // Collect images for OCR
      if (config.processKeyframes && context.data.keyframes) {
        imagesToProcess.push(...context.data.keyframes);
      }
      
      if (config.processThumbnails && context.data.thumbnails) {
        imagesToProcess.push(...context.data.thumbnails);
      }

      if (imagesToProcess.length === 0) {
        this.log('info', 'No images available for OCR processing');
        return {
          success: true,
          data: { ocr: [], reason: 'no_images_available' }
        };
      }

      this.log('info', `Processing OCR on ${imagesToProcess.length} images`);

      // Process images in batches
      const allOCRResults = [];
      const batchSize = config.batchSize;
      
      for (let i = 0; i < imagesToProcess.length; i += batchSize) {
        const batch = imagesToProcess.slice(i, i + batchSize);
        const batchResults = await this.processImageBatch(batch, this.activeService);
        allOCRResults.push(...batchResults);
        
        this.log('info', `Processed OCR batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(imagesToProcess.length / batchSize)}`);
      }

      // Filter out very short text extractions and errors
      const validOCRResults = allOCRResults.filter(result => 
        !result.error && result.text.length >= config.minTextLength
      );

      const failedOCRResults = allOCRResults.filter(result => result.error);

      // Combine all extracted text
      const combinedText = validOCRResults.map(r => r.text).join(' ').trim();

      this.log('info', `OCR completed: ${validOCRResults.length} success, ${failedOCRResults.length} failed, ${combinedText.length} characters extracted`);

      return {
        success: true,
        data: {
          ocr: {
            combinedText,
            results: allOCRResults,
            validCount: validOCRResults.length,
            failureCount: failedOCRResults.length
          },
          service: this.activeService.name
        },
        metadata: {
          processingTime: Date.now(),
          config: this.getConfig()
        }
      };
    } catch (error) {
      this.log('error', 'OCR processing failed', error);
      
      // Try next available service on failure
      this.activeService = undefined;
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown OCR error'
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
