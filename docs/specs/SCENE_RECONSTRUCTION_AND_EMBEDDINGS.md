# Scene Reconstruction & Embeddings with Multi-Pass Captions

## Question 1: How is Scene Reconstruction Affected?

### Current Scene Reconstruction

Scene reconstruction currently uses:
```typescript
const prompt = `Describe this single video scene in details:

Time: ${segment.startTime}s-${segment.endTime}s
Audio: ${segment.transcription}
Visual: ${segment.caption}          // ← Only primary caption
${segment.ocrText ? `Text: ${segment.ocrText}` : ''}

Write a paragraph describing in details what happens in this scene:`;
```

**Problem**: Only uses the primary `caption`, ignoring `spatial` and `temporal` analysis.

### Recommended Enhancement

**Option A: Include All Multi-Pass Fields (Recommended)**

```typescript
const prompt = `Describe this single video scene in details:

Time: ${segment.startTime}s-${segment.endTime}s
Audio: ${segment.transcription}
Visual: ${segment.caption}
Spatial: ${segment.captionSpatial || 'N/A'}
Temporal: ${segment.captionTemporal || 'N/A'}
${segment.ocrText ? `Text: ${segment.ocrText}` : ''}

Write a paragraph describing in details what happens in this scene:`;
```

**Benefits**:
- ✅ LLM gets richer context for reconstruction
- ✅ Spatial info helps describe layout
- ✅ Temporal info helps describe motion/action
- ✅ More accurate scene descriptions

**Example**:

**Before** (caption only):
```
Audio: "The speaker discusses the architecture"
Visual: "A large concrete building with a window"
→ Scene: "The speaker discusses the architecture of a large concrete building with a window."
```

**After** (with multi-pass):
```
Audio: "The speaker discusses the architecture"
Visual: "A large concrete building with a window"
Spatial: "Building in background, window in foreground, trees on left"
Temporal: "Late evening, soft lighting from window"
→ Scene: "During late evening, the speaker discusses the architecture of a large concrete building. The building stands in the background with a prominent window in the foreground, illuminated by soft lighting. Trees are visible on the left side of the frame."
```

**Option B: Structured Elements as Context**

```typescript
const elementsContext = segment.captionElements 
  ? `Objects: ${segment.captionElements.objects.join(', ')}
People: ${segment.captionElements.people.join(', ')}
Setting: ${segment.captionElements.setting}
Time: ${segment.captionElements.time}
Lighting: ${segment.captionElements.lighting}`
  : '';

const prompt = `Describe this single video scene in details:

Time: ${segment.startTime}s-${segment.endTime}s
Audio: ${segment.transcription}
Visual: ${segment.caption}
${elementsContext}
${segment.ocrText ? `Text: ${segment.ocrText}` : ''}

Write a paragraph describing in details what happens in this scene:`;
```

**Benefits**:
- ✅ Structured data helps LLM understand scene components
- ✅ More consistent scene descriptions
- ✅ Better temporal context (time of day, lighting)

---

## Question 2: Are We Creating Embeddings for All Three Fields?

### Current Implementation: **No** (Correct Approach)

We create **ONE embedding** from the **combined FTS text**, not separate embeddings per field.

### Why This is Correct

**Vector embeddings capture semantic meaning**, not keywords. The semantic meaning of:
- "A person walking on a street"
- "Person in foreground, buildings in background"  
- "Walking motion from left to right"

Is essentially the **same scene** - just described from different perspectives.

Creating separate embeddings would:
- ❌ Triple the embedding storage (3x cost)
- ❌ Require 3 vector searches per query (3x latency)
- ❌ Complicate score fusion (how to weight 3 embeddings?)
- ❌ Not improve semantic understanding (same scene, different words)

### What We Actually Do

```typescript
// 1. Store multi-pass data separately in meta_cache
av_meta_cache: {
  caption: "A person walking on a street",
  caption_spatial: "Person in foreground, buildings in background",
  caption_temporal: "Walking motion from left to right",
  caption_elements: {objects: ["person", "street"], ...}
}

// 2. Create ONE embedding from primary caption
embedding = generateEmbedding(caption)  // ← Single embedding

// 3. Combine all text for FTS index
fts_text = caption + " " + spatial + " " + temporal + " " + elements
```

### Search Flow

```
Query: "person walking in foreground"

1. Generate query embedding
   embedding = generateEmbedding(query)

2. Vector search (semantic)
   - Matches: "person walking" semantically
   - Uses: Single embedding from primary caption
   - Score: 0.85

3. FTS search (keywords)
   - Matches: "person" + "walking" + "foreground"
   - Uses: Combined text (caption + spatial + temporal)
   - Score: 0.92

4. Hybrid fusion
   final_score = 0.7 × 0.85 + 0.3 × 0.92 = 0.871
```

**Result**: Best of both worlds!
- Vector: Semantic understanding from primary caption
- FTS: Keyword matching from all fields

---

## Alternative Approach: Multi-Vector Embeddings (Not Recommended)

Some might suggest creating separate embeddings:

```typescript
// ❌ NOT RECOMMENDED
embeddings = {
  caption: generateEmbedding(caption),      // 1024 dims
  spatial: generateEmbedding(spatial),      // 1024 dims
  temporal: generateEmbedding(temporal)     // 1024 dims
}
// Total: 3072 dimensions, 3x storage, 3x search cost
```

**Why not?**

1. **Semantic Redundancy**: All three describe the same scene
2. **Storage Cost**: 3x embedding storage (12 KB vs 4 KB per segment)
3. **Query Cost**: 3 vector searches instead of 1
4. **Fusion Complexity**: How to weight 3 similarity scores?
5. **Diminishing Returns**: FTS already captures keyword differences

