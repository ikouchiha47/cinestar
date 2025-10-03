# ADR-004: Batch-Concurrent Processing Workflow

## Status
Proposed

## Context

Based on our testing of batched transcription + embeddings, we've proven that:
- **5-minute batch transcription** achieves 38x real-time speed with concurrent processing
- **Batch-level embeddings** provide sufficient search quality (57-60% similarity scores)
- **Scene reconstruction is optional** for basic search functionality
- **Immediate searchability** is more valuable than perfect reconstruction

However, our current pipeline has two major issues:
1. **Delayed searchability**: Users must wait for entire video processing before any content is searchable
2. **Sequential stage processing**: We process transcription → captioning → reconstruction sequentially, missing opportunities for concurrent batch processing

## Decision

We will implement a **Batch-Concurrent Processing Workflow** that makes video content searchable immediately after upload while maintaining multi-phase processing benefits.

### New Workflow Architecture

#### Phase 0: Immediate Batch Processing (NEW)
**Triggers**: Immediately after video upload
**Goal**: Make content searchable within 60 seconds

```
Video Upload → Extract Audio Batches (5min) → Concurrent Transcription → Store + Index
```

**Implementation**:
- Extract 5-minute audio segments immediately
- Transcribe all segments concurrently via nginx:9001
- Generate embeddings and store in database
- Index for search immediately
- **Result**: Basic searchability within 60s

#### Phase 1: Enhanced Batch Processing (MODIFIED)
**Triggers**: After Phase 0 completes
**Goal**: Add visual context to existing batches

```
Existing Audio Batches + Visual Keyframes (4 per batch) → Batch Captioning → Scene Reconstruction → Update Database
```

**Key Changes**:
- Process in **batch units** (5-minute segments) instead of stage units
- Each batch contains: `audio_segment + 4_keyframes + captions + reconstruction`
- Store completed batches incrementally as they finish
- Update existing database records with enhanced data

#### Phase 2+: Multi-Phase Refinement (UNCHANGED)
- Continues as currently designed
- Operates on batch-enhanced data from Phase 1

### Batch Processing Unit

```typescript
interface ProcessingBatch {
  id: string;
  startTime: number;
  endTime: number;
  audioSegment: AudioSegment;
  keyframes: Keyframe[]; // 4 frames per 5-minute batch
  transcription?: TranscriptionResult;
  captions?: CaptionResult[];
  reconstruction?: ReconstructionResult;
  embedding?: number[];
  status: 'audio_only' | 'enhanced' | 'complete';
}
```

## Implementation TODO List

### Phase 0: Database & Core Infrastructure
- [x] **0.1** Create database migration `014_batch_processing.sql`
  - [x] `processing_batches` table with batch metadata
  - [x] `transcription_segments` table with precise timing
  - [x] `batch_keyframes` table for visual context
  - [x] Proper indexes for time-based queries
  - [x] Update triggers and constraints
- [x] **0.2** Create `BatchProcessor` class for batch management
  - [x] Audio batch creation and FFmpeg extraction
  - [x] Database storage and retrieval methods
  - [x] Batch status tracking and updates
  - [x] Transcription segment storage with precise timing
- [x] **0.3** Update `TranscriptionProcessor` for batch mode support
  - [x] `transcribeBatch()` method for single batch processing
  - [x] `transcribeBatchesConcurrent()` for parallel processing
  - [x] Service availability checking for batch mode
  - [x] Error handling and fallback service selection
- [ ] **0.4** Add batch status tracking and state management

### Phase 1: Immediate Batch Processing (Week 1-2) 
- [x] **1.1** Implement `processImmediateBatches()` in `VideoJobProcessor`
  - [x] Extract 5-minute audio segments immediately after upload
  - [x] Concurrent transcription via nginx:9001
  - [x] Generate embeddings for each batch (real EmbeddingService)
  - [x] Store in `processing_batches` table
  - [x] Store individual segments with precise timing
  - [x] Update job progress and show notifications
  - [x] Cleanup temporary audio files
