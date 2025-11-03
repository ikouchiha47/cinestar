# Supported Models Matrix

## Overview

The system now supports **all 3 provider configurations** with comprehensive model coverage across different use cases:

1. **Ollama** (Local, Private)
2. **OpenAI** (Cloud, via API)
3. **LiteLLM** (Multi-Provider Proxy for Gemini, Claude, etc.)

---

## ✅ Complete Feature Matrix

| Feature | Ollama (Local) | OpenAI (Cloud) | LiteLLM (Multi-Cloud) |
|---------|---------------|----------------|----------------------|
| **Embeddings (BGE)** | ✅ bge-large-en-v1.5<br>✅ bge-m3 (multilingual) | ✅ text-embedding-3-large<br>✅ text-embedding-3-small | ✅ text-embedding-3-large<br>✅ voyage-3 |
| **General Purpose Text** | ✅ qwen3:4b<br>✅ llama3.2:3b<br>✅ llama3.2:latest | ✅ gpt-4.1<br>✅ gpt-4.1-mini<br>✅ gpt-4.1-nano | ✅ gemini-2.0-flash<br>✅ claude-3.5-sonnet<br>✅ gpt-4o |
| **ASR (Transcription)** | ✅ whisper:latest<br>✅ whisper:medium<br>✅ whisper:small | ✅ gpt-4o-transcribe<br>✅ gpt-4o-mini-transcribe<br>✅ gpt-4o-transcribe-diarize | ❌ Not configured |
| **Vision** | ✅ moondream:v2<br>✅ llava:latest<br>✅ bakllava:latest | ✅ gpt-4.1-mini<br>✅ gpt-4.1<br>✅ gpt-4.1-nano | ✅ gemini-2.0-flash<br>✅ claude-3.5-sonnet<br>✅ gpt-4o |
| **Privacy** | 🔒 Private (Local) | ☁️ Cloud | ☁️ Cloud |
| **API Key Required** | ❌ No | ✅ Yes | ⚠️ Optional |
| **Internet Required** | ❌ No | ✅ Yes | ✅ Yes |

---

## Detailed Configuration

### 1. Ollama (Local, Private) 🔒

**Base URL**: `http://localhost:11434`  
**Privacy**: Private (all processing local)  
**API Key**: Not required  
**Docs**: https://ollama.ai/library

#### Defaults
```json
{
  "vision": "moondream:v2",
  "text": "qwen3:4b",
  "embedding": "qllama/bge-large-en-v1.5:latest",
  "transcription": "whisper:latest"
}
```

#### Available Models

**Vision Models** (3 models)
- `moondream:v2` ⭐ Default - Efficient vision-language model
- `llava:latest` - Large Language and Vision Assistant
- `bakllava:latest` - Mistral-based vision model

**Text Models** (3 models)
- `qwen3:4b` ⭐ Default - Fast 4B parameter model
- `llama3.2:3b` - Compact 3B parameter model from Meta
- `llama3.2:latest` - Meta's latest Llama model

**Embedding Models** (3 models)
- `qllama/bge-large-en-v1.5:latest` ⭐ Default - High-quality English embeddings (1024 dims)
- `bge-m3:latest` - Multilingual embeddings for 100+ languages (1024 dims)
- `nomic-embed-text:latest` - Nomic's text embedding model (768 dims)

**Transcription Models (ASR)** (3 models)
- `whisper:latest` ⭐ Default - OpenAI's Whisper running locally
- `whisper:medium` - Balanced accuracy and speed
- `whisper:small` - Faster, lower resource usage

---

### 2. OpenAI (Cloud) ☁️

**Base URL**: `https://api.openai.com/v1`  
**Privacy**: Cloud (data sent to OpenAI)  
**API Key**: Required (editable)  
**Docs**: https://platform.openai.com/docs/models

#### Defaults
```json
{
  "vision": "gpt-4.1-mini",
  "text": "gpt-4.1",
  "embedding": "text-embedding-3-large",
  "transcription": "gpt-4o-transcribe"
}
```

#### Available Models (8 categories, max 3 per category)

