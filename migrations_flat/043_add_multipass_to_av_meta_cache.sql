-- sql: db:av_search
-- Migration 043: Add multi-pass captioning fields to av_meta_cache
-- TARGET: AV Search Database (av_search.db)

-- Add new columns for multi-pass analysis to av_meta_cache
ALTER TABLE av_meta_cache ADD COLUMN caption TEXT;
ALTER TABLE av_meta_cache ADD COLUMN caption_elements TEXT;
ALTER TABLE av_meta_cache ADD COLUMN caption_spatial TEXT;
ALTER TABLE av_meta_cache ADD COLUMN caption_temporal TEXT;
ALTER TABLE av_meta_cache ADD COLUMN caption_tokens TEXT;

-- Add index for querying by elements
CREATE INDEX IF NOT EXISTS idx_av_meta_has_elements 
ON av_meta_cache(caption_elements) 
WHERE caption_elements IS NOT NULL;

-- Field descriptions:
-- caption: Primary caption text from moondream
-- caption_elements: JSON string of ExtractedElements (objects, people, colors, lighting, time, setting, mood)
-- caption_spatial: Spatial analysis text from moondream
-- caption_temporal: Temporal analysis text from moondream
-- caption_tokens: JSON string of token counts per phase
