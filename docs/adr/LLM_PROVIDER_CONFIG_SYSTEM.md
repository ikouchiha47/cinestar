# LLM Provider Configuration System

## Overview

The LLM Provider Configuration System provides a structured way to manage multiple LLM providers, their models, API keys, and capabilities. This system makes it easy to add new providers, display model options to users, and manage provider-specific settings.

## Architecture

### Core Components

1. **Provider Configuration Files** (`*.json`)
   - Define provider metadata, API endpoints, and available models
   - Categorize models by use case (vision, text, embedding, etc.)
   - Specify defaults and model capabilities

2. **Type Definitions** (`provider-config.types.ts`)
   - TypeScript interfaces for type-safe configuration
   - Ensures consistency across provider configs

3. **Configuration Manager** (`provider-config-manager.ts`)
   - Singleton service for accessing provider configurations
   - Provides helper methods for querying models and capabilities
   - Supports custom provider configurations

4. **UI Components**
   - `ModelSelector`: Display and select models from a provider
   - `ApiKeyManager`: Secure API key input and management

## Configuration Structure

### Provider Configuration Schema

```typescript
{
  "provider": "openai",              // Unique provider ID
  "name": "OpenAI",                  // Display name
  "baseUrl": "https://api.openai.com/v1",  // API base URL
  "docsUrl": "https://platform.openai.com/docs/models",  // Documentation link
  
  "apiKey": {
    "required": true,                // Whether API key is required
    "editable": true,                // Whether user can edit the key
    "envVar": "OPENAI_API_KEY",     // Environment variable name
    "label": "OpenAI API Key",       // Display label
    "placeholder": "sk-..."          // Input placeholder
  },
  
  "defaults": {
    "vision": "gpt-4.1-mini",        // Default model for vision tasks
    "text": "gpt-4.1",               // Default model for text generation
    "embedding": "text-embedding-3-large",  // Default embedding model
    "transcription": "gpt-4o-transcribe"   // Default transcription model
  },
  
  "categories": {
    "vision": {
      "label": "Vision Models",
      "description": "Models with image understanding capabilities",
      "models": [
        {
          "id": "gpt-4.1-mini",
          "name": "GPT-4.1 mini",
          "description": "Smaller, faster version of GPT-4.1 with vision",
          "capabilities": ["text", "vision", "function-calling"],
          "contextWindow": 128000,
          "default": true
        }
      ]
    }
  }
}
```

## OpenAI Configuration

### Defaults
- **Vision**: `gpt-4.1-mini` (balanced performance and cost)
- **Text**: `gpt-4.1` (high-quality text generation)
- **Embedding**: `text-embedding-3-large` (most capable embeddings)
- **Transcription**: `gpt-4o-transcribe` (high-quality speech-to-text)

### Categories

#### Vision Models (Max 3 shown)
1. **gpt-4.1-mini** (Default) - Smaller, faster with vision
2. **gpt-4.1** - Smartest non-reasoning model
3. **gpt-4.1-nano** - Fastest, most cost-efficient

#### Transcription Models (Max 3 shown)
1. **gpt-4o-transcribe** (Default) - High-quality transcription
2. **gpt-4o-mini-transcribe** - Cost-efficient transcription
3. **gpt-4o-transcribe-diarize** - With speaker identification

#### Frontier Models (Max 3 shown)
1. **gpt-5** - Best for coding and agentic tasks
2. **gpt-5-mini** - Faster, cost-efficient GPT-5
3. **gpt-5-nano** - Fastest GPT-5 variant

#### Realtime Models (Max 3 shown)
1. **gpt-realtime** - Realtime text and audio
2. **gpt-realtime-mini** - Cost-efficient realtime
3. **gpt-4o-realtime-preview** - Preview realtime model

#### Reasoning Models (Max 3 shown)
1. **o3** - Complex reasoning tasks
2. **o4-mini** - Fast reasoning
3. **o3-pro** - Enhanced reasoning with more compute

#### Embedding Models (Max 3 shown)
1. **text-embedding-3-large** (Default) - Most capable
2. **text-embedding-3-small** - Smaller, faster
3. **text-embedding-ada-002** - Legacy model