**Vision Models** (3 models)
- `gpt-4.1-mini` ⭐ Default - Balanced performance and cost
- `gpt-4.1` - Smartest non-reasoning model
- `gpt-4.1-nano` - Fastest, most cost-efficient

**Transcription Models** (3 models)
- `gpt-4o-transcribe` ⭐ Default - High-quality speech-to-text
- `gpt-4o-mini-transcribe` - Cost-efficient transcription
- `gpt-4o-transcribe-diarize` - With speaker identification

**Frontier Models** (3 models)
- `gpt-5` - Best for coding and agentic tasks
- `gpt-5-mini` - Faster, cost-efficient GPT-5
- `gpt-5-nano` - Fastest GPT-5 variant

**Realtime Models** (3 models)
- `gpt-realtime` - Realtime text and audio
- `gpt-realtime-mini` - Cost-efficient realtime
- `gpt-4o-realtime-preview` - Preview realtime model

**Reasoning Models** (3 models)
- `o3` - Complex reasoning tasks
- `o4-mini` - Fast reasoning
- `o3-pro` - Enhanced with more compute

**Embedding Models** (3 models)
- `text-embedding-3-large` ⭐ Default - Most capable (3072 dims)
- `text-embedding-3-small` - Smaller, faster (1536 dims)
- `text-embedding-ada-002` - Legacy model (1536 dims)

**Specialized Models** (3 models)
- `gpt-image-1` - State-of-the-art image generation
- `dall-e-3` - Previous generation image generation
- `tts-1` - Text-to-speech optimized for speed

**ChatGPT Models** (3 models)
- `gpt-5-chat-latest` - GPT-5 used in ChatGPT
- `chatgpt-4o-latest` - GPT-4o used in ChatGPT
- `gpt-4o` - Fast, intelligent, flexible

---

### 3. LiteLLM (Multi-Provider Proxy) ☁️

**Base URL**: `http://localhost:4000`  
**Privacy**: Cloud (data sent to respective providers)  
**API Key**: Optional (depends on proxy config)  
**Docs**: https://docs.litellm.ai/docs/providers

#### Defaults
```json
{
  "vision": "gemini/gemini-2.0-flash-exp",
  "text": "gemini/gemini-2.0-flash-exp",
  "embedding": "text-embedding-3-large"
}
```

#### Available Models

**Vision Models** (3 models)
- `gemini/gemini-2.0-flash-exp` ⭐ Default - Google's latest multimodal (1M context)
- `claude-3-5-sonnet-20241022` - Anthropic's most intelligent (200K context)
- `gpt-4o` - OpenAI's multimodal model (128K context)

**Text Models** (3 models)
- `gemini/gemini-2.0-flash-exp` ⭐ Default - Fast and efficient (1M context)
- `claude-3-5-sonnet-20241022` - Anthropic's most intelligent (200K context)
- `gpt-4o` - OpenAI's flagship model (128K context)

**Embedding Models** (3 models)
- `text-embedding-3-large` ⭐ Default - OpenAI's most capable (3072 dims)
- `text-embedding-3-small` - Smaller, faster OpenAI (1536 dims)
- `voyage-3` - High-quality from Voyage AI (1024 dims)

---

## Use Case Mapping

### Embeddings (BGE)

| Use Case | Provider | Model | Dimensions |
|----------|----------|-------|------------|
| English only (best quality) | Ollama | `qllama/bge-large-en-v1.5:latest` | 1024 |
| Multilingual (100+ languages) | Ollama | `bge-m3:latest` | 1024 |
| Cloud (highest quality) | OpenAI | `text-embedding-3-large` | 3072 |
| Cloud (balanced) | LiteLLM | `text-embedding-3-large` | 3072 |

### General Purpose Text

| Use Case | Provider | Model | Context |
|----------|----------|-------|---------|
| Local, fast | Ollama | `qwen3:4b` | - |
| Local, compact | Ollama | `llama3.2:3b` | - |
| Cloud, best quality | OpenAI | `gpt-4.1` | 128K |
| Cloud, balanced | OpenAI | `gpt-4.1-mini` | 128K |
| Cloud, largest context | LiteLLM | `gemini/gemini-2.0-flash-exp` | 1M |

