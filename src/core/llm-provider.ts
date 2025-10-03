import { RetryQueue } from './retry-queue';
import { ConfigManager } from './config';

/**
 * Interface for LLM providers (Ollama, LiteLLM, etc.)
 * This allows for easy swapping between different LLM backends
 */
export interface LLMProvider {
  /**
   * Check if the LLM provider is available
   */
  isAvailable(): Promise<boolean>;

  /**
   * Generate embeddings for text content
   */
  generateEmbedding(text: string): Promise<Float32Array>;

  /**
   * Generate description for image content
   */
  generateImageDescription(imagePath: string, originalImagePath?: string): Promise<string>;

  /**
   * Generate embeddings for image content
   */
  generateImageEmbedding(imagePath: string): Promise<Float32Array>;

  /**
   * Get the name of the provider
   */
  getName(): string;

  /**
   * Get the model being used
   */
  getModel(): string;

  /**
   * Transform natural language question into optimized search query
   */
  transformQuestionToQuery(question: string): Promise<string>;

  /**
   * Extract key entities and concepts from natural language query
   */
  extractSearchEntities(question: string): Promise<string[]>;

  /**
   * Classify query type for multi-modal search (spatial, temporal, audio, action)
   */
  classifyQueryType(question: string): Promise<QueryClassification>;

  /**
   * Transform query based on classification for multi-modal search
   */
  transformMultiModalQuery(question: string, classification: QueryClassification): Promise<MultiModalQuery>}

const CaptionQuery = "Describe the: Objects, Actions, Intent of Action, Scene and Interractions between objects in the image."

/**
 * Ollama LLM provider implementation
 */
export interface QueryClassification {
  type: 'spatial' | 'temporal' | 'audio' | 'action' | 'mixed';
  confidence: number;
  subtypes: string[];
  temporalMarkers?: {
    type: 'beginning' | 'middle' | 'end' | 'specific' | 'range';
    value?: string;
  };
  spatialElements?: string[];
  audioElements?: string[];
  actionElements?: string[];
}

export interface MultiModalQuery {
  original: string;
  transformed: string;
  classification: QueryClassification;
  searchKeywords: {
    text: string[];
    visual: string[];
    audio: string[];
    temporal: string[];
    action: string[];
  };
  embeddings: {
    text: string;
    visual?: string;
    audio?: string;
  };
  filters: {
    timeRange?: [number, number];
    confidenceThreshold?: number;
    mediaTypes?: ('video' | 'image' | 'audio')[];
  };
}

export class OllamaProvider implements LLMProvider {
  private visionModel: string;
  private embeddingModel: string;
  private retryQueue: RetryQueue;

  constructor(visionModel?: string, embeddingModel?: string) {
    const config = ConfigManager.getConfig();
    this.visionModel = visionModel || config.ai.visionModel;
    this.embeddingModel = embeddingModel || config.ai.embeddingModel;
    this.retryQueue = RetryQueue.getInstance();
  }

  async isAvailable(): Promise<boolean> {
    try {
      const config = ConfigManager.getConfig();
      const response = await fetch(`${config.ai.searchUrl}/api/tags`);
      if (!response.ok) return false;
      
      const data = await response.json();
      // Check for configured vision model instead of hardcoded 'llava'
      const visionModel = config.ai.visionModel;
      return data.models && data.models.some((model: any) => model.name.includes(visionModel.split(':')[0]));
    } catch (error) {
      console.error('Ollama availability check failed:', error);
      return false;
    }
  }

