# ADR-012: LiteLLM Provider System with Privacy Modes

## Status
Proposed

## Context
Drillbit is currently "local-first" with Ollama as the only LLM provider. Users want flexibility to:
- Use cloud providers (OpenAI, Anthropic, etc.) via LiteLLM
- Configure custom base URLs and API keys
- Mix local and cloud models for different tasks
- Understand privacy implications when using cloud services

## Decision

### 1. Provider Architecture

**Multi-Provider System**:
```typescript
interface LLMProvider {
  id: string;
  name: string;
  type: 'local' | 'cloud';
  adapter: 'ollama' | 'litellm';
  config: ProviderConfig;
  privacy: 'private' | 'cloud';
}

interface ProviderConfig {
  baseUrl?: string;
  apiKey?: string;
  models: ModelMapping[];
  timeout?: number;
  retries?: number;
}

interface ModelMapping {
  task: 'vision' | 'embedding' | 'text' | 'transcription';
  modelName: string;
  displayName?: string;
}
```

### 2. Configuration Schema

**Config Structure**:
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
      },
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
      },
      "litellm-local": {
        "id": "litellm-local",
        "name": "LiteLLM (Local Models)",
        "type": "local",
        "adapter": "litellm",
        "privacy": "private",
        "config": {
          "baseUrl": "http://localhost:4000",
          "models": [
            { "task": "vision", "modelName": "ollama/moondream:v2" },
            { "task": "embedding", "modelName": "ollama/bge-large-en-v1.5" }
          ]
        }
      }
    }
  }
}
```

### 3. LiteLLM Adapter

**Implementation**:
```typescript
// src/core/llm/litellm-adapter.ts
export class LiteLLMAdapter implements ILLMAdapter {
  private baseUrl: string;
  private apiKey?: string;
  
  constructor(config: ProviderConfig) {
    this.baseUrl = config.baseUrl || 'http://localhost:4000';
    this.apiKey = config.apiKey;
  }
  
  async chat(messages: Message[], options?: ChatOptions): Promise<string> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey && { 'Authorization': `Bearer ${this.apiKey}` })
      },
      body: JSON.stringify({
        model: options?.model || 'gpt-4',
        messages,
        temperature: options?.temperature || 0.7,
        max_tokens: options?.maxTokens
      })
    });
    
    const data = await response.json();
    return data.choices[0].message.content;
  }
  
  async embed(text: string, options?: EmbedOptions): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey && { 'Authorization': `Bearer ${this.apiKey}` })
      },
      body: JSON.stringify({
        model: options?.model || 'text-embedding-3-large',
        input: text
      })
    });
    
    const data = await response.json();
    return data.data[0].embedding;
  }
  
  async vision(imageUrl: string, prompt: string, options?: VisionOptions): Promise<string> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey && { 'Authorization': `Bearer ${this.apiKey}` })
      },
      body: JSON.stringify({
        model: options?.model || 'gpt-4-vision-preview',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageUrl } }
          ]
        }]
      })
    });
    
    const data = await response.json();
    return data.choices[0].message.content;
  }
}
```

### 4. Provider Manager

**Centralized Provider Management**:
```typescript
// src/core/llm/provider-manager.ts
export class ProviderManager {
  private providers: Map<string, LLMProvider>;
  private activeProviderId: string;
  
  constructor(config: Config) {
    this.providers = new Map();
    this.loadProviders(config.llm.providers);
    this.activeProviderId = config.llm.activeProvider;
  }
  
  getProvider(providerId?: string): ILLMAdapter {
    const id = providerId || this.activeProviderId;
    const provider = this.providers.get(id);
    
    if (!provider) {
      throw new Error(`Provider ${id} not found`);
    }
    
    return this.createAdapter(provider);
  }
  
  private createAdapter(provider: LLMProvider): ILLMAdapter {
    switch (provider.adapter) {
      case 'ollama':
        return new OllamaAdapter(provider.config);
      case 'litellm':
        return new LiteLLMAdapter(provider.config);
      default:
        throw new Error(`Unknown adapter: ${provider.adapter}`);
    }
  }
  
  async switchProvider(providerId: string): Promise<void> {
    if (!this.providers.has(providerId)) {
      throw new Error(`Provider ${providerId} not found`);
    }
    
    this.activeProviderId = providerId;
    await this.saveConfig();
    
    // Emit privacy mode change event
    const provider = this.providers.get(providerId)!;
    this.emitPrivacyModeChange(provider.privacy);
  }
  
  getPrivacyMode(): 'private' | 'cloud' {
    const provider = this.providers.get(this.activeProviderId);
    return provider?.privacy || 'private';
  }
  
