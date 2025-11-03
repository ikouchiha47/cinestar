## Task List: Multi-Provider LLM Support (Ollama, OpenAI, Gemini, LiteLLM)

### **Phase 1: Create Provider Adapters**

- [ ] **1.1** Create `OpenAIAdapter` (`src/core/llm/openai-adapter.ts`)
  - Implement [chat()](cci:1://file:///Users/darksied/dev/pocs/drillbit/src/core/llm/types.ts:86:2-89:73) - `/v1/chat/completions`
  - Implement [vision()](cci:1://file:///Users/darksied/dev/pocs/drillbit/src/core/llm/types.ts:96:2-99:90) - `/v1/chat/completions` with image messages
  - Implement [embed()](cci:1://file:///Users/darksied/dev/pocs/drillbit/src/core/llm/types.ts:91:2-94:69) - `/v1/embeddings`
  - Implement [isAvailable()](cci:1://file:///Users/darksied/dev/pocs/drillbit/src/core/llm/types.ts:101:2-104:33) - Check API key and connectivity

- [ ] **1.2** Create `GeminiAdapter` (`src/core/llm/gemini-adapter.ts`)
  - Implement [chat()](cci:1://file:///Users/darksied/dev/pocs/drillbit/src/core/llm/types.ts:86:2-89:73) - `/v1beta/models/{model}:generateContent`
  - Implement [vision()](cci:1://file:///Users/darksied/dev/pocs/drillbit/src/core/llm/types.ts:96:2-99:90) - Same endpoint with image parts
  - Implement [embed()](cci:1://file:///Users/darksied/dev/pocs/drillbit/src/core/llm/types.ts:91:2-94:69) - `/v1beta/models/{model}:embedContent`
  - Implement [isAvailable()](cci:1://file:///Users/darksied/dev/pocs/drillbit/src/core/llm/types.ts:101:2-104:33) - Check API key and connectivity

- [ ] **1.3** Verify `LiteLLMAdapter` exists and works
  - Check implementation in [src/core/llm/litellm-adapter.ts](cci:7://file:///Users/darksied/dev/pocs/drillbit/src/core/llm/litellm-adapter.ts:0:0-0:0)
  - Ensure it uses OpenAI-compatible format
  - Test with `/v1/chat/completions` and `/v1/embeddings`

- [ ] **1.4** Verify `OllamaAdapter` exists and works
  - Check implementation in [src/core/llm/ollama-adapter.ts](cci:7://file:///Users/darksied/dev/pocs/drillbit/src/core/llm/ollama-adapter.ts:0:0-0:0)
  - Ensure it uses `/api/generate` and `/api/embed`

### **Phase 2: Update Provider Manager**

- [ ] **2.1** Update [ProviderManager.createAdapter()](cci:1://file:///Users/darksied/dev/pocs/drillbit/src/core/llm/provider-manager.ts:109:2-123:3) to support new adapters
  - Add case for `adapter: 'openai'` → `new OpenAIAdapter()`
  - Add case for `adapter: 'gemini'` → `new GeminiAdapter()`
  - Keep existing `'ollama'` and `'litellm'` cases

- [ ] **2.2** Add provider validation
  - Validate API keys are present for cloud providers
  - Validate baseUrl is reachable
  - Add error handling for missing configs

### **Phase 3: Update Config Schema**

- [ ] **3.1** Update `config.template.json` with all 4 providers
  - Add `ollama` provider config (local, no API key)
  - Add `openai` provider config (cloud, requires API key)
  - Add `gemini` provider config (cloud, requires API key)
  - Add `litellm` provider config (cloud, optional API key)

- [ ] **3.2** Update TypeScript types
  - Update [AdapterType](cci:2://file:///Users/darksied/dev/pocs/drillbit/src/core/llm/types.ts:5:0-5:47) to include `'openai' | 'gemini'`
  - Ensure [ProviderRuntimeConfig](cci:2://file:///Users/darksied/dev/pocs/drillbit/src/core/llm/types.ts:15:0-22:1) supports all provider formats

### **Phase 4: Refactor Existing Services**

- [ ] **4.1** Refactor [OllamaCaptioningService](cci:2://file:///Users/darksied/dev/pocs/drillbit/src/core/processors/ollama-captioning-service.ts:4:0-103:1) → `VisionService`
  - Replace direct Ollama API calls with [ProviderManager.getProviderForTask('vision')](cci:1://file:///Users/darksied/dev/pocs/drillbit/src/core/llm/provider-manager.ts:70:2-88:3)
  - Support all providers (Ollama, OpenAI, Gemini, LiteLLM)
  - Keep backward compatibility

- [ ] **4.2** Refactor [LLMExtractionService](cci:2://file:///Users/darksied/dev/pocs/drillbit/src/core/processors/llm-extraction-service.ts:19:0-193:1)
  - Replace hardcoded Ollama calls with [ProviderManager.getProviderForTask('text')](cci:1://file:///Users/darksied/dev/pocs/drillbit/src/core/llm/provider-manager.ts:70:2-88:3)
  - Support all providers

- [ ] **4.3** Refactor `MultiPassCaptioningService`
  - Update to use new `VisionService`
  - Remove direct [OllamaCaptioningService](cci:2://file:///Users/darksied/dev/pocs/drillbit/src/core/processors/ollama-captioning-service.ts:4:0-103:1) dependency

- [ ] **4.4** Update [EmbeddingService](cci:2://file:///Users/darksied/dev/pocs/drillbit/src/core/embedding-service.ts:43:0-303:1)
  - Integrate with [ProviderManager](cci:2://file:///Users/darksied/dev/pocs/drillbit/src/core/llm/provider-manager.ts:18:0-348:1) instead of direct provider detection
  - Use [getProviderForTask('embedding')](cci:1://file:///Users/darksied/dev/pocs/drillbit/src/core/llm/provider-manager.ts:70:2-88:3)

### **Phase 5: Update Video Processing Pipeline**

- [ ] **5.1** Update `CaptioningCoordinator` to use [ProviderManager](cci:2://file:///Users/darksied/dev/pocs/drillbit/src/core/llm/provider-manager.ts:18:0-348:1)
- [ ] **5.2** Update `EmbeddingCoordinator` to use [ProviderManager](cci:2://file:///Users/darksied/dev/pocs/drillbit/src/core/llm/provider-manager.ts:18:0-348:1)
- [ ] **5.3** Update [BatchManager](cci:2://file:///Users/darksied/dev/pocs/drillbit/src/core/video-processing/BatchManager.ts:17:0-341:1) Phase 1 to use new services
- [ ] **5.4** Update [VideoJobProcessor](cci:2://file:///Users/darksied/dev/pocs/drillbit/src/core/video-job-processor.ts:23:0-3136:1) to use new services

### **Phase 6: Build Settings UI**

- [ ] **6.1** Create provider selection UI
  - Radio buttons: Ollama / OpenAI / Gemini / LiteLLM
  - Show current active provider
  - Allow switching providers

- [ ] **6.2** Create API key management UI
  - Input fields for OpenAI API key
  - Input fields for Gemini API key
  - Input fields for LiteLLM proxy URL + key
  - Secure storage (not in plain text)

- [ ] **6.3** Create model selection UI per task
  - Dropdown for Vision model
  - Dropdown for Embedding model
  - Dropdown for Text/Chat model
  - Load available models from provider

- [ ] **6.4** Add provider status indicators
  - Show connection status (connected/disconnected)
  - Show API key validation status
  - Show available models

### **Phase 7: Testing & Validation**

- [ ] **7.1** Test Ollama provider (existing)
  - Vision captioning
  - Embeddings
  - Text generation

- [ ] **7.2** Test OpenAI provider
  - Vision with GPT-4V
  - Embeddings with text-embedding-3-large
  - Text with GPT-4

- [ ] **7.3** Test Gemini provider
  - Vision with gemini-pro-vision
  - Embeddings with text-embedding-004
  - Text with gemini-pro

- [ ] **7.4** Test LiteLLM provider
  - Configure LiteLLM proxy
  - Test routing to multiple providers
  - Verify model switching

- [ ] **7.5** Test provider switching
  - Switch from Ollama to OpenAI mid-session
  - Verify all services pick up new provider
  - Test error handling for invalid configs

### **Phase 8: Documentation & Polish**

- [ ] **8.1** Update README with provider setup instructions
- [ ] **8.2** Add error messages for common issues (missing API keys, etc.)
- [ ] **8.3** Add logging for provider selection and API calls
- [ ] **8.4** Create migration guide for existing Ollama users

---

## Priority Order:

1. **Phase 1-2** (Adapters + Manager) - Core infrastructure
2. **Phase 3** (Config) - Configuration structure
3. **Phase 4** (Refactor Services) - Make existing code provider-agnostic
4. **Phase 6** (UI) - User-facing controls
5. **Phase 5** (Pipeline) - Integration
6. **Phase 7-8** (Testing + Docs) - Validation
