# Multi-Pass Captions in Video Processing Pipeline

## Current Video Processing Flow

### Phase 0: Transcription
```
Video → Audio Extraction → Whisper → Transcription
```

### Phase 1: Enhanced Batch Processing (Per 5-min batch)

```
Step 1a: Extract Keyframes
├── Extract 4 keyframes per batch (at 0.2, 0.4, 0.6, 0.8 positions)
└── Save keyframe images

Step 1b: Caption Keyframes
├── For each keyframe:
│   ├── moondream:v2 → Primary caption
│   └── Store caption
└── Result: Array of 4 captions per batch

Step 1c: Scene Reconstruction ← THIS IS WHERE MULTI-PASS SHOULD BE USED
├── Input: transcription + keyframeCaptions[]
├── Prompt: "Audio: {transcription}\nVisual: {captions.join(', ')}"
├── llama3.2:3b → Scene description
└── Result: Reconstructed scene text

Step 1d: Enhanced Multi-Modal Embedding
├── Combine: transcription + captions + scene reconstruction
├── Generate embedding from combined text
└── Store in av_search.db
```

## The Problem

**Current `reconstructSceneForBatch()` only uses primary captions**:

```typescript
private async reconstructSceneForBatch(
  transcription: string, 
  keyframeCaptions: string[]  // ← Only primary captions!
): Promise<string> {
  const visualContext = keyframeCaptions.join('. ');
  
  const prompt = `Based on the following audio transcription and visual descriptions, 
provide a concise scene description (2-3 sentences):

Audio: ${transcription}
Visual: ${visualContext}  // ← Missing spatial & temporal!

Scene Description:`;
  
  // ... call LLM
}
```

**Missing**: Spatial and temporal analysis from multi-pass captioning!

## The Solution

### Option 1: Enhance Scene Reconstruction with Multi-Pass Data (Recommended)

Update `reconstructSceneForBatch()` to accept multi-pass caption data:

```typescript
private async reconstructSceneForBatch(
  transcription: string, 
  keyframeCaptions: Array<{
    caption: string;
    spatial?: string;
    temporal?: string;
    elements?: any;
  }>
): Promise<string> {
  // Build rich visual context from all multi-pass fields
  const visualContext = keyframeCaptions.map(kf => {
    const parts = [kf.caption];
    if (kf.spatial) parts.push(`Spatial: ${kf.spatial}`);
    if (kf.temporal) parts.push(`Temporal: ${kf.temporal}`);
    return parts.join(' | ');
  }).join('\n');
  
  const prompt = `Based on the following audio transcription and visual descriptions, 
provide a concise scene description (2-3 sentences):

Audio: ${transcription}

Visual Context:
${visualContext}

Scene Description:`;
  
  // ... call LLM
}
```

**Example**:

**Before** (primary captions only):
```
Audio: "The speaker discusses the architecture"
Visual: "A large building. A window. Trees visible. Evening light."
→ Scene: "The speaker discusses the architecture of a large building with a window, 
         trees visible in evening light."
```

**After** (with multi-pass):
```
Audio: "The speaker discusses the architecture"
Visual Context:
Frame 1: A large concrete building | Spatial: Building in background, window prominent | Temporal: Late evening, soft lighting
Frame 2: Window detail | Spatial: Window in foreground, trees on left | Temporal: Dusk, shadows lengthening
Frame 3: Trees and building | Spatial: Trees in middle ground, building behind | Temporal: Evening atmosphere
Frame 4: Overall view | Spatial: Wide shot, building dominates frame | Temporal: Twilight setting

→ Scene: "During late evening at twilight, the speaker discusses the architecture of a 
         large concrete building. The building dominates the frame in the background, 
         with a prominent window in the foreground illuminated by soft lighting. Trees 
         are visible in the middle ground on the left side, and long shadows indicate 
         the dusk setting."
```

**Benefits**:
- ✅ Much richer scene descriptions
- ✅ Better temporal context (time of day, lighting changes)
- ✅ Better spatial context (layout, depth, positioning)
- ✅ More accurate reconstruction

### Option 2: Two-Stage Scene Reconstruction

Keep simple reconstruction, but add a refinement pass:

```typescript
// Stage 1: Quick reconstruction (current approach)
const basicScene = await this.reconstructSceneForBatch(
  transcription,
  keyframeCaptions.map(kf => kf.caption)
);

// Stage 2: Refine with multi-pass data (optional, if enabled)
if (config.multiPass?.phases?.enableSceneRefinement) {
  const refinedScene = await this.refineSceneWithMultiPass(
    basicScene,
    keyframeCaptions // Full multi-pass data
  );
  return refinedScene;
}

return basicScene;
```

**Benefits**:
- ✅ Backward compatible
- ✅ Can enable/disable refinement
- ✅ Incremental improvement

**Cons**:
- ❌ Two LLM calls (slower, more tokens)
- ❌ More complex

## Recommended Implementation

### Step 1: Update `captionBatchKeyframes()` to Return Multi-Pass Data

Currently returns:
```typescript
Array<{ keyframeId: string; caption: string; confidence?: number }>
```

Should return:
```typescript
Array<{ 
  keyframeId: string; 
  caption: string; 
  spatial?: string;
  temporal?: string;
  elements?: any;
  tokens?: any;
  confidence?: number 
}>
```

**Code change**:
```typescript
private async captionBatchKeyframes(keyframes: BatchKeyframe[]): Promise<Array<{
  keyframeId: string;
  caption: string;
  spatial?: string;
  temporal?: string;
  elements?: any;
  tokens?: any;
  confidence?: number;
}>> {
  // ... existing code ...
  
  for (const keyframe of keyframes) {
    try {
      let caption: string;
      let multiPassData: any = null;

      if (useMultiPass) {
        // Multi-pass analysis
        const multiPassResult = await this.multiPassService!.analyzeImage(keyframe.imagePath);
        caption = multiPassResult.caption;
        multiPassData = {
          spatial: multiPassResult.spatial,
          temporal: multiPassResult.temporal,
          elements: multiPassResult.elements,
          tokens: multiPassResult.tokens
        };
      } else {
        // Standard captioning
        const result = await activeService.caption(keyframe.imagePath);
        caption = result.caption;
      }
      
      results.push({
        keyframeId: keyframe.id,
        caption,
        ...multiPassData,  // ← Include multi-pass data
        confidence: 1.0
      });
      
    } catch (error) {
      // ... error handling
    }
  }
  
  return results;
}
```

### Step 2: Update `reconstructSceneForBatch()` Signature

```typescript
private async reconstructSceneForBatch(
  transcription: string, 
  keyframeCaptions: Array<{
    caption: string;
    spatial?: string;
    temporal?: string;
    elements?: any;
  }>
): Promise<string> {
  try {
    // Build rich visual context
    const visualContext = keyframeCaptions
      .filter(kf => kf.caption && kf.caption !== 'Visual content')
      .map((kf, idx) => {
        const parts = [`Frame ${idx + 1}: ${kf.caption}`];
        
        if (kf.spatial) {
          parts.push(`  Spatial: ${kf.spatial}`);
        }
        
        if (kf.temporal) {
          parts.push(`  Temporal: ${kf.temporal}`);
        }
        
        return parts.join('\n');
      })
      .join('\n\n');
    
    if (!transcription && !visualContext) {
      return 'Scene content';
    }

    // Build enhanced scene reconstruction prompt
    const prompt = `Based on the following audio transcription and detailed visual descriptions, 
provide a concise scene description (2-3 sentences):

Audio: ${transcription}

Visual Context:
${visualContext}

Scene Description:`;

    // Call Ollama for scene reconstruction
    const config = ConfigManager.getConfig();
    const baseUrl = config.ai.embedUrl;
    const model = config.ai.generalPurposeModel;
    
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: {
          temperature: 0.7,
          num_predict: 150  // Slightly more tokens for richer descriptions
        }
      })
    });

    if (!response.ok) {
      console.warn(`[ENHANCED-BATCH] Scene reconstruction API returned ${response.status}`);
      return `${transcription.substring(0, 200)}...`;
    }

    const data = await response.json();
    const sceneDescription = data.response?.trim() || transcription.substring(0, 200);
    
    return sceneDescription;

  } catch (error) {
    console.error(`[ENHANCED-BATCH] Scene reconstruction failed:`, error);
    return transcription.substring(0, 200) || 'Scene content';
  }
}
```

### Step 3: Update the Call Site

In the batch processing loop:

```typescript
// Step 1b: Caption keyframes (now returns multi-pass data)
console.log(`[ENHANCED-BATCH] 📝 Captioning keyframes...`);
const keyframeCaptions = await this.captionBatchKeyframes(keyframes);
console.log(`[ENHANCED-BATCH] ✅ Generated ${keyframeCaptions.length} captions`);

// Step 1c: Generate scene reconstruction (now uses multi-pass data)
console.log(`[ENHANCED-BATCH] 🎬 Generating scene reconstruction...`);
const sceneReconstruction = await this.reconstructSceneForBatch(
  batch.transcription || '',
  keyframeCaptions  // ← Now includes spatial, temporal, elements
);
console.log(`[ENHANCED-BATCH] ✅ Scene reconstruction: ${sceneReconstruction.substring(0, 100)}...`);
```

## Impact on Enhanced Multi-Modal Embedding

The embedding generation (Step 1d) will automatically benefit:

```typescript
// Step 1d: Generate enhanced multi-modal embedding
const enhancedText = `${batch.transcription}\n\nVisual Context: ${keyframeCaptions.map(kf => kf.caption).join(', ')}\n\nScene Description: ${sceneReconstruction}`;
```

**Before**:
```
Transcription: "The speaker discusses..."
Visual Context: "building, window, trees, evening"
Scene: "The speaker discusses a building with a window..."
→ Embedding captures: audio + basic visuals + simple scene
```

**After**:
```
Transcription: "The speaker discusses..."
Visual Context: "building, window, trees, evening"
Scene: "During late evening at twilight, the speaker discusses the architecture 
        of a large concrete building. The building dominates the frame in the 
        background, with a prominent window in the foreground illuminated by 
        soft lighting. Trees are visible in the middle ground..."
→ Embedding captures: audio + basic visuals + RICH scene with spatial/temporal context
```

**Result**: Better semantic embeddings for search!

## Performance Considerations

### Token Usage

**Before**:
- Scene reconstruction prompt: ~200 tokens
- Scene reconstruction response: ~50 tokens
- Total: ~250 tokens per batch

**After** (with multi-pass):
- Scene reconstruction prompt: ~400 tokens (+100%)
- Scene reconstruction response: ~100 tokens (+100%)
- Total: ~500 tokens per batch (+100%)

**Cost**: ~2x tokens for scene reconstruction, but much better quality

### Processing Time

**Before**:
- Scene reconstruction: ~500ms per batch

**After**:
- Scene reconstruction: ~800ms per batch (+60%)

**Impact**: Acceptable - scene reconstruction is background process

### Overall Video Processing

For a 30-minute video (6 batches):
- **Before**: 6 × 500ms = 3 seconds for scene reconstruction
- **After**: 6 × 800ms = 4.8 seconds for scene reconstruction
- **Increase**: +1.8 seconds total (+60%)

**Conclusion**: Minimal impact on overall processing time

## Configuration

Add to config:

```typescript
multiPass: {
  enabled: true,
  phases: {
    enableExtraction: true,
    enableSpatial: true,
    enableTemporal: true,
    enableSceneRefinement: true  // ← New flag
  }
}
```

## Summary

### Current Flow
```
Transcription → Keyframes → Captions → Scene Reconstruction → Embedding
                                ↓
                         (primary only)
```

### Enhanced Flow
```
Transcription → Keyframes → Multi-Pass Captions → Enhanced Scene Reconstruction → Better Embedding
                                ↓
                    (caption + spatial + temporal)
```

### Benefits
1. ✅ **Richer scene descriptions** - Spatial and temporal context
2. ✅ **Better embeddings** - More semantic information
3. ✅ **Better search** - More accurate scene understanding
4. ✅ **Minimal overhead** - +60% time, +100% tokens (acceptable)

### Implementation Checklist
- [ ] Update `captionBatchKeyframes()` return type
- [ ] Update `reconstructSceneForBatch()` signature
- [ ] Modify prompt to include spatial/temporal
- [ ] Test with sample videos
- [ ] Measure token usage increase
- [ ] Verify scene quality improvement
- [ ] Monitor processing time impact

---

**Status**: Recommendation  
**Priority**: High - Scene reconstruction is key to search quality  
**Effort**: Medium - ~2-3 hours implementation + testing
