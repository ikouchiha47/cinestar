# ADR: Image Tagging and Metadata Extraction System

**Date:** 2025-10-10  
**Status:** Proposed  
**Deciders:** Engineering Team

---

## Context

Current image search relies solely on **vector embeddings** from CLIP/Moondream. While this enables semantic search ("mountain sunset"), it lacks:

1. **Structured metadata** - Objects, locations, mood, weather
2. **Filterable attributes** - "Show me all rainy photos" or "Photos with cats"
3. **Multi-modal search** - Combine text search with filters
4. **Explicit tags** - User-visible labels for browsing

### Current Search Terms Analysis

From user requirements, we need to detect:

**Objects:**
- Animals: cat, dog, bird, elephant
- Food: coffee, vegetables, dessert, chocolate
- Technology: laptop, camera, code screen
- Nature: mountain, ocean, forest, leaves

**Locations/Scenes:**
- Urban: tokyo street, brooklyn bridge, architecture
- Nature: beach, mountain, forest, safari
- Indoor: workspace, kitchen, studio

**Mood/Atmosphere:**
- Calm, vibrant, moody, minimal, busy

**Weather/Conditions:**
- Rain, snow, fog, sunset, golden hour, night

**Visual Properties:**
- Colors: colorful, golden, warm tones, cool tones
- Composition: aerial, portrait, close-up, flatlay
- Style: abstract, geometric, watercolor, vintage

---

## Decision

Implement a **two-phase tagging system** that extracts structured metadata from images using vision models.

### Architecture:

```
┌─────────────────────────────────────────────────────────────┐
│ Image Indexing Pipeline                                      │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Phase 1: Structured Caption Generation                       │
│   - Use Moondream v2 with structured prompt                 │
│   - Output: Markdown-formatted description                  │
│   - Extract: Objects, scene, mood, weather, colors          │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Phase 2: Tag Extraction                                      │
│   - Option A: Regex parsing of markdown output              │
│   - Option B: Smaller LLM for structured extraction         │
│   - Option C: Moondream v3 with JSON output (future)        │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Storage: SQLite with FTS5                                    │
│   - Tags table with categories                              │
│   - Full-text search on tags                                │
│   - Faceted filtering in UI                                 │
└─────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Structured Caption Generation

### Prompt Engineering

**Current Moondream prompt:**
```
Describe this image in detail.
```

**New structured prompt:**
```
Analyze this image and provide a structured description in the following format:

## Objects
List all visible objects (e.g., cat, laptop, coffee cup)

## Scene
Describe the location/setting (e.g., urban street, mountain landscape, indoor workspace)

## Mood
Describe the atmosphere (e.g., calm, vibrant, moody, minimal)

## Weather/Lighting
Describe conditions (e.g., sunny, rainy, foggy, golden hour, night)

## Colors
Dominant colors and tones (e.g., warm tones, cool blues, vibrant, muted)

## Composition
Visual style (e.g., aerial view, close-up, portrait, flatlay)

## Additional Details
Any other notable features
```

**Example Output:**
```markdown
## Objects
- Mountain peaks
- Pine trees
- Lake
- Clouds

## Scene
Mountain landscape at a lake

## Mood
Calm, peaceful, majestic

## Weather/Lighting
Sunset, golden hour, warm light

## Colors
Warm tones, orange, pink, purple sky, blue water

## Composition
Wide landscape shot, aerial perspective

## Additional Details
Reflection of mountains in still water, dramatic sky
```

### Implementation

**File:** `src/core/processors/image-tagging-processor.ts`

```typescript
export class ImageTaggingProcessor {
  private static readonly STRUCTURED_PROMPT = `
Analyze this image and provide a structured description in the following format:

## Objects
List all visible objects (e.g., cat, laptop, coffee cup)

## Scene
Describe the location/setting (e.g., urban street, mountain landscape)

## Mood
Describe the atmosphere (e.g., calm, vibrant, moody)

## Weather/Lighting
Describe conditions (e.g., sunny, rainy, golden hour)

## Colors
Dominant colors and tones (e.g., warm tones, vibrant)

## Composition
Visual style (e.g., aerial view, close-up, portrait)
`;

