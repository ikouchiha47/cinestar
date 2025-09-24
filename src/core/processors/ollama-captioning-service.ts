import { CaptioningService } from './captioning-processor';
import { ConfigManager } from '../config.js';
import { OllamaUrlResolver } from '../utils/ollama-url-resolver.js';
import fs from 'fs/promises';

export class OllamaCaptioningService implements CaptioningService {
  public name = 'ollama-vision';
  private baseUrl: string;
  private model: string;

  constructor(baseUrl = OllamaUrlResolver.getOllamaUrl()) {
    this.baseUrl = baseUrl;
    const config = ConfigManager.getConfig();
    this.model = config.ai.visionModel;
  }

  async caption(imagePath: string, options: any = {}) {
    let imageBuffer = await fs.readFile(imagePath);
    
    // Validate and resize image to prevent MTMD encoding errors
    try {
      const sharp = (await import('sharp')).default;
      // Always sanitize and standardize: convert to sRGB JPEG to strip
      // problematic PNG ancillary chunks (e.g. cICP) and alpha channel.
      // This prevents Ollama "unable to encode mtmd image chunk" errors.
      let img = sharp(imageBuffer).rotate().toColorspace('srgb');

      const metadata = await img.metadata();

      // Skip corrupted or invalid images
      if (!metadata.width || !metadata.height) {
        throw new Error('Invalid image metadata');
      }

      // Use configurable vision model dimensions
      const config = ConfigManager.getConfig();
      const [maxWidth, maxHeight] = config.ai.visionModelDims;

      // Resize if larger than vision model constraints
      if (metadata.width > maxWidth || metadata.height > maxHeight) {
        img = img.resize(maxWidth, maxHeight, { fit: 'inside', withoutEnlargement: true });
      }

      // JPEG has no alpha: flatten against black to avoid artifacts
      img = img.flatten({ background: { r: 0, g: 0, b: 0 } })
             .jpeg({ quality: 85, progressive: false, mozjpeg: true });

      imageBuffer = await img.toBuffer();
      
    } catch (imageError) {
      throw new Error(`Image processing failed: ${imageError instanceof Error ? imageError.message : 'Unknown error'}`);
    }
    
    const url = `${this.baseUrl}/api/generate`;
    const capCfg = ConfigManager.getConfig().captioning;
    const timeoutMs = Math.max(0, Number(capCfg?.timeoutMs ?? 0));

    // Build payload with plain base64 (no data URI), JPEG only
    const base64 = imageBuffer.toString('base64');
    const payload = {
      model: this.model,
      prompt: options.prompt || 'Describe this image in detail.',
      images: [base64],
      stream: false
    } as any;

    const controller = timeoutMs > 0 ? new AbortController() : undefined;
    const timer = timeoutMs > 0 ? setTimeout(() => controller!.abort(), timeoutMs) : undefined;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller?.signal
      });
      if (timer) clearTimeout(timer);

      if (!response.ok) {
        let body = '';
        try { body = await response.text(); } catch {}
        throw new Error(`Ollama captioning error: ${response.status} - ${response.statusText}${body ? ` - ${body.substring(0,200)}` : ''}`);
      }

      const result = await response.json();
      return {
        caption: result.response || '',
        confidence: 1.0,
        metadata: { model: this.model, tokens: result.eval_count }
      };
    } catch (err) {
      if (timer) clearTimeout(timer);
      throw err;
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, { method: 'GET' });
      if (!response.ok) return false;
      
      const data = await response.json();
      return data.models?.some((m: any) => m.name.includes(this.model)) || false;
    } catch {
      return false;
    }
  }
}
