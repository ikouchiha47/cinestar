# Multi-Pass Captioning Implementation

## Overview

This implementation adds LLM-assisted extraction chain captioning to both image and video processing pipelines, following the approach documented in `docs/llm-extraction-chain-approach.md`.

## Architecture

### Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     Multi-Pass Captioning Flow                   │
└─────────────────────────────────────────────────────────────────┘

Phase 1: Comprehensive Caption (moondream:v2)
  ↓
  Input: Image
  Output: Natural language description
  Tokens: ~120 (vision model)

Phase 2: Element Extraction (llama3.2:3b)
  ↓
  Input: Caption from Phase 1
  Output: Structured elements (objects, people, colors, lighting, time, setting)
  Tokens: ~58 (text model - cheaper)

Phase 3: Spatial Analysis (moondream:v2) [Optional]
  ↓
  Input: Image + Extracted elements
  Output: Spatial arrangement description
  Tokens: ~95 (vision model)

Phase 4: Temporal Analysis (moondream:v2) [Optional]
  ↓
  Input: Image + Extracted elements
  Output: Temporal/motion analysis
  Tokens: ~91 (vision model)
```

### Token Efficiency

- **Total tokens**: ~364
- **Moondream tokens**: ~306 (15% savings vs independent approach)
- **Extraction overhead**: ~58 tokens (cheaper text model)
- **Benefit**: Structured metadata + reduced vision model usage

## Components

### 1. LLMExtractionService

**File**: `src/core/processors/llm-extraction-service.ts`

Extracts structured elements from natural language captions using llama3.2:3b.

```typescript
interface ExtractedElements {
  objects: string[];
  people: string[];
  colors: string[];
  lighting: string;
  time: string;
  setting: string;
  mood?: string;
}
```

**Features**:
- Robust parsing with fallback values
- Low temperature (0.1) for consistent extraction
- Graceful error handling

### 2. PhaseQueryBuilder

**File**: `src/core/processors/phase-query-builder.ts`

Builds targeted prompts for each analysis phase using extracted elements.

**Methods**:
- `buildSpatialPrompt(elements)` - Spatial arrangement analysis
- `buildTemporalPrompt(elements)` - Temporal/motion analysis
- `buildSegmentationCheckPrompt(timeline)` - Video segmentation check

### 3. MultiPassCaptioningService

**File**: `src/core/processors/multi-pass-captioning-service.ts`

Orchestrates the multi-pass flow, coordinating moondream and llama services.

**Returns**:
```typescript
interface MultiPassResult {
  caption: string;
  elements: ExtractedElements;
  spatial?: string;
  temporal?: string;
  tokens: {
    caption: number;
    extraction: number;
    spatial?: number;
    temporal?: number;
    total: number;
    moondreamOnly: number;
  };
}
```

## Configuration

### Config Schema

Added to `src/core/config.ts`:

```typescript
multiPass?: {
  enabled: boolean;
  extractionModel: string;
  extractionUrl: string;
  phases: {
    enableExtraction: boolean;
    enableSpatial: boolean;
    enableTemporal: boolean;
    enableSegmentationCheck: boolean;
  };
  segmentation: {
    threshold: 'low' | 'medium' | 'high';
    maxAdditionalFrames: number;
  };
}
```

### Default Configuration

```typescript
multiPass: {
  enabled: false, // Start disabled
  extractionModel: 'llama3.2:3b',
  extractionUrl: '', // Uses ai.embedUrl if empty
  phases: {
    enableExtraction: false,
    enableSpatial: false,
    enableTemporal: false,
    enableSegmentationCheck: false
  },
  segmentation: {
    threshold: 'medium',
    maxAdditionalFrames: 10
  }
}
```

### Enabling Multi-Pass

```typescript
import { ConfigManager } from './src/core/config';