  static async generateStructuredCaption(imagePath: string): Promise<string> {
    // Use existing Moondream service with structured prompt
    const result = await OllamaCaptioningService.generateCaption(
      imagePath,
      this.STRUCTURED_PROMPT
    );
    return result.caption;
  }
}
```

---

## Phase 2: Tag Extraction

### Option A: Regex Parsing (Simple, Fast)

**Pros:**
- No additional model needed
- Fast and deterministic
- Works offline

**Cons:**
- Brittle to format changes
- May miss nuanced tags
- Requires careful regex patterns

**Implementation:**

```typescript
export class TagExtractor {
  static extractTags(structuredCaption: string): ImageTags {
    const tags: ImageTags = {
      objects: [],
      scene: [],
      mood: [],
      weather: [],
      colors: [],
      composition: [],
      raw: structuredCaption
    };

    // Extract objects section
    const objectsMatch = structuredCaption.match(/## Objects\s+([\s\S]*?)(?=##|$)/);
    if (objectsMatch) {
      tags.objects = this.parseListItems(objectsMatch[1]);
    }

    // Extract scene
    const sceneMatch = structuredCaption.match(/## Scene\s+([\s\S]*?)(?=##|$)/);
    if (sceneMatch) {
      tags.scene = this.parseText(sceneMatch[1]);
    }

    // ... similar for other sections

    return tags;
  }

  private static parseListItems(text: string): string[] {
    return text
      .split('\n')
      .filter(line => line.trim().startsWith('-'))
      .map(line => line.replace(/^-\s*/, '').trim())
      .filter(Boolean);
  }

  private static parseText(text: string): string[] {
    // Split by commas, extract keywords
    return text
      .split(/[,\n]/)
      .map(s => s.trim())
      .filter(Boolean);
  }
}
```

### Option B: Small LLM for Extraction (Robust)

**Pros:**
- More robust to format variations
- Can handle synonyms
- Better at extracting implicit tags

**Cons:**
- Additional model inference
- Slower processing
- Requires model deployment

**Implementation:**

```typescript
export class LLMTagExtractor {
  static async extractTags(structuredCaption: string): Promise<ImageTags> {
    const prompt = `
Extract structured tags from this image description.
Return JSON with arrays for: objects, scene, mood, weather, colors, composition.

Description:
${structuredCaption}

JSON:`;

    const response = await OllamaService.generate({
      model: 'llama3.2:1b',  // Small, fast model
      prompt,
      format: 'json'
    });

    return JSON.parse(response);
  }
}
```

### Option C: Moondream v3 with JSON Output (Future)

**When available:**
- Single-pass structured output
- No parsing needed
- Most accurate

**Prompt:**
```typescript
const prompt = {
  task: "analyze_image",
  output_format: "json",
  schema: {
    objects: ["string"],
    scene: "string",
    mood: ["string"],
    weather: "string",
    colors: ["string"],
    composition: "string"
  }
};
```

---

## Database Schema

### Tags Table

```sql
CREATE TABLE image_tags (
  id INTEGER PRIMARY KEY,
  media_item_id INTEGER NOT NULL,
  category TEXT NOT NULL,  -- 'object', 'scene', 'mood', 'weather', 'color', 'composition'
  tag TEXT NOT NULL,
  confidence REAL DEFAULT 1.0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (media_item_id) REFERENCES media_items(id) ON DELETE CASCADE
);

CREATE INDEX idx_image_tags_media_item ON image_tags(media_item_id);
CREATE INDEX idx_image_tags_category ON image_tags(category);
CREATE INDEX idx_image_tags_tag ON image_tags(tag);

-- Full-text search on tags
CREATE VIRTUAL TABLE image_tags_fts USING fts5(
  tag,
  category,
  content=image_tags,
  content_rowid=id
);
```

### Structured Caption Storage

```sql
-- Add column to media_items table
ALTER TABLE media_items ADD COLUMN structured_caption TEXT;
ALTER TABLE media_items ADD COLUMN tags_extracted_at TEXT;
```

---

## Search and Filtering

### Combined Search

```typescript
interface SearchQuery {
  // Text search (existing)
  query?: string;
  
  // Tag filters (new)
  filters?: {
    objects?: string[];      // AND logic: must have all
    scene?: string[];
    mood?: string[];
    weather?: string[];
    colors?: string[];
    composition?: string[];
  };
  
  // Combination mode
  mode?: 'vector' | 'tags' | 'hybrid';
}
```

### Example Queries

**1. Vector only (current):**
```typescript
search({ query: "mountain sunset" })
// Uses CLIP embeddings
```

**2. Tags only (new):**
```typescript
search({ 
  filters: { 
    weather: ["rain"],
    objects: ["cat"]
  }
})
// SQL: WHERE tag IN ('rain', 'cat')
```

**3. Hybrid (best):**
```typescript
search({ 
  query: "peaceful landscape",
  filters: { 
    weather: ["sunset", "golden hour"],
    mood: ["calm"]
  }
})
// Vector search + tag filtering
```

---

## UI Integration

### Faceted Search UI

```
┌────────────────────────────────────────────┐
│ Search: [peaceful landscape        ] 🔍   │
├────────────────────────────────────────────┤
│ Filters:                                   │
│                                            │
│ Objects:                                   │
│ ☐ Cat (127)  ☐ Dog (89)  ☐ Mountain (234) │
│                                            │
│ Weather:                                   │
│ ☑ Sunset (156)  ☐ Rain (45)  ☐ Snow (23)  │
│                                            │
│ Mood:                                      │
│ ☑ Calm (201)  ☐ Vibrant (178)             │
│                                            │
│ [Clear Filters]                            │
└────────────────────────────────────────────┘
```

### Tag Display on Images

```
┌─────────────────────┐
│                     │
│   [Image Preview]   │
│                     │
├─────────────────────┤
│ 🏔️ mountain         │
│ 🌅 sunset           │
│ 😌 calm             │
└─────────────────────┘
```

---

## Implementation Phases

### Phase 1: Foundation (Week 1)
- [ ] Design structured prompt for Moondream
- [ ] Implement `ImageTaggingProcessor`
- [ ] Test prompt with sample images
- [ ] Refine prompt based on output quality

### Phase 2: Tag Extraction (Week 2)
- [ ] Implement regex-based `TagExtractor` (Option A)
- [ ] Test extraction accuracy
- [ ] Create tag normalization (synonyms, plurals)
- [ ] Add database schema for tags

### Phase 3: Integration (Week 3)
- [ ] Integrate into indexing pipeline
- [ ] Batch process existing images
- [ ] Add tag-based search API
- [ ] Performance optimization

### Phase 4: UI (Week 4)
- [ ] Faceted search filters
- [ ] Tag display on images
- [ ] Tag autocomplete in search
- [ ] Tag management (edit, merge)

### Phase 5: Enhancement (Future)
- [ ] Try Option B (LLM extraction) for comparison
- [ ] Migrate to Moondream v3 when available (Option C)
- [ ] User-added tags
- [ ] Tag suggestions
- [ ] Tag-based recommendations

---

## Performance Considerations

### Processing Time

**Per image:**
- Moondream caption: ~2-3s (existing)
- Tag extraction (regex): ~5ms
- Database insert: ~10ms
- **Total overhead: ~15ms** (negligible)

**Batch processing:**
- 1000 images: ~15 seconds additional
- Can run in background
- Progress indicator in UI

### Storage

**Per image:**
- Structured caption: ~500 bytes
- Tags (avg 15 tags): ~300 bytes
- **Total: ~800 bytes per image**

**1000 images:** ~800KB (minimal)

---

## Alternatives Considered

### 1. YOLO/Object Detection Models
**Approach:** Use specialized object detection

**Pros:**
- Very accurate for objects
- Bounding boxes available

**Cons:**
- Doesn't handle mood, weather, style
- Additional model deployment
- Slower inference

**Decision:** Rejected - too narrow, Moondream handles more

### 2. CLIP-based Tag Generation
**Approach:** Use CLIP to classify against tag list

**Pros:**
- Fast inference
- No text generation needed

**Cons:**
- Requires predefined tag list
- Misses nuanced descriptions
- Less flexible

**Decision:** Rejected - too rigid

### 3. User-only Tagging
**Approach:** Let users manually tag images

**Pros:**
- 100% accurate
- User control

**Cons:**
- Time-consuming
- Inconsistent
- Not scalable

**Decision:** Complement, not replace - allow user tags too

---

## Success Metrics

- **Tag accuracy:** > 85% relevant tags per image
- **Coverage:** > 90% images have at least 5 tags
- **Search improvement:** 30% better precision with hybrid search
- **User engagement:** 50% of searches use filters
- **Performance:** < 20ms overhead per image

---

## Risks and Mitigations

### Risk 1: Inconsistent Tag Quality
**Impact:** Moondream may generate inconsistent tags

**Mitigation:**
- Carefully engineered prompts
- Tag normalization (synonyms)
- Confidence scoring
- User feedback loop

### Risk 2: Processing Backlog
**Impact:** Existing images need reprocessing

**Mitigation:**
- Background batch processing
- Priority queue (recent images first)
- Progress indicator
- Pause/resume capability

### Risk 3: Tag Explosion
**Impact:** Too many unique tags, hard to filter

**Mitigation:**
- Tag consolidation (merge synonyms)
- Minimum frequency threshold
- Tag hierarchy (parent/child)
- Admin tag management

---

## Open Questions

1. **Which extraction method to start with?**
   - **Recommendation:** Option A (regex) for MVP, evaluate Option B later

2. **Should we support tag hierarchies?**
   - Example: "cat" → "animal" → "mammal"
   - **Recommendation:** Phase 2 feature

3. **How to handle tag conflicts?**
   - Example: "warm" in colors vs mood
   - **Recommendation:** Use category prefix in storage

4. **Should users be able to edit AI-generated tags?**
   - **Recommendation:** Yes, with override flag

5. **How to handle multi-language tags?**
   - **Recommendation:** English only for MVP, i18n later

---

## Next Steps

1. Review and approve ADR
2. Test structured prompt with 20 diverse images
3. Measure tag quality and adjust prompt
4. Implement Phase 1 (foundation)
5. Gather user feedback on tag usefulness

---

## References

- Moondream documentation: https://github.com/vikhyat/moondream
- FTS5 full-text search: https://www.sqlite.org/fts5.html
- Faceted search patterns: https://www.nngroup.com/articles/faceted-search/
