# Foreign Key and ID Issues Analysis

## Date: Nov 1, 2025 3:38am

## ✅ Issues Already Fixed

### 1. Media.db Foreign Key Constraint ✅
**Fixed**: `VideoPersistenceService` now looks up parent video's `sourceId` from `media.db` instead of using file path.

---

## 🟡 Potential Issues Found

### Issue 1: ID Consistency Between Tables

**Current Behavior:**
```typescript
// VideoPersistenceService uses batchId for everything
segmentId: result.batchId  // e.g., "30d7d1d6-132b-4f4c-8c4f-91eda185b2e6"

// Written to media.db
id: data.segmentId  // "30d7d1d6-132b-4f4c-8c4f-91eda185b2e6"

// Written to av_search.db
itemId: data.segmentId     // "30d7d1d6-132b-4f4c-8c4f-91eda185b2e6"
segmentId: data.segmentId  // "30d7d1d6-132b-4f4c-8c4f-91eda185b2e6"
```

**Schema Analysis:**

**media.db:**
```sql
CREATE TABLE media_items (
  id TEXT PRIMARY KEY,           -- Segment ID (batch UUID)
  source_id TEXT NOT NULL,       -- Parent video's source UUID
  path TEXT NOT NULL UNIQUE,     -- "/path/video.mp4#t=0,300"
  type TEXT CHECK(type IN ('video_segment', ...))
);
```

**av_search.db:**
```sql
-- Embeddings table
CREATE TABLE video_segment_embeddings (
  id TEXT PRIMARY KEY,           -- Segment ID (batch UUID)
  item_id TEXT NOT NULL,         -- Also segment ID (batch UUID)
  segment_id TEXT NOT NULL,      -- Also segment ID (batch UUID)
  vector BLOB NOT NULL
);

-- Meta cache (composite PK)
CREATE TABLE av_meta_cache (
  item_id TEXT NOT NULL,         -- Segment ID (batch UUID)
  segment_id TEXT,               -- Segment ID (batch UUID)
  media_type TEXT NOT NULL,
  PRIMARY KEY (item_id, segment_id, media_type)
);
```

**Assessment:** ✅ **This is actually CORRECT**

The schema design uses:
- `item_id` = the media item (segment) identifier
- `segment_id` = also the segment identifier (for consistency with parent video relationships)

Both pointing to the same UUID is intentional for video segments. For parent videos, `item_id` would be the video ID and `segment_id` would be NULL or the specific segment.

---

### Issue 2: av_meta_cache Composite Primary Key

**Schema:**
```sql
PRIMARY KEY (item_id, segment_id, media_type)
```

**Current Code:**
```typescript
this.avSearchWriter.updateAVMetaCache({
  itemId: data.segmentId,      // "30d7d1d6-..."
  segmentId: data.segmentId,   // "30d7d1d6-..." (same)
  mediaType: 'video',
  // ... other fields
});
```

**Potential Issue:** If `itemId` and `segmentId` are always the same for segments, the composite PK is redundant. However, this is by design:
- For **parent videos**: `itemId` = video UUID, `segmentId` = NULL
- For **segments**: `itemId` = segment UUID, `segmentId` = segment UUID

**Assessment:** ✅ **CORRECT** - Allows both parent videos and segments in same table

---

### Issue 3: No Foreign Key Constraints in av_search.db

**Observation:**
```sql
-- av_search.db has NO foreign key constraints
CREATE TABLE video_segment_embeddings (
  item_id TEXT NOT NULL,    -- No FK to media.db
  segment_id TEXT NOT NULL  -- No FK to media.db
);

CREATE TABLE av_meta_cache (
  item_id TEXT NOT NULL,    -- No FK to media.db
  segment_id TEXT           -- No FK to media.db
);
```

**Assessment:** ✅ **This is INTENTIONAL**

`av_search.db` is a **search index database**, not a relational database. It's designed to:
- Be fast for vector similarity search
- Not have FK overhead
- Be rebuildable from source data

If a segment is deleted from `media.db`, the orphaned entries in `av_search.db` are harmless and can be cleaned up later.

---

### Issue 4: transcripts_fts Has No Foreign Keys

**Schema:**
```sql
CREATE VIRTUAL TABLE transcripts_fts USING fts5(
  segment_id UNINDEXED,  -- No FK constraint
  transcript,
  content=''
);
```

**Assessment:** ✅ **CORRECT** - FTS5 virtual tables don't support foreign keys