- [x] **1.2** Create immediate search functionality
  - [x] Search against batch-level embeddings with cosine similarity
  - [x] Search against segment-level embeddings for precise timing
  - [x] Return results with 5-minute accuracy (batch) and precise timing (segments)
  - [x] Add processing status indicators and searchability checks
- [x] **1.3** Add simple notification system
  - [x] Job status updates for "Video now searchable"
  - [x] No websockets - manual refresh approach via job polling
  - [x] Progress indicators (25% = immediate, 60% = enhanced, 90% = complete)
- [x] **1.4** Integrate with main job processing workflow
  - [x] Phase 0 runs before existing pipeline
  - [x] Graceful fallback if immediate processing fails
  - [x] Maintains compatibility with existing refinement system

### Phase 2: Enhanced Batch Processing (Week 3-4)
- [x] **2.1** Implement batch-aware visual processing
  - [x] Extract 4 keyframes per 5-minute batch (evenly distributed: 20%, 40%, 60%, 80%)
  - [x] Batch captioning for keyframes (existing BatchCaptioningProcessor)
  - [x] Update batch records with visual data
  - [x] Store keyframes in `batch_keyframes` table
- [x] **2.2** Implement batch scene reconstruction  
  - [x] Per-batch reconstruction (not cross-batch) - existing SceneReconstructionProcessor
  - [x] Combine audio + visual context
  - [x] Store reconstruction results in batch `scene_context` field
- [x] **2.3** Enhanced search with multi-modal data
  - [x] Search across transcription + visual captions (existing functionality)
  - [x] Integrate batch visual processing into immediate workflow
  - [x] Progressive enhancement: Phase 0 → Phase 1 → Traditional pipeline
  - [x] Multi-modal scene reconstruction combining audio + visual context

### Phase 3: Adaptive Scoring System (Week 5)
- [x] **3.1** Implement query analysis
  - [x] Detect visual vs audio vs mixed vs temporal queries
  - [x] Extract query indicators and keywords with confidence scoring
  - [x] Smart query classification with 25+ visual/audio/temporal keywords
- [x] **3.2** Implement adaptive scoring formula
  - [x] Base similarity × data availability multiplier
  - [x] Query relevance bonuses for content matching
  - [x] Quality-based promotion rules (confidence scores, processing status)
  - [x] Intelligent scoring: visual queries boost visual data, audio queries boost transcription
- [x] **3.3** Add data availability detection
  - [x] Check transcription, captions, reconstruction availability per batch
  - [x] Apply appropriate multipliers based on query type and data availability
  - [x] Progressive enhancement scoring: audio_only < enhanced < complete
- [ ] **3.4** Implement dynamic promotion logic
  - [ ] Fallback rules when data is missing
  - [ ] Quality thresholds and penalties

### Phase 4: Integration & Testing (Week 6)
- [ ] **4.1** Integration with existing pipeline
  - [ ] Ensure compatibility with multi-phase processing
  - [ ] Event system integration
  - [ ] Progress tracking updates
- [ ] **4.2** Performance optimization
  - [ ] Batch processing concurrency limits
  - [ ] Caching strategy implementation
  - [ ] Resource usage monitoring
- [ ] **4.3** End-to-end testing
  - [ ] Validate 60-second searchability
  - [ ] Test progressive enhancement
  - [ ] Verify search quality metrics
- [ ] **4.4** Documentation and deployment
  - [ ] Update API documentation
  - [ ] Deployment procedures
  - [ ] Monitoring and alerting

## Implementation Plan

### Phase 1: Immediate Batch Processing (Week 1-2)

#### 1.1 Create Pre-Processing Pipeline
**Files to modify**:
- `src/core/video-job-processor.ts`: Add `processImmediateBatches()`
- `src/core/processors/batch-processor.ts`: NEW - Batch management
- `src/core/processors/transcription-processor.ts`: Enhance for batch mode