  async generateEmbedding(text: string): Promise<Float32Array> {
    const operation = async (): Promise<Float32Array> => {
      console.log(`Generating text embedding for "${text.substring(0, 30)}..." using ${this.embeddingModel}`);

      const config = ConfigManager.getConfig();
      const response = await fetch(`${config.ai.searchUrl}/api/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.embeddingModel,
          prompt: text
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ollama API error: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      return new Float32Array(data.embedding);
    };

    try {
      return await this.retryQueue.addTask(operation, `text-embedding-${text.substring(0, 20)}`, 5);
    } catch (error) {
      console.error('Error generating text embedding after retries:', error);
      // Fallback to random embeddings using configured dimension
      const dim = ConfigManager.getConfig().ai.embeddingDimensions || 768;
      const randomArray = new Array(dim).fill(0).map(() => Math.random() - 0.5);
      return new Float32Array(randomArray);
    }
  }

  async generateImageDescription(imagePath: string, _originalImagePath?: string): Promise<string> {
    const operation = async (): Promise<string> => {
      console.log(`Generating description for image ${imagePath} using ${this.visionModel}`);

      // Read and encode the image
      const fs = await import('fs');
      const imageBuffer = await fs.promises.readFile(imagePath);
      const base64Image = imageBuffer.toString('base64');

      const config = ConfigManager.getConfig();
      const response = await fetch(`${config.ai.indexingUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.visionModel,
          prompt: CaptionQuery,
          images: [base64Image],
          stream: false
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${await response.text()}`);
      }

      const data = await response.json();
      console.log(' Ollama response for compressed image:', response.status, data);

      if (!data.response || data.response.trim() === '') {
        console.log('Empty response from vision model');
        console.log('Base64 image length:', base64Image.length, 'First 100 chars:', base64Image);
        throw new Error('Empty response from vision model');
      }

      return data.response.trim();
    };

    try {
      const fileName = imagePath.split('/').pop() || 'unknown';
      return await this.retryQueue.addTask(operation, `image-description-${fileName}`, 5);
    } catch (error) {
      console.error('Error generating image description after retries:', error);
      return 'Error generating description';
    }
  }

  async generateImageEmbedding(imagePath: string): Promise<Float32Array> {
    try {
      // First get the image description
      const description = await this.generateImageDescription(imagePath);
      console.log(`Generated description: ${description.substring(0, 100)}...`);

      // Then generate embedding from the description
      return await this.generateEmbedding(description);
    } catch (error) {
      console.error('Error generating image embedding:', error);
      // Fallback to random embeddings in case of error, dimension per config
      const dim = ConfigManager.getConfig().ai.embeddingDimensions || 768;
      const randomArray = new Array(dim).fill(0).map(() => Math.random() - 0.5);
      return new Float32Array(randomArray);
    }
  }

  getName(): string {
    return 'Ollama';
  }

  getModel(): string {
    return `Vision: ${this.visionModel}, Embedding: ${this.embeddingModel}`;
  }

  async transformQuestionToQuery(question: string): Promise<string> {
    const operation = async (): Promise<string> => {
      console.log(`[QA-TRANSFORM] Transforming question: "${question}"`);
      
      const config = ConfigManager.getConfig();
      
      // Use general purpose model for question transformation
      const model = config.ai.generalPurposeModel;
      
      const prompt = `Transform this question into search keywords for video/image content. Consider visual, audio, temporal, and action elements.

Question: "${question}"

Search keywords:`;

      let url = config.ai.embedUrl;
      url = `${url}/api/generate`
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          prompt,
          stream: false,
          options: {
            temperature: 0.2,
            num_predict: 30,
            max_tokens: 50
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Query transformation failed: ${response.status}`);
      }

      const data = await response.json();
      let transformed = data.response?.trim() || question;
      
      // Strip out common preamble patterns and clean up
      transformed = transformed
        .replace(/^Here are (?:some )?(?:key )?(?:search )?(?:terms?|keywords?).*?:\s*/i, '')
        .replace(/^(?:Keywords?|Terms?|Query).*?:\s*/i, '')
        .replace(/^\d+\.\s*/gm, '') // Remove numbered list markers
        .replace(/\n/g, ' ') // Join multi-line into single line
        .replace(/^[""`']+|[""`']+$/g, '') // Remove surrounding quotes only
        .trim();
      
      // If result is empty or too long, fall back to original
      if (!transformed || transformed.length > 150) {
        transformed = question;
      }
      
      console.log(`[QA-TRANSFORM] Transformed: "${question}" → "${transformed}"`);
      return transformed;
    };

    try {
      return await this.retryQueue.addTask(operation, `question-transform-${question.substring(0, 20)}`, 3);
    } catch (error) {
      console.warn('[QA-TRANSFORM] Falling back to original question:', error);
      return question; // Fallback to original question
    }
  }

  async classifyQueryType(question: string): Promise<QueryClassification> {
    const operation = async (): Promise<QueryClassification> => {
      console.log(`[QA-CLASSIFY] Classifying query type: "${question}"`);
      
      const config = ConfigManager.getConfig();
      const model = config.ai.generalPurposeModel;
      
      const prompt = `You are a search query classifier. Analyze this query and determine its PRIMARY type.

Query: "${question}"

Classification Rules (choose ONE primary type):

1. TEMPORAL - Query asks about WHEN/WHERE in the timeline (time positions, durations)
   ✅ Examples: "beginning", "first 5 minutes", "end of video", "after 2:30", "at 1:45"
   ❌ NOT temporal: "cat jumping" (that's an action, not a time reference)
   
2. ACTION - Query asks about WHAT is HAPPENING (activities, movements, interactions, events)
   ✅ Examples: "cat jumping from wall", "people dancing", "someone cooking", "running"
   ❌ NOT action: "cat on wall" (that's spatial - static object)
   
3. SPATIAL - Query asks about WHAT you can SEE (objects, colors, scenes, people, places - STATIC)
   ✅ Examples: "red cars", "mountains", "person wearing hat", "cat on wall"
   ❌ NOT spatial: "cat jumping" (that's an action - movement)
   
4. AUDIO - Query asks about WHAT you can HEAR (sounds, dialogue, music, speech content)
   ✅ Examples: "talking about cooking", "music playing", "dialogue mentioning technology"
   ❌ NOT audio: "people talking" (that's an action - the activity of talking)
   
5. MIXED - Query combines multiple types above
   ✅ Examples: "beginning where someone is cooking" (temporal + action)

For TEMPORAL queries, extract time information:
- "beginning" → {"type": "beginning", "value": "0-60"}
- "first 5 minutes" → {"type": "range", "value": "0-300"}
- "after 5 minutes" → {"type": "range", "value": "300-end"}
- "end" → {"type": "end", "value": "last-60"}

Return ONLY this JSON (no markdown, no explanation):
{
  "type": "spatial|temporal|audio|action|mixed",
  "confidence": 0.9,
  "subtypes": ["visual", "time", "sound", "activity"],
  "temporalMarkers": {"type": "beginning", "value": "0-60"},
  "spatialElements": ["visual objects mentioned"],
  "audioElements": ["sounds/speech mentioned"],
  "actionElements": ["activities mentioned"]
}`;

      let url = config.ai.embedUrl;
      url = `${url}/api/generate`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          prompt,
          stream: false,
          format: 'json',
          options: {
            temperature: 0.1,
            num_predict: 200
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Query classification failed: ${response.status}`);
      }

      const data = await response.json();
      let classification: QueryClassification;
      
      try {
        classification = JSON.parse(data.response);
        
        // Ensure all required fields exist
        classification.subtypes = classification.subtypes || [];
        classification.spatialElements = classification.spatialElements || [];
        classification.audioElements = classification.audioElements || [];
        classification.actionElements = classification.actionElements || [];
        
        // Post-process to fix semantic issues
        classification = this.postProcessClassification(classification, question);
        
        console.log(`[QA-CLASSIFY] Classified: ${classification.type} (${classification.confidence})`);
      } catch (parseError) {
        console.warn('[QA-CLASSIFY] JSON parse failed, using fallback');
        classification = this.fallbackQueryClassification(question);
      }
      
      return classification;
    };

    try {
      return await this.retryQueue.addTask(operation, `query-classify-${question.substring(0, 20)}`, 3);
    } catch (error) {
      console.warn('[QA-CLASSIFY] Using fallback classification:', error);
      return this.fallbackQueryClassification(question);
    }
  }

  private postProcessClassification(classification: QueryClassification, question: string): QueryClassification {
    const lowerQuestion = question.toLowerCase();
    
    // Fix temporal markers - extract actual time values
    if (classification.temporalMarkers) {
      const timeMatch = lowerQuestion.match(/(\d+)\s*(minute|min|second|sec|hour|hr)s?/);
      if (timeMatch) {
        const value = parseInt(timeMatch[1]);
        const unit = timeMatch[2];
        let seconds = value;
        
        if (unit.startsWith('min')) seconds = value * 60;
        if (unit.startsWith('hour') || unit.startsWith('hr')) seconds = value * 3600;
        
        // Determine if it's "first X" or "after X"
        if (lowerQuestion.includes('first') || lowerQuestion.includes('beginning')) {
          classification.temporalMarkers = {
            type: 'range',
            value: `0-${seconds}`
          };
        } else if (lowerQuestion.includes('after')) {
          classification.temporalMarkers = {
            type: 'range',
            value: `${seconds}-end`
          };
        }
      } else if (lowerQuestion.includes('beginning') || lowerQuestion.includes('start')) {
        classification.temporalMarkers = {
          type: 'beginning',
          value: '0-60'
        };
      } else if (lowerQuestion.includes('end')) {
        classification.temporalMarkers = {
          type: 'end',
          value: 'last-60'
        };
      }
    }
    
    // Fix audio elements - should be about sounds/speech, not time words
    if (classification.audioElements) {
      classification.audioElements = classification.audioElements.filter(elem => {
        const lower = elem.toLowerCase();
        // Remove time-related words from audio elements
        return !['beginning', 'start', 'end', 'first', 'last', 'after', 'before'].includes(lower);
      });
    }
    
    // If query has temporal words but classified as mixed, consider making it temporal
    const temporalWords = ['beginning', 'start', 'end', 'first', 'last', 'after', 'before', 'minute', 'second'];
    const hasTemporalWords = temporalWords.some(word => lowerQuestion.includes(word));
    
    if (hasTemporalWords && classification.type === 'mixed') {
      const hasAudioWords = ['talking', 'saying', 'dialogue', 'music', 'sound'].some(w => lowerQuestion.includes(w));
      
      // If only temporal + generic words (no audio/spatial), make it temporal
      if (!hasAudioWords && !classification.spatialElements?.length && !classification.actionElements?.length) {
        classification.type = 'temporal';
      }
    }
    
    return classification;
  }

  private fallbackQueryClassification(question: string): QueryClassification {
    const lowerQuestion = question.toLowerCase();
    
    // Simple keyword-based classification
    const spatialKeywords = ['show', 'see', 'look', 'appear', 'contain', 'with', 'red', 'blue', 'green', 'person', 'people', 'car', 'building', 'mountain', 'scene', 'background', 'foreground'];
    const temporalKeywords = ['beginning', 'start', 'end', 'middle', 'after', 'before', 'minutes', 'seconds', 'time', 'duration', 'clip', 'section'];
    const audioKeywords = ['say', 'talk', 'speak', 'sound', 'music', 'dialogue', 'conversation', 'audio', 'voice', 'hear', 'mention'];
    const actionKeywords = ['doing', 'action', 'activity', 'movement', 'dancing', 'cooking', 'walking', 'running', 'talking', 'explaining', 'interacting'];
    
    let type: QueryClassification['type'] = 'mixed';
    let confidence = 0.7;
    
    const hasSpatial = spatialKeywords.some(kw => lowerQuestion.includes(kw));
    const hasTemporal = temporalKeywords.some(kw => lowerQuestion.includes(kw));
    const hasAudio = audioKeywords.some(kw => lowerQuestion.includes(kw));
    const hasAction = actionKeywords.some(kw => lowerQuestion.includes(kw));
    
    if (hasSpatial && !hasTemporal && !hasAudio && !hasAction) type = 'spatial';
    else if (hasTemporal && !hasSpatial && !hasAudio && !hasAction) type = 'temporal';
    else if (hasAudio && !hasSpatial && !hasTemporal && !hasAction) type = 'audio';
    else if (hasAction && !hasSpatial && !hasTemporal && !hasAudio) type = 'action';
    else type = 'mixed';
    
    return {
      type,
      confidence,
      subtypes: [
        ...(hasSpatial ? ['visual'] : []),
        ...(hasTemporal ? ['time'] : []),
        ...(hasAudio ? ['sound'] : []),
        ...(hasAction ? ['activity'] : [])
      ],
      spatialElements: [],
      audioElements: [],
      actionElements: []
    };
  }

  async transformMultiModalQuery(question: string, classification: QueryClassification): Promise<MultiModalQuery> {
    const operation = async (): Promise<MultiModalQuery> => {
      console.log(`[QA-MULTIMODAL] Transforming query: "${question}" (${classification.type})`);
      
      const config = ConfigManager.getConfig();
      const model = config.ai.generalPurposeModel;
      
      const prompt = `Transform this ${classification.type} query into search keywords.

Query: "${question}"
Query Type: ${classification.type}

IMPORTANT: 
1. "transformed" should be a SIMPLIFIED version (remove ONLY filler words like "show me", "find", "about", "with")
   - Keep meaningful words like "talking", "dancing", "cooking" (these describe the content!)
2. Make sure the transformed query preseves keywords to enable multi-modal search (spatial, temporal, interractions etc.)
3. Use Stemming and Lemmatization where necessary. (eg. "cars" → "car", "talking" -> "talk")
4. Extract keywords for each modality:

1. TEXT keywords: Words from transcription/dialogue (what people SAY)
   - For "talking about cooking" → ["cooking", "recipe", "food"]

2. VISUAL keywords: What you SEE (objects, colors, scenes, people)
   - For "red cars" → ["red", "car", "vehicle", "automobile"]
   
3. AUDIO keywords: What you HEAR (sounds, music, speech, NOT time words)
   - For "talking about cooking" → ["talk", "speech", "dialogue", "cooking"]
   - For "music playing" → ["music", "song", "melody"]
   - For "dialogue about" → ["dialogue", "conversation"]
   
4. TEMPORAL keywords: Time positions (ONLY if query mentions time)
   - For "first 5 minutes" → ["beginning", "start"]
   - For "end" → ["end", "conclusion"]
   
5. ACTION keywords: Activities/movements
   - For "people dancing" → ["dancing", "movement", "performance"]

Time Range Extraction:
- "beginning" or "first X minutes" → [0, X*60]
- "after X minutes" → [X*60, null]
- "end" or "last X minutes" → [null, null] (search from end)
- No time mentioned → null

- DO NOT use the examples in prompt as return values
- DO NOT return the examples as fallback if nothing matches

Return ONLY this JSON (use actual query content, NOT placeholders). 

Example for "talking about tamil cinema":
{
  "transformed": "talk tamil cinema",  // Removed only "about" (filler word)
  "searchKeywords": {
    "text": ["tamil", "cinema"],
    "visual": ["cinema", "film", "movie"],
    "audio": ["tamil", "dialogue"],
    "temporal": [],
    "action": []
  },
  "embeddings": {
    "text": "tamil cinema films movies",            // ← Used for text embedding  
    "visual": "tamil cinema scenes movies visual", // ← Used for visual embedding
    "audio": "tamil language dialogue speech"     // ← Used for audio embedding
  },
  "filters": {
    "timeRange": null,
    "confidenceThreshold": 0.7,
    "mediaTypes": ["video"]
  }
}`;

      let url = config.ai.embedUrl;
      url = `${url}/api/generate`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          prompt,
          stream: false,
          format: 'json',
          options: {
            temperature: 0.2,
            num_predict: 300
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Multi-modal transformation failed: ${response.status}`);
      }

      const data = await response.json();
      let multiModalQuery: MultiModalQuery;
      
      try {
        multiModalQuery = JSON.parse(data.response);
        multiModalQuery.original = question;
        multiModalQuery.classification = classification;
        
        // Ensure all arrays exist
        multiModalQuery.searchKeywords = {
          text: multiModalQuery.searchKeywords?.text || [],
          visual: multiModalQuery.searchKeywords?.visual || [],
          audio: multiModalQuery.searchKeywords?.audio || [],
          temporal: multiModalQuery.searchKeywords?.temporal || [],
          action: multiModalQuery.searchKeywords?.action || []
        };
        
        multiModalQuery.embeddings = {
          text: multiModalQuery.embeddings?.text || question,
          visual: multiModalQuery.embeddings?.visual,
          audio: multiModalQuery.embeddings?.audio
        };
        
        multiModalQuery.filters = {
          timeRange: multiModalQuery.filters?.timeRange,
          confidenceThreshold: multiModalQuery.filters?.confidenceThreshold || 0.5,
          mediaTypes: multiModalQuery.filters?.mediaTypes || ['video', 'image', 'audio']
        };
        
        // Post-process to fix time ranges and clean keywords
        multiModalQuery = this.postProcessMultiModalQuery(multiModalQuery, question, classification);
        
        console.log(`[QA-MULTIMODAL] Transformed: ${multiModalQuery.transformed}`);
      } catch (parseError) {
        console.warn('[QA-MULTIMODAL] JSON parse failed, using fallback');
        multiModalQuery = this.fallbackMultiModalQuery(question, classification);
      }
      
      return multiModalQuery;
    };

    try {
      return await this.retryQueue.addTask(operation, `multimodal-transform-${question.substring(0, 20)}`, 3);
    } catch (error) {
      console.warn('[QA-MULTIMODAL] Using fallback transformation:', error);
      return this.fallbackMultiModalQuery(question, classification);
    }
  }

  private postProcessMultiModalQuery(query: MultiModalQuery, question: string, classification: QueryClassification): MultiModalQuery {
    const lowerQuestion = question.toLowerCase();
    
    // Check if query actually has temporal words
    const temporalWords = ['beginning', 'start', 'end', 'first', 'last', 'after', 'before', 'minute', 'second', 'at'];
    const hasTemporalWords = temporalWords.some(word => lowerQuestion.includes(word));
    
    // Only set time ranges for temporal queries that actually mention time
    if (hasTemporalWords && (classification.type === 'temporal' || (classification.type === 'mixed' && classification.temporalMarkers))) {
      if (classification.temporalMarkers?.value) {
        const value = classification.temporalMarkers.value;
        
        if (value.includes('-')) {
          const parts = value.split('-');
          
          // Parse start time
          let start: number | null = null;
          if (parts[0] === 'last') {
            start = null; // Will be calculated from video end
          } else if (parts[0] && !isNaN(parseInt(parts[0]))) {
            start = parseInt(parts[0]);
          } else {
            start = 0;
          }
          
          // Parse end time
          let end: number | null = null;
          if (parts[1] === 'end') {
            end = null; // Search until end
          } else if (parts[1] && !isNaN(parseInt(parts[1]))) {
            end = parseInt(parts[1]);
          }
          
          // Only set if we have valid time range
          if (start !== null || end !== null) {
            query.filters.timeRange = [start || 0, end || null] as [number, number];
          }
        }
      }
    } else {
      // Non-temporal queries should not have time ranges
      query.filters.timeRange = undefined;
    }
    
    // Remove example keywords from prompt that LLM might have copied
    const exampleKeywords = ['dialogue', 'conversation', 'car', 'vehicle', 'automobile', 'music', 'song', 'melody', 'movement', 'performance', 'scene', 'colors'];
    
    // Clean keywords - remove examples that don't appear in the query
    // Object.keys(query.searchKeywords).forEach(key => {
    //   const keywords = query.searchKeywords[key as keyof typeof query.searchKeywords];
    //   if (Array.isArray(keywords)) {
    //     query.searchKeywords[key as keyof typeof query.searchKeywords] = keywords.filter(kw => {
    //       const lower = kw.toLowerCase();
    //       // Keep if it's in the query or not an example keyword
    //       return lowerQuestion.includes(lower) || !exampleKeywords.includes(lower);
    //     });
    //   }
    // });
    
    // If keywords are empty, extract from question
    if (query.searchKeywords.text.length === 0 && query.searchKeywords.visual.length === 0) {
      const words = question.toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length > 3 && !['show', 'find', 'with', 'about', 'video', 'scene'].includes(word));
      
      if (classification.type === 'spatial' || classification.spatialElements?.length) {
        query.searchKeywords.visual = words.slice(0, 3);
      } else if (classification.type === 'audio' || classification.audioElements?.length) {
        query.searchKeywords.audio = words.slice(0, 3);
      } else {
        query.searchKeywords.text = words.slice(0, 3);
      }
    }
    
    return query;
  }

