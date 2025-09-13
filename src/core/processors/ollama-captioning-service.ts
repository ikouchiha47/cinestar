import { CaptioningService } from './captioning-processor';
import { ConfigManager } from '../config';
import fs from 'fs/promises';

export class OllamaCaptioningService implements CaptioningService {
  public name = 'ollama-vision';
  private baseUrl: string;
  private model: string;

  constructor(baseUrl = 'http://localhost:11434') {
    this.baseUrl = baseUrl;
    const config = ConfigManager.getConfig();
    this.model = config.ai.visionModel;
  }

  async caption(imagePath: string, options: any = {}) {
    let imageBuffer = await fs.readFile(imagePath);
    
    // Validate and resize image to prevent MTMD encoding errors
    try {
      const sharp = (await import('sharp')).default;
      const metadata = await sharp(imageBuffer).metadata();
      
      // Skip corrupted or invalid images
      if (!metadata.width || !metadata.height) {
        throw new Error('Invalid image metadata');
      }
      
      // Resize large images to prevent Ollama buffer issues
      if (metadata.width > 1024 || metadata.height > 1024) {
        imageBuffer = await sharp(imageBuffer)
          .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer();
      }
    } catch (imageError) {
      throw new Error(`Image processing failed: ${imageError instanceof Error ? imageError.message : 'Unknown error'}`);
    }
    
    const base64Image = imageBuffer.toString('base64');

    const url = `${this.baseUrl}/api/generate`;
    const capCfg = ConfigManager.getConfig().captioning;
    const timeoutMs = Math.max(0, Number(capCfg?.timeoutMs ?? 0));
    const retries = Math.max(0, Number(capCfg?.retries ?? 0));
    const retryDelayMs = Math.max(0, Number(capCfg?.retryDelayMs ?? 1000));

    const payload = {
      model: this.model,
      prompt: options.prompt || 'Describe this image in detail.',
      images: [base64Image],
      stream: false
    };

    let lastErr: any = null;
    const attempts = Math.max(1, retries + 1);
    for (let attempt = 0; attempt < attempts; attempt++) {
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
        lastErr = err;
        if (attempt < attempts - 1) {
          await new Promise(res => setTimeout(res, retryDelayMs * (attempt + 1)));
          continue;
        }
        break;
      }
    }
    throw lastErr || new Error('Ollama captioning failed');
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
