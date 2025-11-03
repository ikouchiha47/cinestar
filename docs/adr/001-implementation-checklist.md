# ADR 001: LLM Extraction Chain - Implementation Checklist

## Prerequisites Verified ✅

- [x] `video_keyframes` table exists (migration 001)
- [x] `OllamaCaptioningService` exists and working
- [x] `video-job-processor-v2.ts` has Phase 1 captioning
- [x] Scene reconstruction exists in Phase 1
- [x] Config system supports `ai.visionModel` and `ai.generalPurposeModel`

---

## Phase 0: Preparation & Validation (Week 0 - Pre-implementation)

### 0.1 Database Schema Validation
- [ ] **Verify `video_keyframes` table has required columns**
  - Existing: `id`, `video_id`, `segment_id`, `image_path`, `label`, `caption`, `embedding`, `created_at`
  - **Action:** No changes needed, schema is sufficient
  
- [ ] **Create migration for new columns**
  - File: `migrations_flat/042_add_multipass_caption_fields.sql`
  - Add to `video_keyframes`:
    - `caption_elements` JSONB (structured metadata)
    - `caption_spatial` TEXT (spatial analysis)
    - `caption_temporal` TEXT (temporal analysis)
    - `caption_tokens` JSONB (token tracking)
  - **Critical:** Use `ALTER TABLE IF NOT EXISTS` to avoid errors
  - **Critical:** Test migration on dev database first

### 0.2 Model Availability Check
- [ ] **Verify llama3.2:3b is available**
  ```bash
  curl -s http://localhost:11434/api/tags | jq -r '.models[].name' | grep llama3.2
  ```
  - **Expected:** `llama3.2:3b` in output
  - **If missing:** Run `ollama pull llama3.2:3b`

- [ ] **Verify moondream:v2 is available**
  ```bash
  curl -s http://localhost:11434/api/tags | jq -r '.models[].name' | grep moondream
  ```
  - **Expected:** `moondream:v2` in output
  - **If missing:** Already exists per code review

### 0.3 Config Validation
- [ ] **Add multipass config to ConfigManager**
  - File: `src/core/config.ts`
  - Add section:
    ```typescript
    multiPass: {
      enabled: boolean;
      extractionModel: string; // 'llama3.2:3b'
      extractionUrl: string; // config.ai.embedUrl
      phases: {
        enableExtraction: boolean;
        enableSpatial: boolean;
        enableTemporal: boolean;
        enableSegmentationCheck: boolean;
      };
    }
    ```
  - **Default values:** All false initially, enable incrementally

---

## Phase 1: Core Services (Week 1)

### 1.1 Create LLM Extraction Service
- [ ] **Create file:** `src/core/processors/llm-extraction-service.ts`
- [ ] **Implement `ExtractedElements` interface**
  ```typescript
  export interface ExtractedElements {
    objects: string[];
    people: string[];
    colors: string[];
    lighting: string;
    time: string;
    setting: string;
    mood?: string;
  }
  ```
- [ ] **Implement `LLMExtractionService` class**
  - Constructor: Use `config.ai.embedUrl` and `llama3.2:3b`
  - Method: `extractElements(caption: string): Promise<ExtractedElements>`
  - **Critical:** Handle llama3.2 response parsing robustly
  - **Critical:** Validate extracted fields exist before returning
  - **Critical:** Add fallback for parsing failures

- [ ] **Add extraction prompt template**
  ```typescript
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
  ```

- [ ] **Add parsing logic with error handling**
  ```typescript
  private parseExtractedElements(text: string): ExtractedElements {
    const lines = text.split('\n');
    
    // Extract with fallbacks
    const objects = this.extractLine(lines, 'OBJECTS:').split(',').map(s => s.trim()).filter(Boolean);
    const people = this.extractLine(lines, 'PEOPLE:').split(',').map(s => s.trim()).filter(Boolean);
    const colors = this.extractLine(lines, 'COLORS:').split(',').map(s => s.trim()).filter(Boolean);
    
    return {
      objects: objects.length > 0 ? objects : ['unknown'],
      people: people.length > 0 ? people : ['none'],
      colors: colors.length > 0 ? colors : ['unknown'],
      lighting: this.extractLine(lines, 'LIGHTING:') || 'unknown',
      time: this.extractLine(lines, 'TIME:') || 'unknown',
      setting: this.extractLine(lines, 'SETTING:') || 'unknown',
      mood: this.extractLine(lines, 'MOOD:') || undefined
    };
  }
  ```