  isPrivate(): boolean {
    return this.getPrivacyMode() === 'private';
  }
}
```

### 5. UI Components

#### Settings Panel

**Provider Settings UI**:
```tsx
// src/components/settings/ProviderSettings.tsx
export function ProviderSettings() {
  const [providers, setProviders] = useState<LLMProvider[]>([]);
  const [activeProvider, setActiveProvider] = useState<string>('');
  const [privacyMode, setPrivacyMode] = useState<'private' | 'cloud'>('private');
  
  return (
    <div className="space-y-6">
      {/* Privacy Mode Indicator */}
      <div className={`p-4 rounded-lg border-2 ${
        privacyMode === 'private' 
          ? 'bg-green-500/10 border-green-500' 
          : 'bg-orange-500/10 border-orange-500'
      }`}>
        <div className="flex items-center gap-3">
          {privacyMode === 'private' ? (
            <>
              <Shield className="w-6 h-6 text-green-500" />
              <div>
                <h3 className="font-semibold text-green-400">Private Mode</h3>
                <p className="text-sm text-neutral-400">
                  All processing happens locally on your device
                </p>
              </div>
            </>
          ) : (
            <>
              <Cloud className="w-6 h-6 text-orange-500" />
              <div>
                <h3 className="font-semibold text-orange-400">Cloud Mode</h3>
                <p className="text-sm text-neutral-400">
                  Your data is sent to external services for processing
                </p>
              </div>
            </>
          )}
        </div>
      </div>
      
      {/* Provider Selection */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-white">AI Provider</h3>
        
        {providers.map(provider => (
          <div
            key={provider.id}
            className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
              activeProvider === provider.id
                ? 'bg-blue-500/10 border-blue-500'
                : 'bg-neutral-800/30 border-neutral-700 hover:border-neutral-600'
            }`}
            onClick={() => handleProviderChange(provider.id)}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {provider.type === 'local' ? (
                  <Server className="w-5 h-5 text-green-500" />
                ) : (
                  <Cloud className="w-5 h-5 text-orange-500" />
                )}
                <div>
                  <h4 className="font-medium text-white">{provider.name}</h4>
                  <p className="text-sm text-neutral-400">
                    {provider.type === 'local' ? 'Local processing' : 'Cloud API'}
                  </p>
                </div>
              </div>
              
              {activeProvider === provider.id && (
                <Check className="w-5 h-5 text-blue-500" />
              )}
            </div>
            
            {/* Model Mappings */}
            <div className="mt-3 space-y-1">
              {provider.config.models.map(model => (
                <div key={model.task} className="text-xs text-neutral-500">
                  {model.task}: {model.modelName}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      
      {/* Add Custom Provider */}
      <button
        className="w-full p-3 rounded-lg border-2 border-dashed border-neutral-700 hover:border-blue-500 transition-colors"
        onClick={() => setShowAddProvider(true)}
      >
        <Plus className="w-5 h-5 mx-auto text-neutral-500" />
        <span className="text-sm text-neutral-400">Add Custom Provider</span>
      </button>
    </div>
  );
}
```

#### Add Provider Dialog

```tsx
// src/components/settings/AddProviderDialog.tsx
export function AddProviderDialog({ onClose, onSave }) {
  const [config, setConfig] = useState({
    name: '',
    type: 'local',
    adapter: 'litellm',
    baseUrl: 'http://localhost:4000',
    apiKey: '',
    models: []
  });
  
  return (
    <Dialog>
      <DialogTitle>Add Custom Provider</DialogTitle>
      
      <div className="space-y-4">
        {/* Provider Name */}
        <Input
          label="Provider Name"
          value={config.name}
          onChange={(e) => setConfig({ ...config, name: e.target.value })}
          placeholder="My Custom Provider"
        />
        
        {/* Type Selection */}
        <RadioGroup
          label="Provider Type"
          value={config.type}
          onChange={(value) => setConfig({ ...config, type: value })}
        >
          <Radio value="local">
            <Shield className="w-4 h-4" />
            Local (Private)
          </Radio>
          <Radio value="cloud">
            <Cloud className="w-4 h-4" />
            Cloud (External API)
          </Radio>
        </RadioGroup>
        
        {/* Base URL */}
        <Input
          label="Base URL"
          value={config.baseUrl}
          onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
          placeholder="http://localhost:4000"
        />
        
        {/* API Key (optional) */}
        {config.type === 'cloud' && (
          <Input
            label="API Key"
            type="password"
            value={config.apiKey}
            onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
            placeholder="sk-..."
          />
        )}
        
        {/* Model Mappings */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-white">Model Mappings</label>
          
          <ModelMapping
            task="vision"
            value={config.models.find(m => m.task === 'vision')?.modelName}
            onChange={(modelName) => updateModel('vision', modelName)}
            placeholder="gpt-4-vision-preview"
          />
          
          <ModelMapping
            task="embedding"
            value={config.models.find(m => m.task === 'embedding')?.modelName}
            onChange={(modelName) => updateModel('embedding', modelName)}
            placeholder="text-embedding-3-large"
          />
          
          <ModelMapping
            task="text"
            value={config.models.find(m => m.task === 'text')?.modelName}
            onChange={(modelName) => updateModel('text', modelName)}
            placeholder="gpt-4-turbo"
          />
        </div>
        
        {/* Privacy Warning */}
        {config.type === 'cloud' && (
          <Alert variant="warning">
            <AlertTriangle className="w-4 h-4" />
            <AlertTitle>Privacy Notice</AlertTitle>
            <AlertDescription>
              Using cloud providers will send your media and queries to external services.
              Make sure you trust the provider and understand their privacy policy.
            </AlertDescription>
          </Alert>
        )}
      </div>
      
      <DialogActions>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={() => onSave(config)}>Add Provider</Button>
      </DialogActions>
    </Dialog>
  );
}
```

### 6. Visual Privacy Indicators

**Global Privacy Mode Indicator**:
```tsx
// src/components/PrivacyModeIndicator.tsx
export function PrivacyModeIndicator() {
  const privacyMode = usePrivacyMode();
  
  return (
    <div className={`fixed top-4 right-4 z-50 transition-all ${
      privacyMode === 'private' 
        ? 'opacity-0 pointer-events-none' 
        : 'opacity-100'
    }`}>
      <div className="bg-orange-500/90 backdrop-blur-sm text-white px-4 py-2 rounded-full shadow-lg flex items-center gap-2">
        <Cloud className="w-4 h-4" />
        <span className="text-sm font-medium">Cloud Mode Active</span>
      </div>
    </div>
  );
}
```

**Background Gradient Change**:
```tsx
// In main layout
const bgGradient = privacyMode === 'private'
  ? 'bg-gradient-to-br from-neutral-950 via-neutral-900 to-neutral-950'
  : 'bg-gradient-to-br from-orange-950/20 via-neutral-900 to-orange-950/20';
```

### 7. Migration Strategy (Future Release)

**Cloud → Local Migration Plan**:

```typescript
// src/core/migration/cloud-to-local-migration.ts
export class CloudToLocalMigration {
  /**
   * Phase 1: Stop new cloud processing
   * - Switch provider to local
   * - Queue pending items for reprocessing
   */
  async phase1_stopCloudProcessing(): Promise<void> {
    await providerManager.switchProvider('ollama-local');
    await this.queuePendingItems();
  }
  
  /**
   * Phase 2: Reprocess cloud-generated content
   * - Re-caption images with local models
   * - Re-embed text with local models
   * - Re-transcribe videos with local Whisper
   */
  async phase2_reprocessContent(): Promise<void> {
    // Identify cloud-processed items
    const cloudItems = await db.query(`
      SELECT * FROM media_items 
      WHERE processing_provider = 'cloud'
    `);
    
    // Reprocess with local models
    for (const item of cloudItems) {
      await this.reprocessItem(item);
    }
  }
  
  /**
   * Phase 3: Verify and cleanup
   * - Verify all content is local
   * - Remove cloud provider config
   * - Update privacy mode
   */
  async phase3_cleanup(): Promise<void> {
    await this.verifyAllLocal();
    await this.removeCloudProviders();
    await this.updatePrivacyMode('private');
  }
}
```

## Implementation Plan

### Phase 1: Core Infrastructure (Week 1)
- [ ] Create LiteLLM adapter
- [ ] Implement ProviderManager
- [ ] Update config schema
- [ ] Add provider switching logic

### Phase 2: UI Components (Week 1-2)
- [ ] Provider settings panel
- [ ] Add provider dialog
- [ ] Privacy mode indicators
- [ ] Background visual changes

### Phase 3: Integration (Week 2)
- [ ] Update all LLM calls to use ProviderManager
- [ ] Add provider selection to onboarding
- [ ] Test with multiple providers

### Phase 4: Documentation (Week 2)
- [ ] User guide for adding providers
- [ ] LiteLLM setup instructions
- [ ] Privacy implications documentation

### Phase 5: Future (Next Release)
- [ ] Cloud → Local migration tool
- [ ] Hybrid mode (local + cloud)
- [ ] Cost tracking for cloud providers

## Benefits

1. **Flexibility**: Users can choose their preferred provider
2. **Privacy Control**: Clear indicators when using cloud services
3. **Local-First Default**: Maintains privacy-first philosophy
4. **Easy Setup**: LiteLLM simplifies multi-provider support
5. **Future-Proof**: Easy to add new providers

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Users accidentally use cloud | Clear privacy warnings, visual indicators |
| API key security | Encrypt keys, warn about storage |
| Cost overruns | Add usage tracking, cost estimates |
| Provider lock-in | Support migration back to local |
| Performance differences | Document expected performance per provider |

## Alternatives Considered

1. **Ollama-only**: Too restrictive for advanced users
2. **Direct API integration**: Too much work for each provider
3. **Cloud-first**: Against privacy philosophy

## Decision

Implement LiteLLM provider system with:
- Local-first default (Ollama)
- Optional cloud providers via LiteLLM
- Clear privacy mode indicators
- Future migration path back to local

This maintains our privacy-first philosophy while giving users flexibility.