  private fallbackMultiModalQuery(question: string, classification: QueryClassification): MultiModalQuery {
    const keywords = question.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2 && !['the', 'and', 'or', 'but', 'with', 'show', 'find', 'get'].includes(word));

    return {
      original: question,
      transformed: question,
      classification,
      searchKeywords: {
        text: keywords.slice(0, 3),
        visual: classification.spatialElements || [],
        audio: classification.audioElements || [],
        temporal: classification.temporalMarkers ? [classification.temporalMarkers.type] : [],
        action: classification.actionElements || []
      },
      embeddings: {
        text: question,
        visual: classification.spatialElements?.join(' ') || question,
        audio: classification.audioElements?.join(' ') || question
      },
      filters: {
        mediaTypes: ['video', 'image', 'audio'],
        confidenceThreshold: 0.5
      }
    };
  }

  async extractSearchEntities(question: string): Promise<string[]> {
    const operation = async (): Promise<string[]> => {
      console.log(`[QA-ENTITIES] Extracting entities from: "${question}"`);
      
      const config = ConfigManager.getConfig();
      const model = config.ai.generalPurposeModel;
      
      const prompt = `Extract keywords from: "${question}"

Return ONLY a comma-separated list, no explanations:
`;

      let url = config.ai.embedUrl;
      url = `${url}/api/generate`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          prompt,
          stream: false,
          options: {
            temperature: 0.2,
            num_predict: 50
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Entity extraction failed: ${response.status}`);
      }

      const data = await response.json();
      let entitiesText = data.response?.trim() || '';
      
      // Strip out common preamble patterns
      entitiesText = entitiesText
        .replace(/^Here are (?:some )?(?:important )?keywords?.*?:\s*/i, '')
        .replace(/^(?:Keywords?|Entities|Terms).*?:\s*/i, '')
        .replace(/^\d+\.\s*/gm, '') // Remove numbered list markers
        .trim();
      
      // Parse comma-separated entities or newline-separated
      let entities: string[];
      if (entitiesText.includes(',')) {
        entities = entitiesText.split(',');
      } else {
        entities = entitiesText.split('\n');
      }
      
      entities = entities
        .map((e: string) => e.trim())
        .map((e: string) => e.replace(/^[""`']+|[""`']+$/g, '')) // Remove surrounding quotes from each entity
        .filter((e: string) => e.length > 0 && e.length < 50) // Filter out long explanatory text
        .slice(0, 5); // Limit to top 5 entities
      
      console.log(`[QA-ENTITIES] Extracted: [${entities.join(', ')}]`);
      return entities.length > 0 ? entities : [question]; // Fallback to original
    };

    try {
      return await this.retryQueue.addTask(operation, `entity-extract-${question.substring(0, 20)}`, 3);
    } catch (error) {
      console.warn('[QA-ENTITIES] Falling back to simple keywords:', error);
      
      // Fallback: simple keyword extraction
      const keywords = question.toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length > 3 && !['which', 'what', 'have', 'with', 'about', 'videos', 'video'].includes(word));
      
      return keywords.length > 0 ? keywords : [question];
    }
  }
}

