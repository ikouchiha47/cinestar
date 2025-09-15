import { BaseVideoProcessor, ProcessingContext, ProcessingResult } from '../video-pipeline';
import fetch from 'node-fetch';

export interface OptimizedSceneReconstructionConfig {
  enabled?: boolean;
  model?: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
  
  // Two-pass configuration
  coarseSpacing?: number;    // seconds between coarse passes
  fineSpacing?: number;      // seconds between fine passes
  
  // RNN-style temporal context
  contextWindow?: number;    // how many previous segments to include
  useRnnStyle?: boolean;     // enable RNN-style reconstruction
  
  // Performance tuning
  skipSimilar?: boolean;     // skip reconstruction for similar adjacent segments
  similarityThreshold?: number;
}

interface SegmentContext {
  id: string;
  startTime: number;
  endTime: number;
  transcription: string;
  caption: string;
  ocrText: string;
  reconstructedScene?: string;
}

interface OllamaResponse {
  response: string;
  done: boolean;
  model?: string;
  created_at?: string;
  context?: number[];
}

export class OptimizedSceneReconstructionProcessor extends BaseVideoProcessor {
  public name = 'optimized-scene-reconstruction';
  public version = '2.0.0';
  
  private baseUrl: string;
  private model: string;
  private segmentCache: Map<string, SegmentContext> = new Map();
  private previousScenes: string[] = [];
  
  constructor(config: OptimizedSceneReconstructionConfig = {}) {
    super();
    
    this.baseUrl = config.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    this.model = config.model || 'tinyllama';
    
    this.setConfig({
      enabled: true,
      temperature: 0.7,
      maxTokens: 25,
      coarseSpacing: 30,      // every 30s for coarse pass
      fineSpacing: 5,         // every 5s for fine pass
      contextWindow: 3,       // include 3 previous segments
      useRnnStyle: true,
      skipSimilar: true,
      similarityThreshold: 0.8,
      ...config
    });
  }

  async process(context: ProcessingContext): Promise<ProcessingResult> {
    try {
      const config = this.getConfig();
      
      if (!config.enabled) {
        return {
          success: true,
          data: { reconstructedScenes: {} },
          metadata: { skipped: true }
        };
      }

      // This processor now runs at video level with all processed segments
      const processedSegments = context.data.processedSegments || [];
      const batchCaptions = context.data.batchCaptions || {};
      
      if (!processedSegments.length) {
        this.log('warn', 'No processed segments available for scene reconstruction');
        return { success: true, data: { reconstructedScenes: {} } };
      }

      this.log('info', `Scene reconstruction for ${processedSegments.length} segments`);
      const reconstructedScenes: Record<string, string> = {};

      // Process each segment for scene reconstruction
      for (const segmentContext of processedSegments) {
        const segment = segmentContext.segment;
        const segmentData = segmentContext.data;
        
        const transcription = segmentData.transcription?.text || segmentData.transcription || '';
        const segmentCaptions = batchCaptions[segment.id] || [];
        const caption = segmentCaptions.length > 0 ? segmentCaptions[0].caption : '';
        const ocrText = segmentData.ocrText || '';

        // Cache current segment
        const currentContext: SegmentContext = {
          id: segment.id,
          startTime: segment.startTime,
          endTime: segment.endTime,
          transcription,
          caption,
          ocrText
        };

        // Check if we should skip this segment based on spacing
        if (!this.shouldProcessSegment(currentContext, config)) {
          this.log('debug', `Skipping segment ${segment.id} due to spacing`);
          continue;
        }

        // Check similarity with previous segment
        if (config.skipSimilar && this.isSimilarToPrevious(currentContext)) {
          const previousScene = this.previousScenes[this.previousScenes.length - 1] || null;
          reconstructedScenes[segment.id] = previousScene || '';
          this.log('debug', `Skipping segment ${segment.id} due to similarity`);
          continue;
        }

        // Build temporal context and reconstruct scene
        try {
          const temporalContext = this.buildTemporalContext(currentContext, config);
          const reconstructedScene = await this.generateOptimizedSceneDescription(currentContext, temporalContext, config);
          
          if (reconstructedScene) {
            reconstructedScenes[segment.id] = reconstructedScene;
            this.segmentCache.set(segment.id, { ...currentContext, reconstructedScene });
            this.previousScenes.push(reconstructedScene);
            
            // Keep only recent scenes in memory
            if (this.previousScenes.length > (config.contextWindow || 3)) {
              this.previousScenes.shift();
            }
          }
        } catch (error) {
          this.log('error', `Scene reconstruction failed for segment ${segment.id}`, error);
        }
      }

      const processedCount = Object.keys(reconstructedScenes).length;
      this.log('info', `Scene reconstruction completed: ${processedCount}/${processedSegments.length} segments`);

      return {
        success: true,
        data: { 
          reconstructedScenes,
          processedCount,
          totalSegments: processedSegments.length
        }
      };

    } catch (error) {
      this.log('error', 'Optimized scene reconstruction failed', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown scene reconstruction error'
      };
    }
  }