## Ollama Configuration

### Defaults
- **Vision**: `moondream:v2` (efficient local vision model)
- **Text**: `qwen3:4b` (fast 4B parameter model)
- **Embedding**: `qllama/bge-large-en-v1.5:latest` (high-quality embeddings)

### Categories

#### Vision Models (Max 3 shown)
1. **moondream:v2** (Default) - Efficient vision-language model
2. **llava:latest** - Large Language and Vision Assistant
3. **bakllava:latest** - Mistral-based vision model

#### Text Models (Max 3 shown)
1. **qwen3:4b** (Default) - Fast 4B parameter model
2. **llama3.2:latest** - Meta's latest Llama
3. **mistral:latest** - High-quality from Mistral AI

#### Embedding Models (Max 3 shown)
1. **qllama/bge-large-en-v1.5:latest** (Default) - High-quality embeddings
2. **nomic-embed-text:latest** - Nomic's embedding model
3. **mxbai-embed-large:latest** - Large embedding model

## Usage Examples

### Using the Configuration Manager

```typescript
import { providerConfigManager } from './core/llm/provider-config-manager';

// Get provider configuration
const openaiConfig = providerConfigManager.getConfig('openai');

// Get default model for a task
const defaultVisionModel = providerConfigManager.getDefaultModel('openai', 'vision');
// Returns: "gpt-4.1-mini"

// Get all models with a specific capability
const visionModels = providerConfigManager.getModelsByCapability('openai', 'vision');

// Get models in a category
const transcriptionModels = providerConfigManager.getModelsByCategory('openai', 'transcription');

// Check if API key is required
const requiresKey = providerConfigManager.requiresApiKey('openai');
// Returns: true

// Get documentation URL
const docsUrl = providerConfigManager.getDocsUrl('openai');
// Returns: "https://platform.openai.com/docs/models"
```

### Using the Model Selector Component

```tsx
import { ModelSelector } from './components/ModelSelector';

function MyComponent() {
  const [selectedModel, setSelectedModel] = useState('gpt-4.1-mini');

  return (
    <ModelSelector
      providerId="openai"
      selectedModelId={selectedModel}
      onModelSelect={setSelectedModel}
      filterByCapability="vision"
      showCategories={true}
      maxModelsPerCategory={3}
    />
  );
}
```

### Using the API Key Manager Component

```tsx
import { ApiKeyManager } from './components/ApiKeyManager';

function MyComponent() {
  const [apiKey, setApiKey] = useState('');

  const validateApiKey = async (key: string): Promise<boolean> => {
    // Validate the API key with the provider
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: { 'Authorization': `Bearer ${key}` }
    });
    return response.ok;
  };

  return (
    <ApiKeyManager
      providerId="openai"
      currentApiKey={apiKey}
      onApiKeyChange={setApiKey}
      onValidate={validateApiKey}
    />
  );
}
```

## Adding a New Provider

### 1. Create Configuration File

Create a new JSON file (e.g., `anthropic-models-config.json`):

```json
{
  "provider": "anthropic",
  "name": "Anthropic",
  "baseUrl": "https://api.anthropic.com/v1",
  "docsUrl": "https://docs.anthropic.com/claude/docs",
  "apiKey": {
    "required": true,
    "editable": true,
    "envVar": "ANTHROPIC_API_KEY",
    "label": "Anthropic API Key",
    "placeholder": "sk-ant-..."
  },
  "defaults": {
    "text": "claude-3-5-sonnet-20241022",
    "vision": "claude-3-5-sonnet-20241022"
  },
  "categories": {
    "text": {
      "label": "Text Models",
      "description": "Claude models for text generation",
      "models": [
        {
          "id": "claude-3-5-sonnet-20241022",
          "name": "Claude 3.5 Sonnet",
          "description": "Most intelligent Claude model",
          "capabilities": ["text", "vision"],
          "contextWindow": 200000,
          "default": true
        }
      ]
    }
  }
}
```

### 2. Register in Configuration Manager

Update `provider-config-manager.ts`:

