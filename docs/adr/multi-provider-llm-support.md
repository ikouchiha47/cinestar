# Multi-Provider LLM Support

This document describes the multi-provider LLM support system that allows the application to work with multiple AI providers (Ollama, OpenAI, Gemini, LiteLLM).

## Overview

The application now supports multiple LLM providers through a unified adapter interface. This allows users to:
- Use local models via Ollama (default)
- Use cloud providers like OpenAI and Google Gemini
- Route requests through LiteLLM proxy for advanced features
- Switch between providers without code changes

## Architecture

### Provider Adapter Pattern

Each provider has an adapter that implements the `ILLMAdapter` interface:

```typescript
interface ILLMAdapter {
  chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse>;
  embed(text: string, options?: EmbedOptions): Promise<EmbedResponse>;
  vision(imageUrl: string, prompt: string, options?: VisionOptions): Promise<ChatResponse>;
  isAvailable(): Promise<boolean>;
  getModels?(): Promise<string[]>;
}
```

### Supported Providers

1. **Ollama** (Local, Private)
   - Default provider
   - Runs models locally
   - No API key required
   - Privacy: Private

2. **OpenAI** (Cloud)
   - GPT-4, GPT-4 Vision, text-embedding-3-large
   - Requires API key
   - Privacy: Cloud

3. **Google Gemini** (Cloud)
   - Gemini Pro, Gemini Pro Vision
   - Requires API key
   - Privacy: Cloud

4. **LiteLLM** (Proxy)
   - Routes to multiple providers
   - OpenAI-compatible API
   - Optional API key
   - Privacy: Depends on backend

## Configuration

### Default Configuration

The application uses Ollama by default with these settings:

```json
{
  "llm": {
    "activeProvider": "ollama-local",
    "privacyMode": "private",
    "providers": {
      "ollama-local": {
        "id": "ollama-local",
        "name": "Ollama (Local)",
        "type": "local",
        "adapter": "ollama",
        "privacy": "private",
        "config": {
          "baseUrl": "http://localhost:11434",
          "models": [
            { "task": "vision", "modelName": "moondream:v2" },
            { "task": "embedding", "modelName": "bge-large-en-v1.5" },
            { "task": "text", "modelName": "qwen3:4b" }
          ],
          "timeout": 300000
        },
        "enabled": true
      }
    }
  }
}
```

### Adding a New Provider

To add OpenAI as a provider:

```json
{
  "llm": {
    "providers": {
      "openai-cloud": {
        "id": "openai-cloud",
        "name": "OpenAI",
        "type": "cloud",
        "adapter": "openai",
        "privacy": "cloud",
        "config": {
          "baseUrl": "https://api.openai.com/v1",
          "apiKey": "sk-your-api-key-here",
          "models": [
            { "task": "vision", "modelName": "gpt-4-vision-preview" },
            { "task": "embedding", "modelName": "text-embedding-3-large" },
            { "task": "text", "modelName": "gpt-4" }
          ],
          "timeout": 60000
        },
        "enabled": true
      }
    }
  }
}
```

### Switching Providers

To switch the active provider:

```typescript
const providerManager = new ProviderManager(config.llm);
await providerManager.switchProvider('openai-cloud');
```

## Migration from Old Config

The system automatically migrates old `aiServices` configuration to the new `llm` format:

**Old Format:**
```json
{
  "aiServices": {
    "captioning": {
      "baseUrl": "http://localhost:11434",
      "model": "moondream:v2"
    }
  }
}
```

**New Format:**
```json
{
  "llm": {
    "activeProvider": "ollama-local",
    "providers": {
      "ollama-local": {
        "config": {
          "baseUrl": "http://localhost:11434",
          "models": [
            { "task": "vision", "modelName": "moondream:v2" }
          ]
        }
      }
    }
  }
}
```

Migration happens automatically on first config access.

## Usage

### In Services

Services receive a `ProviderManager` instance and use it to get adapters:

```typescript
class VisionService {
  constructor(private providerManager: ProviderManager) {}
  
  async caption(imagePath: string): Promise<string> {
    const adapter = this.providerManager.getProviderForTask('vision');
    const model = this.providerManager.getModelForTask('vision');
    
    const response = await adapter.vision(imagePath, 'Describe this image', { model });
    return response.content;
  }
}
```

### Task-Specific Adapters

Get an adapter for a specific task:

```typescript
// Get adapter for vision tasks
const visionAdapter = providerManager.getProviderForTask('vision');

// Get adapter for embedding tasks
const embeddingAdapter = providerManager.getProviderForTask('embedding');

// Get adapter for text generation tasks
const textAdapter = providerManager.getProviderForTask('text');
```

### Model Selection

Get the configured model for a task:

```typescript
const visionModel = providerManager.getModelForTask('vision');
const embeddingModel = providerManager.getModelForTask('embedding');
const textModel = providerManager.getModelForTask('text');
```

