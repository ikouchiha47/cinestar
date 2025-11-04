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
import { readFileSync } from 'fs';

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
    const model = options?.model || 'phi3:3.8b';
    
    const requestBody: any = {
      model,
      messages: this.formatMessages(messages),
      stream: false,
      options: {
        temperature: options?.temperature ?? 0.7,
        num_predict: options?.maxTokens
      }
    };
    
    // Add format if specified (can be 'json' string or JSON schema object)
    if (options?.format) {
      requestBody.format = options.format;
    }
    
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(this.timeout)
    });
    
    const data = await response.json();
    
    // Some models/endpoints may return content in different fields
    // Qwen3 models use 'thinking' field for extended reasoning mode
    const content = (data?.message && data.message.content)
      || (data?.message && data.message.thinking)  // Qwen3 extended reasoning
      || data?.response
      || data?.content
      || '';
    
    return {
      content,
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
    // If already base64 with data: prefix, extract base64 part
    if (imageUrl.startsWith('data:')) {
      return imageUrl.split(',')[1];
    }
    
    // If the string looks like plain base64 (no prefix), return as-is
    // Heuristics: long string, no whitespace, typical image prefixes or base64 charset
    const looksLikeBase64 = (s: string): boolean => {
      if (!s || s.length < 80) return false;
      if (s.includes(' ') || s.includes('\n')) return false;
      if (s.startsWith('/9j/') || s.startsWith('iVBORw0KG') || s.startsWith('R0lGOD') || s.startsWith('UklGR')) return true; // jpg/png/gif/webp
      return /^[A-Za-z0-9+/=]+$/.test(s);
    };
    if (looksLikeBase64(imageUrl)) {
      return imageUrl;
    }
    
    // If file path, read and convert to base64
    if (imageUrl.startsWith('file://') || imageUrl.startsWith('/') || imageUrl.startsWith('\\')) {
      const path = imageUrl.replace('file://', '');
      const buffer = readFileSync(path);
      return buffer.toString('base64');
    }
    
    // If HTTP/HTTPS URL, fetch and convert
    if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
      const response = await fetch(imageUrl);
      const buffer = await response.arrayBuffer();
      return Buffer.from(buffer).toString('base64');
    }
    
    // Otherwise, assume it's already plain base64 (no prefix, no path)
    // This handles the case where VisionService passes plain base64 for Ollama
    return imageUrl;
  }
}
