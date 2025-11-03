# LLM Provider System - Integration Guide

## Overview

The LLM Provider system is now **ready for integration**. This guide shows you how to wire it into your app.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    React UI                              │
│              (ProviderSettings Component)                │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│              Renderer Process                            │
│           (llmConfigService)                             │
└─────────────────────────────────────────────────────────┘
                           │ IPC
                           ▼
┌─────────────────────────────────────────────────────────┐
│               Main Process                               │
│          (LLMConfigHandler)                              │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│            User Data Directory                           │
│  ~/Library/Application Support/Cinestar/llm-config.json │
└─────────────────────────────────────────────────────────┘
```

## Step 1: Initialize in Main Process

In your main process entry point (e.g., `src/main/index.ts` or `main.ts`):

```typescript
import { initializeLLMConfigHandler } from './main/llm-config-handler';

// After app.whenReady()
app.whenReady().then(async () => {
  // ... your existing initialization ...
  
  // Initialize LLM config handler
  const llmConfigHandler = initializeLLMConfigHandler();
  await llmConfigHandler.initialize();
  
  // ... rest of your code ...
});
```

## Step 2: Add to Settings UI

Add the ProviderSettings component to your settings/preferences screen:

```typescript
// In your Settings.tsx or Preferences.tsx
import { ProviderSettings } from '../components/ProviderSettings';
import { llmConfigService } from '../services/llm-config-service';
import { useState, useEffect } from 'react';

export function SettingsPage() {
  const [userConfig, setUserConfig] = useState(null);
  
  useEffect(() => {
    // Load user config on mount
    llmConfigService.getUserConfig().then(setUserConfig);
  }, []);
  
  if (!userConfig) {
    return <div>Loading...</div>;
  }
  
  return (
    <div className="settings-page">
      <h1>Settings</h1>
      
      {/* Your existing settings sections */}
      
      {/* LLM Provider Settings */}
      <section className="llm-settings">
        <ProviderSettings
          activeProviderId={userConfig.activeProvider}
          onProviderChange={async (providerId) => {
            await llmConfigService.setActiveProvider(providerId);
            const updated = await llmConfigService.getUserConfig();
            setUserConfig(updated);
          }}
          onModelChange={async (task, modelId) => {
            await llmConfigService.setSelectedModel(
              userConfig.activeProvider,
              task,
              modelId
            );
            const updated = await llmConfigService.getUserConfig();
            setUserConfig(updated);
          }}
          onApiKeyChange={async (providerId, apiKey) => {
            await llmConfigService.setApiKey(providerId, apiKey);
            const updated = await llmConfigService.getUserConfig();
            setUserConfig(updated);
          }}
        />
      </section>
    </div>
  );
}
```

## Step 3: Use Privacy Indicator Anywhere

Add privacy indicators to your UI wherever LLM operations occur:

```typescript
import { PrivacyIndicator } from '../components/ProviderSettings';
import { llmConfigService } from '../services/llm-config-service';

export function VideoProcessingCard() {
  const [privacyMode, setPrivacyMode] = useState<'private' | 'cloud'>('private');
  
  useEffect(() => {
    llmConfigService.getActiveProvider().then(providerId => {
      // Ollama is private, others are cloud
      setPrivacyMode(providerId === 'ollama' ? 'private' : 'cloud');
    });
  }, []);
  
  return (
    <div className="card">
      <div className="card-header">
        <h3>Video Processing</h3>
        <PrivacyIndicator mode={privacyMode} size="sm" />
      </div>
      {/* ... rest of card ... */}
    </div>
  );
}
```

## Step 4: Use Selected Models in Processing

When you need to use an LLM model, get the user's selection:

```typescript
import { llmConfigService } from '../services/llm-config-service';
import { providerConfigManager } from '../core/llm/provider-config-manager';

async function processVideo(videoPath: string) {
  // Get active provider
  const activeProvider = await llmConfigService.getActiveProvider();
  
  // Get user's selected vision model
  const visionModel = await llmConfigService.getSelectedModel(
    activeProvider,
    'vision'
  );
  
  // Fallback to default if user hasn't selected one
  const modelToUse = visionModel || 
    providerConfigManager.getDefaultModel(activeProvider, 'vision');
  
  console.log(`Using ${modelToUse} from ${activeProvider} for video processing`);
  
  // Use the model...
}
```

## Step 5: Handle API Keys

When making LLM API calls, retrieve the user's API key:

```typescript
import { llmConfigService } from '../services/llm-config-service';

async function callOpenAI(prompt: string) {
  const apiKey = await llmConfigService.getApiKey('openai');
  
  if (!apiKey) {
    throw new Error('OpenAI API key not configured. Please add it in Settings.');
  }
  
  // Make API call with apiKey
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    // ... rest of request
  });
}
```

## Configuration Files

### Built-in Configs (Read-Only in ASAR)

These are bundled with your app and provide model listings:

```
app.asar/
└── src/core/llm/
    ├── openai-models-config.json    ← OpenAI models
    ├── ollama-models-config.json    ← Ollama models
    └── litellm-models-config.json   ← LiteLLM models
