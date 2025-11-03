# ADR-001: Temporal Embedding with RNN for Media Processing

## Status
Proposed

## Context
Drillbit currently processes media files (images, videos, audio) with static embeddings that capture content at a single point in time. To enhance search capabilities and enable temporal understanding of media sequences, we need to implement temporal embeddings using Recurrent Neural Networks (RNNs) that can process media content over time and capture temporal relationships.

### Current System Analysis
- **Hardware**: MacBook (likely M1/M2 with unified memory architecture)
- **Current Stack**: Electron app with SQLite + sqlite-vec for embeddings
- **LLM Provider**: Ollama with vision and embedding models
- **Media Processing**: Sharp for images, FFmpeg for video/audio
- **Embedding Storage**: sqlite-vec with Float32Array embeddings

### Use Cases for Temporal Embeddings
1. **Video Scene Understanding**: Capture narrative flow and scene transitions
2. **Audio Temporal Patterns**: Music progression, speech patterns, ambient changes
3. **Image Sequence Analysis**: Photo series, time-lapse understanding
4. **Cross-Modal Temporal Correlation**: Sync audio-visual temporal features

## Decision
Implement a parallel temporal embedding system using LSTM/GRU networks that can process media sequences while maintaining compatibility with existing static embeddings.

## Architecture Design

### 1. Temporal Processing Pipeline
```
Media Input → Frame/Segment Extraction → Static Embeddings → RNN Processing → Temporal Embeddings
     ↓              ↓                        ↓                    ↓                ↓
   Video         FFmpeg                   Ollama              LSTM/GRU        sqlite-vec
   Audio         Chunks                 Vision/Audio           Model          (temporal)
   Images        Sequence               Embeddings                            
```

### 2. Database Schema Extension
```sql
-- Extend existing media_items table
ALTER TABLE media_items ADD COLUMN temporal_embedding BLOB;
ALTER TABLE media_items ADD COLUMN temporal_segments INTEGER DEFAULT 0;
ALTER TABLE media_items ADD COLUMN temporal_status TEXT DEFAULT 'pending';

-- New table for temporal segments
CREATE TABLE temporal_segments (
    id TEXT PRIMARY KEY,
    media_item_id TEXT NOT NULL,
    segment_index INTEGER NOT NULL,
    start_time REAL,
    end_time REAL,
    static_embedding BLOB,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (media_item_id) REFERENCES media_items(id)
);

-- New table for temporal embeddings
CREATE TABLE temporal_embeddings (
    id TEXT PRIMARY KEY,
    media_item_id TEXT NOT NULL,
    embedding BLOB NOT NULL,
    model_version TEXT NOT NULL,
    sequence_length INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (media_item_id) REFERENCES media_items(id)
);
```

### 3. RNN Model Architecture
```typescript
interface TemporalEmbeddingConfig {
  sequenceLength: number;      // Number of temporal segments
  embeddingDim: number;        // Input embedding dimension (from Ollama)
  hiddenDim: number;          // RNN hidden state dimension
  outputDim: number;          // Final temporal embedding dimension
  modelType: 'LSTM' | 'GRU';  // RNN variant
  bidirectional: boolean;      // Process sequence in both directions
}

interface TemporalSegment {
  index: number;
  startTime: number;
  endTime: number;
  staticEmbedding: Float32Array;
  mediaPath: string;
}
```

### 4. Implementation Strategy

#### Phase 1: Infrastructure Setup
1. **Add TensorFlow.js/ONNX Runtime** for RNN inference
2. **Extend database schema** for temporal data
3. **Create temporal processing queue** separate from static processing
4. **Implement segment extraction** for different media types

#### Phase 2: RNN Model Integration
1. **Pre-trained Model**: Use lightweight LSTM/GRU (e.g., 128-256 hidden units)
2. **Model Format**: ONNX for cross-platform compatibility
3. **Fallback Strategy**: If RNN fails, use concatenated static embeddings
4. **Model Versioning**: Track model versions for embedding compatibility

#### Phase 3: Parallel Processing
1. **Worker Threads**: Separate RNN processing from main thread
2. **Batch Processing**: Process multiple segments simultaneously
3. **Memory Management**: Stream processing for large videos
4. **Progress Tracking**: Real-time feedback for temporal processing

### 5. System Capacity Optimization

#### Memory Management
```typescript
class TemporalProcessor {
  private maxConcurrentJobs = 2; // Limit based on available RAM
  private segmentBatchSize = 8;  // Process segments in batches
  private maxSequenceLength = 32; // Limit temporal window
  
  async processTemporalEmbedding(mediaItem: MediaItem): Promise<Float32Array> {
    // Stream processing to avoid memory overflow
    const segments = await this.extractSegments(mediaItem);
    const batches = this.createBatches(segments, this.segmentBatchSize);
    
    const temporalFeatures: Float32Array[] = [];
    for (const batch of batches) {
      const batchEmbeddings = await this.processBatch(batch);
      temporalFeatures.push(...batchEmbeddings);
    }
    
    return this.runRNN(temporalFeatures);
  }
}
```

