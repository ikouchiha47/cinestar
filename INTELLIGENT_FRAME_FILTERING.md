# Intelligent Frame Filtering for VideoRAG

## Problem Statement
Current system processes **1170 images per video** (293 batches), causing excessive computational overhead in captioning pipeline. Need intelligent filtering to reduce to ~20-50 meaningful frames while preserving visual information quality.

## Solution Architecture

### Three-Stage Filtering Pipeline

```
Raw Keyframes (1170) 
    ↓
Stage 1: FFmpeg Motion Analysis
    ↓
Stage 2: Visual Similarity Filtering  
    ↓
Stage 3: Scene Boundary Priority
    ↓
Final Frames (~20-50)
```

## Stage 1: FFmpeg Motion-Based Importance

### Motion Vector Analysis
Use FFmpeg's built-in motion detection to score frame importance based on visual activity.

```bash
# Extract motion vectors and scene change scores
ffmpeg -i video.mp4 -vf "select='gt(scene,0.3)',showinfo" -vsync vfr frames_%03d.png

# Advanced motion analysis with scores
ffmpeg -i video.mp4 -vf "select='gt(scene,0.1)',metadata=print:file=motion_scores.txt" -f null -
```

### Motion Scoring Algorithm
```typescript
interface MotionScore {
  timestamp: number;
  sceneScore: number;    // 0.0-1.0 (scene change intensity)
  motionIntensity: number; // Motion vector magnitude
  complexity: number;    // Visual complexity score
}
```

**Implementation Strategy:**
1. **High Motion Frames**: Prioritize frames with significant motion (action scenes, camera movement)
2. **Scene Transitions**: Detect cuts, fades, transitions using `scene` filter
3. **Static Frame Removal**: Skip frames with minimal motion (static shots, paused content)

### FFmpeg Commands for Motion Analysis
```bash
# Scene detection with thresholds
ffmpeg -i input.mp4 -vf "select='gt(scene,0.15)',showinfo" -vsync vfr -f null - 2>&1 | grep "scene_score"

# Motion vector extraction
ffmpeg -i input.mp4 -vf "codecview=mv=pf+bf+bb" -pix_fmt yuv420p motion_vectors.mp4

# Histogram analysis for complexity
ffmpeg -i input.mp4 -vf "histogram,metadata=print" -f null - 2>&1 | grep "lavfi.histogram"
```

## Stage 2: Visual Similarity Filtering

### Perceptual Hashing
Use image hashing to detect and remove visually similar consecutive frames.

```typescript
interface FrameHash {
  timestamp: number;
  phash: string;        // Perceptual hash (64-bit)
  dhash: string;        // Difference hash
  similarity: number;   // Similarity to previous frame
}
```

### Similarity Detection Process
1. **Extract Frame Hashes**: Generate perceptual hashes for each candidate frame
2. **Calculate Hamming Distance**: Compare consecutive frame hashes
3. **Apply Threshold**: Remove frames with >85% similarity to previous frame
4. **Preserve Key Moments**: Always keep first/last frames and scene boundaries

### Hash-Based Filtering Algorithm
```typescript
async filterSimilarFrames(frames: FrameCandidate[]): Promise<FrameCandidate[]> {
  const filtered = [frames[0]]; // Always keep first
  
  for (let i = 1; i < frames.length; i++) {
    const similarity = calculateHammingDistance(frames[i-1].hash, frames[i].hash);
    
    if (similarity < SIMILARITY_THRESHOLD || frames[i].isSceneBoundary) {
      filtered.push(frames[i]);
    }
  }
  
  return filtered;
}
```

## Stage 3: Scene Boundary Priority

### Scene Cut Detection
Leverage FFmpeg's scene detection to identify the most visually important moments.

```bash
# Detect scene cuts with timestamps
ffmpeg -i input.mp4 -vf "select='gt(scene,0.2)',metadata=print:file=scenes.txt" -f null -

# Extract frames at scene boundaries
ffmpeg -i input.mp4 -vf "select='gt(scene,0.2)'" -vsync vfr scene_%03d.png
```

### Priority Scoring System
```typescript
interface FramePriority {
  timestamp: number;
  sceneScore: number;      // Scene change intensity (0-1)
  motionScore: number;     // Motion activity level (0-1)
  boundaryDistance: number; // Distance to nearest scene cut
  finalScore: number;      // Weighted combination
}

// Priority calculation
finalScore = (sceneScore * 0.4) + (motionScore * 0.3) + (boundaryBonus * 0.3)
```

