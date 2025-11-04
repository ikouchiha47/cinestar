/**
 * Gemini Adapter
 * 
 * Implements Google Gemini API for chat, vision, and embeddings
 */

import {
  ILLMAdapter,
  Message,
  ChatOptions,
  EmbedOptions,
  VisionOptions,
  ChatResponse,
  EmbedResponse,
  ProviderRuntimeConfig
} from './types';

export class GeminiAdapter implements ILLMAdapter {
  private baseUrl: string;
  private apiKey: string;
  private timeout: number;
  
  constructor(config: ProviderRuntimeConfig) {
    this.baseUrl = config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
    this.apiKey = config.apiKey || '';
    this.timeout = config.timeout || 60000; // 60 seconds default
    
    if (!this.apiKey) {
      console.warn('[GEMINI-ADAPTER] No API key provided');
    }
  }
  
  /**
   * Check if Gemini API is available
   */
  async isAvailable(): Promise<boolean> {
    if (!this.apiKey) {
      console.error('[GEMINI-ADAPTER] API key is required');
      return false;
    }
    
    try {
      const response = await fetch(`${this.baseUrl}/models?key=${this.apiKey}`, {
        signal: AbortSignal.timeout(5000)
      });
      return response.ok;
    } catch (error) {
      console.error('[GEMINI-ADAPTER] Availability check failed:', error);
      return false;
    }
  }
  