- [ ] **Add unit tests**
  - Test extraction with valid caption
  - Test extraction with malformed llama response
  - Test extraction with empty response
  - Test fallback values

### 1.2 Create Phase Query Builder
- [ ] **Create file:** `src/core/processors/phase-query-builder.ts`
- [ ] **Implement `AnalysisPhase` enum**
  ```typescript
  export enum AnalysisPhase {
    SPATIAL = 'spatial',
    TEMPORAL = 'temporal',
    SEGMENTATION_CHECK = 'segmentation_check'
  }
  ```

- [ ] **Implement `PhaseQueryBuilder` class**
  - Method: `buildSpatialPrompt(elements: ExtractedElements): string`
  - Method: `buildTemporalPrompt(elements: ExtractedElements): string`
  - Method: `buildSegmentationCheckPrompt(timeline: Array<{timestamp: number, elements: ExtractedElements}>): string`

- [ ] **Spatial prompt template**
  ```typescript
  buildSpatialPrompt(elements: ExtractedElements): string {
    return `Given these elements in the image:
Objects: ${elements.objects.join(', ')}
People: ${elements.people.join(', ')}
Setting: ${elements.setting}

Describe their spatial arrangement. Where is each positioned? What is in the foreground, middle ground, and background? How are elements arranged in depth?`;
  }
  ```

- [ ] **Temporal prompt template**
  ```typescript
  buildTemporalPrompt(elements: ExtractedElements): string {
    return `Given this scene:
Time: ${elements.time}
Lighting: ${elements.lighting}
Objects: ${elements.objects.join(', ')}
People: ${elements.people.join(', ')}

What actions or movements are happening? What might happen next in this scene? Describe any sense of motion or dynamic elements.`;
  }
  ```

- [ ] **Segmentation check prompt template**
  ```typescript
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
  ```

- [ ] **Add unit tests**
  - Test prompt generation with various element combinations
  - Test timeline formatting for segmentation check
  - Test edge cases (empty arrays, missing fields)

---

## Phase 2: Integration with Video Pipeline (Week 2)

### 2.1 Update Video Job Processor - Phase 2 Integration
- [ ] **File:** `src/core/video-job-processor-v2.ts`
- [ ] **Import new services**
  ```typescript
  import { LLMExtractionService, ExtractedElements } from './processors/llm-extraction-service';
  import { PhaseQueryBuilder, AnalysisPhase } from './processors/phase-query-builder';
  ```

- [ ] **Add services to class**
  ```typescript
  private extractionService: LLMExtractionService;
  private queryBuilder: PhaseQueryBuilder;
  
  constructor() {
    // ... existing code
    this.extractionService = new LLMExtractionService();
    this.queryBuilder = new PhaseQueryBuilder();
  }
  ```