## Privacy Mode

The system tracks privacy mode based on the active provider:

```typescript
const privacyMode = providerManager.getPrivacyMode(); // 'private' | 'cloud'
const isPrivate = providerManager.isPrivate(); // boolean
```

Privacy mode changes automatically when switching providers and emits events:

```typescript
providerManager.on('privacy-mode-changed', ({ from, to }) => {
  console.log(`Privacy mode changed from ${from} to ${to}`);
});
```

## Error Handling

The system provides specific error types for different failure scenarios:

```typescript
import { 
  AuthenticationError, 
  RateLimitError, 
  ModelNotFoundError,
  getUserFriendlyMessage 
} from './llm/errors';

try {
  await adapter.chat(messages);
} catch (error) {
  if (error instanceof AuthenticationError) {
    // Handle auth error - show API key settings
  } else if (error instanceof RateLimitError) {
    // Handle rate limit - show retry time
  } else if (error instanceof ModelNotFoundError) {
    // Handle missing model - show model selection
  }
  
  // Get user-friendly message
  const message = getUserFriendlyMessage(error);
  console.error(message);
}
```

## Provider Events

ProviderManager emits events for provider changes:

```typescript
providerManager.on('provider-changed', ({ from, to }) => {
  console.log(`Switched from ${from} to ${to}`);
});

providerManager.on('privacy-mode-changed', ({ from, to }) => {
  console.log(`Privacy mode: ${from} → ${to}`);
});

providerManager.on('provider-added', (provider) => {
  console.log(`Added provider: ${provider.name}`);
});

providerManager.on('provider-removed', (providerId) => {
  console.log(`Removed provider: ${providerId}`);
});

providerManager.on('provider-updated', (provider) => {
  console.log(`Updated provider: ${provider.name}`);
});
```

## Troubleshooting

### Provider Not Available

If a provider is not available:

1. Check the provider is enabled in config
2. Verify API key is set (for cloud providers)
3. Check baseUrl is correct and reachable
4. Verify models are downloaded (for Ollama)

```typescript
const validation = await providerManager.validateProvider('openai-cloud');
if (!validation.valid) {
  console.error('Validation errors:', validation.errors);
}
```

### Model Not Found

If a model is not found:

1. Check model name is correct
2. For Ollama, pull the model: `ollama pull moondream:v2`
3. Verify model is listed in provider config

```typescript
const models = await adapter.getModels();
console.log('Available models:', models);
```

### API Key Issues

For cloud providers:

1. Verify API key is set in config
2. Check API key has correct permissions
3. Ensure API key is not expired

### Rate Limiting

If you hit rate limits:

1. Wait for the retry-after period
2. Consider using a different provider
3. Implement request queuing/throttling

## Best Practices

1. **Use Ollama by default** - It's private and free
2. **Validate providers** - Check availability before switching
3. **Handle errors gracefully** - Provide user-friendly messages
4. **Cache adapters** - ProviderManager caches adapter instances
5. **Monitor privacy mode** - Alert users when switching to cloud providers
6. **Test with multiple providers** - Ensure your code works with all adapters

## API Reference

### ProviderManager

```typescript
class ProviderManager {
  // Get adapter for active provider
  getProvider(providerId?: string): ILLMAdapter
  
  // Get adapter for specific task
  getProviderForTask(task: TaskType, providerId?: string): ILLMAdapter
  
  // Get model name for task
  getModelForTask(task: TaskType, providerId?: string): string
  
  // Switch active provider
  async switchProvider(providerId: string): Promise<void>
  
  // Add new provider
  async addProvider(provider: LLMProvider): Promise<void>
  
  // Remove provider
  async removeProvider(providerId: string): Promise<void>
  
  // Update provider config
  async updateProvider(providerId: string, updates: Partial<LLMProvider>): Promise<void>
  
  // Validate provider
  async validateProvider(providerId: string): Promise<{ valid: boolean; errors: string[] }>
  
  // Get all providers
  getAllProviders(): LLMProvider[]
  
  // Get active provider
  getActiveProvider(): LLMProvider
  
  // Get privacy mode
  getPrivacyMode(): PrivacyMode
  isPrivate(): boolean
  
  // Filter providers
  getProvidersByType(type: ProviderType): LLMProvider[]
  getProvidersByPrivacy(privacy: PrivacyMode): LLMProvider[]
  
  // Get default config
  static getDefaultConfig(): LLMConfig
}
```

### ConfigMigration

```typescript
class ConfigMigration {
  // Check if migration needed
  static needsMigration(config: any): boolean
  
  // Migrate old config
  static migrate(oldConfig: OldConfig): LLMConfig
  
  // Apply migration
  static applyMigration(config: any): any
  
  // Get migration summary
  static getMigrationSummary(oldConfig: OldConfig, newConfig: LLMConfig): string
}
```
