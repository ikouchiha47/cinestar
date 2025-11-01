/**
 * Provider Configuration Types
 * 
 * Defines the structure for LLM provider configurations including
 * model listings, defaults, and API key management.
 */

export interface ProviderApiKeyConfig {
  /** Whether an API key is required for this provider */
  required: boolean;
  /** Whether the API key can be edited by the user */
  editable: boolean;
  /** Environment variable name for the API key */
  envVar?: string;
  /** Display label for the API key field */
  label: string;
  /** Placeholder text for the API key input */
  placeholder?: string;
}

export interface ModelCapability {
  /** Unique identifier for the model */
  id: string;
  /** Display name for the model */
  name: string;
  /** Description of the model's capabilities */
  description: string;
  /** List of capabilities this model supports */
  capabilities: string[];
  /** Context window size (for text models) */
  contextWindow?: number;
  /** Embedding dimensions (for embedding models) */
  dimensions?: number;
  /** Whether this is the default model in its category */
  default?: boolean;
}

export interface ModelCategory {
  /** Display label for the category */
  label: string;
  /** Description of the category */
  description: string;
  /** List of models in this category */
  models: ModelCapability[];
}

export interface ProviderDefaults {
  /** Default model for vision tasks */
  vision?: string;
  /** Default model for text generation */
  text?: string;
  /** Default model for embeddings */
  embedding?: string;
  /** Default model for transcription */
  transcription?: string;
  /** Default model for text-to-speech */
  tts?: string;
  /** Default model for image generation */
  imageGeneration?: string;
}

export interface ProviderConfig {
  /** Unique identifier for the provider */
  provider: string;
  /** Display name for the provider */
  name: string;
  /** Base URL for the provider's API */
  baseUrl: string;
  /** URL to the provider's documentation */
  docsUrl: string;
  /** API key configuration */
  apiKey: ProviderApiKeyConfig;
  /** Default models for different tasks */
  defaults: ProviderDefaults;
  /** Categorized model listings */
  categories: Record<string, ModelCategory>;
}

/**
 * Helper type to extract all model IDs from a provider config
 */
export type ModelId<T extends ProviderConfig> = T['categories'][keyof T['categories']]['models'][number]['id'];

/**
 * Helper type to get models by capability
 */
export type ModelsByCapability<T extends ProviderConfig, C extends string> = Extract<
  T['categories'][keyof T['categories']]['models'][number],
  { capabilities: readonly (C | string)[] }
>;
