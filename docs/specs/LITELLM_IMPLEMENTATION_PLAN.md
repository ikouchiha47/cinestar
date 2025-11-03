# LiteLLM Provider System - Implementation Plan

## Overview
Add flexible LLM provider system supporting both local (Ollama) and cloud (via LiteLLM) providers while maintaining privacy-first philosophy.

---

## Architecture

### Core Components Created ✅

1. **`src/core/llm/types.ts`** - Type definitions
   - `ILLMAdapter` interface
   - Provider types and configs
   - Message/response types

2. **`src/core/llm/ollama-adapter.ts`** - Ollama wrapper
   - Implements `ILLMAdapter`
   - Wraps existing Ollama functionality
   - Local, private processing

3. **`src/core/llm/litellm-adapter.ts`** - LiteLLM integration
   - Implements `ILLMAdapter`
   - Supports cloud providers (OpenAI, Anthropic, etc.)
   - Configurable base URL and API keys

4. **`src/core/llm/provider-manager.ts`** - Provider orchestration
   - Manages multiple providers
   - Switches between providers
   - Tracks privacy mode
   - Emits events for UI updates

---

## Configuration Schema

### Default Config (Local-First)

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
            { "task": "embedding", "modelName": "qllama/bge-large-en-v1.5:latest" },
            { "task": "text", "modelName": "qwen3:4b" }
          ]
        }
      }
    }
  }
}
```

### Example: Adding LiteLLM Cloud Provider

```json
{
  "llm": {
    "providers": {
      "litellm-openai": {
        "id": "litellm-openai",
        "name": "OpenAI (Cloud)",
        "type": "cloud",
        "adapter": "litellm",
        "privacy": "cloud",
        "config": {
          "baseUrl": "http://localhost:4000",
          "apiKey": "sk-...",
          "models": [
            { "task": "vision", "modelName": "gpt-4-vision-preview" },
            { "task": "embedding", "modelName": "text-embedding-3-large" },
            { "task": "text", "modelName": "gpt-4-turbo" }
          ]
        }
      }
    }
  }
}
```

### Example: LiteLLM with Local Models

```json
{
  "llm": {
    "providers": {
      "litellm-local": {
        "id": "litellm-local",
        "name": "LiteLLM (Local)",
        "type": "local",
        "adapter": "litellm",
        "privacy": "private",
        "config": {
          "baseUrl": "http://localhost:4000",
          "models": [
            { "task": "vision", "modelName": "ollama/moondream:v2" },
            { "task": "embedding", "modelName": "ollama/bge-large-en-v1.5" },
            { "task": "text", "modelName": "ollama/qwen3:4b" }
          ]
        }
      }
    }
  }
}
```

---

## Implementation Steps

### Phase 1: Core Infrastructure ✅ (Completed)

- [x] Create type definitions (`types.ts`)
- [x] Create Ollama adapter (`ollama-adapter.ts`)
- [x] Create LiteLLM adapter (`litellm-adapter.ts`)
- [x] Create Provider Manager (`provider-manager.ts`)
- [x] Write ADR document

### Phase 2: Config Integration (Next)

- [ ] Update `src/core/config.ts` to include LLM config
- [ ] Add default provider config
- [ ] Add config migration for existing users
- [ ] Initialize ProviderManager in main process

### Phase 3: Update Existing LLM Calls

**Files to Update**:
- [ ] `src/core/image-job-processor.ts` - Use ProviderManager for captions
- [ ] `src/core/video-job-processor.ts` - Use ProviderManager for vision
- [ ] `src/core/embedding-service.ts` - Use ProviderManager for embeddings
- [ ] Any other files using Ollama directly

**Pattern**:
```typescript
// OLD
const ollama = new Ollama();
const response = await ollama.generate({...});