### ASR (Speech Recognition)

| Use Case | Provider | Model | Features |
|----------|----------|-------|----------|
| Local, private | Ollama | `whisper:latest` | Full Whisper |
| Local, fast | Ollama | `whisper:small` | Faster inference |
| Cloud, high quality | OpenAI | `gpt-4o-transcribe` | Best accuracy |
| Cloud, with speakers | OpenAI | `gpt-4o-transcribe-diarize` | Speaker ID |

### Vision

| Use Case | Provider | Model | Context |
|----------|----------|-------|---------|
| Local, private | Ollama | `moondream:v2` | Efficient |
| Cloud, balanced | OpenAI | `gpt-4.1-mini` | 128K |
| Cloud, best quality | OpenAI | `gpt-4.1` | 128K |
| Cloud, largest context | LiteLLM | `gemini/gemini-2.0-flash-exp` | 1M |
| Cloud, best reasoning | LiteLLM | `claude-3-5-sonnet-20241022` | 200K |

---

## Privacy Comparison

### 🔒 Private (Ollama)
✅ All data stays on your machine  
✅ Works offline  
✅ No API costs  
✅ Full control over models  
❌ Requires local GPU/CPU resources  
❌ Limited to open-source models  

### ☁️ Cloud (OpenAI)
✅ Access to latest, most powerful models  
✅ No local hardware requirements  
✅ Consistent performance  
❌ Data sent to OpenAI servers  
❌ Requires internet connection  
❌ API costs per usage  

### ☁️ Cloud (LiteLLM Multi-Provider)
✅ Access to multiple providers (Google, Anthropic, OpenAI)  
✅ Unified interface  
✅ Flexibility to choose best model per task  
❌ Data sent to respective provider servers  
❌ Requires internet connection  
❌ API costs per usage  
❌ Requires LiteLLM proxy setup  

---

## Configuration Files

All configurations are stored in JSON format:

```
src/core/llm/
├── ollama-models-config.json      # Ollama local models
├── openai-models-config.json      # OpenAI cloud models
└── litellm-models-config.json     # LiteLLM multi-provider models
```

Each configuration includes:
- Provider metadata (name, base URL, docs)
- API key requirements
- Default models per task
- Categorized model listings (max 3 per category)
- Model capabilities and specifications

---

## Quick Start Examples

### Using Local Ollama for Privacy
```typescript
import { providerConfigManager } from './core/llm/provider-config-manager';

// Get default local vision model
const visionModel = providerConfigManager.getDefaultModel('ollama', 'vision');
// Returns: "moondream:v2"

// Get all local embedding models
const embeddings = providerConfigManager.getModelsByCategory('ollama', 'embedding');
// Returns: [bge-large-en-v1.5, bge-m3, nomic-embed-text]
```

### Using OpenAI for Quality
```typescript
// Get default OpenAI transcription model
const asrModel = providerConfigManager.getDefaultModel('openai', 'transcription');
// Returns: "gpt-4o-transcribe"

// Check if API key is required
const needsKey = providerConfigManager.requiresApiKey('openai');
// Returns: true
```

### Using LiteLLM for Gemini/Claude
```typescript
// Get Gemini vision model
const geminiVision = providerConfigManager.getDefaultModel('litellm', 'vision');
// Returns: "gemini/gemini-2.0-flash-exp"

// Get all vision models (includes Gemini, Claude, GPT-4o)
const visionModels = providerConfigManager.getModelsByCapability('litellm', 'vision');
```

---

## Summary

✅ **All 3 providers configured**  
✅ **BGE embeddings**: EN-large and M3 multilingual  
✅ **General purpose**: qwen3:4b, llama3.2:3b, and cloud options  
✅ **ASR**: Whisper local + OpenAI cloud transcription  
✅ **Vision**: moondream, OpenAI, Gemini, Claude via LiteLLM  
✅ **Max 3 models per category** for clean UI  
✅ **Privacy indicators** for all providers  
✅ **Editable API keys** where applicable  

The system now supports **complete flexibility** across local and cloud providers for all your LLM needs! 🎉