  /**
   * Get available models from Gemini
   */
  async getModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/models?key=${this.apiKey}`);
      
      if (!response.ok) {
        throw this.handleError(response.status, await response.text());
      }
      
      const data = await response.json();
      return data.models?.map((m: any) => m.name.replace('models/', '')) || [];
    } catch (error) {
      console.error('[GEMINI-ADAPTER] Failed to get models:', error);
      return [];
    }
  }
  
  /**
   * Chat completion using Gemini
   */
  async chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse> {
    const model = options?.model || 'gemini-pro';
    
    console.log(`[GEMINI-ADAPTER] Chat request to ${model}`);
    
    try {
      const response = await fetch(
        `${this.baseUrl}/models/${model}:generateContent?key=${this.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: this.formatMessages(messages),
            generationConfig: {
              temperature: options?.temperature ?? 0.7,
              maxOutputTokens: options?.maxTokens
            }
          }),
          signal: AbortSignal.timeout(this.timeout)
        }
      );
      
      if (!response.ok) {
        throw this.handleError(response.status, await response.text());
      }
      
      const data = await response.json();
      
      // Extract text from Gemini's response format
      const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      
      return {
        content,
        model,
        usage: data.usageMetadata ? {
          promptTokens: data.usageMetadata.promptTokenCount,
          completionTokens: data.usageMetadata.candidatesTokenCount,
          totalTokens: data.usageMetadata.totalTokenCount
        } : undefined
      };
    } catch (error) {
      console.error('[GEMINI-ADAPTER] Chat error:', error);
      throw error;
    }
  }
  
  /**
   * Generate embeddings using Gemini
   */
  async embed(text: string, options?: EmbedOptions): Promise<EmbedResponse> {
    const model = options?.model || 'text-embedding-004';
    
    console.log(`[GEMINI-ADAPTER] Embedding request to ${model}`);
    
    try {
      const response = await fetch(
        `${this.baseUrl}/models/${model}:embedContent?key=${this.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: {
              parts: [{ text }]
            }
          }),
          signal: AbortSignal.timeout(this.timeout)
        }
      );
      
      if (!response.ok) {
        throw this.handleError(response.status, await response.text());
      }
      
      const data = await response.json();
      const embedding = data.embedding?.values || [];
      
      return {
        embedding,
        model,
        dimensions: embedding.length
      };
    } catch (error) {
      console.error('[GEMINI-ADAPTER] Embedding error:', error);
      throw error;
    }
  }
  
  /**
   * Vision/image understanding using Gemini Pro Vision
   */
  async vision(imageUrl: string, prompt: string, options?: VisionOptions): Promise<ChatResponse> {
    const model = options?.model || 'gemini-pro-vision';
    
    console.log(`[GEMINI-ADAPTER] Vision request to ${model}`);
    
    try {
      // Prepare image data
      const imageData = await this.prepareImageData(imageUrl);
      
      const response = await fetch(
        `${this.baseUrl}/models/${model}:generateContent?key=${this.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: prompt },
                {
                  inline_data: {
                    mime_type: imageData.mimeType,
                    data: imageData.base64
                  }
                }
              ]
            }],
            generationConfig: {
              maxOutputTokens: options?.maxTokens || 1000
            }
          }),
          signal: AbortSignal.timeout(this.timeout)
        }
      );
      
      if (!response.ok) {
        throw this.handleError(response.status, await response.text());
      }
      
      const data = await response.json();
      
      // Extract text from Gemini's response format
      const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      
      return {
        content,
        model,
        usage: data.usageMetadata ? {
          promptTokens: data.usageMetadata.promptTokenCount,
          completionTokens: data.usageMetadata.candidatesTokenCount,
          totalTokens: data.usageMetadata.totalTokenCount
        } : undefined
      };
    } catch (error) {
      console.error('[GEMINI-ADAPTER] Vision error:', error);
      throw error;
    }
  }
  
  /**
   * Format messages for Gemini API (parts-based format)
   */
  private formatMessages(messages: Message[]): any[] {
    return messages.map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [
        typeof msg.content === 'string' 
          ? { text: msg.content }
          : msg.content
      ]
    }));
  }
  
  /**
   * Prepare image data for Gemini API
   * Returns base64 data and mime type
   */
  private async prepareImageData(imageUrl: string): Promise<{ base64: string; mimeType: string }> {
    // If already a data URL, extract base64 and mime type
    if (imageUrl.startsWith('data:')) {
      const matches = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (matches) {
        return {
          mimeType: matches[1],
          base64: matches[2]
        };
      }
    }
    
    // If file path, read and convert to base64
    if (imageUrl.startsWith('file://') || imageUrl.startsWith('/') || imageUrl.startsWith('\\')) {
      const fs = await import('fs');
      const path = imageUrl.replace('file://', '');
      const buffer = fs.readFileSync(path);
      const base64 = buffer.toString('base64');
      
      // Detect image type from extension
      const ext = path.split('.').pop()?.toLowerCase();
      const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';
      
      return { base64, mimeType };
    }
    
    // If HTTP URL, fetch and convert
    if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
      const response = await fetch(imageUrl);
      const buffer = await response.arrayBuffer();
      const base64 = Buffer.from(buffer).toString('base64');
      const mimeType = response.headers.get('content-type') || 'image/jpeg';
      
      return { base64, mimeType };
    }
    
    // If plain base64 (no prefix), assume it's already base64
    // This handles the case where VisionService passes plain base64 for Gemini
    if (imageUrl.length > 100 && !imageUrl.includes(' ')) {
      return { base64: imageUrl, mimeType: 'image/jpeg' };
    }
    
    throw new Error(`Unsupported image URL format: ${imageUrl}`);
  }
  
  /**
   * Handle API errors and throw appropriate error types
   */
  private handleError(status: number, body: string): Error {
    let errorMessage = 'Gemini API error';
    
    try {
      const errorData = JSON.parse(body);
      errorMessage = errorData.error?.message || errorMessage;
    } catch {
      errorMessage = body.substring(0, 200);
    }
    
    switch (status) {
      case 401:
      case 403:
        return new Error(`Authentication failed: ${errorMessage}. Please check your API key.`);
      case 429:
        return new Error(`Rate limit exceeded: ${errorMessage}. Please try again later.`);
      case 404:
        return new Error(`Model not found: ${errorMessage}. Please check the model name.`);
      case 400:
        return new Error(`Bad request: ${errorMessage}`);
      case 500:
      case 502:
      case 503:
        return new Error(`Gemini service error: ${errorMessage}. Please try again.`);
      default:
        return new Error(`Gemini API error (${status}): ${errorMessage}`);
    }
  }
}
