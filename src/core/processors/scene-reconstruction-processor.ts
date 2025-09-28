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
    this.model = config.model || 'tinyllama:latest';
    
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

      // This is a VIDEO-LEVEL processor - process all segments from processedSegments
      const processedSegments = context.data.processedSegments || [];
      const batchCaptions = context.data.batchCaptions || {};
      
      this.log('info', `Processing scene reconstruction for ${processedSegments.length} segments`);
      this.log('debug', `Available batch caption keys: ${Object.keys(batchCaptions).join(', ')}`);
      
      if (processedSegments.length === 0) {
        this.log('warn', 'No processed segments available for scene reconstruction');
        return {
          success: true,
          data: { reconstructedScene: 'No segments available for reconstruction' }
        };
      }

      // Combine all segment content to create a comprehensive scene description
      const allContent = [];
      
      for (const segmentContext of processedSegments) {
        const segment = segmentContext.segment;
        const segmentData = segmentContext.data;
        
        // Get transcription
        const transcription = segmentData.transcription?.text || segmentData.transcription || '';
        
        // Get captions for this segment
        const segmentCaptions = batchCaptions[segment.id] || [];
        let visualDescription = 'no visual description available';
        
        if (segmentCaptions.length > 0) {
          const firstCaption = segmentCaptions[0];
          if (typeof firstCaption === 'string') {
            visualDescription = firstCaption;
          } else if (firstCaption?.caption) {
            visualDescription = firstCaption.caption;
          } else if (firstCaption?.text) {
            visualDescription = firstCaption.text;
          }
        }
        
        // Get OCR text
        const ocrText = segmentData.ocrText || '';
        
        allContent.push({
          timestamp: `${segment.startTime}s - ${segment.endTime}s`,
          audio: transcription || 'no audio',
          visual: visualDescription,
          ocr: ocrText
        });
        
        this.log('debug', `Segment ${segment.id}: Audio=${transcription.length}chars, Visual=${visualDescription.length}chars, OCR=${ocrText.length}chars`);
      }

      // Generate comprehensive scene description using all content
      const reconstructedScene = await this.generateSceneDescription({
        timestamp: `0s - ${context.segment.endTime || 'end'}s`,
        audio: allContent.map(c => c.audio).filter(a => a !== 'no audio').join(' '),
        visual: allContent.map(c => c.visual).filter(v => v !== 'no visual description available').join(' '),
        previous: 'beginning of video',
        ocr: allContent.map(c => c.ocr).filter(o => o).join(' ')
      });

      this.log('info', `Scene reconstructed: ${reconstructedScene.substring(0, 100)}...`);

      return {
        success: true,
        data: { 
          reconstructedScene,
          originalTranscription: allContent.map(c => c.audio).join(' '),
          originalCaptions: Object.values(batchCaptions).flat(),
          originalOcr: allContent.map(c => c.ocr).join(' ')
        },
        metadata: {
          model: this.model,
          processingTime: Date.now(),
          segmentsProcessed: processedSegments.length
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
