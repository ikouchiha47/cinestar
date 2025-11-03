# Onboarding Setup Test Checklist

## Date: Nov 1, 2025 2:51pm

## Pre-Test Setup ✅

### Models Deleted
- ✅ `qllama/bge-large-en-v1.5:latest` - Deleted
- ✅ `hf.co/gpustack/bge-m3-GGUF:Q6_K` - Not installed

### Models Still Installed
- ✅ `moondream:v2` - Installed
- ✅ `qwen3:4b` - Installed
- ✅ `qwen2.5:3b` - Installed

### Expected Missing Models
According to `ModelManager.REQUIRED_MODELS`:
1. ❌ `qllama/bge-large-en-v1.5:latest` - Missing (will download)
2. ❌ `hf.co/gpustack/bge-m3-GGUF:Q6_K` - Missing (will download)
3. ✅ `moondream:v2` - Already installed (skip)
4. ✅ `qwen3:4b` - Already installed (skip)

---

## Test Procedure

### Step 1: Start Application
```bash
npm run dev
```

### Step 2: Trigger Onboarding
- App should detect first launch or missing config
- Show splash screen
- Show welcome screen
- Show feature selection

### Step 3: Select Videos Feature
- Click on "Videos" card
- Should enable video processing
- Click "Continue" button

### Step 4: Watch Setup Progress Screen

**Expected Tasks**:
```
1. ⏳ Checking Whisper installation
   - Should check if whisper-cli exists
   - Should build if needed
   - Should show progress

2. ⏳ Downloading bge-large-en-v1.5:latest
   - Status: "Downloading..."
   - Progress: 0% → 100%
   - Size: ~340MB
   - Purpose: Text Embeddings

3. ⏳ Downloading bge-m3-GGUF:Q6_K
   - Status: "Downloading..."
   - Progress: 0% → 100%
   - Size: ~1.2GB
   - Purpose: Multilingual Embeddings
```

**NOT Expected** (already installed):
- ❌ moondream:v2 download
- ❌ qwen3:4b download

---

## What to Watch For

### UI Elements

**Overall Progress Bar**:
- [ ] Shows percentage (0-100%)
- [ ] Updates smoothly
- [ ] Shows fun loading messages

**Task Cards**:
- [ ] Show status icons (⏳ pending, 🔄 running, ✅ completed)
- [ ] Show individual progress bars
- [ ] Show status messages
- [ ] Show file sizes
- [ ] Animate transitions

**Status Messages**:
- [ ] "Preparing download..."
- [ ] "Downloading..."
- [ ] "Verifying integrity..."
- [ ] "Saving to disk..."
- [ ] "Download complete!"

### Parallel Execution

**Whisper + Ollama**:
- [ ] Whisper check starts immediately
- [ ] First Ollama model starts immediately
- [ ] Both run in parallel
- [ ] Second Ollama model waits for first to complete

**Timeline** (expected):
```
0:00 - Whisper check starts
0:00 - bge-large-en-v1.5 download starts
0:30 - Whisper completes ✅
2:00 - bge-large-en-v1.5 completes ✅
2:01 - bge-m3-GGUF download starts
5:00 - bge-m3-GGUF completes ✅
5:01 - Setup complete! 🎉
```

### Console Logs

**Expected Logs**:
```
[SIMPLIFIED-ONBOARDING] Starting comprehensive setup...
[MODEL-MANAGER] Found 2 missing Ollama models
[MODEL-MANAGER] Starting download of qllama/bge-large-en-v1.5:latest...
[MODEL-MANAGER] qllama/bge-large-en-v1.5:latest: pulling manifest
[MODEL-MANAGER] qllama/bge-large-en-v1.5:latest: pulling [layer] (45%)
[MODEL-MANAGER] ✅ Successfully downloaded qllama/bge-large-en-v1.5:latest
[MODEL-MANAGER] Starting download of hf.co/gpustack/bge-m3-GGUF:Q6_K...
[MODEL-MANAGER] hf.co/gpustack/bge-m3-GGUF:Q6_K: pulling manifest
[MODEL-MANAGER] ✅ Successfully downloaded hf.co/gpustack/bge-m3-GGUF:Q6_K
[SIMPLIFIED-ONBOARDING] All setup tasks completed successfully
[SIMPLIFIED-ONBOARDING] Completing onboarding...
```

