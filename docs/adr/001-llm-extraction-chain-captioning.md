# ADR 001: LLM Extraction Chain for Multi-Pass Image Captioning

**Status:** Proposed  
**Date:** 2025-10-25  
**Deciders:** Engineering Team  
**Technical Story:** Implement efficient multi-pass image analysis with structured metadata extraction

---

## Context and Problem Statement

Current image captioning uses moondream:v2 for generating captions. For advanced use cases (video analysis, scene reconstruction), we need multi-pass analysis to extract spatial, temporal, and contextual information. 

**Problem:** Direct chaining of full captions as context causes:
- Token waste through context repetition
- Model ignoring specific questions
- Unpredictable token costs
- Information loss in subsequent passes

**Need:** Efficient multi-pass approach that:
- Minimizes expensive vision model token usage
- Produces focused, non-repetitive answers
- Generates structured metadata for search/filtering
- Supports video keyframe analysis

---

## Decision Drivers

1. **Token Efficiency** - Vision model (moondream) tokens are more expensive than text model tokens
2. **Quality** - Need focused answers without context repetition
3. **Structured Metadata** - Want searchable/filterable elements (objects, colors, time, etc.)
4. **Scalability** - Processing millions of images/video frames
5. **Flexibility** - Support different analysis modes (general, video, spatial)
6. **Cost** - Optimize for production at scale

---

## Considered Options

### Option 1: Independent Passes (Current Baseline)
Each pass receives only image + prompt, no context sharing.

**Pros:**
- Simple implementation
- Can parallelize all passes
- Predictable token usage
- No context management

**Cons:**
- Uses full moondream tokens for each pass (359 tokens for 3 passes)
- Some information redundancy across passes
- No structured metadata extraction

### Option 2: Chained Context Passes
Each pass receives image + prompt + previous outputs as context.

**Pros:**
- Potentially builds on previous knowledge
- Narrative coherence (in theory)

**Cons:**
- ❌ Model repeats context verbatim (tested)
- ❌ Ignores specific questions (tested)
- ❌ Unpredictable token usage (tested)
- ❌ Information loss (tested)
- ❌ Must run sequentially

### Option 3: LLM Extraction Chain (Proposed)
Use LLM to extract structured elements, then send targeted prompts with elements only.

**Pros:**
- ✅ 15% moondream token savings (306 vs 359 tokens)
- ✅ No context repetition
- ✅ Focused, quality answers
- ✅ Structured metadata byproduct
- ✅ Flexible for different use cases

**Cons:**
- More complex (two models)
- Sequential processing
- 58 token extraction overhead (cheaper model)

---

## Decision Outcome

**Chosen option: Option 3 - LLM Extraction Chain**

Implement a phased captioning system with:
1. **Phase 1:** Moondream generates comprehensive caption
2. **Phase 2:** Llama3.2 extracts structured elements
3. **Phase 3+:** Moondream receives targeted prompts with extracted elements

**Rationale:**
- 15% cost savings on expensive vision model tokens
- Better quality (no repetition, focused answers)
- Structured metadata enables advanced search/filtering
- Scales well for video analysis (many keyframes)
- Complexity is justified by production benefits

---

## Video Pipeline Integration

### Mapping to Existing Video Phases

The multi-pass analysis integrates into the existing video processing pipeline:

#### **Phase 0: Audio Transcription** (existing, unchanged)
- Extract audio track
- Transcribe with Whisper
- Store transcription segments with timestamps

#### **Phase 1: Captioning + Scene Reconstruction** (existing + enhanced)
- Extract keyframes (scene boundaries or uniform sampling)
- **Per keyframe:** Moondream one-shot caption
  - Prompt: "What do you see in this image? Describe everything including the setting, objects, people, activities, colors, lighting, and mood."
  - ~120 tokens per frame
- Scene reconstruction using captions + transcription
- **Output:** Keyframes with captions, reconstructed scenes

