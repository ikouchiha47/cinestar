# Multi-Pass Captioning Implementation Status

## ✅ Completed (What We've Done)

### Phase 0: Preparation & Validation
- [x] Database schema updated (av_search.db + image_search.db)
- [x] Models verified (moondream:v2, llama3.2:3b)
- [x] Config system extended with multiPass section

### Phase 1: Core Services
- [x] `LLMExtractionService` created (`src/core/processors/llm-extraction-service.ts`)
  - Extracts structured elements from captions
  - Robust parsing with fallbacks
  - Error handling for malformed responses
  
- [x] `PhaseQueryBuilder` created (`src/core/processors/phase-query-builder.ts`)
  - Builds spatial prompts
  - Builds temporal prompts
  - Builds segmentation check prompts
  
- [x] `MultiPassCaptioningService` created (`src/core/processors/multi-pass-captioning-service.ts`)
  - Orchestrates multi-pass flow
  - Tracks token usage
  - Returns comprehensive results

### Phase 2: Database Migrations
- [x] Migration 043: `av_meta_cache` fields added
- [x] Migration 044: `image_meta_cache` fields added
- [x] Removed old migration 042 (video-rag.db)
- [x] Migrations follow new modality-split architecture

### Phase 3: Integration
- [x] `ImageJobProcessor` integrated
  - Uses MultiPassCaptioningService when enabled
  - Stores data in image_search.db
  
- [x] `VideoJobProcessor` integrated
  - Uses MultiPassCaptioningService for keyframes
  - Stores data in av_search.db
  - Added `storeMultiPassData()` method
  
- [x] `AVSearchWriter` enhanced
  - Added `updateMultiPassCaption()` method
  - Added `buildCombinedSearchText()` for FTS
  - Added `elementsToKeywords()` helper
  
- [x] `ImageSearchWriter` enhanced
  - Added `updateMultiPassCaption()` method
  - Added `buildCombinedSearchText()` for FTS
  - Added `elementsToKeywords()` helper

### Phase 4: Search Integration
- [x] Enhanced FTS with combined text (caption + spatial + temporal + elements)
- [x] Single embedding approach (correct for production)
- [x] Hybrid search unchanged (70% vector + 30% FTS)

### Phase 5: Documentation
- [x] Implementation summary
- [x] Multi-pass captioning guide
- [x] Search strategy document
- [x] Scene reconstruction guide
- [x] Spatial/temporal search enhancement guide
- [x] Migration complete document

---

## ⏳ Remaining Tasks (From Original Checklist)

### Phase 2: Video Pipeline Integration (NOT YET DONE)

#### 2.1 Scene Reconstruction Enhancement
- [ ] **Update `captionBatchKeyframes()` return type**
  - Currently returns: `Array<{keyframeId, caption, confidence}>`
  - Should return: `Array<{keyframeId, caption, spatial, temporal, elements, tokens, confidence}>`
  - **File**: `src/core/video-job-processor-v2.ts` line ~2706

- [ ] **Update `reconstructSceneForBatch()` signature**
  - Currently accepts: `(transcription: string, keyframeCaptions: string[])`
  - Should accept: `(transcription: string, keyframeCaptions: Array<{caption, spatial, temporal, elements}>)`
  - **File**: `src/core/video-job-processor-v2.ts` line ~2630

- [ ] **Enhance scene reconstruction prompt**
  - Include spatial and temporal in prompt
  - Build rich visual context from multi-pass data
  - **File**: `src/core/video-job-processor-v2.ts` line ~2640

#### 2.2 Token Tracking
- [ ] **Add token tracking method**
  - Track tokens per phase (extraction, spatial, temporal)
  - Store in av_meta_cache
  - **File**: `src/core/video-job-processor-v2.ts`

### Phase 3: Search Enhancement (NOT YET DONE)

