# Video Transcription Setup Guide

## Problem Summary

The video transcription pipeline had issues where:
- `seg_0` transcribed successfully using extracted WAV files
- `seg_1+` failed because `segment.audioPath` was undefined
- Pipeline wasn't properly passing extracted audio paths to transcription

## Solutions Implemented

### Solution 1: Quick Fix (Applied)
Modified `transcription-processor.ts` to check for extracted audio files directly:
- Looks for `{segment.id}.wav` in `./tmp/audio/` directory
- Falls back to `segment.audioPath` or video file if not found
- More robust handling of missing audio paths

### Solution 2: Docker Compose (Recommended)
Containerized transcription services for better reliability:

#### Setup Docker Services
```bash
# Pull Ollama models if needed
echo "Setting up Ollama models..."
docker exec driller-ollama ollama pull moondream:v2
docker exec driller-ollama ollama pull qllama/bge-large-en-v1.5:latest
docker-compose up -d
```

#### Services Available
- **Whisper API**: `http://localhost:9000` (OpenAI Whisper ASR)
- **Ollama**: `http://localhost:11434` (LLaVA for multimodal)
- **Fast Whisper**: `http://localhost:8000` (faster-whisper, optional)

#### Service Priority
1. DockerWhisperService (primary, more reliable)
2. WhisperCppService (fallback, local binary)

## Testing

Test the pipeline with a video file:
```bash
# Check if services are running
curl http://localhost:9000/
curl http://localhost:11434/api/tags

# Process a video through the UI or API
```

## Benefits of Docker Solution

1. **Reliability**: Containerized services are more stable
2. **Consistency**: Same environment across different machines  
3. **Scalability**: Easy to add more transcription workers
4. **Maintenance**: No local binary path issues
5. **Fallback**: Still has WhisperCpp as backup

## Troubleshooting

### Docker Services Not Starting
```bash
docker-compose logs whisper
docker-compose logs ollama
```

### Audio Extraction Issues
Check `./tmp/audio/` directory for WAV files:
```bash
ls -la ./tmp/audio/
```

### Pipeline Debugging
Enable debug logs in transcription processor to see audio path resolution.

## Video Processing Pipeline Stages

The VideoRAG system processes videos through a sequential pipeline with controlled concurrency:

### Stage Flow
```
Video File → Segmentation → Audio Extraction → Visual Processing → Transcription → Captioning → OCR → Storage
```

### 1. Segmentation Stage
**Purpose**: Detect scene changes and create temporal segments
- **Input**: Full video file
- **Process**: FFmpeg scene detection with threshold 0.4
- **Output**: Array of segments with `startTime`/`endTime` boundaries
- **Example**: `[0-89.4s, 87.4-868.3s, 866.3-875.5s, ...]`

### 2. Audio Extraction Stage  
**Purpose**: Extract audio for each segment
- **Input**: Video segment with timing boundaries
- **Process**: `ffmpeg -ss {startTime} -t {duration} -acodec pcm_s16le -ac 1 -ar 16000`
- **Output**: 16kHz mono WAV file per segment
- **Location**: `./tmp/audio/seg_{id}.wav`

### 3. Visual Processing Stage
**Purpose**: Generate thumbnails and keyframes
- **Thumbnails**: At scene cut points for overview
- **Keyframes**: Every 1 second within segment bounds for detailed analysis
- **Output**: JPEG files in `./cache/video/{hash}/thumbnails/` and `keyframes/`

### 4. Transcription Stage
**Purpose**: Convert audio to text using ASR
- **Services**: Docker Whisper (primary) → WhisperCpp (fallback)
- **Input**: WAV file from audio extraction
- **Output**: Text transcript with word-level timestamps
- **API**: `POST http://localhost:9000/asr` with audio file

### 5. Captioning Stage
**Purpose**: Generate visual descriptions of keyframes
- **Services**: Ollama Vision (moondream:v2) → HTTP service (fallback)
- **Input**: JPEG keyframes from visual processing
- **Output**: Natural language descriptions of visual content
- **Batch Size**: 4 images processed concurrently

### 6. OCR Stage
**Purpose**: Extract text from video frames
- **Status**: Currently no services configured
- **Input**: Keyframes and thumbnails
- **Output**: Extracted text content

### 7. Storage Stage
**Purpose**: Store all processed data in SQLite database
- **Database**: `./data/video-rag.db` with sqlite-vec extension
- **Tables**: `video_files`, `video_segments`, `segments_fts`
- **Features**: Full-text search + vector embeddings for hybrid search

## Concurrency Model

### Segment-Level Parallelism
- **Batch Size**: 2 segments processed simultaneously
- **Reason**: Prevents resource exhaustion (Docker services, FFmpeg processes)

### Stage-Level Sequential
- Within each segment, stages run sequentially to ensure data dependencies
- Audio extraction must complete before transcription
- Visual processing can run parallel to audio extraction

### Timing Synchronization
- All processors use the same segment `startTime`/`endTime` boundaries
- Audio timestamps are relative to segment start (0-based from Whisper)
- Visual keyframes use absolute timestamps within segment range
- Database storage maps everything to consistent time ranges