#### **Phase 2: Extraction + Spatial Analysis** (new)
- **For each keyframe:**
  - **Llama3.2 extraction** (~58 tokens):
    - Extract: OBJECTS, PEOPLE, COLORS, LIGHTING, TIME, SETTING, MOOD
    - Store as `caption_elements` (structured metadata)
  - **Spatial analysis** (~95 tokens):
    - Build targeted prompt from extracted elements
    - Moondream analyzes spatial arrangement
    - Store as `caption_spatial`
- **No scene reconstruction** in this phase
- **Output:** Structured elements + spatial layout per keyframe

#### **Phase 3: Segmentation Check + Temporal Analysis** (new)
- **Segmentation decision** (~50 tokens, amortized):
  - Llama3.2 analyzes timeline of extracted elements
  - Determines if finer frame sampling is needed
  - If YES: Extract additional frames between keyframes
  - If NO: Proceed with existing keyframes
- **Temporal analysis** (~91 tokens per frame):
  - Build targeted prompt from extracted elements
  - Moondream analyzes actions, movements, predictions
  - Store as `caption_temporal`
- **Output:** Temporal analysis per keyframe, additional frames if needed

#### **Phase 4: Additional Details** (skip - derive from existing)
- Object enumeration → from `caption_elements.objects`
- Scene type → from `caption_elements.setting`
- Attention/focus → infer from spatial analysis (foreground)
- Mood → from `caption_elements.mood`

---

## Implementation Plan

### Phase 1: Core Infrastructure

#### 1.1 Create Extraction Service

```typescript
// src/core/processors/llm-extraction-service.ts

export interface ExtractedElements {
  objects: string[];
  people: string[];
  colors: string[];
  lighting: string;
  time: string;
  setting: string;
  mood?: string;
}

export class LLMExtractionService {
  private baseUrl: string;
  private model: string; // llama3.2:3b
  
  async extractElements(caption: string): Promise<ExtractedElements> {
    const prompt = this.buildExtractionPrompt(caption);
    const response = await this.callLLM(prompt);
    return this.parseExtractedElements(response);
  }
  
  private buildExtractionPrompt(caption: string): string {
    return `Extract structured information from this image description. Return ONLY a concise list in this exact format:

OBJECTS: [comma-separated list]
PEOPLE: [comma-separated list or 'none']
COLORS: [comma-separated list]
LIGHTING: [brief description]
TIME: [time of day]
SETTING: [brief location description]
MOOD: [optional mood/atmosphere]

Description: ${caption}`;
  }
  
  private parseExtractedElements(text: string): ExtractedElements {
    const lines = text.split('\n');
    return {
      objects: this.extractLine(lines, 'OBJECTS:').split(',').map(s => s.trim()),
      people: this.extractLine(lines, 'PEOPLE:').split(',').map(s => s.trim()),
      colors: this.extractLine(lines, 'COLORS:').split(',').map(s => s.trim()),
      lighting: this.extractLine(lines, 'LIGHTING:'),
      time: this.extractLine(lines, 'TIME:'),
      setting: this.extractLine(lines, 'SETTING:'),
      mood: this.extractLine(lines, 'MOOD:') || undefined
    };
  }
  
  private extractLine(lines: string[], prefix: string): string {
    const line = lines.find(l => l.startsWith(prefix));
    return line ? line.substring(prefix.length).trim() : '';
  }
}
```

#### 1.2 Create Phase-Specific Query Builder

```typescript
// src/core/processors/phase-query-builder.ts

export enum AnalysisPhase {
  GENERAL = 'general',
  SPATIAL = 'spatial',
  TEMPORAL = 'temporal',
  CONTEXTUAL = 'contextual'
}

export class PhaseQueryBuilder {
  /**
   * Build targeted prompt for spatial analysis
   */
  buildSpatialPrompt(elements: ExtractedElements): string {
    return `Given these elements in the image:
