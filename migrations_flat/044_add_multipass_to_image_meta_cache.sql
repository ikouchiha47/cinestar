-- sql: db:image_search
-- Migration 044: Add multi-pass captioning fields to image_meta_cache
-- TARGET: Image Search Database (image_search.db)

-- Add new columns for multi-pass analysis to image_meta_cache
ALTER TABLE image_meta_cache ADD COLUMN caption TEXT;
ALTER TABLE image_meta_cache ADD COLUMN caption_elements TEXT;
ALTER TABLE image_meta_cache ADD COLUMN caption_spatial TEXT;
ALTER TABLE image_meta_cache ADD COLUMN caption_temporal TEXT;
ALTER TABLE image_meta_cache ADD COLUMN caption_tokens TEXT;

-- Add index for querying by elements
CREATE INDEX IF NOT EXISTS idx_image_meta_has_elements 
ON image_meta_cache(caption_elements) 
WHERE caption_elements IS NOT NULL;

-- Field descriptions:
-- caption: Primary caption text from moondream
-- caption_elements: JSON string of ExtractedElements (objects, people, colors, lighting, time, setting, mood)
-- caption_spatial: Spatial analysis text from moondream
-- caption_temporal: Temporal analysis text from moondream
-- caption_tokens: JSON string of token counts per phase