**Key changes**:
```typescript
// In video-job-processor.ts
async processVideoJob(jobId: string) {
  // Phase 0: Immediate batch processing
  await this.processImmediateBatches(jobId);
  
  // Phase 1+: Continue with existing pipeline
  await this.processVideoSegments(jobId);
}

async processImmediateBatches(jobId: string) {
  const batches = await this.createAudioBatches(jobId, 300); // 5min
  const transcriptionPromises = batches.map(batch => 
    this.transcribeAndStoreBatch(batch)
  );
  await Promise.all(transcriptionPromises);
}
```

#### 1.2 Batch Database Schema
**Files to modify**:
- `src/database/migrations/010_batch_processing.sql`: NEW migration

```sql
CREATE TABLE processing_batches (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL,
  batch_index INTEGER NOT NULL,
  start_time REAL NOT NULL,
  end_time REAL NOT NULL,
  audio_path TEXT,
  transcription TEXT,
  embedding BLOB,
  status TEXT DEFAULT 'audio_only',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (video_id) REFERENCES videos (id)
);

-- Store individual transcription segments with precise timing
CREATE TABLE transcription_segments (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  segment_index INTEGER NOT NULL,
  start_time REAL NOT NULL,  -- Precise start time in seconds
  end_time REAL NOT NULL,    -- Precise end time in seconds
  text TEXT NOT NULL,
  confidence REAL,           -- Whisper confidence score
  embedding BLOB,            -- Individual segment embedding
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (batch_id) REFERENCES processing_batches (id)
);

CREATE INDEX idx_batches_video_time ON processing_batches(video_id, start_time);
CREATE INDEX idx_batches_status ON processing_batches(status);
CREATE INDEX idx_segments_batch ON transcription_segments(batch_id);
CREATE INDEX idx_segments_time ON transcription_segments(start_time, end_time);
CREATE INDEX idx_segments_text_search ON transcription_segments(text);
```

### Phase 2: Enhanced Batch Processing (Week 3-4)

#### 2.1 Modify Visual Processing
**Files to modify**:
- `src/core/processors/visual-processor.ts`: Add batch-aware keyframe extraction
- `src/core/processors/caption-processor.ts`: Process batches instead of individual images

**Key changes**:
```typescript
// Process 4 keyframes per 5-minute batch
async processBatchKeyframes(batch: ProcessingBatch): Promise<Keyframe[]> {
  const keyframeTimes = [
    batch.startTime + 60,   // 1 min into batch
    batch.startTime + 120,  // 2 min into batch
    batch.startTime + 180,  // 3 min into batch
    batch.startTime + 240   // 4 min into batch
  ];
  
  return Promise.all(keyframeTimes.map(time => 
    this.extractKeyframe(batch.videoPath, time)
  ));
}
```

#### 2.2 Batch Scene Reconstruction
**Files to modify**:
- `src/core/processors/scene-reconstruction-processor.ts`: Add batch reconstruction

```typescript
async reconstructBatch(batch: ProcessingBatch): Promise<ReconstructionResult> {
  const context = {
    transcription: batch.transcription,
    captions: batch.captions,
    timeRange: `${batch.startTime}-${batch.endTime}`,
    keyframes: batch.keyframes
  };
  
  return this.reconstructScene(context);
}
```

### Phase 3: Integration & Testing (Week 5-6)

#### 3.1 Event System Integration
**Files to modify**:
- `src/core/video-pipeline.ts`: Emit batch completion events
- `src/core/video-job-processor.ts`: Listen for batch events

```typescript
// Emit events as batches complete
this.emit('batch:complete', {
  batchId: batch.id,
  status: batch.status,
  searchable: true
});
```

#### 3.2 Search Integration with Time Segment Retrieval
**Files to modify**:
- `src/database/video-database.ts`: Add batch search methods
- `src/api/search-api.ts`: Query batch data with time segments

