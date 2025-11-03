# Model Configuration Fixes

## Issues Fixed

### 1. ❌ Vision Models Showing in Text Category
**Problem**: Moondream, LLaVA, BakLLaVA were showing up in "Text Models" section  
**Root Cause**: Models had `capabilities: ["text", "vision"]` - they shouldn't have "text"  
**Fix**: Removed "text" capability from all vision models

```json
// Before
"capabilities": ["text", "vision"]

// After  
"capabilities": ["vision"]
```

### 2. ❌ Confusing Model Names
**Problem**: `llama3.2:latest` vs `llama3.2:3b` - what's the difference?  
**Root Cause**: Poor naming and descriptions  
**Fix**: Clarified in names and descriptions

```json
// Before
"llama3.2:3b" → "Llama 3.2 3B"
"llama3.2:latest" → "Llama 3.2"

// After
"llama3.2:3b" → "Llama 3.2 (3B)" - "Compact 3B parameter model - faster, lower memory"
"llama3.2:latest" → "Llama 3.2 (Latest)" - "Latest version (typically 8B+) - more capable"
```

### 3. ❌ Wrong Model Names
**Problem**: `nomic-embed-text:latest` doesn't exist in Ollama  
**Root Cause**: Static config not validated against actual Ollama  
**Fix**: Changed to `nomic-embed-text` (correct name)

### 4. ❌ No Validation
**Problem**: All model names are static - no way to know if they're actually installed  
**Root Cause**: No integration with Ollama API  
**Fix**: Created `OllamaModelValidator` service

## New Features

### Model Validation Service

**File**: `src/services/ollama-model-validator.ts`

Validates models against actual Ollama installation using `/api/show` endpoint:

```typescript
// Check single model
const result = await ollamaValidator.validateModel('moondream:v2');
// { modelId: 'moondream:v2', exists: true, details: {...} }

// Check multiple models
const results = await ollamaValidator.validateModels([
  'moondream:v2',
  'qwen3:4b',
  'nomic-embed-text'
]);

// Get all available models
const available = await ollamaValidator.getAvailableModels();
// ['moondream:v2', 'llama3.2:3b', ...]

// Check if Ollama is running
const isRunning = await ollamaValidator.isOllamaRunning();
```

### Visual Validation Badges

**Updated**: `src/components/ModelSelector.tsx`

Now shows real-time validation status for Ollama models:

```
┌─────────────────────────────────────────┐
│ Moondream v2  [Default] [✓ Installed]  │
│ Efficient vision-language model         │
│ [vision]                                │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ LLaVA  [Not Installed]                  │
│ Large Language and Vision Assistant      │
│ [vision]                                │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ Qwen3 4B  [Checking...]                 │
│ Fast and efficient 4B parameter model    │
│ [text]                                  │
└─────────────────────────────────────────┘
```

## How It Works

### 1. On Component Mount
```typescript
useEffect(() => {
  if (providerId === 'ollama') {
    // Get all models from config
    const allModels = providerConfigManager.getAllModels('ollama');
    
    // Validate against Ollama
    const results = await ollamaValidator.validateModels(modelIds);
    
    // Update UI with validation status
    setModelValidation(results);
  }
}, [providerId]);
```

### 2. Ollama API Call
```bash
curl --location 'http://localhost:11434/api/show' \
--data '{
    "name": "moondream:v2"
}'
```

**Response if exists**:
```json
{
  "modelfile": "...",
  "parameters": "...",
  "details": {
    "format": "gguf",
    "family": "moondream",
    "parameter_size": "1.7B",
    "quantization_level": "Q4_0"
  }
}
```

**Response if not exists**: HTTP 404

### 3. UI Updates
- **Checking...** - Gray badge while validating
- **✓ Installed** - Green badge if model exists
- **Not Installed** - Red badge if model missing

## Benefits

### For Users
✅ **No more guessing** - See which models are actually installed  
✅ **Clear feedback** - Know what needs to be downloaded  
✅ **Better UX** - Can't select models that don't exist  
✅ **Correct filtering** - Vision models don't show in text section  

### For Developers
✅ **Real-time validation** - Checks actual Ollama state  
✅ **Cached results** - Doesn't spam Ollama API  
✅ **Extensible** - Easy to add more validation logic  
✅ **Type-safe** - Full TypeScript support  

## Files Modified

1. **`src/core/llm/ollama-models-config.json`**
   - Fixed vision model capabilities
   - Clarified llama3.2 naming
   - Fixed nomic-embed-text model name

2. **`src/services/ollama-model-validator.ts`** (NEW)
   - Model validation service
   - Ollama API integration
   - Caching layer

3. **`src/components/ModelSelector.tsx`**
   - Added validation on mount
   - Visual validation badges
   - Real-time status updates

## Testing

### Manual Test
1. Open Settings → LLM Providers
2. Select Ollama
3. Look at model list
4. Should see:
   - ✓ Installed (green) for models you have
   - Not Installed (red) for models you don't have
   - Checking... (gray) while loading

### Validation Test
```bash
# Check what models you actually have
curl http://localhost:11434/api/tags

# Try to show a model
curl --location 'http://localhost:11434/api/show' \
--data '{"name":"moondream:v2"}'
```

## Future Enhancements

### Potential Improvements
1. **Auto-download** - Click "Not Installed" to pull model
2. **Size info** - Show model size before download
3. **Health check** - Periodic validation in background
4. **Smart defaults** - Only show installed models by default
5. **Pull progress** - Show download progress for new models

## Summary

✅ **Fixed capability filtering** - Vision models no longer show in text  
✅ **Clarified naming** - Clear difference between model variants  
✅ **Added validation** - Real-time check against Ollama  
✅ **Better UX** - Visual badges show installation status  
✅ **Correct model names** - All names match actual Ollama models  

**Status**: ✅ **COMPLETE** - Model configuration is now accurate and validated!