// Enable all phases
ConfigManager.updateConfig({
  multiPass: {
    enabled: true,
    extractionModel: 'llama3.2:3b',
    extractionUrl: '',
    phases: {
      enableExtraction: true,
      enableSpatial: true,
      enableTemporal: true,
      enableSegmentationCheck: false
    },
    segmentation: {
      threshold: 'medium',
      maxAdditionalFrames: 10
    }
  }
});
```

## Database Schema

### Migrations

**Files**: 
- `migrations_flat/043_add_multipass_to_av_meta_cache.sql` (for video/audio)
- `migrations_flat/044_add_multipass_to_image_meta_cache.sql` (for images)

Adds new columns to search database meta caches:

**av_search.db (av_meta_cache)**:
```sql
ALTER TABLE av_meta_cache ADD COLUMN caption TEXT;
ALTER TABLE av_meta_cache ADD COLUMN caption_elements TEXT;
ALTER TABLE av_meta_cache ADD COLUMN caption_spatial TEXT;
ALTER TABLE av_meta_cache ADD COLUMN caption_temporal TEXT;
ALTER TABLE av_meta_cache ADD COLUMN caption_tokens TEXT;
```

**image_search.db (image_meta_cache)**:
```sql
ALTER TABLE image_meta_cache ADD COLUMN caption TEXT;
ALTER TABLE image_meta_cache ADD COLUMN caption_elements TEXT;
ALTER TABLE image_meta_cache ADD COLUMN caption_spatial TEXT;
ALTER TABLE image_meta_cache ADD COLUMN caption_temporal TEXT;
ALTER TABLE image_meta_cache ADD COLUMN caption_tokens TEXT;
```

**Fields**:
- `caption`: Primary caption text from moondream
- `caption_elements`: JSON string of ExtractedElements
- `caption_spatial`: Spatial analysis text
- `caption_temporal`: Temporal analysis text
- `caption_tokens`: JSON string of token counts per phase

## Integration

### Image Processing

**File**: `src/core/image-job-processor.ts`

Multi-pass is automatically used when enabled:

```typescript
if (cfg.multiPass?.enabled && this.multiPassService) {
  const multiPassResult = await this.multiPassService.analyzeImage(inferencePath);
  caption = multiPassResult.caption;
  // Store metadata in image_search.db (image_meta_cache)
  this.searchWriter.updateMetaCache(itemId, {
    ...data,
    caption: multiPassResult.caption,
    captionElements: multiPassResult.elements,
    captionSpatial: multiPassResult.spatial,
    captionTemporal: multiPassResult.temporal,
    captionTokens: multiPassResult.tokens
  });
}
```

### Video Processing

**File**: `src/core/video-job-processor-v2.ts`

Multi-pass is applied to keyframe captioning:

```typescript
if (useMultiPass) {
  const multiPassResult = await this.multiPassService!.analyzeImage(keyframe.imagePath);
  // Store in av_search.db (av_meta_cache)
  this.avSearchWriter.updateMultiPassCaption({
    itemId: videoId,
    segmentId: segmentId,
    mediaType: 'video',
    caption: multiPassResult.caption,
    elements: multiPassResult.elements,
    spatial: multiPassResult.spatial,
    temporal: multiPassResult.temporal,
    tokens: multiPassResult.tokens
  });
}
```

## Testing

### Test Script

**File**: `test-multi-pass.ts`

```bash
# Test with a single image
npx tsx test-multi-pass.ts ./path/to/image.jpg
```

**Output**:
- Phase 1: Comprehensive caption
- Phase 2: Extracted elements
- Phase 3: Spatial analysis (if enabled)
- Phase 4: Temporal analysis (if enabled)
- Token summary and savings

### Prerequisites

Ensure models are available:

```bash
# Check moondream:v2
curl -s http://localhost:11434/api/tags | jq -r '.models[].name' | grep moondream

# Check llama3.2:3b
curl -s http://localhost:11434/api/tags | jq -r '.models[].name' | grep llama3.2