#### Resource Allocation
- **CPU Cores**: Use 2-3 cores for RNN processing (leave cores for UI/other tasks)
- **Memory**: Limit to 2GB for temporal processing (safe for 8GB+ systems)
- **Storage**: Compress temporal embeddings (quantization to int8/int16)
- **Concurrent Jobs**: Max 2 temporal processing jobs simultaneously

### 6. API Extensions

#### New Endpoints
```typescript
interface TemporalMediaAPI {
  // Start temporal processing for a media item
  startTemporalProcessing(mediaId: string): Promise<{success: boolean, jobId?: string}>;
  
  // Get temporal processing status
  getTemporalStatus(mediaId: string): Promise<{status: 'pending' | 'processing' | 'completed' | 'failed'}>;
  
  // Search using temporal embeddings
  searchTemporal(query: string, temporalWeight: number): Promise<MediaItem[]>;
  
  // Get temporal segments for a media item
  getTemporalSegments(mediaId: string): Promise<TemporalSegment[]>;
}
```

#### UI Integration
```typescript
// Add temporal processing controls to existing UI
interface SourceActions {
  startIndexing: (sourceId: string) => void;
  forceReindex: (sourceId: string) => void;
  startTemporalProcessing: (sourceId: string) => void; // New action
}
```

### 7. Model Selection & Training

#### Pre-trained Options
1. **Video**: Use video understanding models (e.g., I3D features → LSTM)
2. **Audio**: Audio sequence models (e.g., Wav2Vec features → GRU)
3. **Images**: Image sequence models (e.g., ResNet features → LSTM)

#### Lightweight Models
- **Model Size**: <50MB for fast loading
- **Inference Speed**: <100ms per sequence on M1/M2
- **Quantization**: Use int8 quantization for mobile deployment

### 8. Fallback & Compatibility

#### Graceful Degradation
```typescript
class HybridEmbeddingProvider {
  async generateEmbedding(mediaItem: MediaItem): Promise<Float32Array> {
    try {
      // Try temporal embedding first
      if (this.supportsTemporalProcessing(mediaItem)) {
        return await this.generateTemporalEmbedding(mediaItem);
      }
    } catch (error) {
      console.warn('Temporal processing failed, falling back to static:', error);
    }
    
    // Fallback to existing static embedding
    return await this.generateStaticEmbedding(mediaItem);
  }
}
```

## Implementation Timeline

### Week 1-2: Foundation
- [ ] Database schema migration
- [ ] Basic temporal segment extraction
- [ ] TensorFlow.js/ONNX integration

### Week 3-4: Core RNN Processing
- [ ] LSTM/GRU model integration
- [ ] Parallel processing pipeline
- [ ] Memory optimization

### Week 5-6: UI & API Integration
- [ ] Temporal processing controls
- [ ] Progress tracking
- [ ] Search integration

### Week 7-8: Optimization & Testing
- [ ] Performance tuning
- [ ] Error handling
- [ ] User testing

## Consequences

### Positive
- **Enhanced Search**: Temporal understanding improves relevance
- **Future-Proof**: Enables advanced AI features (video summarization, etc.)
- **Parallel Processing**: Doesn't block existing functionality
- **Scalable**: Can add more sophisticated models later

### Negative
- **Complexity**: Adds significant system complexity
- **Resource Usage**: Higher CPU/memory requirements
- **Storage**: Additional storage for temporal embeddings
- **Maintenance**: More models and dependencies to maintain

### Risks & Mitigations
- **Performance Impact**: Mitigate with resource limits and background processing
- **Model Compatibility**: Use versioned models with fallback strategies
- **Memory Issues**: Implement streaming and batch processing
- **User Experience**: Provide clear progress feedback and optional processing

## Alternatives Considered

1. **Server-Side Processing**: Rejected due to privacy and offline requirements
2. **Static Embedding Concatenation**: Simpler but loses temporal relationships
3. **External API**: Rejected due to cost and latency concerns
4. **Transformer Models**: Too resource-intensive for local processing

## References
- [TensorFlow.js RNN Guide](https://www.tensorflow.org/js/guide/models_and_layers)
- [ONNX Runtime Web](https://onnxruntime.ai/docs/get-started/with-javascript.html)
- [sqlite-vec Documentation](https://github.com/asg017/sqlite-vec)
- [Video Understanding with RNNs](https://arxiv.org/abs/1411.4389)