// NEW
const provider = providerManager.getProviderForTask('vision');
const model = providerManager.getModelForTask('vision');
const response = await provider.vision(imageUrl, prompt, { model });
```

### Phase 4: UI Components

#### 4.1 Provider Settings Panel

**File**: `src/components/settings/ProviderSettings.tsx`

**Features**:
- List all providers
- Show active provider
- Privacy mode indicator
- Switch provider button
- Add/edit/remove providers

#### 4.2 Add Provider Dialog

**File**: `src/components/settings/AddProviderDialog.tsx`

**Features**:
- Provider name input
- Type selection (local/cloud)
- Base URL input
- API key input (for cloud)
- Model mappings
- Privacy warning for cloud providers

#### 4.3 Privacy Mode Indicator

**File**: `src/components/PrivacyModeIndicator.tsx`

**Features**:
- Fixed position indicator when in cloud mode
- Shows "Cloud Mode Active" badge
- Orange/warning color scheme
- Disappears in private mode

#### 4.4 Background Visual Changes

**Update**: Main layout components

**Changes**:
- Private mode: Green/neutral gradient
- Cloud mode: Orange/warning tint
- Subtle background change to indicate privacy state

### Phase 5: LiteLLM Setup Documentation

**File**: `docs/LITELLM_SETUP.md`

**Content**:
- How to install LiteLLM
- How to configure LiteLLM proxy
- Example configs for popular providers
- Security best practices

---

## Usage Examples

### Basic Usage (Default - Ollama)

```typescript
import { ProviderManager } from './core/llm/provider-manager';

// Initialize with config
const config = await getConfig();
const providerManager = new ProviderManager(config.llm);

// Use default provider
const provider = providerManager.getProvider();
const response = await provider.chat([
  { role: 'user', content: 'Hello!' }
]);
```

### Task-Specific Provider

```typescript
// Get provider for vision task
const visionProvider = providerManager.getProviderForTask('vision');
const model = providerManager.getModelForTask('vision');

const caption = await visionProvider.vision(
  'file:///path/to/image.jpg',
  'Describe this image',
  { model }
);
```

### Switching Providers

```typescript
// Switch to cloud provider
await providerManager.switchProvider('litellm-openai');

// Listen for privacy mode changes
providerManager.on('privacy-mode-changed', ({ from, to }) => {
  console.log(`Privacy mode changed: ${from} → ${to}`);
  updateUI(to);
});
```

### Adding Custom Provider

```typescript
const newProvider = {
  id: 'my-custom-provider',
  name: 'My Custom Provider',
  type: 'cloud',
  adapter: 'litellm',
  privacy: 'cloud',
  config: {
    baseUrl: 'http://my-litellm-server:4000',
    apiKey: 'my-api-key',
    models: [
      { task: 'vision', modelName: 'gpt-4-vision' },
      { task: 'embedding', modelName: 'text-embedding-3-large' },
      { task: 'text', modelName: 'gpt-4' }
    ]
  }
};

await providerManager.addProvider(newProvider);
```

---

## Privacy Mode Indicators

### Visual Changes

| Mode | Background | Indicator | Color Scheme |
|------|-----------|-----------|--------------|
| Private | Neutral gradient | None | Green accents |
| Cloud | Orange tint | "Cloud Mode" badge | Orange/warning |

### UI Examples

**Private Mode**:
```tsx
<div className="bg-gradient-to-br from-neutral-950 via-neutral-900 to-neutral-950">
  {/* No indicator shown */}
</div>
```

**Cloud Mode**:
```tsx
<div className="bg-gradient-to-br from-orange-950/20 via-neutral-900 to-orange-950/20">
  <div className="fixed top-4 right-4 bg-orange-500/90 text-white px-4 py-2 rounded-full">
    <Cloud className="w-4 h-4" />
    <span>Cloud Mode Active</span>
  </div>
</div>
```

---

## LiteLLM Setup Guide

### Installation

```bash
pip install litellm[proxy]
```

### Configuration

**`litellm_config.yaml`**:
```yaml
model_list:
  # OpenAI
  - model_name: gpt-4-vision-preview
    litellm_params:
      model: gpt-4-vision-preview
      api_key: os.environ/OPENAI_API_KEY
  
  - model_name: text-embedding-3-large
    litellm_params:
      model: text-embedding-3-large
      api_key: os.environ/OPENAI_API_KEY
  
  # Local Ollama (proxied through LiteLLM)
  - model_name: ollama/moondream:v2
    litellm_params:
      model: ollama/moondream:v2
      api_base: http://localhost:11434
  
  - model_name: ollama/bge-large-en-v1.5
    litellm_params:
      model: ollama/bge-large-en-v1.5
      api_base: http://localhost:11434