**When it might make sense**:
- If spatial/temporal were **completely different scenes** (they're not)
- If you needed **aspect-specific search** (e.g., "search only spatial")
- If you had **unlimited compute budget** (you don't)

---

## Recommended Implementation

### 1. Update Scene Reconstruction

```typescript
// In optimized-scene-reconstruction.ts

private async generateOptimizedSceneDescription(
  segment: SegmentContext, 
  temporalContext: string[],
  config: OptimizedSceneReconstructionConfig
): Promise<string> {
  
  const contextText = temporalContext.length > 0 
    ? `Previous: ${temporalContext.join(' → ')}`
    : 'Start';

  // Build enhanced prompt with multi-pass data
  const visualContext = [
    segment.caption,
    segment.captionSpatial ? `Spatial: ${segment.captionSpatial}` : '',
    segment.captionTemporal ? `Temporal: ${segment.captionTemporal}` : ''
  ].filter(Boolean).join('\n');

  const prompt = `Describe this single video scene in details:

Time: ${segment.startTime}s-${segment.endTime}s
Audio: ${segment.transcription}
Visual Context:
${visualContext}
${segment.ocrText ? `Text: ${segment.ocrText}` : ''}

Write a paragraph describing in details what happens in this scene:`;

  // ... rest of the method
}
```

### 2. Update SegmentContext Interface

```typescript
// In optimized-scene-reconstruction.ts

interface SegmentContext {
  id: string;
  startTime: number;
  endTime: number;
  transcription: string;
  caption: string;
  captionSpatial?: string;      // ← Add
  captionTemporal?: string;     // ← Add
  captionElements?: any;        // ← Add
  ocrText: string;
  reconstructedScene?: string;
}
```

### 3. Fetch Multi-Pass Data

```typescript
// When building segment context, fetch from av_meta_cache

const segmentMeta = await this.avSearchWriter.db.prepare(`
  SELECT 
    caption,
    caption_spatial,
    caption_temporal,
    caption_elements
  FROM av_meta_cache
  WHERE segment_id = ?
`).get(segment.id);

const currentContext: SegmentContext = {
  id: segment.id,
  startTime: segment.startTime,
  endTime: segment.endTime,
  transcription,
  caption: segmentMeta?.caption || caption,
  captionSpatial: segmentMeta?.caption_spatial,
  captionTemporal: segmentMeta?.caption_temporal,
  captionElements: segmentMeta?.caption_elements 
    ? JSON.parse(segmentMeta.caption_elements) 
    : null,
  ocrText
};
```

---

## Performance Impact

### Scene Reconstruction

**Before**:
- Prompt length: ~200 characters
- LLM tokens: ~50 tokens
- Generation time: ~500ms

**After** (with multi-pass):
- Prompt length: ~400 characters (+100%)
- LLM tokens: ~100 tokens (+100%)
- Generation time: ~800ms (+60%)

**Impact**: Acceptable - scene reconstruction is background process

### Embeddings

**Before**:
- 1 embedding per segment: 4 KB
- 1000 segments: 4 MB

**After** (same):
- 1 embedding per segment: 4 KB
- 1000 segments: 4 MB

**Impact**: None - still single embedding

### Search

**Before**:
- 1 vector search + 1 FTS search
- Latency: ~50ms

**After** (same):
- 1 vector search + 1 FTS search (with richer text)
- Latency: ~60ms (+20%)

**Impact**: Minimal - FTS slightly slower with more text

---

## Summary

### Scene Reconstruction
✅ **Should be enhanced** to use multi-pass data
- Include spatial and temporal in prompt
- Richer context → better scene descriptions
- ~60% slower but acceptable for background process

### Embeddings
✅ **Current approach is correct** - single embedding
- One embedding from primary caption (semantic meaning)
- Combined text in FTS (keyword matching)
- No need for multiple embeddings (same scene, different perspectives)

### Search Quality
✅ **Improved without extra cost**
- Vector: Semantic understanding (unchanged)
- FTS: Richer keyword matching (enhanced)
- Hybrid: Best of both worlds

---

## Implementation Checklist

- [ ] Update `SegmentContext` interface with multi-pass fields
- [ ] Modify `generateOptimizedSceneDescription()` to include spatial/temporal
- [ ] Fetch multi-pass data from `av_meta_cache` when building context
- [ ] Test scene reconstruction quality with multi-pass data
- [ ] Monitor LLM token usage increase
- [ ] Verify embeddings remain single per segment
- [ ] Confirm search performance is acceptable

---

## Example: Complete Flow

```
1. Video Processing
   ├── Extract keyframe
   ├── Caption (moondream): "A person walking on a street"
   ├── Extract elements (llama): {objects: ["person", "street"], ...}
   ├── Spatial (moondream): "Person in foreground, buildings in background"
   └── Temporal (moondream): "Walking motion from left to right"

2. Storage
   ├── av_meta_cache: Store all 4 fields separately
   ├── Embedding: Generate 1 embedding from primary caption
   └── FTS: Index combined text (caption + spatial + temporal + elements)

3. Scene Reconstruction
   ├── Fetch: All 4 fields from av_meta_cache
   ├── Prompt: Include caption + spatial + temporal + audio + OCR
   ├── LLM: Generate rich scene description
   └── Store: Reconstructed scene in database

4. Search
   ├── Query: "person walking in foreground"
   ├── Vector: Match semantic meaning (1 embedding)
   ├── FTS: Match keywords in combined text
   ├── Fusion: Combine scores (70% vector + 30% FTS)
   └── Result: Relevant segments with high scores
```

---

**Status**: Recommendation  
**Next Steps**: 
1. Implement scene reconstruction enhancement
2. Test with sample videos
3. Measure quality improvement
4. Monitor performance impact
