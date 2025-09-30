-- Migration: Add multi-stage embeddings to video_segments table
-- This enables storing embeddings from different pipeline stages for progressive search

-- Add columns for multi-stage embeddings
ALTER TABLE video_segments ADD COLUMN transcription_embedding BLOB;
ALTER TABLE video_segments ADD COLUMN caption_embedding BLOB;  
ALTER TABLE video_segments ADD COLUMN reconstruction_embedding BLOB;

-- Add metadata column to track embedding quality and confidence
ALTER TABLE video_segments ADD COLUMN embedding_metadata TEXT; -- JSON with quality scores

-- Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_video_segments_transcription_embedding ON video_segments(transcription_embedding) WHERE transcription_embedding IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_video_segments_caption_embedding ON video_segments(caption_embedding) WHERE caption_embedding IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_video_segments_reconstruction_embedding ON video_segments(reconstruction_embedding) WHERE reconstruction_embedding IS NOT NULL;

-- Add column to track which embeddings are available for each segment
ALTER TABLE video_segments ADD COLUMN available_embeddings TEXT DEFAULT '[]'; -- JSON array: ["transcription", "caption", "reconstruction"]

-- Update existing segments to mark legacy embedding as reconstruction_embedding
UPDATE video_segments 
SET reconstruction_embedding = embedding,
    available_embeddings = '["reconstruction"]'
WHERE embedding IS NOT NULL;

-- Add column to track embedding generation timestamps
ALTER TABLE video_segments ADD COLUMN embedding_timestamps TEXT; -- JSON with timestamps per embedding type
