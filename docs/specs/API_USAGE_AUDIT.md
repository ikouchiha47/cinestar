# API Usage Audit & LLM Provider Integration

## Current API Usage

### 1. **Embeddings** - `EmbeddingService`
**File**: `src/core/embedding-service.ts`

**Current Implementation**:
```typescript
// Hardcoded to Ollama or OpenAI based on env var
this.provider = envProvider === 'openai' ? 'openai' : 'ollama';
this.embeddingModel = 'qllama/bge-large-en-v1.5'; // Ollama
// OR
this.embeddingModel = 'text-embedding-3-large'; // OpenAI
```

**Used By**:
- `video-job-processor.ts` - All embedding generation
- `incremental-segment-processor.ts` - Segment embeddings
- `video-segment-indexer.ts` - Search indexing

**API Calls**:
```typescript
// Ollama
POST http://localhost:11434/api/embeddings
{
  "model": "qllama/bge-large-en-v1.5",
  "prompt": "text to embed"
}

// OpenAI
POST https://api.openai.com/v1/embeddings
{
  "model": "text-embedding-3-large",
  "input": "text to embed"
}
```

### 2. **Vision/Captioning** - `OllamaCaptioningService`
**File**: `src/core/processors/ollama-captioning-service.ts`

**Current Implementation**:
```typescript
// Hardcoded to Ollama moondream
this.model = 'moondream:v2';
this.baseUrl = 'http://localhost:11434';
```

**Used By**:
- `batch-captioning-processor.ts` - Batch keyframe captioning
- `multi-pass-captioning-service.ts` - Multi-pass analysis
- `captioning-processor.ts` - Single frame captioning
- `video-job-processor.ts` - Phase 1 enhancement

**API Calls**:
```typescript
POST http://localhost:11434/api/generate
{
  "model": "moondream:v2",
  "prompt": "Describe this image in detail.",
  "images": ["base64_encoded_jpeg"],
  "stream": false
}
```

### 3. **Text Generation** - `LLMExtractionService`
**File**: `src/core/processors/llm-extraction-service.ts`

**Current Implementation**:
```typescript
// Hardcoded to Ollama
this.model = 'qwen3:4b';
this.baseUrl = 'http://localhost:11434';
```

**Used By**:
- `multi-pass-captioning-service.ts` - Scene reconstruction
- `video-job-processor.ts` - Scene description generation

**API Calls**:
```typescript
POST http://localhost:11434/api/generate
{
  "model": "qwen3:4b",
  "prompt": "Reconstruct the scene...",
  "stream": false
}
```

### 4. **Transcription** - Whisper (Local)
**File**: `src/core/whisper-service.ts`

**Current Implementation**:
```typescript
// Uses local whisper.cpp binary
const whisperPath = path.join(process.cwd(), 'whisper.cpp', 'main');
```

**Used By**:
- `video-job-processor.ts` - Audio transcription
- `audio-processor.ts` - Audio extraction

**Not an API** - Local binary execution

---

## ❌ Problems

### 1. **Hardcoded Models**
All services have hardcoded model names:
- `moondream:v2` for vision
- `qwen3:4b` for text
- `qllama/bge-large-en-v1.5` for embeddings

### 2. **Hardcoded Providers**
No way to switch between:
- Ollama (local)
- OpenAI (cloud)
- LiteLLM (multi-provider)

### 3. **No Configuration Integration**
Services don't use the new LLM provider system we built!

### 4. **Environment Variable Hell**
```typescript
process.env.EMBEDDINGS_PROVIDER
process.env.OLLAMA_EMBED_MODEL
process.env.EMBEDDINGS_API_KEY
```

---

## ✅ Solution: Integrate LLM Provider System

### Step 1: Update EmbeddingService

**Before**:
```typescript
constructor(baseUrl?: string, apiKey?: string, embeddingModel?: string) {
  const envProvider = process.env.EMBEDDINGS_PROVIDER;
  this.provider = envProvider === 'openai' ? 'openai' : 'ollama';
  this.embeddingModel = 'qllama/bge-large-en-v1.5';
}
```

**After**:
```typescript
import { llmConfigService } from '../services/llm-config-service';
import { providerConfigManager } from './llm/provider-config-manager';

constructor() {
  // Get active provider from config
  const activeProvider = await llmConfigService.getActiveProvider();
  const selectedModel = await llmConfigService.getSelectedModel(activeProvider, 'embedding');
  
  this.provider = activeProvider;
  this.embeddingModel = selectedModel;
  
  // Get API key if cloud provider
  if (activeProvider !== 'ollama') {
    this.apiKey = await llmConfigService.getApiKey(activeProvider);
  }
}
```

### Step 2: Update OllamaCaptioningService → VisionService

**Rename**: `OllamaCaptioningService` → `VisionService`

**Before**:
```typescript
constructor() {
  this.model = 'moondream:v2';
  this.baseUrl = 'http://localhost:11434';
}
```

**After**:
```typescript
import { llmConfigService } from '../../services/llm-config-service';

constructor() {
  const activeProvider = await llmConfigService.getActiveProvider();
  const selectedModel = await llmConfigService.getSelectedModel(activeProvider, 'vision');
  
  this.provider = activeProvider;
  this.model = selectedModel;
  
  // Get base URL from provider config
  const config = providerConfigManager.getConfig(activeProvider);
  this.baseUrl = config.baseUrl;
  
  // Get API key if needed
  if (activeProvider !== 'ollama') {
    this.apiKey = await llmConfigService.getApiKey(activeProvider);
  }
}

async caption(imagePath: string, options: any = {}) {
  if (this.provider === 'ollama') {
    return this.captionWithOllama(imagePath, options);
  } else if (this.provider === 'openai') {
    return this.captionWithOpenAI(imagePath, options);
  } else if (this.provider === 'litellm') {
    return this.captionWithLiteLLM(imagePath, options);
  }
}
```