```

### Start LiteLLM Proxy

```bash
litellm --config litellm_config.yaml --port 4000
```

### Test Connection

```bash
curl http://localhost:4000/health
curl http://localhost:4000/models
```

---

## Migration Plan (Future Release)

### Cloud → Local Migration

**Scenario**: User wants to switch from cloud back to local processing

**Steps**:
1. Switch provider to local
2. Identify cloud-processed content
3. Reprocess with local models
4. Verify all content is local
5. Remove cloud provider

**Implementation** (future):
```typescript
class CloudToLocalMigration {
  async migrate() {
    // 1. Switch to local
    await providerManager.switchProvider('ollama-local');
    
    // 2. Find cloud-processed items
    const cloudItems = await db.query(`
      SELECT * FROM media_items 
      WHERE processing_provider LIKE 'litellm-%'
    `);
    
    // 3. Reprocess
    for (const item of cloudItems) {
      await reprocessItem(item);
    }
    
    // 4. Cleanup
    await providerManager.removeProvider('litellm-openai');
  }
}
```

---

## Security Considerations

### API Key Storage

**Current**: Store in config file (encrypted at rest)

**Future**: 
- Use system keychain
- Environment variables
- Secure vault integration

### Privacy Warnings

**Required Warnings**:
- When adding cloud provider
- When switching to cloud provider
- When processing first item with cloud
- In settings UI

**Warning Text**:
```
⚠️ Privacy Notice

Using cloud providers will send your media files and search queries 
to external services. Make sure you:

1. Trust the provider
2. Understand their privacy policy
3. Are comfortable with data leaving your device
4. Comply with any data regulations

You can switch back to local processing at any time.
```

---

## Testing Plan

### Unit Tests

- [ ] Test OllamaAdapter
- [ ] Test LiteLLMAdapter
- [ ] Test ProviderManager
- [ ] Test provider switching
- [ ] Test privacy mode tracking

### Integration Tests

- [ ] Test with real Ollama
- [ ] Test with LiteLLM proxy
- [ ] Test provider switching during processing
- [ ] Test config persistence

### UI Tests

- [ ] Test provider settings panel
- [ ] Test add provider dialog
- [ ] Test privacy mode indicator
- [ ] Test visual changes

---

## Documentation Needed

1. **User Guide**:
   - How to add providers
   - How to switch providers
   - Privacy implications
   - LiteLLM setup

2. **Developer Guide**:
   - Provider architecture
   - Adding new adapters
   - Extending provider types

3. **ADR** ✅:
   - Design decisions
   - Trade-offs
   - Future considerations

---

## Timeline

| Phase | Duration | Status |
|-------|----------|--------|
| Core Infrastructure | 1 day | ✅ Complete |
| Config Integration | 1 day | ⏳ Pending |
| Update LLM Calls | 2 days | ⏳ Pending |
| UI Components | 2 days | ⏳ Pending |
| Documentation | 1 day | ⏳ Pending |
| Testing | 2 days | ⏳ Pending |
| **Total** | **9 days** | **11% Complete** |

---

## Next Steps

1. ✅ Create core infrastructure (DONE)
2. Update config.ts with LLM config schema
3. Initialize ProviderManager in main process
4. Update image-job-processor to use ProviderManager
5. Create provider settings UI
6. Add privacy mode indicators
7. Write documentation
8. Test with LiteLLM

---

## Benefits

✅ **Flexibility**: Support any LLM provider via LiteLLM
✅ **Privacy-First**: Default to local, opt-in to cloud
✅ **Clear Indicators**: Users always know privacy state
✅ **Easy Setup**: Simple config, no code changes
✅ **Future-Proof**: Easy to add new providers
✅ **Migration Path**: Can switch back to local anytime

---

## Status: Phase 1 Complete ✅

**Created**:
- ✅ Type definitions
- ✅ Ollama adapter
- ✅ LiteLLM adapter
- ✅ Provider manager
- ✅ ADR document
- ✅ Implementation plan

**Ready for**: Config integration and UI development

🚀 **Foundation is solid - ready to build on!**
