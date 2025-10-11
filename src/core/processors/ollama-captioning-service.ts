import { CaptioningService } from './captioning-processor';
import { ConfigManager } from '../config.js';
import { ImageProcessingUtils } from '../image-processing-utils.js';

export class OllamaCaptioningService implements CaptioningService {
  public name = 'ollama-captioning';
  private baseUrl: string;
  private model: string;

  constructor(baseUrl?: string, model?: string) {
    const config = ConfigManager.getConfig();
    // Use specialized captionUrl for vision model processing
    this.baseUrl = (baseUrl || config.ai.captionUrl).replace(/\/$/, '');
    this.model = model || config.ai.visionModel || 'moondream:v2';
    console.log(`[OLLAMA-CAPTIONING] Using specialized caption URL: ${this.baseUrl}`);
  }

  async caption(imagePath: string, options: any = {}) {
    // Use ImageProcessingUtils for consistent image processing with dynamic quality optimization
    const config = ConfigManager.getConfig();
    let imageBuffer: Buffer;
    
    try {
      imageBuffer = await ImageProcessingUtils.prepareForVisionModel(
        imagePath,
        config.ai.visionModelDims,
        {
          forceQuality: options.quality, // Allow quality override for testing
          format: 'jpeg'
        }
      );
    } catch (imageError) {
      throw new Error(`Image processing failed: ${imageError instanceof Error ? imageError.message : 'Unknown error'}`);
    }
    
    const url = `${this.baseUrl}/api/generate`;
    const capCfg = ConfigManager.getConfig().captioning;
    const timeoutMs = Math.max(0, Number(capCfg?.timeoutMs ?? 0));

    // Build payload with plain base64 (no data URI), JPEG only
    const base64 = imageBuffer.toString('base64');
    const defaultPrompt = `Describe this image in details in a structured format:

**Scene:** [Overall setting, time of day, lighting, atmosphere]
**Objects:** [List main objects, people, animals visible]
**Actions:** [What's happening, activities, movements]
**Tags:** [Keywords for search: colors, mood, style, location type]`;

    const payload = {
      model: this.model,
      prompt: options.prompt || defaultPrompt,
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