---

## Success Criteria

### Must Have ✅
- [ ] All missing models download successfully
- [ ] Progress bars update in real-time
- [ ] Status messages are user-friendly
- [ ] Parallel execution works (Whisper + Ollama)
- [ ] Setup completes and proceeds to app
- [ ] No errors in console

### Nice to Have ✨
- [ ] Smooth animations
- [ ] Fun loading messages
- [ ] Cards are centered properly
- [ ] Overall progress is accurate
- [ ] No UI glitches

### Error Scenarios to Test Later
- [ ] Ollama not running
- [ ] Network disconnected during download
- [ ] Disk full
- [ ] User cancels setup

---

## Debug Commands

### Check Ollama Models
```bash
curl http://localhost:11434/api/tags | python3 -m json.tool
```

### Check Whisper Installation
```bash
ls -la node_modules/nodejs-whisper/cpp/whisper.cpp/build/bin/whisper-cli
ls -la models/ggml-base.en.bin
```

### Monitor Network
```bash
# Watch Ollama API calls
lsof -i :11434

# Monitor download progress
watch -n 1 'curl http://localhost:11434/api/tags | grep bge'
```

### Check Logs
```bash
# App logs
tail -f logs_*

# Electron logs
tail -f ~/Library/Logs/Drillbit/main.log
```

---

## Post-Test Verification

### After Setup Completes

**Check Models Installed**:
```bash
curl http://localhost:11434/api/tags | grep -E "bge-large|bge-m3"
```

**Expected**:
```json
{
  "name": "qllama/bge-large-en-v1.5:latest",
  "size": 358114184
},
{
  "name": "hf.co/gpustack/bge-m3-GGUF:Q6_K",
  "size": ~1200000000
}
```

**Check Config**:
```bash
cat ~/.config/drillbit/config.json | grep -A5 "onboarding"
```

**Expected**:
```json
{
  "onboarding": {
    "complete": true,
    "firstLaunchDate": "2025-11-01T..."
  },
  "features": {
    "images": true,
    "videos": true,
    "audio": false
  }
}
```

---

## Known Issues / Expected Behavior

### Slow Download Progress
- ✅ **Expected** - Large models take time
- ✅ **No timeout** - Will run as long as needed
- ✅ **Progress updates** - Shows percentage

### Whisper Build Time
- ✅ **Expected** - CMake build takes 1-2 minutes
- ✅ **Only on first run** - Skipped if already built
- ✅ **Progress shown** - 0-100%

### Multiple Layers
- ✅ **Expected** - Models have multiple layers
- ✅ **Progress per layer** - Shows current layer progress
- ✅ **Sequential layers** - One at a time

---

## Test Results

### Date: ___________
### Tester: ___________

**Overall Result**: [ ] PASS / [ ] FAIL

**Notes**:
```
(Add observations here)
```

**Screenshots**:
- [ ] Welcome screen
- [ ] Feature selection
- [ ] Setup progress (0%)
- [ ] Setup progress (50%)
- [ ] Setup progress (100%)
- [ ] Completed app

**Issues Found**:
```
(List any bugs or issues)
```

**Performance**:
- Download time: _______ minutes
- Total setup time: _______ minutes
- Network speed: _______ Mbps

---

## Ready to Test! 🚀

**Current Status**:
- ✅ Models deleted (bge-large, bge-m3)
- ✅ ModelManager implemented
- ✅ SetupProgress component created
- ✅ SimplifiedOnboarding integrated
- ✅ Parallel execution configured
- ✅ No timeout on downloads
- ✅ Cards centered in UI

**Start the test**: `npm run dev`

Good luck! 🎉