```

### User Config (Read-Write in userData)

User's selections and API keys are stored here:

```
~/Library/Application Support/Drillbit/  (macOS)
%APPDATA%/Drillbit/                      (Windows)
~/.config/Drillbit/                      (Linux)
└── llm-config.json
```

Example `llm-config.json`:

```json
{
  "version": "1.0.0",
  "activeProvider": "ollama",
  "providers": {
    "ollama": {
      "enabled": true,
      "selectedModels": {
        "vision": "moondream:v2",
        "text": "qwen3:4b",
        "embedding": "qllama/bge-large-en-v1.5:latest",
        "transcription": "whisper:latest"
      }
    },
    "openai": {
      "enabled": true,
      "apiKey": "sk-...",
      "selectedModels": {
        "vision": "gpt-4.1-mini",
        "text": "gpt-4.1",
        "embedding": "text-embedding-3-large",
        "transcription": "gpt-4o-transcribe"
      }
    }
  }
}
```

## API Reference

### llmConfigService Methods

```typescript
// Get full config
const config = await llmConfigService.getUserConfig();

// Get/Set active provider
const provider = await llmConfigService.getActiveProvider();
await llmConfigService.setActiveProvider('openai');

// Get/Set API key
const apiKey = await llmConfigService.getApiKey('openai');
await llmConfigService.setApiKey('openai', 'sk-...');

// Get/Set selected model
const model = await llmConfigService.getSelectedModel('openai', 'vision');
await llmConfigService.setSelectedModel('openai', 'vision', 'gpt-4.1-mini');

// Enable/Disable provider
await llmConfigService.setProviderEnabled('openai', true);
```

### providerConfigManager Methods

```typescript
import { providerConfigManager } from '../core/llm/provider-config-manager';

// Get provider config (model listings, etc.)
const config = providerConfigManager.getConfig('openai');

// Get default model
const defaultVision = providerConfigManager.getDefaultModel('openai', 'vision');

// Get all models for a capability
const visionModels = providerConfigManager.getModelsByCapability('openai', 'vision');

// Get models by category
const frontierModels = providerConfigManager.getModelsByCategory('openai', 'frontier');

// Check if API key required
const needsKey = providerConfigManager.requiresApiKey('openai'); // true

// Get docs URL
const docsUrl = providerConfigManager.getDocsUrl('openai');
```

## Testing in Development

1. **Start your app in dev mode**
2. **Open Settings** and navigate to LLM Provider Settings
3. **Select a provider** (Ollama for local, OpenAI for cloud)
4. **Configure models** for different tasks
5. **Add API key** if using cloud provider
6. **Check privacy indicator** updates correctly

## Testing in Production (ASAR)

1. **Build your app**: `npm run build` or `make build`
2. **Install and run** the packaged app
3. **Verify config location**:
   - macOS: `~/Library/Application Support/Drillbit/llm-config.json`
   - Windows: `%APPDATA%/Drillbit/llm-config.json`
   - Linux: `~/.config/Drillbit/llm-config.json`
4. **Test settings persistence** across app restarts
5. **Verify built-in configs** are read from ASAR correctly

## Troubleshooting

### Config not persisting
- Check userData directory exists and is writable
- Check console for `[LLM-CONFIG]` error messages
- Verify LLMConfigHandler is initialized in main process

### Models not showing
- Check built-in JSON configs are bundled in ASAR
- Verify providerConfigManager is loading configs correctly
- Check browser console for errors

### API keys not working
- Verify API key is saved in llm-config.json
- Check API key is retrieved correctly before API calls
- Test API key directly with curl/Postman

### Privacy indicator not updating
- Ensure you're calling `getActiveProvider()` to determine mode
- Check that provider changes trigger state updates
- Verify PrivacyIndicator receives correct mode prop

## Next Steps

Once integrated, you can:

1. **Update existing LLM calls** to use selected models
2. **Add provider switching** to your UI
3. **Implement model fallbacks** for resilience
4. **Add usage tracking** per provider
5. **Create provider health checks**

## Files Created

- ✅ `src/core/llm/user-config.types.ts` - User config types
- ✅ `src/main/llm-config-handler.ts` - Main process IPC handler
- ✅ `src/services/llm-config-service.ts` - Renderer service
- ✅ `src/types/global.d.ts` - Updated with electron.invoke types
- ✅ `docs/LLM_PROVIDER_INTEGRATION_GUIDE.md` - This guide

## Summary

The LLM Provider system is **production-ready** and handles ASAR correctly by:

1. **Built-in configs** stay in ASAR (read-only)
2. **User settings** go to userData (read-write)
3. **IPC bridge** connects renderer to main process
4. **Service layer** provides clean API for React components

Just follow the 5 steps above to integrate into your app! 🚀
