/**
 * OpenAI Adapter
 * 
 * Implements OpenAI API for chat, vision, and embeddings
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

export class OpenAIAdapter implements ILLMAdapter {
  private baseUrl: string;
  private apiKey: string;
  private timeout: number;
  
  constructor(config: ProviderRuntimeConfig) {
    this.baseUrl = config.baseUrl || 'https://api.openai.com/v1';
    this.apiKey = config.apiKey || '';
    this.timeout = config.timeout || 60000; // 60 seconds default
    
    if (!this.apiKey) {
      console.warn('[OPENAI-ADAPTER] No API key provided');
    }
  }
  
  /**
   * Check if OpenAI API is available
   */
  async isAvailable(): Promise<boolean> {
    if (!this.apiKey) {
      console.error('[OPENAI-ADAPTER] API key is required');
      return false;
    }
    
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(5000)
      });
      return response.ok;
    } catch (error) {
      console.error('[OPENAI-ADAPTER] Availability check failed:', error);
      return false;
    }
  }
  
  /**
   * Get available models from OpenAI
   */
  async getModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: this.getHeaders()
      });
      
      if (!response.ok) {
        throw this.handleError(response.status, await response.text());
      }
      
      const data = await response.json();
      return data.data?.map((m: any) => m.id) || [];
    } catch (error) {
      console.error('[OPENAI-ADAPTER] Failed to get models:', error);
      return [];
    }
  }
  
  /**
   * Chat completion
   */
  async chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse> {
    const model = options?.model || 'gpt-4';
    
    console.log(`[OPENAI-ADAPTER] Chat request to ${model}`);
    
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          model,
          messages: this.formatMessages(messages),
          temperature: options?.temperature ?? 0.7,
          max_tokens: options?.maxTokens,
          stream: options?.stream || false
        }),
        signal: AbortSignal.timeout(this.timeout)
      });
      
      if (!response.ok) {
        throw this.handleError(response.status, await response.text());
      }
      
      const data = await response.json();
      
      return {
        content: data.choices[0].message.content,
        model: data.model,
        usage: data.usage ? {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens
        } : undefined
      };
    } catch (error) {
      console.error('[OPENAI-ADAPTER] Chat error:', error);
      throw error;
    }
  }
  
  /**
   * Generate embeddings
   */
  async embed(text: string, options?: EmbedOptions): Promise<EmbedResponse> {
    const model = options?.model || 'text-embedding-3-large';
    
    console.log(`[OPENAI-ADAPTER] Embedding request to ${model}`);
    
    try {
      const response = await fetch(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          model,
          input: text,
          dimensions: options?.dimensions
        }),
        signal: AbortSignal.timeout(this.timeout)
      });
      
      if (!response.ok) {
        throw this.handleError(response.status, await response.text());
      }
      
      const data = await response.json();
      
      return {
        embedding: data.data[0].embedding,
        model: data.model,
        dimensions: data.data[0].embedding.length
      };
    } catch (error) {
      console.error('[OPENAI-ADAPTER] Embedding error:', error);
      throw error;
    }
  }
  
  /**
   * Vision/image understanding using GPT-4 Vision
   */
  async vision(imageUrl: string, prompt: string, options?: VisionOptions): Promise<ChatResponse> {
    const model = options?.model || 'gpt-4-vision-preview';
    
    console.log(`[OPENAI-ADAPTER] Vision request to ${model}`);
    
    try {
      // Convert file path to data URL if needed
      const imageDataUrl = await this.prepareImageUrl(imageUrl);
      
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          model,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { 
                type: 'image_url', 
                image_url: { 
                  url: imageDataUrl,
                  detail: options?.detail || 'auto'
                } 
              }
            ]
          }],
          max_tokens: options?.maxTokens || 1000
        }),
        signal: AbortSignal.timeout(this.timeout)
      });
      
      if (!response.ok) {
        throw this.handleError(response.status, await response.text());
      }
      
      const data = await response.json();
      
      return {
        content: data.choices[0].message.content,
        model: data.model,
        usage: data.usage ? {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens
        } : undefined
      };
    } catch (error) {
      console.error('[OPENAI-ADAPTER] Vision error:', error);
      throw error;
    }
  }
  
  /**
   * Get request headers with authentication
   */
  private getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`
    };
  }
  
  /**
   * Format messages for OpenAI API
   */
  private formatMessages(messages: Message[]): any[] {
    return messages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));
  }
  
  /**
   * Prepare image URL for OpenAI API
   * Converts file paths to data URLs
   */
  private async prepareImageUrl(imageUrl: string): Promise<string> {
    // If already a data URL or HTTP URL, return as is
    if (imageUrl.startsWith('data:') || imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
      return imageUrl;
    }
    
    // If file path, convert to data URL
    if (imageUrl.startsWith('file://') || imageUrl.startsWith('/') || imageUrl.startsWith('\\')) {
      const fs = await import('fs');
      const path = imageUrl.replace('file://', '');
      const buffer = fs.readFileSync(path);
      const base64 = buffer.toString('base64');
      
      // Detect image type from extension
      const ext = path.split('.').pop()?.toLowerCase();
      const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';
      
      return `data:${mimeType};base64,${base64}`;
    }
    
    // If plain base64 (no prefix), wrap in data URL
    // Assume JPEG if we can't determine type
    if (imageUrl.length > 100 && !imageUrl.includes(' ')) {
      return `data:image/jpeg;base64,${imageUrl}`;
    }
    
    return imageUrl;
  }
  
  /**
   * Handle API errors and throw appropriate error types
   */
  private handleError(status: number, body: string): Error {
    let errorMessage = 'OpenAI API error';
    
    try {
      const errorData = JSON.parse(body);
      errorMessage = errorData.error?.message || errorMessage;
    } catch {
      errorMessage = body.substring(0, 200);
    }
    
    switch (status) {
      case 401:
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
        return new Error(`OpenAI service error: ${errorMessage}. Please try again.`);
      default:
        return new Error(`OpenAI API error (${status}): ${errorMessage}`);
    }
  }
}