#### 3.1 Query Analysis Enhancement
- [ ] **Add spatial keywords to `analyzeQuery()`**
  - Keywords: foreground, background, left, right, depth, layout, etc.
  - Detect spatial query type
  - **File**: `src/core/video-job-processor-v2.ts` line ~3030

- [ ] **Add temporal keywords to `analyzeQuery()`**
  - Keywords: motion, moving, action, walking, running, etc.
  - Detect temporal query type
  - **File**: `src/core/video-job-processor-v2.ts` line ~3030

#### 3.2 Adaptive Scoring Enhancement
- [ ] **Fetch multi-pass data in `calculateAdaptiveScore()`**
  - Query av_meta_cache for spatial/temporal/elements
  - **File**: `src/core/video-job-processor-v2.ts` line ~3100

- [ ] **Add spatial query boost**
  - If query type is 'spatial' and spatial data exists
  - Check if query terms match spatial description
  - Boost score by 0.4
  - **File**: `src/core/video-job-processor-v2.ts` line ~3130

- [ ] **Add temporal query boost**
  - If query type is 'temporal' and temporal data exists
  - Check if query terms match temporal description
  - Boost score by 0.4
  - **File**: `src/core/video-job-processor-v2.ts` line ~3150

- [ ] **Add element matching boost**
  - Parse caption_elements JSON
  - Match query against objects, colors, time, etc.
  - Boost score by 0.2
  - **File**: `src/core/video-job-processor-v2.ts` line ~3170

### Phase 4: Testing (NOT YET DONE)

#### 4.1 Unit Tests
- [ ] Test `LLMExtractionService`
  - Valid extraction
  - Malformed response handling
  - Fallback values
  - Model unavailable

- [ ] Test `PhaseQueryBuilder`
  - Spatial prompt generation
  - Temporal prompt generation
  - Segmentation prompt generation
  - Edge cases

#### 4.2 Integration Tests
- [ ] Test image processing with multi-pass
  - Enable multi-pass
  - Process test image
  - Verify data in image_search.db

- [ ] Test video processing with multi-pass
  - Enable multi-pass
  - Process test video
  - Verify data in av_search.db

- [ ] Test scene reconstruction with multi-pass
  - Verify spatial/temporal in prompt
  - Verify richer scene descriptions

- [ ] Test search with multi-pass data
  - Spatial queries ("person in foreground")
  - Temporal queries ("walking motion")
  - Element queries ("red car afternoon")

#### 4.3 End-to-End Test
- [ ] Process complete video with all phases enabled
- [ ] Verify all fields populated
- [ ] Check token counts
- [ ] Verify search improvements
- [ ] Check performance impact

### Phase 5: Monitoring (NOT YET DONE)

- [ ] Add phase-specific logging
- [ ] Track success rates
- [ ] Track performance metrics
- [ ] Add alerts for failures

### Phase 6: Rollout (NOT YET DONE)

- [ ] Day 1-2: Enable extraction only
- [ ] Day 3-4: Enable spatial
- [ ] Day 5-6: Enable temporal
- [ ] Day 7: Enable segmentation check
- [ ] Monitor and validate each phase

---

## 🎯 Priority Tasks (What to Do Next)

### High Priority (Core Functionality)

1. **Scene Reconstruction Enhancement** (2-3 hours)
   - Update `captionBatchKeyframes()` to return multi-pass data
   - Update `reconstructSceneForBatch()` to use spatial/temporal
   - This is critical for video search quality

2. **Search Query Enhancement** (2-3 hours)
   - Add spatial/temporal keywords to `analyzeQuery()`
   - Add multi-pass data boosts to `calculateAdaptiveScore()`
   - This unlocks spatial/temporal search

### Medium Priority (Quality Improvements)

3. **Token Tracking** (1-2 hours)
   - Add method to track tokens per phase
   - Store in av_meta_cache
   - Monitor token usage

4. **Integration Testing** (3-4 hours)
   - Test image processing
   - Test video processing
   - Test scene reconstruction
   - Test search improvements