- [ ] **Add Phase 2 method: Extract + Spatial**
  ```typescript
  private async processPhase2ExtractionAndSpatial(
    keyframes: Array<{id: string, imagePath: string, caption: string}>
  ): Promise<void> {
    const config = ConfigManager.getConfig();
    
    if (!config.multiPass?.phases?.enableExtraction) {
      console.log('[PHASE-2] Extraction disabled, skipping');
      return;
    }
    
    for (const keyframe of keyframes) {
      try {
        // 2.1 Extract structured elements
        const elements = await this.extractionService.extractElements(keyframe.caption);
        
        // Store elements
        await this.videoDb.database.prepare(`
          UPDATE video_keyframes 
          SET caption_elements = ? 
          WHERE id = ?
        `).run(JSON.stringify(elements), keyframe.id);
        
        // 2.2 Spatial analysis (if enabled)
        if (config.multiPass?.phases?.enableSpatial) {
          const spatialPrompt = this.queryBuilder.buildSpatialPrompt(elements);
          const spatialResult = await this.ollamaCaptioningService.caption(
            keyframe.imagePath,
            { prompt: spatialPrompt }
          );
          
          // Store spatial analysis
          await this.videoDb.database.prepare(`
            UPDATE video_keyframes 
            SET caption_spatial = ? 
            WHERE id = ?
          `).run(spatialResult.caption, keyframe.id);
        }
        
        console.log(`[PHASE-2] ✓ Keyframe ${keyframe.id} processed`);
        
      } catch (error) {
        console.error(`[PHASE-2] Failed for keyframe ${keyframe.id}:`, error);
        // Continue with other keyframes
      }
    }
  }
  ```

- [ ] **Integrate Phase 2 into existing pipeline**
  - Find existing Phase 1 captioning code
  - After Phase 1 completes, call `processPhase2ExtractionAndSpatial()`
  - **Critical:** Only run if Phase 1 succeeded
  - **Critical:** Handle errors gracefully, don't fail entire video

