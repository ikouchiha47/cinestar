/**
 * Ollama Adapter
 * 
 * Wrapper around existing Ollama functionality to match ILLMAdapter interface
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

export class OllamaAdapter implements ILLMAdapter {
  private baseUrl: string;
  private timeout: number;
  
  constructor(config: ProviderRuntimeConfig) {
    this.baseUrl = config.baseUrl || 'http://localhost:11434';
    this.timeout = config.timeout || 300000;
  }
  
  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(5000)
      });
      return response.ok;
    } catch (error) {
      return false;
    }
  }
  
  async getModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      const data = await response.json();
      return data.models?.map((m: any) => m.name) || [];
    } catch (error) {
      return [];
    }
  }
  
  async chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse> {
    const model = options?.model || 'qwen3:4b';
    
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: this.formatMessages(messages),
        stream: false,
        options: {
          temperature: options?.temperature ?? 0.7,
          num_predict: options?.maxTokens
        }
      }),
      signal: AbortSignal.timeout(this.timeout)
    });
    
    const data = await response.json();
    
    return {
      content: data.message.content,
      model: data.model
    };
  }
  
  async embed(text: string, options?: EmbedOptions): Promise<EmbedResponse> {
    const model = options?.model || 'qllama/bge-large-en-v1.5:latest';
    
    const response = await fetch(`${this.baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        input: text
      }),
      signal: AbortSignal.timeout(this.timeout)
    });
    
    const data = await response.json();
    
    // Ollama returns {embeddings: [number[]]} or {embedding: number[]}
    const embedding = data.embeddings?.[0] || data.embedding;
    
    return {
      embedding,
      model: data.model,
      dimensions: embedding.length
    };
  }
  
  async vision(imageUrl: string, prompt: string, options?: VisionOptions): Promise<ChatResponse> {
    const model = options?.model || 'moondream:v2';
    
    // Convert image URL to base64 if needed
    const imageData = await this.loadImage(imageUrl);
    
    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        images: [imageData],
        stream: false
      }),
      signal: AbortSignal.timeout(this.timeout)
    });
    
    const data = await response.json();
    
    return {
      content: data.response,
      model: data.model
    };
  }
  
  private formatMessages(messages: Message[]): any[] {
    return messages.map(msg => ({
      role: msg.role,
      content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
    }));
  }
  
  private async loadImage(imageUrl: string): Promise<string> {
    // If already base64, return as is
    if (imageUrl.startsWith('data:')) {
      return imageUrl.split(',')[1];
    }
    
    // If file path, read and convert to base64
    if (imageUrl.startsWith('file://') || imageUrl.startsWith('/')) {
      const fs = require('fs');
      const path = imageUrl.replace('file://', '');
      const buffer = fs.readFileSync(path);
      return buffer.toString('base64');
    }
    
    // If HTTP URL, fetch and convert
    const response = await fetch(imageUrl);
    const buffer = await response.arrayBuffer();
    return Buffer.from(buffer).toString('base64');
  }
}
