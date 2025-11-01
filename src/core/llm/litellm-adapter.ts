/**
 * LiteLLM Adapter
 * 
 * Supports both local models (via LiteLLM proxy to Ollama) and cloud providers
 * (OpenAI, Anthropic, etc.) through a unified API.
 */

import {
  ILLMAdapter,
  Message,
  ChatOptions,
  EmbedOptions,
  VisionOptions,
  ChatResponse,
  EmbedResponse,
  ProviderConfig
} from './types';

export class LiteLLMAdapter implements ILLMAdapter {
  private baseUrl: string;
  private apiKey?: string;
  private defaultModel: string;
  private timeout: number;
  
  constructor(config: ProviderConfig) {
    this.baseUrl = config.baseUrl || 'http://localhost:4000';
    this.apiKey = config.apiKey;
    this.defaultModel = config.models.find(m => m.task === 'text')?.modelName || 'gpt-4';
    this.timeout = config.timeout || 300000; // 5 minutes default
  }
  
  /**
   * Check if LiteLLM server is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(5000)
      });
      return response.ok;
    } catch (error) {
      console.error('[LITELLM-ADAPTER] Health check failed:', error);
      return false;
    }
  }
  
  /**
   * Get available models from LiteLLM
   */
  async getModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: this.getHeaders()
      });
      
      const data = await response.json();
      return data.data?.map((m: any) => m.id) || [];
    } catch (error) {
      console.error('[LITELLM-ADAPTER] Failed to get models:', error);
      return [];
    }
  }
  
  /**
   * Chat completion
   */
  async chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse> {
    const model = options?.model || this.defaultModel;
    
    console.log(`[LITELLM-ADAPTER] Chat request to ${model}`);
    
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
        const error = await response.text();
        throw new Error(`LiteLLM chat failed: ${error}`);
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
      console.error('[LITELLM-ADAPTER] Chat error:', error);
      throw error;
    }
  }
  
  /**
   * Generate embeddings
   */
  async embed(text: string, options?: EmbedOptions): Promise<EmbedResponse> {
    const model = options?.model || 'text-embedding-3-large';
    
    console.log(`[LITELLM-ADAPTER] Embedding request to ${model}`);
    
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
        const error = await response.text();
        throw new Error(`LiteLLM embedding failed: ${error}`);
      }
      
      const data = await response.json();
      
      return {
        embedding: data.data[0].embedding,
        model: data.model,
        dimensions: data.data[0].embedding.length
      };
    } catch (error) {
      console.error('[LITELLM-ADAPTER] Embedding error:', error);
      throw error;
    }
  }
  
  /**
   * Vision/image understanding
   */
  async vision(imageUrl: string, prompt: string, options?: VisionOptions): Promise<ChatResponse> {
    const model = options?.model || 'gpt-4-vision-preview';
    
    console.log(`[LITELLM-ADAPTER] Vision request to ${model}`);
    
    try {
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
                  url: imageUrl,
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
        const error = await response.text();
        throw new Error(`LiteLLM vision failed: ${error}`);
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
      console.error('[LITELLM-ADAPTER] Vision error:', error);
      throw error;
    }
  }
  
  /**
   * Get request headers
   */
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    
    return headers;
  }
  
  /**
   * Format messages for LiteLLM API
   */
  private formatMessages(messages: Message[]): any[] {
    return messages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));
  }
}