```typescript
import anthropicConfig from './anthropic-models-config.json';

private loadBuiltInConfigs(): void {
  this.configs.set('openai', openaiConfig as ProviderConfig);
  this.configs.set('ollama', ollamaConfig as ProviderConfig);
  this.configs.set('anthropic', anthropicConfig as ProviderConfig);
}
```

### 3. Create Adapter (if needed)

If the provider uses a different API format, create an adapter:

```typescript
export class AnthropicAdapter implements ILLMAdapter {
  // Implement adapter methods
}
```

## Custom Provider Support

Users can add custom providers at runtime:

```typescript
const customProvider: ProviderConfig = {
  provider: "custom-llm",
  name: "My Custom LLM",
  baseUrl: "https://my-llm-api.com",
  docsUrl: "https://docs.my-llm.com",
  apiKey: {
    required: true,
    editable: true,
    label: "Custom LLM API Key"
  },
  defaults: {
    text: "my-model-v1"
  },
  categories: {
    text: {
      label: "Text Models",
      description: "Custom text models",
      models: [
        {
          id: "my-model-v1",
          name: "My Model v1",
          description: "Custom model",
          capabilities: ["text"],
          default: true
        }
      ]
    }
  }
};

providerConfigManager.setCustomConfig(customProvider);
```

## API Key Management

### Security Features

1. **Local Storage**: API keys are stored locally, never sent to external services
2. **Masked Input**: Keys are hidden by default with toggle visibility
3. **Validation**: Optional async validation before saving
4. **Environment Variables**: Support for system-level configuration
5. **Editable Control**: Some providers may have system-managed keys

### Best Practices

- Always validate API keys before saving
- Use environment variables for production deployments
- Provide clear error messages for invalid keys
- Show security warnings to users
- Support key rotation without app restart

## Model Selection UI

### Features

1. **Categorized Display**: Models grouped by use case
2. **Search**: Filter models by name, description, or ID
3. **Expandable Categories**: Show/hide category details
4. **Default Indicators**: Highlight recommended models
5. **Capability Tags**: Show what each model can do
6. **Context Info**: Display context window and dimensions
7. **Documentation Links**: Direct link to provider docs

### Customization

- `maxModelsPerCategory`: Limit displayed models (default: 3)
- `filterByCapability`: Show only models with specific capability
- `showCategories`: Toggle categorized vs flat view

## Integration with Existing System

The new configuration system integrates with the existing LLM provider system:

```typescript
// Old: ProviderConfig (runtime configuration)
interface ProviderRuntimeConfig {
  baseUrl?: string;
  apiKey?: string;
  models: ModelMapping[];
}

// New: ProviderConfig (static configuration)
interface ProviderConfig {
  provider: string;
  name: string;
  baseUrl: string;
  categories: Record<string, ModelCategory>;
}
```

The configuration manager provides the static model listings and metadata, while the runtime config manages the active connection settings.

## Future Enhancements

1. **Model Comparison**: Side-by-side model comparison UI
2. **Cost Estimation**: Show estimated costs per model
3. **Performance Metrics**: Display latency and throughput data
4. **Auto-Discovery**: Automatically detect available models from API
5. **Model Aliases**: Support for model name aliases
6. **Version Management**: Track and manage model versions
7. **Usage Analytics**: Track which models are used most
8. **Provider Health**: Monitor provider availability

## Files Created

1. `src/core/llm/openai-models-config.json` - OpenAI model configuration
2. `src/core/llm/ollama-models-config.json` - Ollama model configuration
3. `src/core/llm/provider-config.types.ts` - TypeScript type definitions
4. `src/core/llm/provider-config-manager.ts` - Configuration management service
5. `src/components/ModelSelector.tsx` - Model selection UI component
6. `src/components/ApiKeyManager.tsx` - API key management UI component

## Related Documentation

- [ADR-012: LiteLLM Provider System](./adr/ADR-012-litellm-provider-system.md)
- [LiteLLM Implementation Plan](../LITELLM_IMPLEMENTATION_PLAN.md)
- [OpenAI Models Documentation](https://platform.openai.com/docs/models)
- [Ollama Library](https://ollama.ai/library)