/**
 * LiteLLM provider implementation
 */
export class LiteLLMProvider implements LLMProvider {
  private model: string;
  private apiKey: string;

  constructor(model: string = 'openai/clip', apiKey: string = '') {
    this.model = model;
    this.apiKey = apiKey;
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Check if API key is provided
      if (!this.apiKey) {
        console.warn('LiteLLM API key not provided');
        return false;
      }

      // In a real implementation, this would make a test call to the LiteLLM API
      return true;
    } catch (error) {
      console.error('LiteLLM availability check failed:', error);
      return false;
    }
  }

  async generateEmbedding(text: string): Promise<Float32Array> {
    // Simplified implementation - would call LiteLLM API
    console.log(`Generating embedding for text "${text.substring(0, 30)}..." using LiteLLM model ${this.model}`);
    const randomArray = new Array(384).fill(0).map(() => Math.random() - 0.5);
    return new Float32Array(randomArray);
  }

  async generateImageDescription(imagePath: string, _originalImagePath?: string): Promise<string> {
    // Simplified implementation - would call LiteLLM API with image
    console.log(`Generating description for image ${imagePath} using LiteLLM model ${this.model}`);
    return 'LiteLLM image description placeholder';
  }

  async generateImageEmbedding(imagePath: string): Promise<Float32Array> {
    // Simplified implementation - would call LiteLLM API with image
    console.log(`Generating embedding for image ${imagePath} using LiteLLM model ${this.model}`);
    const randomArray = new Array(384).fill(0).map(() => Math.random() - 0.5);
    return new Float32Array(randomArray);
  }

  async transformQuestionToQuery(question: string): Promise<string> {
    // LiteLLM implementation would use actual API
    console.log(`[QA-TRANSFORM] LiteLLM transforming: "${question}"`);
    return question; // Placeholder - implement with actual LiteLLM API
  }

  async classifyQueryType(question: string): Promise<QueryClassification> {
    // LiteLLM implementation would use actual API
    console.log(`[QA-CLASSIFY] LiteLLM classifying: "${question}"`);
    return {
      type: 'mixed',
      confidence: 0.5,
      subtypes: ['text'],
      spatialElements: [],
      audioElements: [],
      actionElements: []
    };
  }

  async transformMultiModalQuery(question: string, classification: QueryClassification): Promise<MultiModalQuery> {
    // LiteLLM implementation would use actual API
    console.log(`[QA-MULTIMODAL] LiteLLM transforming: "${question}"`);
    return {
      original: question,
      transformed: question,
      classification,
      searchKeywords: {
        text: [question],
        visual: [],
        audio: [],
        temporal: [],
        action: []
      },
      embeddings: {
        text: question
      },
      filters: {
        mediaTypes: ['video', 'image', 'audio']
      }
    };
  }

  async extractSearchEntities(question: string): Promise<string[]> {
    // LiteLLM implementation would use actual API
    console.log(`[QA-ENTITIES] LiteLLM extracting from: "${question}"`);
    return [question]; // Placeholder - implement with actual LiteLLM API
  }

  getName(): string {
    return 'LiteLLM';
  }

  getModel(): string {
    return this.model;
  }
}

/**
 * Factory for creating LLM providers
 */
export class LLMProviderFactory {
  static createProvider(type: 'ollama' | 'litellm' | 'subprocess' = 'ollama', config?: any): LLMProvider {
    switch (type) {
      case 'ollama':
        return new OllamaProvider(config?.visionModel, config?.embeddingModel);
      case 'litellm':
        return new LiteLLMProvider(config);
      default:
        throw new Error(`Unknown LLM provider type: ${type}`);
    }
  }
}