**Key Implementation**:
```typescript
// Search API with precise time segment retrieval
interface SearchResult {
  id: string;
  videoId: string;
  videoPath: string;
  matchType: 'batch' | 'segment';
  
  // Time information for video player navigation
  startTime: number;    // Exact start time in seconds
  endTime: number;      // Exact end time in seconds
  duration: number;     // Segment duration
  
  // Content and relevance
  text: string;
  similarity: number;
  confidence?: number;  // Whisper confidence if available
  
  // Context for UI display
  batchIndex?: number;
  segmentIndex?: number;
  timeRange: string;    // "5:23-5:45" for UI display
}

// Multi-level search: batch-level + segment-level
async searchWithTimeSegments(query: string): Promise<SearchResult[]> {
  // 1. Search batch-level embeddings (5-minute chunks)
  const batchResults = await this.searchBatches(query);
  
  // 2. Search segment-level embeddings (precise timing)
  const segmentResults = await this.searchSegments(query);
  
  // 3. Combine and rank results
  return this.combineAndRankResults(batchResults, segmentResults);
}

// Segment-level search for precise timing
async searchSegments(query: string): Promise<SearchResult[]> {
  const queryEmbedding = await this.generateEmbedding(query);
  
  return this.db.prepare(`
    SELECT 
      ts.id,
      ts.batch_id,
      ts.start_time,
      ts.end_time,
      ts.text,
      ts.confidence,
      ts.segment_index,
      pb.video_id,
      pb.batch_index,
      v.file_path as video_path
    FROM transcription_segments ts
    JOIN processing_batches pb ON ts.batch_id = pb.id
    JOIN videos v ON pb.video_id = v.id
    WHERE ts.embedding IS NOT NULL
    ORDER BY similarity(ts.embedding, ?) DESC
    LIMIT ?
  `).all(queryEmbedding, limit);
}
```

**Search Result Usage**:
```typescript
// In UI: Jump to exact time in video player
function handleSearchResultClick(result: SearchResult) {
  videoPlayer.seekTo(result.startTime);
  videoPlayer.highlightSegment(result.startTime, result.endTime);
  
  // Show context: "Found at 5:23-5:45 in batch 2"
  showSearchContext({
    timeRange: result.timeRange,
    batchIndex: result.batchIndex,
    segmentIndex: result.segmentIndex
  });
}
```

## Search Semantics & User Flow Changes

### Current Search Flow (Single-Level)
```
User Query → Generate Embedding → Search Video Segments → Return Results
```

**Current Steps:**
1. User enters search query
2. Generate query embedding
3. Search against final reconstructed segments
4. Return ranked results with video timestamps
5. User clicks → Jump to video time

**Limitations:**
- ❌ No results until full processing complete (20+ minutes)
- ❌ Single granularity level (scene-based)
- ❌ No progressive refinement

### Proposed Search Flow (Multi-Level)

```
User Query → Multi-Level Search Strategy → Ranked Results → Progressive Enhancement
```

**New Search Steps:**

#### Step 1: Query Analysis & Strategy Selection
```typescript
async handleUserSearch(query: string) {
  // Analyze query intent and available data
  const searchStrategy = await this.determineSearchStrategy(query);
  
  return this.executeMultiLevelSearch(query, searchStrategy);
}

async determineSearchStrategy(query: string) {
  // Check what data is available for videos
  const dataAvailability = await this.checkDataAvailability();
  
  return {
    levels: ['immediate', 'enhanced', 'reconstructed'],
    weights: this.calculateLevelWeights(dataAvailability),
    fallbacks: this.determineFallbacks(dataAvailability)
  };
}
```