  private shouldProcessSegment(segment: SegmentContext, config: OptimizedSceneReconstructionConfig): boolean {
    const { coarseSpacing, fineSpacing } = config;
    
    // Two-pass logic
    const isCoarsePass = segment.startTime % coarseSpacing! < 1;
    const isFinePass = segment.startTime % fineSpacing! < 1;
    
    // Process coarse passes for major scene changes
    // Process fine passes for detailed reconstruction
    return isCoarsePass || isFinePass;
  }

  private isSimilarToPrevious(current: SegmentContext): boolean {
    if (this.previousScenes.length === 0) return false;
    
    const prevContext = this.segmentCache.values().next().value;
    if (!prevContext) return false;

    // Simple similarity check based on text content
    const prevText = [prevContext.transcription, prevContext.caption, prevContext.ocrText].join(' ');
    const currentText = [current.transcription, current.caption, current.ocrText].join(' ');
    
    if (!prevText || !currentText) return false;
    
    // Jaccard similarity
    const prevWords = new Set(prevText.toLowerCase().split(/\s+/));
    const currentWords = new Set(currentText.toLowerCase().split(/\s+/));
    
    const intersection = new Set([...prevWords].filter(word => currentWords.has(word)));
    const union = new Set([...prevWords, ...currentWords]);
    
    const similarity = intersection.size / union.size;
    return similarity > this.getConfig().similarityThreshold!;
  }

  private buildTemporalContext(current: SegmentContext, config: OptimizedSceneReconstructionConfig): string[] {
    if (!config.useRnnStyle) return [];
    
    // const context: string[] = []; // TODO: Implement context usage
    const windowSize = config.contextWindow!;
    
    // Get previous segments in temporal order
    const sortedSegments = Array.from(this.segmentCache.values())
      .filter(s => s.endTime < current.startTime)
      .sort((a, b) => a.startTime - b.startTime);
    
    // Take the last N segments
    const relevantSegments = sortedSegments.slice(-windowSize);
    
    return relevantSegments.map(s => s.reconstructedScene || 
      [s.transcription, s.caption, s.ocrText].filter(Boolean).join(' '));
  }

  private async generateOptimizedSceneDescription(
    segment: SegmentContext, 
    temporalContext: string[],
    config: OptimizedSceneReconstructionConfig
  ): Promise<string> {
    
    const contextText = temporalContext.length > 0 
      ? `Previous: ${temporalContext.join(' → ')}`
      : 'Start';

    const prompt = `Scene (${segment.startTime}s-${segment.endTime}s): ${contextText} | ${segment.transcription} | ${segment.caption} | ${segment.ocrText}`;

    try {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt: prompt,
          stream: false,
          options: {
            temperature: config.temperature,
            max_tokens: config.maxTokens
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status}`);
      }

      const data = await response.json() as OllamaResponse;
      const reconstructedScene = data.response?.trim() || [segment.transcription, segment.caption, segment.ocrText].filter(Boolean).join(' ');
      
      // Log full scene reconstruction response
      this.log('info', `🎬 Scene Reconstruction [${segment.id}] (${segment.startTime}s-${segment.endTime}s)`);
      this.log('info', `📝 Input: ${prompt.substring(0, 200)}${prompt.length > 200 ? '...' : ''}`);
      this.log('info', `🤖 TinyLlama Response: "${reconstructedScene}"`);
      this.log('info', `📊 Model: ${this.model} | Tokens: ${config.maxTokens} | Temp: ${config.temperature}`);
      
      return reconstructedScene;
    } catch (error) {
      this.log('error', 'Failed to generate optimized scene description', error);
      return [segment.transcription, segment.caption, segment.ocrText].filter(Boolean).join(' ');
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

  // Method to estimate processing reduction
  estimateReduction(totalSegments: number, totalDuration: number): {reduction: number, coarseCount: number, fineCount: number} {
    const config = this.getConfig();
    const coarseCount = Math.ceil(totalDuration / config.coarseSpacing!);
    const fineCount = Math.ceil(totalDuration / config.fineSpacing!) - coarseCount;
    const actualCount = coarseCount + fineCount;
    
    return {
      reduction: ((totalSegments - actualCount) / totalSegments) * 100,
      coarseCount,
      fineCount
    };
  }
}
