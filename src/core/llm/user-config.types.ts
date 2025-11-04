/**
 * User Configuration Types
 * 
 * Defines the structure for user's LLM preferences stored in userData directory.
 * This is separate from the built-in provider configs (which are read-only in ASAR).
 */

export interface UserProviderConfig {
  /** Whether this provider is enabled */
  enabled: boolean;
  /** User's API key for this provider (if applicable) */
  apiKey?: string;
  /** User's selected models for different tasks */
  selectedModels: {
    vision?: string;
    text?: string;
    embedding?: string;
    transcription?: string;
    tts?: string;
    imageGeneration?: string;
  };
}

export interface UserLLMConfig {
  /** Version for migration purposes */
  version: string;
  /** Currently active provider ID */
  activeProvider: string;
  /** Per-provider user settings */
  providers: Record<string, UserProviderConfig>;
}

export const DEFAULT_USER_CONFIG: UserLLMConfig = {
  version: '1.0.0',
  activeProvider: 'ollama', // Privacy-first default
  providers: {
    ollama: {
      enabled: true,
      selectedModels: {
        vision: 'moondream:v2',
        text: 'phi3:3.8b',
        embedding: 'qllama/bge-large-en-v1.5:latest',
        transcription: 'whisper:latest'
      }
    },
    openai: {
      enabled: false,
      selectedModels: {
        vision: 'gpt-4.1-mini',
        text: 'gpt-4.1',
        embedding: 'text-embedding-3-large',
        transcription: 'gpt-4o-transcribe'
      }
    },
    litellm: {
      enabled: false,
      selectedModels: {
        vision: 'gemini/gemini-2.0-flash-exp',
        text: 'gemini/gemini-2.0-flash-exp',
        embedding: 'text-embedding-3-large'
      }
    }
  }
};