#### Step 2: Multi-Level Parallel Search
```typescript
async executeMultiLevelSearch(query: string, strategy: SearchStrategy) {
  const queryEmbedding = await this.generateEmbedding(query);
  
  // Execute searches in parallel across all available levels
  const [immediateResults, enhancedResults, reconstructedResults] = 
    await Promise.allSettled([
      this.searchImmediateLevel(query, queryEmbedding),    // Audio transcription only
      this.searchEnhancedLevel(query, queryEmbedding),     // Audio + visual captions
      this.searchReconstructedLevel(query, queryEmbedding) // Full scene reconstruction
    ]);
  
  return this.combineAndRankResults(immediateResults, enhancedResults, reconstructedResults);
}
```

#### Step 3: Intelligent Result Combination
```typescript
async combineAndRankResults(immediate, enhanced, reconstructed) {
  const combinedResults = [];
  
  // For each video, determine best available result level
  for (const videoId of this.getUniqueVideoIds(immediate, enhanced, reconstructed)) {
    const videoResults = {
      immediate: immediate.filter(r => r.videoId === videoId),
      enhanced: enhanced.filter(r => r.videoId === videoId),
      reconstructed: reconstructed.filter(r => r.videoId === videoId)
    };
    
    // Select best result based on availability and quality
    const bestResult = this.selectBestResult(videoResults);
    combinedResults.push(bestResult);
  }
  
  return this.rankByRelevance(combinedResults);
}
```

### Search Result Types & User Experience

#### Level 1: Immediate Results (Available in 60s)
```typescript
interface ImmediateResult {
  level: 'immediate';
  confidence: 'medium';
  source: 'audio_transcription';
  granularity: '5_minute_batches';
  
  // Time precision: ~5 minute accuracy
  startTime: 300;  // Start of 5-min batch
  endTime: 600;    // End of 5-min batch
  
  // Content
  text: "Batch transcription text...";
  similarity: 0.75;
  
  // UI indicators
  processingStatus: 'basic_available';
  enhancementETA: '3 minutes';
}
```

#### Level 2: Enhanced Results (Available in 5-10 minutes)
```typescript
interface EnhancedResult {
  level: 'enhanced';
  confidence: 'high';
  source: 'audio_transcription + visual_captions';
  granularity: 'segment_level';
  
  // Time precision: ~30 second accuracy
  startTime: 342.5;  // Precise segment start
  endTime: 367.8;    // Precise segment end
  
  // Multi-modal content
  text: "Enhanced transcription with visual context...";
  visualContext: ["person speaking", "indoor setting"];
  similarity: 0.82;
  
  // UI indicators
  processingStatus: 'enhanced_available';
  reconstructionETA: '2 minutes';
}
```

#### Level 3: Reconstructed Results (Available in 15-20 minutes)
```typescript
interface ReconstructedResult {
  level: 'reconstructed';
  confidence: 'highest';
  source: 'full_scene_reconstruction';
  granularity: 'scene_level';
  
  // Time precision: exact scene boundaries
  startTime: 342.5;
  endTime: 398.2;
  
  // Rich contextual content
  text: "Full scene reconstruction with narrative context...";
  sceneContext: {
    setting: "indoor office meeting",
    characters: ["speaker", "audience"],
    narrative: "discussion about project timeline"
  };
  similarity: 0.89;
  
  // UI indicators
  processingStatus: 'fully_processed';
}
```

### User Interface Changes

#### Progressive Search Results Display
```typescript
// UI shows results as they become available
function displaySearchResults(results: SearchResult[]) {
  results.forEach(result => {
    const resultCard = createResultCard(result);
    
    // Visual indicators for processing level
    switch(result.level) {
      case 'immediate':
        resultCard.addBadge('⚡ Quick Result', 'blue');
        resultCard.addProgressBar('Enhancing...', 30);
        break;
        
      case 'enhanced':
        resultCard.addBadge('🎯 Enhanced', 'green');
        resultCard.addProgressBar('Final processing...', 80);
        break;
        
      case 'reconstructed':
        resultCard.addBadge('✨ Complete', 'gold');
        break;
    }
    
    // Time precision indicator
    const precision = calculateTimePrecision(result);
    resultCard.addTimePrecision(precision); // "±2.5 min" vs "±30 sec" vs "exact"
  });
}
```