Objects: ${elements.objects.join(', ')}
People: ${elements.people.join(', ')}
Setting: ${elements.setting}

Describe their spatial arrangement. Where is each positioned? What is in the foreground, middle ground, and background? How are elements arranged in depth?`;
  }
  
  /**
   * Build targeted prompt for temporal analysis
   */
  buildTemporalPrompt(elements: ExtractedElements): string {
    return `Given this scene:
Time: ${elements.time}
Lighting: ${elements.lighting}
Objects: ${elements.objects.join(', ')}
People: ${elements.people.join(', ')}

What actions or movements are happening? What might happen next in this scene? Describe any sense of motion or dynamic elements.`;
  }
  
  /**
   * Build targeted prompt for contextual analysis
   */
  buildContextualPrompt(elements: ExtractedElements): string {
    return `Given this scene:
Setting: ${elements.setting}
Objects: ${elements.objects.join(', ')}
People: ${elements.people.join(', ')}
Mood: ${elements.mood || 'unknown'}

What is the context or purpose of this scene? What type of location is this? What activities typically happen here?`;
  }
  
  /**
   * Build prompt for video keyframe sequence analysis
   */
  buildVideoSequencePrompt(elements: ExtractedElements): string {
    return `Given this moment in a video:
Time: ${elements.time}
Objects: ${elements.objects.join(', ')}
People: ${elements.people.join(', ')}
Actions: Describe what is happening

If this is one frame in a video sequence, what likely happened just before this moment? What might happen in the next few moments? Describe the flow of action.`;
  }
  
  /**
   * Build prompt for segmentation check (Phase 3)
   * Determines if finer frame sampling is needed
   */
  buildSegmentationCheckPrompt(timeline: Array<{timestamp: number, elements: ExtractedElements}>): string {
    const timelineStr = timeline.map(t => 
      `[t=${t.timestamp}s] Objects: ${t.elements.objects.join(', ')}, People: ${t.elements.people.join(', ')}, Setting: ${t.elements.setting}`
    ).join('\n');
    
    return `Analyze this video timeline:

${timelineStr}

Are there rapid changes, multiple distinct actions, or scene transitions that require more detailed frame sampling between these keyframes?

Consider:
- Sudden object/people changes
- Action transitions (e.g., person sitting → standing → walking)
- Scene cuts or camera angle changes
- Fast-moving objects

Return ONLY: YES or NO, followed by a brief reason.

Example: "YES - Person transitions from sitting to standing between t=5s and t=10s, need intermediate frames."
Example: "NO - Scene is static with minimal changes, existing keyframes are sufficient."`;
  }
}
```

#### 1.3 Create Multi-Pass Captioning Service

