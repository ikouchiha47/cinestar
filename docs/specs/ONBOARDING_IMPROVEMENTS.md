# Onboarding & Model Management Improvements

## Date: Nov 1, 2025 1:10pm

## Tasks Completed

### 1. ✅ Disabled Audio Card in Onboarding

**File**: `src/components/SimplifiedOnboarding.tsx`
**Change**: Commented out the audio card (lines 434-493)

**Result**: Users now only see:
- Images (always enabled)
- Videos (optional)
- ~~Audio~~ (disabled)

### 2. ✅ Tested Ollama Pull API

**API Endpoint**: `http://localhost:11434/api/pull`

**Test Command**:
```bash
curl --location 'http://localhost:11434/api/pull' \
--data '{
    "name": "qwen2.5:3b",
    "stream": false
}'
```

**Response**:
```json
{
    "status": "success"
}
```

**✅ API Works!**

### 3. Required Models

Based on `src/core/config.ts`, the application needs:

1. **moondream:v2** - Vision/captioning model
   - Used for: Image captions, keyframe analysis
   - Config: `ai.visionModel`

2. **qllama/bge-large-en-v1.5:latest** - Embedding model
   - Used for: Text embeddings, semantic search
   - Config: `ai.embeddingModel`
   - Dimensions: 1024

3. **qwen3:4b** - General purpose text generation
   - Used for: Scene reconstruction, Q&A, element extraction
   - Config: `ai.generalPurposeModel`
   - ✅ Already installed

### 4. Whisper Rebuild Skip Conditions

**Location**: `nodejs-whisper` package

**Skip Condition**:
```
[Nodejs-whisper] whisper-cli executable found. Skipping build.
```

**When Build is Skipped**:
- Executable exists at: `node_modules/nodejs-whisper/cpp/whisper.cpp/build/bin/whisper-cli`
- Model file exists at: `./models/ggml-base.en.bin`

**Build Trigger**:
- Missing executable
- Missing model file
- Platform change (requires rebuild for architecture)

**Postinstall Script**:
```json
{
  "scripts": {
    "postinstall": "npx electron-rebuild -f -w better-sqlite3 && npm rebuild sharp && node scripts/download-whisper-model.js && node scripts/copy-whisper-binaries.js"
  }
}
```

---

## Implementation Plan

### Task A: Auto-Download Missing Ollama Models

**Create**: `src/core/model-manager.ts`

**Features**:
1. Check if models exist using `/api/tags`
2. Download missing models using `/api/pull`
3. Show progress during onboarding
4. Handle errors gracefully

**Models to Download**:
```typescript
const REQUIRED_MODELS = [
  {
    name: 'moondream:v2',
    purpose: 'Vision/Captioning',
    size: '~1.7GB',
    required: true
  },
  {
    name: 'qllama/bge-large-en-v1.5:latest',
    purpose: 'Text Embeddings',
    size: '~340MB',
    required: true
  },
  {
    name: 'qwen3:4b',
    purpose: 'Text Generation',
    size: '~2.5GB',
    required: false // Already installed
  }
];
```

**API Methods**:
```typescript
class ModelManager {
  // Check if model exists
  async checkModel(modelName: string): Promise<boolean>
  
  // Download model
  async pullModel(modelName: string, onProgress?: (progress: number) => void): Promise<void>
  
  // Check all required models
  async checkRequiredModels(): Promise<{ missing: string[], existing: string[] }>
  
  // Download all missing models
  async downloadMissingModels(onProgress?: (model: string, progress: number) => void): Promise<void>
}
```

### Task B: Integrate with Onboarding

**Update**: `src/components/SimplifiedOnboarding.tsx`

**Flow**:
1. User selects "Videos" feature
2. Check which models are missing
3. Show download screen with progress for each model
4. Download models sequentially or in parallel
5. Complete onboarding when all downloads finish

**Progress Display**:
```
Downloading AI Models...

✅ qwen3:4b (2.5GB) - Already installed
🔄 moondream:v2 (1.7GB) - Downloading... 45%
⏳ qllama/bge-large-en-v1.5 (340MB) - Waiting...
```

### Task C: Handle Whisper Setup

**Current Behavior**: ✅ Already working!
- Whisper checks for executable on startup
- Skips build if found
- Downloads model via postinstall script

**No changes needed** - whisper setup is already optimized.

---

## Testing Checklist

### Model Manager Tests
- [ ] Check if model exists (existing model)
- [ ] Check if model exists (missing model)
- [ ] Pull model with stream=false
- [ ] Pull model with stream=true (progress tracking)
- [ ] Handle Ollama not running
- [ ] Handle network errors
- [ ] Handle disk space errors

### Onboarding Tests
- [ ] Fresh install - no models
- [ ] Partial install - some models missing
- [ ] All models present - skip download
- [ ] Cancel during download
- [ ] Retry after failed download
- [ ] Audio card is hidden
- [ ] Only Images + Videos shown

### Whisper Tests
- [ ] First run - builds whisper
- [ ] Subsequent runs - skips build
- [ ] Model download on first run
- [ ] Transcription works after setup

---

## API Reference

### Ollama API Endpoints

**List Models**:
```bash
GET http://localhost:11434/api/tags
```

**Pull Model** (no stream):
```bash
POST http://localhost:11434/api/pull
Content-Type: application/json

{
  "name": "moondream:v2",
  "stream": false
}
```

**Pull Model** (with progress):
```bash
POST http://localhost:11434/api/pull
Content-Type: application/json

{
  "name": "moondream:v2",
  "stream": true
}

# Response (streaming):
{"status":"pulling manifest"}
{"status":"downloading digestname","digest":"sha256:...","total":1234567,"completed":123456}
{"status":"verifying sha256 digest"}
{"status":"writing manifest"}
{"status":"removing any unused layers"}
{"status":"success"}
```

---

## Files Modified

1. ✅ `src/components/SimplifiedOnboarding.tsx` - Disabled audio card
2. ⏳ `src/core/model-manager.ts` - To be created
3. ⏳ `src/components/SimplifiedOnboarding.tsx` - Update to use ModelManager

---

## Next Steps

1. Create `ModelManager` class
2. Integrate with onboarding flow
3. Test with fresh install
4. Add error handling and retry logic
5. Update documentation