#### Simple Notification System
```typescript
// Skip real-time websockets - use simple notifications instead
// Users can refresh search or press search again to get enhanced results

interface ProcessingNotification {
  videoId: string;
  videoTitle: string;
  status: 'immediate_ready' | 'enhanced_ready' | 'reconstructed_ready';
  message: string;
  timestamp: Date;
}

// Show notification when processing levels complete
function showProcessingNotification(notification: ProcessingNotification) {
  // Simple toast notification
  toast.show({
    title: notification.message,
    description: "Search again to see improved results",
    action: { label: "Search", onClick: () => triggerSearch() }
  });
}

// Examples:
// "Video 'Meeting.mp4' is now searchable (basic)"
// "Enhanced search available for 'Meeting.mp4' - search again for better results"
// "Full processing complete for 'Meeting.mp4'"
```

### Adaptive Scoring System

#### Core Scoring Formula
```typescript
interface SearchScore {
  baseScore: number;        // Semantic similarity (0-1)
  dataAvailability: number; // Data completeness multiplier (0-1)
  queryRelevance: number;   // Query-type match bonus (0-0.3)
  qualityBonus: number;     // Processing quality bonus (0-0.2)
  finalScore: number;       // Combined final score
}

// Final Score = (baseScore * dataAvailability) + queryRelevance + qualityBonus
function calculateFinalScore(result: SearchResult, query: QueryAnalysis): SearchScore {
  const baseScore = result.similarity; // 0.75 from embedding similarity
  
  const dataAvailability = calculateDataAvailability(result);
  const queryRelevance = calculateQueryRelevance(result, query);
  const qualityBonus = calculateQualityBonus(result);
  
  const finalScore = (baseScore * dataAvailability) + queryRelevance + qualityBonus;
  
  return { baseScore, dataAvailability, queryRelevance, qualityBonus, finalScore };
}
```

#### Data Availability Multiplier
```typescript
function calculateDataAvailability(result: SearchResult): number {
  const availability = {
    transcription: result.transcription ? 1.0 : 0.0,
    visual: result.visualCaptions ? 0.8 : 0.0,        // Visual may be lower quality
    reconstruction: result.sceneContext ? 1.0 : 0.0,
    segments: result.preciseSegments ? 0.9 : 0.0      // Segment-level timing
  };
  
  // Weight based on result level
  switch(result.level) {
    case 'immediate':
      return availability.transcription; // Only transcription matters
      
    case 'enhanced':
      // Transcription is required, visual is bonus
      return availability.transcription * (0.7 + (availability.visual * 0.3));
      
    case 'reconstructed':
      // All components contribute
      return (availability.transcription * 0.4) + 
             (availability.visual * 0.2) + 
             (availability.reconstruction * 0.3) +
             (availability.segments * 0.1);
  }
}
```

#### Query-Type Relevance Scoring
```typescript
interface QueryAnalysis {
  type: 'visual' | 'audio' | 'mixed' | 'temporal';
  confidence: number;
  keywords: string[];
  visualIndicators: string[];  // ["typing", "walking", "gesturing"]
  audioIndicators: string[];   // ["discussion", "music", "dialogue"]
}

function calculateQueryRelevance(result: SearchResult, query: QueryAnalysis): number {
  let relevanceBonus = 0;
  
  // Visual query bonus
  if (query.type === 'visual' && result.visualCaptions) {
    const visualMatch = checkVisualMatch(result.visualCaptions, query.visualIndicators);
    relevanceBonus += visualMatch * 0.2; // Up to 0.2 bonus
  }
  
  // Audio query bonus  
  if (query.type === 'audio' && result.transcription) {
    const audioMatch = checkAudioMatch(result.transcription, query.audioIndicators);
    relevanceBonus += audioMatch * 0.15; // Up to 0.15 bonus
  }
  
  // Mixed query - balanced approach
  if (query.type === 'mixed') {
    const hasMultiModal = result.transcription && result.visualCaptions;
    relevanceBonus += hasMultiModal ? 0.1 : 0;
  }
  
  // Temporal precision bonus
  if (query.type === 'temporal' && result.preciseSegments) {
    relevanceBonus += 0.1;
  }
  
  return Math.min(relevanceBonus, 0.3); // Cap at 0.3
}
```