### 2.2 Update Video Job Processor - Phase 3 Integration
- [ ] **Add Phase 3 method: Segmentation + Temporal**
  ```typescript
  private async processPhase3SegmentationAndTemporal(
    videoId: string,
    keyframes: Array<{id: string, imagePath: string, timestamp: number, caption_elements: string}>
  ): Promise<void> {
    const config = ConfigManager.getConfig();
    
    // 3.1 Segmentation check (if enabled)
    let needsMoreFrames = false;
    if (config.multiPass?.phases?.enableSegmentationCheck) {
      const timeline = keyframes.map(kf => ({
        timestamp: kf.timestamp,
        elements: JSON.parse(kf.caption_elements) as ExtractedElements
      }));
      
      const segmentationPrompt = this.queryBuilder.buildSegmentationCheckPrompt(timeline);
      
      // Use llama for segmentation decision
      const response = await fetch(`${config.ai.embedUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.multiPass.extractionModel,
          prompt: segmentationPrompt,
          stream: false
        })
      });
      
      const data = await response.json();
      const decision = data.response?.trim() || '';
      needsMoreFrames = decision.toUpperCase().startsWith('YES');
      
      console.log(`[PHASE-3] Segmentation decision: ${decision}`);
      
      // Store decision
      await this.videoDb.database.prepare(`
        UPDATE video_files 
        SET metadata = json_set(COALESCE(metadata, '{}'), '$.segmentation_check', json(?))
        WHERE id = ?
      `).run(JSON.stringify({ decision, needsMoreFrames }), videoId);
    }
    
    // 3.2 Extract additional frames if needed
    if (needsMoreFrames) {
      console.log('[PHASE-3] Extracting additional frames...');
      // TODO: Implement additional frame extraction
      // For now, skip and use existing keyframes
    }
    
    // 3.3 Temporal analysis (if enabled)
    if (config.multiPass?.phases?.enableTemporal) {
      for (const keyframe of keyframes) {
        try {
          const elements = JSON.parse(keyframe.caption_elements) as ExtractedElements;
          const temporalPrompt = this.queryBuilder.buildTemporalPrompt(elements);
          
          const temporalResult = await this.ollamaCaptioningService.caption(
            keyframe.imagePath,
            { prompt: temporalPrompt }
          );
          
          // Store temporal analysis
          await this.videoDb.database.prepare(`
            UPDATE video_keyframes 
            SET caption_temporal = ? 
            WHERE id = ?
          `).run(temporalResult.caption, keyframe.id);
          
          console.log(`[PHASE-3] ✓ Temporal analysis for ${keyframe.id}`);
          
        } catch (error) {
          console.error(`[PHASE-3] Failed temporal for ${keyframe.id}:`, error);
        }
      }
    }
  }
  ```

- [ ] **Integrate Phase 3 into pipeline**
  - After Phase 2 completes, call `processPhase3SegmentationAndTemporal()`
  - **Critical:** Only run if Phase 2 succeeded
  - **Critical:** Fetch keyframes with `caption_elements` populated

### 2.3 Token Tracking
- [ ] **Add token tracking to each phase**
  ```typescript
  private async updateTokenTracking(
    keyframeId: string,
    phase: string,
    tokens: number
  ): Promise<void> {
    const existing = await this.videoDb.database.prepare(`
      SELECT caption_tokens FROM video_keyframes WHERE id = ?
    `).get(keyframeId) as any;
    
    const tokens_data = existing?.caption_tokens 
      ? JSON.parse(existing.caption_tokens)
      : {};
    
    tokens_data[phase] = tokens;
    tokens_data.total = Object.values(tokens_data).reduce((a: any, b: any) => a + b, 0);
    
    await this.videoDb.database.prepare(`
      UPDATE video_keyframes 
      SET caption_tokens = ? 
      WHERE id = ?
    `).run(JSON.stringify(tokens_data), keyframeId);
  }
  ```

- [ ] **Call token tracking after each phase**
  - After extraction: `updateTokenTracking(id, 'extraction', result.metadata.tokens)`
  - After spatial: `updateTokenTracking(id, 'spatial', result.metadata.tokens)`
  - After temporal: `updateTokenTracking(id, 'temporal', result.metadata.tokens)`

---

## Phase 3: Database Migration (Week 2)

### 3.1 Create Migration File
- [x] **Create:** `migrations_flat/042_add_multipass_caption_fields.sql`
  ```sql
  -- Migration 042: Add multi-pass captioning fields to video_keyframes
  -- TARGET: Video Database (./data/video-rag.db)
  
  -- Add new columns for multi-pass analysis
  ALTER TABLE video_keyframes ADD COLUMN caption_elements TEXT;
  ALTER TABLE video_keyframes ADD COLUMN caption_spatial TEXT;
  ALTER TABLE video_keyframes ADD COLUMN caption_temporal TEXT;
  ALTER TABLE video_keyframes ADD COLUMN caption_tokens TEXT;
  
  -- Add index for querying by elements
  CREATE INDEX IF NOT EXISTS idx_keyframes_has_elements 
  ON video_keyframes(caption_elements) 
  WHERE caption_elements IS NOT NULL;
  ```

- [x] **Test migration on dev database**
  ```bash
  sqlite3 ./data/video-rag.db < migrations_flat/042_add_multipass_caption_fields.sql
  ```

- [x] **Verify columns added**
  ```bash
  sqlite3 ./data/video-rag.db "PRAGMA table_info(video_keyframes);"
  ```

### 3.2 Update UnifiedMigrator
- [ ] **Verify migration will be picked up**
  - File: `src/core/unified-migrator.ts`
  - Check `getMigrationsDir()` points to `migrations_flat/`
  - **No code changes needed** - migrator auto-detects new files

- [ ] **Test migration in dev**
  - Delete `data/video-rag.db`
  - Restart app
  - Verify all migrations run including 042

---

## Phase 4: Configuration & Feature Flags (Week 2)

### 4.1 Add Config Schema
- [ ] **File:** `src/core/config.ts`
- [ ] **Add multiPass section**
  ```typescript
  export interface Config {
    // ... existing fields
    
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
    };
  }
  ```

- [ ] **Add default config**
  ```typescript
  const defaultConfig: Config = {
    // ... existing defaults
    
    multiPass: {
      enabled: false, // Start disabled
      extractionModel: 'llama3.2:3b',
      extractionUrl: '', // Will use ai.embedUrl
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
  };
  ```

### 4.2 Add UI Toggle (Optional)
- [ ] **Add settings panel for multi-pass**
  - Location: Settings > Video Processing
  - Toggles for each phase
  - **Start with all disabled**
  - Enable incrementally after testing

---

## Phase 5: Testing & Validation (Week 3)

### 5.1 Unit Tests
- [ ] **Test `LLMExtractionService`**
  - File: `src/core/processors/__tests__/llm-extraction-service.test.ts`
  - Test valid extraction
  - Test malformed response handling
  - Test fallback values
  - Test llama3.2 unavailable

- [ ] **Test `PhaseQueryBuilder`**
  - File: `src/core/processors/__tests__/phase-query-builder.test.ts`
  - Test spatial prompt generation
  - Test temporal prompt generation
  - Test segmentation prompt generation
  - Test edge cases (empty arrays, nulls)

### 5.2 Integration Tests
- [ ] **Test Phase 2 integration**
  - Process single video with Phase 2 enabled
  - Verify `caption_elements` populated
  - Verify `caption_spatial` populated (if enabled)
  - Verify no errors in logs

- [ ] **Test Phase 3 integration**
  - Process video with Phase 3 enabled
  - Verify segmentation decision stored
  - Verify `caption_temporal` populated
  - Verify token tracking accurate

### 5.3 End-to-End Test
- [ ] **Process complete video**
  - Enable all phases
  - Process 30-second test video
  - Verify all fields populated
  - Check token counts match expectations
  - Verify no memory leaks
  - Check performance (should complete in reasonable time)

### 5.4 Error Handling Tests
- [ ] **Test llama3.2 unavailable**
  - Stop llama model
  - Process video
  - Verify graceful degradation (Phase 1 still works)

- [ ] **Test moondream unavailable**
  - Stop moondream model
  - Verify error handling
  - Verify job marked as failed

- [ ] **Test malformed responses**
  - Mock llama returning invalid JSON
  - Verify fallback values used
  - Verify processing continues

---

## Phase 6: Monitoring & Metrics (Week 3)

### 6.1 Add Logging
- [ ] **Add phase-specific logging**
  - `[PHASE-2-EXTRACTION]` prefix for extraction logs
  - `[PHASE-2-SPATIAL]` prefix for spatial logs
  - `[PHASE-3-SEGMENTATION]` prefix for segmentation logs
  - `[PHASE-3-TEMPORAL]` prefix for temporal logs

- [ ] **Log token usage**
  - Log per-keyframe token counts
  - Log total video token counts
  - Log model used (moondream vs llama)

### 6.2 Add Metrics
- [ ] **Track success rates**
  - Extraction success rate
  - Spatial analysis success rate
  - Temporal analysis success rate
  - Segmentation decision accuracy (manual validation)

- [ ] **Track performance**
  - Time per phase
  - Tokens per phase
  - Total processing time increase

### 6.3 Add Alerts
- [ ] **Alert on high failure rates**
  - If extraction fails >20%, alert
  - If spatial/temporal fails >20%, alert

- [ ] **Alert on token budget exceeded**
  - If video exceeds expected token count, alert

---

## Phase 7: Rollout Strategy (Week 4)

### 7.1 Incremental Enablement
- [ ] **Week 4 Day 1-2: Enable Phase 2 Extraction Only**
  - Set `multiPass.enabled = true`
  - Set `phases.enableExtraction = true`
  - Set `phases.enableSpatial = false`
  - Set `phases.enableTemporal = false`
  - Monitor for 2 days
  - Verify extraction quality

- [ ] **Week 4 Day 3-4: Enable Phase 2 Spatial**
  - Set `phases.enableSpatial = true`
  - Monitor for 2 days
  - Verify spatial analysis quality
  - Check token usage increase

- [ ] **Week 4 Day 5-6: Enable Phase 3 Temporal**
  - Set `phases.enableTemporal = true`
  - Monitor for 2 days
  - Verify temporal analysis quality
  - Check total token usage

- [ ] **Week 4 Day 7: Enable Segmentation Check**
  - Set `phases.enableSegmentationCheck = true`
  - Monitor segmentation decisions
  - Validate additional frame extraction (if implemented)

### 7.2 Rollback Plan
- [ ] **Document rollback procedure**
  - Disable phases via config
  - No database rollback needed (new columns nullable)
  - Restart app to apply config changes

- [ ] **Test rollback**
  - Disable all phases
  - Verify Phase 1 still works
  - Verify no errors

---

## Critical Error Prevention Checklist

### ❌ Errors to Avoid (from previous experience)

1. **Empty moondream responses**
   - ✅ **Solution:** Use simple, natural language prompts only
   - ✅ **Solution:** No markdown formatting in prompts
   - ✅ **Solution:** Always check `result.response` is not empty

2. **llama3.2 model not found**
   - ✅ **Solution:** Check model availability in constructor
   - ✅ **Solution:** Use exact model name `llama3.2:3b`
   - ✅ **Solution:** Graceful degradation if unavailable

3. **Database schema errors**
   - ✅ **Solution:** Use `ALTER TABLE` not `CREATE TABLE`
   - ✅ **Solution:** Test migration on dev database first
   - ✅ **Solution:** Make new columns nullable

4. **Context repetition in chained passes**
   - ✅ **Solution:** Use LLM extraction, not full caption chaining
   - ✅ **Solution:** Pass only structured elements, not sentences

5. **Token budget exceeded**
   - ✅ **Solution:** Track tokens per phase
   - ✅ **Solution:** Add config limits
   - ✅ **Solution:** Alert on budget exceeded

6. **Processing failures cascade**
   - ✅ **Solution:** Wrap each phase in try-catch
   - ✅ **Solution:** Continue processing other keyframes on error
   - ✅ **Solution:** Log errors but don't fail entire video

7. **Missing image files**
   - ✅ **Solution:** Check file exists before captioning
   - ✅ **Solution:** Handle ENOENT gracefully
   - ✅ **Solution:** Skip missing files, log warning

8. **Concurrent processing conflicts**
   - ✅ **Solution:** Process phases sequentially per video
   - ✅ **Solution:** Use database transactions where needed
   - ✅ **Solution:** Add locking if needed

---

## Success Criteria

### Phase 1 Success
- [ ] `LLMExtractionService` extracts valid elements from captions
- [ ] `PhaseQueryBuilder` generates correct prompts
- [ ] Unit tests pass
- [ ] No compilation errors

### Phase 2 Success
- [ ] Video processing completes with Phase 2 enabled
- [ ] `caption_elements` populated in database
- [ ] `caption_spatial` populated (if enabled)
- [ ] Token counts tracked accurately
- [ ] No errors in logs

### Phase 3 Success
- [ ] Segmentation check runs and stores decision
- [ ] `caption_temporal` populated in database
- [ ] Token usage within expected range
- [ ] Processing time acceptable (<2x Phase 1)

### Overall Success
- [ ] 15% moondream token savings achieved
- [ ] Structured metadata enables search
- [ ] No increase in error rate
- [ ] Processing time increase <50%
- [ ] All tests passing
- [ ] Production rollout successful

---

## Rollout Timeline

| Week | Phase | Tasks | Success Metric |
|------|-------|-------|----------------|
| **Week 0** | Preparation | Schema validation, model checks, config setup | All prerequisites met |
| **Week 1** | Core Services | LLMExtractionService, PhaseQueryBuilder, tests | Unit tests pass |
| **Week 2** | Integration | Phase 2 & 3 integration, migration, config | Integration tests pass |
| **Week 3** | Testing | E2E tests, error handling, monitoring | All tests pass, metrics tracked |
| **Week 4** | Rollout | Incremental enablement, monitoring, validation | Production stable |

---

## Next Steps

1. **Review this checklist with team**
2. **Assign tasks to developers**
3. **Set up development environment**
4. **Begin Week 0 preparation tasks**
5. **Schedule daily standups for progress tracking**

---

**Document Version:** 1.0  
**Last Updated:** 2025-10-25  
**Status:** Ready for Implementation