```typescript
// src/core/processors/multi-pass-captioning-service.ts

export interface CaptioningMode {
  type: 'general' | 'video' | 'spatial' | 'full';
  phases: AnalysisPhase[];
}

export interface MultiPassResult {
  caption: string;
  elements: ExtractedElements;
  spatial?: string;
  temporal?: string;
  contextual?: string;
  tokens: {
    caption: number;
    extraction: number;
    spatial?: number;
    temporal?: number;
    contextual?: number;
    total: number;
    moondreamTotal: number;
  };
}

export class MultiPassCaptioningService {
  private moondreamService: OllamaCaptioningService;
  private extractionService: LLMExtractionService;
  private queryBuilder: PhaseQueryBuilder;
  
  constructor() {
    this.moondreamService = new OllamaCaptioningService();
    this.extractionService = new LLMExtractionService();
    this.queryBuilder = new PhaseQueryBuilder();
  }
  
  /**
   * Analyze image with specified mode
   */
  async analyze(imagePath: string, mode: CaptioningMode): Promise<MultiPassResult> {
    // Phase 1: Get comprehensive caption
    const captionResult = await this.moondreamService.caption(imagePath, {
      prompt: "What do you see in this image? Describe everything including the setting, objects, people, activities, colors, lighting, and mood."
    });
    
    // Phase 2: Extract structured elements
    const elements = await this.extractionService.extractElements(captionResult.caption);
    
    const result: MultiPassResult = {
      caption: captionResult.caption,
      elements: elements,
      tokens: {
        caption: captionResult.metadata.tokens,
        extraction: 0, // Will be updated
        total: captionResult.metadata.tokens,
        moondreamTotal: captionResult.metadata.tokens
      }
    };
    
    // Phase 3+: Execute requested analysis phases
    for (const phase of mode.phases) {
      await this.executePhase(imagePath, phase, elements, result);
    }
    
    return result;
  }
  
  private async executePhase(
    imagePath: string,
    phase: AnalysisPhase,
    elements: ExtractedElements,
    result: MultiPassResult
  ): Promise<void> {
    let prompt: string;
    
    switch (phase) {
      case AnalysisPhase.SPATIAL:
        prompt = this.queryBuilder.buildSpatialPrompt(elements);
        const spatialResult = await this.moondreamService.caption(imagePath, { prompt });
        result.spatial = spatialResult.caption;
        result.tokens.spatial = spatialResult.metadata.tokens;
        result.tokens.moondreamTotal += spatialResult.metadata.tokens;
        break;
        
      case AnalysisPhase.TEMPORAL:
        prompt = this.queryBuilder.buildTemporalPrompt(elements);
        const temporalResult = await this.moondreamService.caption(imagePath, { prompt });
        result.temporal = temporalResult.caption;
        result.tokens.temporal = temporalResult.metadata.tokens;
        result.tokens.moondreamTotal += temporalResult.metadata.tokens;
        break;
        
      case AnalysisPhase.CONTEXTUAL:
        prompt = this.queryBuilder.buildContextualPrompt(elements);
        const contextualResult = await this.moondreamService.caption(imagePath, { prompt });
        result.contextual = contextualResult.caption;
        result.tokens.contextual = contextualResult.metadata.tokens;
        result.tokens.moondreamTotal += contextualResult.metadata.tokens;
        break;
    }
    
    result.tokens.total = result.tokens.moondreamTotal + result.tokens.extraction;
  }
  
  /**
   * Predefined modes for common use cases
   */
  static readonly MODES = {
    GENERAL: {
      type: 'general' as const,
      phases: []
    },
    VIDEO: {
      type: 'video' as const,
      phases: [AnalysisPhase.TEMPORAL]
    },
    SPATIAL: {
      type: 'spatial' as const,
      phases: [AnalysisPhase.SPATIAL]
    },
    FULL: {
      type: 'full' as const,
      phases: [AnalysisPhase.SPATIAL, AnalysisPhase.TEMPORAL, AnalysisPhase.CONTEXTUAL]
    }
  };
}
```

### Phase 2: Integration with Existing System

#### 2.1 Update Media Item Schema

```typescript
// Add new fields to media_items table
interface MediaItem {
  // ... existing fields
  
  // Multi-pass analysis results
  caption_elements?: ExtractedElements;
  caption_spatial?: string;
  caption_temporal?: string;
  caption_contextual?: string;
  
  // Token tracking
  caption_tokens?: {
    total: number;
    moondream: number;
    extraction: number;
  };
  
  // Analysis mode used
  caption_mode?: 'general' | 'video' | 'spatial' | 'full';
}
```

#### 2.2 Update Captioning Processor

