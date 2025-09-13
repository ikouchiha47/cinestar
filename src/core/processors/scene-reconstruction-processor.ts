import { BaseVideoProcessor, ProcessingContext, ProcessingResult } from '../video-pipeline';
import fetch from 'node-fetch';

export interface SceneReconstructionConfig {
  enabled?: boolean;
  model?: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
  includeTemporalContext?: boolean;
}

export class SceneReconstructionProcessor extends BaseVideoProcessor {
  public name = 'scene-reconstruction';
  public version = '1.0.0';
  
  private baseUrl: string;
  private model: string;

  constructor(config: SceneReconstructionConfig = {}) {
    super();
    
    this.baseUrl = config.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    this.model = config.model || 'tinyllama';
    
    this.setConfig({
      enabled: true,
      temperature: 0.7,
      maxTokens: 80,
      includeTemporalContext: true,
      ...config
    });
  }

  async process(context: ProcessingContext): Promise<ProcessingResult> {
    try {
      const config = this.getConfig();
      
      if (!config.enabled) {
        this.log('info', 'Scene reconstruction disabled, skipping');
        return {
          success: true,
          data: { reconstructedScene: null },
          metadata: { skipped: true }
        };
      }

      const { segment } = context;
      const transcription = context.data.transcription?.text || '';
      const captions = context.data.captions || [];
      const ocrText = context.data.ocrText || '';

      // Get the main visual description (first caption or combined)
      const visualDescription = captions.length > 0 
        ? captions[0] 
        : 'no visual description available';

      // Get previous scene context if available
      const previousScene = config.includeTemporalContext 
        ? context.data.previousScene || 'beginning of video'
        : 'none';

      this.log('info', `Reconstructing scene for segment: ${segment.id}`);
      this.log('debug', `Audio: ${transcription.substring(0, 100)}...`);
      this.log('debug', `Visual: ${visualDescription.substring(0, 100)}...`);

      const reconstructedScene = await this.generateSceneDescription({
        timestamp: `${segment.startTime}s - ${segment.endTime}s`,
        audio: transcription || 'no audio',
        visual: visualDescription,
        previous: previousScene,
        ocr: ocrText
      });

      this.log('info', `Scene reconstructed: ${reconstructedScene.substring(0, 100)}...`);

      return {
        success: true,
        data: { 
          reconstructedScene,
          originalTranscription: transcription,
          originalCaptions: captions,
          originalOcr: ocrText
        },
        metadata: {
          model: this.model,
          processingTime: Date.now()
        }
      };

    } catch (error) {
      this.log('error', 'Scene reconstruction failed', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown scene reconstruction error'
      };
    }
  }

  private async generateSceneDescription(input: {
    timestamp: string;
    audio: string;
    visual: string;
    previous: string;
    ocr?: string;
  }): Promise<string> {
    
    const prompt = `Create a brief scene description (max 30 words).

Context:
- Time: ${input.timestamp}
- Audio: ${input.audio}
- Visual: ${input.visual}
${input.ocr ? `- Text: ${input.ocr}` : ''}

Write ONE short sentence describing this scene:`;

    try {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt: prompt,
          stream: false,
          options: {
            temperature: this.getConfig().temperature,
            top_p: 0.9,
            max_tokens: this.getConfig().maxTokens
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as any;
      const result = data.response?.trim();
      
      if (!result) {
        throw new Error('Empty response from Ollama');
      }

      return result;
    } catch (error) {
      this.log('error', 'Failed to generate scene description', error);
      // Fallback to simple concatenation
      return [input.audio, input.visual, input.ocr].filter(Boolean).join(' ');
    }
  }

  async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }
}