FTS5 is a specialized full-text search table that doesn't support standard SQL constraints. The `segment_id` is just a reference field for joining results.

---

## 🔴 Actual Issues to Watch For

### Issue A: Parent Video Not Found in media.db

**Scenario:**
```typescript
const parentVideo = await this.ensureParentVideoExists(videoPath);
// Returns null if parent video not in media.db

const segmentData: SegmentStorageData = {
  parentSourceId: parentVideo?.sourceId,  // Could be undefined!
  // ...
};
```

**In writeToMediaDb:**
```typescript
const sourceId = data.parentSourceId || data.videoPath;  // Falls back to videoPath
```

**Risk:** If parent video doesn't exist in `media.db`, segments will use `videoPath` as `sourceId`, which will **FAIL the FK constraint** because `videoPath` is not a valid UUID in the `sources` table.

**Solution Already Implemented:** ✅ Code logs warning and falls back, but FK error will still occur.

**Better Solution Needed:**
1. Ensure parent video is ALWAYS in `media.db` before processing segments
2. Or create the parent video entry in `media.db` if missing
3. Or skip segment persistence if parent not found (with error)

---

### Issue B: Batch ID Format Validation

**Current:** Batch IDs are UUIDs generated by `BatchProcessor`
```
30d7d1d6-132b-4f4c-8c4f-91eda185b2e6
```

**Risk:** If batch ID generation changes or fails, could create invalid IDs.

**Assessment:** ✅ **LOW RISK** - UUID generation is reliable

---

### Issue C: Path Uniqueness Constraint

**media.db schema:**
```sql
path TEXT NOT NULL UNIQUE
```

**Current paths:**
```
/Users/darksied/Downloads/video.mp4#t=0.0,300.0
/Users/darksied/Downloads/video.mp4#t=300.0,600.0
```

**Risk:** If two batches somehow get the same time range, the UNIQUE constraint will fail.

**Assessment:** ✅ **LOW RISK** - Batch time ranges are deterministic and non-overlapping

---

## 🟢 Recommendations

### 1. Strengthen Parent Video Lookup ⚠️ IMPORTANT

**Current Issue:** If parent video not in `media.db`, FK constraint will fail.

**Recommendation:**
```typescript
async ensureParentVideoExists(videoPath: string): Promise<{ id: string; sourceId: string }> {
  // Try to find in media.db
  const parentVideo = this.mediaDb.getMediaItemsByPath(videoPath)
    .find(item => item.type === 'video' && item.path === videoPath);
  
  if (parentVideo) {
    return { id: parentVideo.id, sourceId: parentVideo.sourceId };
  }
  
  // CRITICAL: Parent video MUST exist before processing segments
  throw new Error(`Parent video not found in media.db: ${videoPath}. Cannot process segments without parent.`);
}
```

**Why:** Better to fail fast with clear error than get cryptic FK constraint errors later.

---

### 2. Add Validation Logging

Add logging to catch ID issues early:
```typescript
console.log(`[PERSISTENCE-DEBUG] Segment IDs:
  - batchId: ${result.batchId}
  - parentSourceId: ${parentVideo?.sourceId}
  - videoPath: ${result.videoPath}
`);
```

---

### 3. Consider Adding Cleanup Method

For orphaned entries in `av_search.db`:
```typescript
async cleanupOrphanedSearchEntries(): Promise<void> {
  // Find entries in av_search.db that don't exist in media.db
  // Delete them to keep search index clean
}
```

---

## Summary

### ✅ No Critical FK/ID Issues Found

The current implementation is **mostly correct**:
- ID consistency is intentional
- Composite PKs serve a purpose
- No FK in search DBs is by design
- FTS5 limitations are handled

### ⚠️ One Important Fix Needed

**Parent video lookup should throw error instead of returning null** to prevent FK constraint failures with clearer error messages.

### 📊 Database Architecture is Sound

```
media.db (Canonical)
  └─> media_items (id, source_id FK to sources)
       └─> Segments reference parent via source_id

av_search.db (Search Index - No FKs)
  ├─> video_segment_embeddings (fast vector search)
  ├─> video_segment_vec (vec0 virtual table)
  ├─> transcripts_fts (full-text search)
  └─> av_meta_cache (metadata cache)

jobs.db (Processing State)
  └─> processing_batches (batch metadata)
       └─> batch_keyframes (keyframe data)
```

All databases serve different purposes and the FK constraints are appropriate for each.