```typescript
// src/core/processors/captioning-processor.ts

export class CaptioningProcessor {
  private multiPassService: MultiPassCaptioningService;
  
  async processMediaItem(item: MediaItem, mode?: CaptioningMode): Promise<void> {
    // Determine mode based on media type
    const captioningMode = mode || this.determineMode(item);
    
    // Execute multi-pass analysis
    const result = await this.multiPassService.analyze(item.path, captioningMode);
    
    // Update media item
    await this.updateMediaItem(item.id, {
      caption: result.caption,
      caption_elements: result.elements,
      caption_spatial: result.spatial,
      caption_temporal: result.temporal,
      caption_contextual: result.contextual,
      caption_tokens: result.tokens,
      caption_mode: captioningMode.type,
      caption_status: 'completed',
      caption_generated_at: new Date().toISOString()
    });
  }
  
  private determineMode(item: MediaItem): CaptioningMode {
    // Video keyframes get temporal analysis
    if (item.type === 'video' || item.metadata?.isKeyframe) {
      return MultiPassCaptioningService.MODES.VIDEO;
    }
    
    // Default to general for images
    return MultiPassCaptioningService.MODES.GENERAL;
  }
}
```

### Phase 3: Search and Retrieval Enhancement

#### 3.1 Structured Search

```typescript
// src/core/search/structured-search.ts

export interface StructuredSearchQuery {
  objects?: string[];
  people?: string[];
  colors?: string[];
  time?: string;
  setting?: string;
  mood?: string;
}

export class StructuredSearchService {
  /**
   * Search media items by structured elements
   */
  async search(query: StructuredSearchQuery): Promise<MediaItem[]> {
    const filters = [];
    
    if (query.objects) {
      filters.push(`caption_elements->>'objects' @> '${JSON.stringify(query.objects)}'`);
    }
    
    if (query.colors) {
      filters.push(`caption_elements->>'colors' @> '${JSON.stringify(query.colors)}'`);
    }
    
    if (query.time) {
      filters.push(`caption_elements->>'time' ILIKE '%${query.time}%'`);
    }
    
    if (query.setting) {
      filters.push(`caption_elements->>'setting' ILIKE '%${query.setting}%'`);
    }
    
    // Execute query with filters
    return this.db.query(`
      SELECT * FROM media_items
      WHERE ${filters.join(' AND ')}
      ORDER BY created_at DESC
    `);
  }
}
```

### Phase 4: Configuration

#### 4.1 Add Configuration Options

```typescript
// config.ts

export interface CaptioningConfig {
  // Existing config
  provider: 'ollama';
  model: 'moondream:v2';
  
  // New multi-pass config
  multiPass: {
    enabled: boolean;
    extractionModel: 'llama3.2:3b';
    defaultMode: 'general' | 'video' | 'spatial' | 'full';
    
    // Mode-specific settings
    modes: {
      video: {
        phases: string[];
        enableSequenceAnalysis: boolean;
      };
      spatial: {
        phases: string[];
        includeDepthLayers: boolean;
      };
      full: {
        phases: string[];
      };
    };
  };
}
```

---

## Implementation Phases

### Phase 1: Core Services (Week 1)
- [ ] Implement `LLMExtractionService`
- [ ] Implement `PhaseQueryBuilder`
- [ ] Implement `MultiPassCaptioningService`
- [ ] Unit tests for extraction and query building

### Phase 2: Integration (Week 2)
- [ ] Update database schema
- [ ] Integrate with `CaptioningProcessor`
- [ ] Add configuration options
- [ ] Migration script for existing data

### Phase 3: Search Enhancement (Week 3)
- [ ] Implement `StructuredSearchService`
- [ ] Add search API endpoints
- [ ] Update UI for structured search
- [ ] Index optimization

### Phase 4: Video Support (Week 4)
- [ ] Video keyframe extraction
- [ ] Temporal sequence analysis
- [ ] Video timeline visualization
- [ ] Performance optimization

---

## Consequences

### Positive

1. **Cost Savings**
   - 15% reduction in moondream token usage
   - ~13% overall cost reduction at scale
   - Cheaper text model for extraction

2. **Quality Improvement**
   - No context repetition
   - Focused, relevant answers
   - Better spatial/temporal analysis

3. **Enhanced Search**
   - Structured metadata enables advanced filtering
   - Object/color/time-based search
   - Better categorization