### Scene Boundary Strategy
1. **Mandatory Frames**: Always include frames within 1-2 seconds of scene cuts
2. **Transition Frames**: Capture before/after scene transitions
3. **Content Diversity**: Ensure coverage across different scene types
4. **Temporal Distribution**: Maintain even temporal spacing when possible

## Combined Filtering Algorithm

### Multi-Stage Process
```typescript
class IntelligentFrameFilter {
  async filterFrames(videoPath: string, maxFrames: number = 20): Promise<string[]> {
    // Stage 1: FFmpeg Motion Analysis
    const motionScores = await this.analyzeMotionWithFFmpeg(videoPath);
    const candidateFrames = this.selectMotionCandidates(motionScores, maxFrames * 3);
    
    // Stage 2: Visual Similarity Filtering  
    const hashedFrames = await this.generatePerceptualHashes(candidateFrames);
    const similarityFiltered = this.filterSimilarFrames(hashedFrames);
    
    // Stage 3: Scene Boundary Priority
    const sceneBoundaries = await this.detectSceneBoundaries(videoPath);
    const priorityScored = this.scorePriority(similarityFiltered, sceneBoundaries);
    
    // Final Selection
    return this.selectTopFrames(priorityScored, maxFrames);
  }
}
```

### FFmpeg Integration Points

#### 1. Motion Vector Extraction
```bash
# Extract motion data to JSON
ffmpeg -i input.mp4 -vf "select='not(mod(n,30))',showinfo" -f null - 2>&1 \
  | grep -E "(scene_score|pts_time)" | jq -R 'split(" ") | {timestamp: .[1], scene: .[3]}'
```

#### 2. Scene Detection Pipeline
```bash
# Generate scene cut timestamps
ffmpeg -i input.mp4 -vf "select='gt(scene,0.15)',showinfo" -f null - 2>&1 \
  | grep "pts_time" | sed 's/.*pts_time:\([0-9.]*\).*/\1/' > scene_cuts.txt
```

#### 3. Frame Extraction at Key Points
```bash
# Extract frames at calculated timestamps
while read timestamp; do
  ffmpeg -ss $timestamp -i input.mp4 -vframes 1 -q:v 2 "frame_${timestamp}.jpg"
done < selected_timestamps.txt
```

## Performance Optimization

### Computational Efficiency
- **Parallel Processing**: Process motion analysis and hashing concurrently
- **Caching**: Store motion scores and hashes for reuse
- **Batch Operations**: Group FFmpeg operations to minimize overhead
- **Memory Management**: Stream processing for large videos

### Quality Metrics
```typescript
interface FilteringMetrics {
  originalFrameCount: number;
  filteredFrameCount: number;
  reductionRatio: number;
  sceneCoverage: number;     // % of scenes represented
  temporalDistribution: number; // Evenness of frame spacing
  processingTime: number;
}
```

## Configuration Parameters

### Tunable Thresholds
```typescript
interface FilterConfig {
  maxFrames: number;           // Final frame count target (20-50)
  motionThreshold: number;     // Motion intensity cutoff (0.1-0.5)
  sceneThreshold: number;      // Scene change sensitivity (0.1-0.3)
  similarityThreshold: number; // Visual similarity cutoff (0.8-0.95)
  boundaryWindow: number;      // Scene boundary proximity (1-3 seconds)
  
  // Scoring weights
  motionWeight: number;        // Motion importance (0.3)
  sceneWeight: number;         // Scene change importance (0.4)
  boundaryWeight: number;      // Boundary proximity importance (0.3)
}
```

## Expected Results

### Performance Improvement
- **Before**: 1170 frames → 293 batches → ~20 minutes processing
- **After**: 20-50 frames → 5-13 batches → ~2 minutes processing
- **Reduction**: 95% fewer frames, 90% faster processing

### Quality Preservation
- Maintain visual diversity across video content
- Capture key moments and transitions
- Preserve scene representation
- Reduce redundant similar frames

## Implementation Roadmap

1. **FFmpeg Motion Analysis Module** - Extract motion vectors and scene scores
2. **Perceptual Hashing Service** - Generate and compare frame hashes  
3. **Scene Boundary Detection** - Identify and prioritize scene cuts
4. **Unified Filtering Algorithm** - Combine all three methods
5. **Performance Optimization** - Parallel processing and caching
6. **Configuration Interface** - Tunable parameters for different use cases

This approach provides intelligent, content-aware frame selection that dramatically reduces computational load while preserving the most visually significant moments for captioning and analysis.