#### Quality-Based Promotion System
```typescript
function calculateQualityBonus(result: SearchResult): number {
  let qualityBonus = 0;
  
  // Transcription quality indicators
  if (result.transcriptionConfidence > 0.9) qualityBonus += 0.05;
  if (result.hasWordTimestamps) qualityBonus += 0.03;
  
  // Visual quality indicators  
  if (result.visualConfidence > 0.8) qualityBonus += 0.04;
  if (result.visualCaptions?.length > 3) qualityBonus += 0.02; // Rich visual context
  
  // Reconstruction quality indicators
  if (result.sceneCoherence > 0.85) qualityBonus += 0.06;
  
  return Math.min(qualityBonus, 0.2); // Cap at 0.2
}
```

### Adaptive Strategy Examples

#### Case 1: Only Transcription Available
```typescript
// Query: "person typing on keyboard" 
// Available: transcription only, visual processing failed

const queryAnalysis = {
  type: 'visual',
  visualIndicators: ['typing', 'keyboard', 'person'],
  audioIndicators: ['clicking', 'keys']
};

const result = {
  level: 'immediate',
  similarity: 0.65,           // Lower similarity (visual query, audio data)
  transcription: "clicking sounds and keyboard noises",
  visualCaptions: null,       // Not available
  transcriptionConfidence: 0.92
};

const score = {
  baseScore: 0.65,
  dataAvailability: 1.0,      // Transcription fully available
  queryRelevance: 0.1,        // Some audio match ("clicking", "keyboard")
  qualityBonus: 0.05,         // High transcription confidence
  finalScore: 0.8             // (0.65 * 1.0) + 0.1 + 0.05 = 0.8
};

// Result: Transcription gets promoted despite being visual query
```

#### Case 2: Multi-Level Data with Quality Differences
```typescript
// Query: "budget discussion"
// Available: All levels, but visual is poor quality

const results = [
  {
    level: 'immediate',
    similarity: 0.85,
    transcription: "discussing quarterly budget allocations and cost projections",
    dataAvailability: 1.0,     // Full transcription
    queryRelevance: 0.15,      // Perfect audio match
    qualityBonus: 0.05,
    finalScore: 1.05           // (0.85 * 1.0) + 0.15 + 0.05
  },
  {
    level: 'enhanced', 
    similarity: 0.78,
    transcription: "discussing quarterly budget allocations",
    visualCaptions: ["blurry text", "unclear scene"], // Poor visual quality
    dataAvailability: 0.75,    // Transcription good, visual poor
    queryRelevance: 0.12,      // Good audio match
    qualityBonus: 0.02,        // Low visual confidence
    finalScore: 0.725          // (0.78 * 0.75) + 0.12 + 0.02
  },
  {
    level: 'reconstructed',
    similarity: 0.82,
    // Reconstruction not yet indexed for this segment
    dataAvailability: 0.0,     // No reconstruction data
    finalScore: 0.0            // Eliminated due to no data
  }
];

// Result: Immediate level wins despite lower base similarity
```

#### Case 3: Balanced Multi-Modal Query
```typescript
// Query: "person presenting financial charts"
// Available: Good transcription + good visual

const result = {
  level: 'enhanced',
  similarity: 0.72,
  transcription: "presenting the financial results for Q3",
  visualCaptions: ["person pointing", "charts on screen", "presentation setup"],
  dataAvailability: 0.85,     // Good transcription + visual
  queryRelevance: 0.2,        // Perfect multi-modal match
  qualityBonus: 0.08,         // Good quality both modes
  finalScore: 0.892           // (0.72 * 0.85) + 0.2 + 0.08
};
```