# Pull if missing
ollama pull moondream:v2
ollama pull llama3.2:3b
```

## Rollout Strategy

### Incremental Enablement

1. **Week 1: Enable Extraction Only**
   ```typescript
   phases: {
     enableExtraction: true,
     enableSpatial: false,
     enableTemporal: false,
     enableSegmentationCheck: false
   }
   ```
   - Monitor extraction quality
   - Verify structured metadata

2. **Week 2: Enable Spatial Analysis**
   ```typescript
   phases: {
     enableExtraction: true,
     enableSpatial: true,
     enableTemporal: false,
     enableSegmentationCheck: false
   }
   ```
   - Monitor token usage increase
   - Verify spatial analysis quality

3. **Week 3: Enable Temporal Analysis**
   ```typescript
   phases: {
     enableExtraction: true,
     enableSpatial: true,
     enableTemporal: true,
     enableSegmentationCheck: false
   }
   ```
   - Monitor total token usage
   - Verify temporal analysis quality

4. **Week 4: Enable Segmentation Check (Video Only)**
   ```typescript
   phases: {
     enableExtraction: true,
     enableSpatial: true,
     enableTemporal: true,
     enableSegmentationCheck: true
   }
   ```
   - Monitor segmentation decisions
   - Validate additional frame extraction

### Rollback

To disable multi-pass:

```typescript
ConfigManager.updateConfig({
  multiPass: {
    enabled: false,
    // ... rest of config
  }
});
```

No database rollback needed - new columns are nullable.

## Performance Considerations

### Token Costs

- **Moondream tokens**: More expensive (vision model)
- **Llama tokens**: Cheaper (text model)
- **Net savings**: ~15% on moondream tokens

### Processing Time

- **Additional latency**: ~58 tokens for extraction
- **Sequential processing**: Phases run sequentially
- **Trade-off**: Quality + metadata vs speed

### When to Use

✅ **Use multi-pass when**:
- Processing high volumes (cost savings matter)
- Need structured metadata for search/filtering
- Quality over speed
- Multiple specialized analyses needed

❌ **Don't use when**:
- Real-time processing required
- Single comprehensive caption sufficient
- Speed is critical
- Simple use case

## Monitoring

### Metrics to Track

1. **Token usage**:
   - Total tokens per image/video
   - Moondream vs llama token ratio
   - Cost savings vs independent approach

2. **Quality**:
   - Extraction accuracy (manual validation)
   - Spatial analysis relevance
   - Temporal analysis accuracy

3. **Performance**:
   - Processing time per phase
   - Total processing time increase
   - Throughput (images/videos per hour)

4. **Errors**:
   - Extraction failures
   - Parsing errors
   - Service availability

### Logging

All phases log with prefixes:
- `[MULTI-PASS]` - General multi-pass operations
- `[LLM-EXTRACTION]` - Element extraction
- `[PHASE-2]` - Extraction phase
- `[PHASE-3]` - Spatial phase
- `[PHASE-4]` - Temporal phase

## Troubleshooting

### Empty Extraction Response

**Symptom**: LLM returns empty response

**Solution**:
- Check llama3.2:3b is running
- Verify model name is correct
- Check extraction prompt format

### Moondream Empty Response

**Symptom**: Moondream returns empty caption

**Solution**:
- Use simple, natural language prompts
- Avoid markdown formatting
- Check image quality/size

### High Token Usage

**Symptom**: Token usage higher than expected

**Solution**:
- Disable spatial/temporal phases if not needed
- Check for context repetition
- Verify extraction is working correctly

### Slow Processing

**Symptom**: Processing takes too long

**Solution**:
- Disable phases incrementally
- Check model availability
- Verify network latency to Ollama

## Future Enhancements

1. **Parallel Processing**: Run spatial + temporal in parallel
2. **Caching**: Cache extracted elements for similar images
3. **Adaptive Phases**: Auto-enable phases based on image complexity
4. **Batch Extraction**: Extract elements for multiple captions at once
5. **Custom Prompts**: Allow custom prompts per phase
6. **Quality Scoring**: Auto-validate extraction quality

## References

- [ADR: LLM Extraction Chain Captioning](./adr/001-llm-extraction-chain-captioning.md)
- [Implementation Checklist](./adr/001-implementation-checklist.md)
- [Chained vs Independent Analysis](./chained-vs-independent-analysis.md)
- [LLM Extraction Chain Approach](./llm-extraction-chain-approach.md)

## Support

For issues or questions:
1. Check logs for error messages
2. Verify model availability
3. Test with `test-multi-pass.ts` script
4. Review configuration settings
5. Check database schema migration

---

**Last Updated**: 2025-10-25  
**Status**: Implemented, Ready for Testing