4. **Video Analysis**
   - Efficient keyframe processing
   - Temporal sequence understanding
   - Action prediction

5. **Flexibility**
   - Different modes for different use cases
   - Easy to add new analysis phases
   - Configurable per media type

### Negative

1. **Complexity**
   - Two models to manage (moondream + llama)
   - More code to maintain
   - Sequential processing (can't fully parallelize)

2. **Latency**
   - Additional extraction step adds ~200-500ms
   - Sequential phases add latency
   - Not suitable for real-time use cases

3. **Dependencies**
   - Requires llama3.2:3b model
   - Extraction quality depends on LLM
   - More failure points

4. **Migration**
   - Need to update existing captions
   - Database schema changes
   - Backward compatibility considerations

---

## Risks and Mitigation

### Risk 1: Extraction Quality
**Risk:** LLM might miss important elements or extract incorrectly

**Mitigation:**
- Validate extraction output format
- Fallback to independent passes if extraction fails
- Monitor extraction accuracy metrics
- Use structured output validation

### Risk 2: Model Availability
**Risk:** llama3.2 or moondream might not be available

**Mitigation:**
- Health checks for both models
- Graceful degradation to single-pass
- Circuit breaker pattern
- Model fallback configuration

### Risk 3: Performance
**Risk:** Sequential processing might be too slow

**Mitigation:**
- Batch processing for multiple images
- Async processing with job queue
- Cache extraction results
- Optimize model loading

### Risk 4: Cost Overrun
**Risk:** Total tokens might exceed budget despite savings

**Mitigation:**
- Token usage monitoring and alerts
- Configurable mode selection per media type
- Budget limits per analysis
- A/B testing to validate savings

---

## Monitoring and Metrics

### Key Metrics to Track

1. **Token Usage**
   - Moondream tokens per image
   - Extraction tokens per image
   - Total tokens per mode
   - Cost per image

2. **Quality**
   - Extraction accuracy (manual sampling)
   - Answer relevance scores
   - Context repetition detection
   - User feedback on search results

3. **Performance**
   - End-to-end latency per mode
   - Extraction latency
   - Model response times
   - Queue depth

4. **Adoption**
   - Mode usage distribution
   - Search query types
   - Structured search usage
   - Feature utilization

---

## Alternatives Considered

### Alternative 1: Keep Independent Passes
**Rejected because:** Higher moondream token costs, no structured metadata

### Alternative 2: Use Chained Context
**Rejected because:** Testing showed context repetition, quality degradation

### Alternative 3: Single-Pass with Post-Processing
**Rejected because:** Can't get specialized spatial/temporal analysis from single pass

### Alternative 4: Use GPT-4V for Everything
**Rejected because:** Much higher cost, external API dependency

---

## References

- [Test Results: One-Shot vs Phased Analysis](/Users/darksied/dev/pocs/drillbit/docs/oneshot-vs-phased-analysis.md)
- [Test Results: Chained vs Independent](/Users/darksied/dev/pocs/drillbit/docs/chained-vs-independent-analysis.md)
- [Test Results: LLM Extraction Chain](/Users/darksied/dev/pocs/drillbit/docs/llm-extraction-chain-approach.md)
- Test Scripts: `/tmp/test_*.sh`

---

## Decision

**Status: PROPOSED**

Awaiting review and approval from:
- [ ] Engineering Lead
- [ ] Product Owner
- [ ] DevOps (for model deployment)
- [ ] QA (for testing strategy)

**Next Steps:**
1. Review and approve ADR
2. Review detailed implementation checklist: `docs/adr/001-implementation-checklist.md`
3. Set up development environment with llama3.2
4. Begin Phase 0 preparation tasks
5. Follow incremental rollout strategy (Week 0-4)

**Implementation Guide:** See `docs/adr/001-implementation-checklist.md` for detailed task breakdown, error prevention strategies, and rollout timeline.