### Dynamic Promotion Logic
```typescript
function rankResults(results: SearchResult[], query: QueryAnalysis): SearchResult[] {
  const scoredResults = results.map(result => ({
    ...result,
    score: calculateFinalScore(result, query)
  }));
  
  // Sort by final score
  const ranked = scoredResults.sort((a, b) => b.score.finalScore - a.score.finalScore);
  
  // Apply promotion rules
  return applyPromotionRules(ranked, query);
}

function applyPromotionRules(results: SearchResult[], query: QueryAnalysis): SearchResult[] {
  // Rule 1: Promote transcription if visual processing failed
  if (query.type === 'visual') {
    const transcriptionResults = results.filter(r => r.transcription && !r.visualCaptions);
    const visualResults = results.filter(r => r.visualCaptions);
    
    if (visualResults.length === 0 && transcriptionResults.length > 0) {
      // Boost transcription results when visual is unavailable
      transcriptionResults.forEach(r => r.score.finalScore += 0.1);
    }
  }
  
  // Rule 2: Promote segment-level precision for temporal queries
  if (query.type === 'temporal') {
    results.filter(r => r.preciseSegments).forEach(r => r.score.finalScore += 0.15);
  }
  
  // Rule 3: Penalize incomplete reconstruction
  results.filter(r => r.level === 'reconstructed' && !r.sceneContext)
         .forEach(r => r.score.finalScore *= 0.5);
  
  return results.sort((a, b) => b.score.finalScore - a.score.finalScore);
}
```

### Performance Implications

#### Search Latency by Level
- **Immediate**: <500ms (pre-computed embeddings)
- **Enhanced**: <1000ms (more data to search)
- **Reconstructed**: <2000ms (complex scene data)

#### Caching Strategy
```typescript
// Multi-level caching for different processing states
const searchCache = {
  immediate: new LRUCache({ max: 1000, ttl: '1h' }),
  enhanced: new LRUCache({ max: 500, ttl: '2h' }),
  reconstructed: new LRUCache({ max: 200, ttl: '4h' })
};
```

## Benefits

### Immediate Benefits
- ✅ **60s to searchable**: Content available immediately after upload
- ✅ **Concurrent processing**: 38x real-time transcription speed
- ✅ **Progressive enhancement**: Basic search → enhanced search → full reconstruction
- ✅ **Fault tolerance**: Partial results preserved if processing fails

### Long-term Benefits
- ✅ **Better UX**: Users see results immediately
- ✅ **Scalable**: Batch processing handles large videos efficiently
- ✅ **Flexible**: Can adjust batch size based on performance
- ✅ **Incremental**: Storage and indexing happen as batches complete

## Risks & Mitigations

### Risk 1: Database Complexity
**Mitigation**: Use clear batch status tracking and proper indexing

### Risk 2: Duplicate Processing
**Mitigation**: Implement proper batch state management and idempotency

### Risk 3: Resource Contention
**Mitigation**: Limit concurrent batch processing and monitor resource usage

## Success Metrics

### Phase 0 Success (Week 2)
- [ ] Video searchable within 60 seconds of upload
- [ ] 5-minute batch transcription completes in <40 seconds
- [ ] Search results return relevant content (>50% similarity)

### Phase 1 Success (Week 4)
- [ ] Enhanced batches complete within 5 minutes
- [ ] Visual context improves search quality by 10%
- [ ] Incremental storage works without data loss

### Overall Success (Week 6)
- [ ] End-to-end processing time reduced by 70%
- [ ] User satisfaction with search speed increases
- [ ] No regression in final reconstruction quality

## Implementation Priority

1. **HIGH**: Phase 0 - Immediate batch processing
2. **MEDIUM**: Phase 1 - Enhanced batch processing  
3. **LOW**: Integration with existing multi-phase system

This ADR addresses the core user need for immediate searchability while maintaining the benefits of our multi-phase processing approach.