### Low Priority (Nice to Have)

5. **Unit Tests** (4-6 hours)
   - Test extraction service
   - Test query builder
   - Test edge cases

6. **LLM Query Analysis** (6-8 hours)
   - Replace keyword matching with LLM
   - More accurate query understanding
   - Advanced feature

---

## 📊 Completion Status

### Overall Progress: ~70% Complete

| Phase | Status | Completion |
|-------|--------|------------|
| Phase 0: Preparation | ✅ Done | 100% |
| Phase 1: Core Services | ✅ Done | 100% |
| Phase 2: Database | ✅ Done | 100% |
| Phase 3: Integration | ✅ Done | 100% |
| Phase 4: Search (FTS) | ✅ Done | 100% |
| **Phase 5: Scene Reconstruction** | ⏳ **Not Started** | **0%** |
| **Phase 6: Search Enhancement** | ⏳ **Not Started** | **0%** |
| Phase 7: Testing | ⏳ Not Started | 0% |
| Phase 8: Monitoring | ⏳ Not Started | 0% |
| Phase 9: Rollout | ⏳ Not Started | 0% |

### What Works Now
✅ Multi-pass captioning for images  
✅ Multi-pass captioning for video keyframes  
✅ Data storage in modality databases  
✅ Enhanced FTS search with combined text  
✅ Single embedding approach  
✅ Hybrid search (vector + FTS)  

### What Doesn't Work Yet
❌ Scene reconstruction doesn't use spatial/temporal  
❌ Search doesn't boost spatial/temporal queries  
❌ No token tracking  
❌ No tests  

---

## 🚀 Quick Start Guide

### To Enable Multi-Pass Captioning

1. **Check config** (`src/core/config.ts`):
   ```typescript
   multiPass: {
     enabled: true,
     phases: {
       enableExtraction: true,  // ✅ Currently enabled
       enableSpatial: false,    // Enable after testing
       enableTemporal: false,   // Enable after testing
     }
   }
   ```

2. **Run migrations**:
   ```bash
   # Migrations run automatically on app start
   # Or manually:
   sqlite3 data/av_search.db < migrations_flat/043_add_multipass_to_av_meta_cache.sql
   sqlite3 data/image_search.db < migrations_flat/044_add_multipass_to_image_meta_cache.sql
   ```

3. **Test with sample image**:
   ```bash
   npx tsx test-multi-pass.ts ./path/to/image.jpg
   ```

4. **Process a video** and check logs for `[MULTI-PASS]` messages

### To Complete Implementation

1. **Scene Reconstruction** (Priority 1):
   - Edit `src/core/video-job-processor-v2.ts`
   - Update `captionBatchKeyframes()` return type (line ~2706)
   - Update `reconstructSceneForBatch()` signature (line ~2630)
   - Enhance prompt with spatial/temporal (line ~2640)

2. **Search Enhancement** (Priority 2):
   - Edit `src/core/video-job-processor-v2.ts`
   - Add spatial/temporal keywords to `analyzeQuery()` (line ~3030)
   - Add multi-pass boosts to `calculateAdaptiveScore()` (line ~3100)

3. **Test Everything** (Priority 3):
   - Process test video
   - Try spatial queries: "person in foreground"
   - Try temporal queries: "walking motion"
   - Verify improvements

---

## 📝 Notes

- **Database**: Using new modality-split architecture (av_search.db, image_search.db)
- **Embeddings**: Single embedding per item (correct approach)
- **FTS**: Combined text from all caption fields (working)
- **Search**: Hybrid vector + FTS (working, but not yet using multi-pass boosts)
- **Scene Reconstruction**: Not yet using multi-pass data (needs update)

---

**Last Updated**: 2025-10-25  
**Status**: 70% Complete - Core infrastructure done, integration pending  
**Next Steps**: Scene reconstruction + search enhancement