### Step 3: Update LLMExtractionService → TextGenerationService

**Before**:
```typescript
constructor() {
  this.model = 'qwen3:4b';
  this.baseUrl = 'http://localhost:11434';
}
```

**After**:
```typescript
constructor() {
  const activeProvider = await llmConfigService.getActiveProvider();
  const selectedModel = await llmConfigService.getSelectedModel(activeProvider, 'text');
  
  this.provider = activeProvider;
  this.model = selectedModel;
  this.baseUrl = providerConfigManager.getConfig(activeProvider).baseUrl;
  
  if (activeProvider !== 'ollama') {
    this.apiKey = await llmConfigService.getApiKey(activeProvider);
  }
}
```

### Step 4: Add Transcription Provider Support

**Current**: Only local Whisper

**Add**: OpenAI Whisper API support

```typescript
class TranscriptionService {
  async transcribe(audioPath: string) {
    const activeProvider = await llmConfigService.getActiveProvider();
    const selectedModel = await llmConfigService.getSelectedModel(activeProvider, 'transcription');
    
    if (activeProvider === 'ollama' || selectedModel === 'whisper:latest') {
      return this.transcribeWithLocalWhisper(audioPath);
    } else if (activeProvider === 'openai') {
      return this.transcribeWithOpenAI(audioPath);
    }
  }
  
  async transcribeWithOpenAI(audioPath: string) {
    const apiKey = await llmConfigService.getApiKey('openai');
    const formData = new FormData();
    formData.append('file', fs.createReadStream(audioPath));
    formData.append('model', 'whisper-1');
    
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: formData
    });
    
    return response.json();
  }
}
```

---

## Implementation Plan

### Phase 1: Refactor Services (High Priority)
1. ✅ Create unified `VisionService` (replaces `OllamaCaptioningService`)
2. ✅ Create unified `TextGenerationService` (replaces `LLMExtractionService`)
3. ✅ Update `EmbeddingService` to use provider config
4. ✅ Add `TranscriptionService` with multi-provider support

### Phase 2: Update Processors
1. Update `batch-captioning-processor.ts` to use `VisionService`
2. Update `multi-pass-captioning-service.ts` to use new services
3. Update `video-job-processor.ts` to use provider-aware services

### Phase 3: Remove Environment Variables
1. Remove `EMBEDDINGS_PROVIDER` env var
2. Remove `OLLAMA_EMBED_MODEL` env var
3. Remove `EMBEDDINGS_API_KEY` env var
4. Use `llm-config.json` instead

---

## API Endpoint Mapping

### Embeddings

| Provider | Endpoint | Model Format |
|----------|----------|--------------|
| Ollama | `http://localhost:11434/api/embeddings` | `qllama/bge-large-en-v1.5` |
| OpenAI | `https://api.openai.com/v1/embeddings` | `text-embedding-3-large` |
| LiteLLM | `http://localhost:4000/embeddings` | `text-embedding-3-large` |

### Vision (Image Captioning)

| Provider | Endpoint | Model Format |
|----------|----------|--------------|
| Ollama | `http://localhost:11434/api/generate` | `moondream:v2` |
| OpenAI | `https://api.openai.com/v1/chat/completions` | `gpt-4o` |
| LiteLLM | `http://localhost:4000/chat/completions` | `gemini/gemini-2.0-flash-exp` |

### Text Generation

| Provider | Endpoint | Model Format |
|----------|----------|--------------|
| Ollama | `http://localhost:11434/api/generate` | `qwen3:4b` |
| OpenAI | `https://api.openai.com/v1/chat/completions` | `gpt-4o` |
| LiteLLM | `http://localhost:4000/chat/completions` | `gemini/gemini-2.0-flash-exp` |

### Transcription

| Provider | Endpoint | Model Format |
|----------|----------|--------------|
| Local | `whisper.cpp/main` (binary) | `whisper:latest` |
| OpenAI | `https://api.openai.com/v1/audio/transcriptions` | `whisper-1` |
| LiteLLM | `http://localhost:4000/audio/transcriptions` | `whisper-1` |

---

## Benefits After Integration

### For Users
✅ **One place to configure** - All models in Settings  
✅ **Switch providers easily** - Dropdown selection  
✅ **Mix and match** - Ollama for embeddings, OpenAI for vision  
✅ **See costs** - Know which APIs are cloud vs local  

### For Developers
✅ **No more env vars** - Config file driven  
✅ **Type-safe** - Full TypeScript support  
✅ **Testable** - Easy to mock providers  
✅ **Maintainable** - Single source of truth  

---

## Current Status

### ✅ Built
- LLM provider configuration system
- Provider settings UI (V2)
- Config persistence (`llm-config.json`)
- IPC handlers for config management

### ❌ Not Integrated
- Services still use hardcoded models
- No provider switching at runtime
- Environment variables still required

### 🔄 Next Steps
1. **Fix LiteLLM API key UI** (DONE - just fixed!)
2. **Refactor EmbeddingService** to use provider config
3. **Refactor OllamaCaptioningService** to support multi-provider
4. **Add TranscriptionService** with OpenAI support
5. **Update all processors** to use new services

---

## Summary

**Current**: Hardcoded Ollama everywhere, env vars for config  
**Goal**: Dynamic provider selection, UI-driven config  
**Blocker**: Services don't use the LLM provider system we built  

**Action Required**: Refactor the 3 core services to read from `llm-config.json` instead of hardcoded values!
