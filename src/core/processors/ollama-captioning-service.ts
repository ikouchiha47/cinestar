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
    const imageBuffer = await fs.readFile(imagePath);
    const base64Image = imageBuffer.toString('base64');

    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt: options.prompt || 'Describe this image in detail.',
        images: [base64Image],
        stream: false
      })
    });

    if (!response.ok) {
      let body = '';
      try { body = await response.text(); } catch {}
      throw new Error(`Ollama captioning error: ${response.status} - ${response.statusText}${body ? ` - ${body.substring(0,200)}` : ''}`);
    }

    const result = await response.json();
    return {
      caption: result.response || '',
      confidence: 1.0, // Ollama doesn't provide confidence scores
      metadata: { model: this.model, tokens: result.eval_count }
    };
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
