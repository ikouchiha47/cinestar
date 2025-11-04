/**
 * LLM Provider System Types
 */

export type ProviderType = 'local' | 'cloud';
export type AdapterType = 'ollama' | 'litellm' | 'openai' | 'gemini';
export type PrivacyMode = 'private' | 'cloud';
export type TaskType = 'vision' | 'embedding' | 'text' | 'transcription';

export interface ModelMapping {
  task: TaskType;
  modelName: string;
  displayName?: string;
}

export interface ProviderRuntimeConfig {
  baseUrl?: string;
  apiKey?: string;
  models: ModelMapping[];
  timeout?: number;
  retries?: number;
  maxTokens?: number;
}

export interface LLMProvider {
  id: string;
  name: string;
  type: ProviderType;
  adapter: AdapterType;
  privacy: PrivacyMode;
  config: ProviderRuntimeConfig;
  enabled?: boolean;
}

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string | MessageContent[];
}

export interface MessageContent {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: {
    url: string;
    detail?: 'low' | 'high' | 'auto';
  };
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  format?: 'json' | object;  // Can be 'json' string or JSON schema object
}

export interface EmbedOptions {
  model?: string;
  dimensions?: number;
}

export interface VisionOptions {
  model?: string;
  maxTokens?: number;
  detail?: 'low' | 'high' | 'auto';
}

export interface ChatResponse {
  content: string;
  model?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface EmbedResponse {
  embedding: number[];
  model?: string;
  dimensions?: number;
}

/**
 * Base interface for all LLM adapters
 */
export interface ILLMAdapter {
  /**
   * Chat completion
   */
  chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse>;
  
  /**
   * Generate embeddings
   */
  embed(text: string, options?: EmbedOptions): Promise<EmbedResponse>;
  
  /**
   * Vision/image understanding
   */
  vision(imageUrl: string, prompt: string, options?: VisionOptions): Promise<ChatResponse>;
  
  /**
   * Check if adapter is available
   */
  isAvailable(): Promise<boolean>;
  
  /**
   * Get available models
   */
  getModels?(): Promise<string[]>;
}

/**
 * Provider configuration in app config
 */
export interface LLMConfig {
  activeProvider: string;
  privacyMode: PrivacyMode;
  providers: Record<string, LLMProvider>;
}
