# ADR-007: Media Grouping, Deduplication, and Burst Handling

- Status: Proposed
- Date: 2025-10-18
- Authors: Drillbit Team
- Related: `ADR-004-batch-concurrent-processing-workflow.md`, `ADR-004-integrated-video-player.md`, `ADR-006-intelligent-query-cache.md`

## Context

Our landing view is a basic listing without meaningful grouping. We need robust grouping and deduplication to:
- Reduce visual noise (remove duplicates/near-duplicates).
- Organize bursts and versions into stacks.
- Consolidate video segments under their parent videos.
- Offer "Similar" suggestions powered by embeddings.

Constraints and current state:
- We already deduplicate search results between `video` and `video_segment` by base path.
- Vector search uses `vector.db`; pipeline/metadata stored in `video-rag.db`.
- We must preserve privacy and avoid destructive operations; provide reversible actions.

## Goals

- Group and stack media in the gallery:
  - Exact duplicates (hash-identical).
  - Near-duplicate images (perceptual similarity).
  - Bursts (temporal clusters with similar content).
  - Versions/exports of the same source (filename and metadata heuristics).
  - Video variants and segment-parent consolidation.
- Provide a fast UI with stacks, badges, and expand/collapse interactions.
- Make grouping incremental, resilient, and tunable via thresholds.

## Non-Goals

- Cloud synchronization or collaborative curation.
- Heavy DAM features (workflows, permissions). We remain a search-first utility; organizing is supportive.

## Terminology

- Canonical: Primary representative of a group/stack.
- Exact duplicate: Same content hash and size.
- Near-duplicate: High visual similarity (pHash/Hamming distance below threshold).
- Burst: Images shot within a small time window with similar visual signatures.
- Version: Export/derivative (e.g., `IMG_0001.JPG`, `IMG_0001-Edit.jpg`, RAW/JPG pair).

## Data Model

New tables live in `library.db` (separate from `vector.db`). This keeps search vectors slim and isolates mutable library metadata/features. Migrations will use explicit DB directive comments.

```sql
-- sql: db:library
-- Media groups and membership
CREATE TABLE IF NOT EXISTS media_groups (
  id TEXT PRIMARY KEY,
  group_type TEXT NOT NULL,        -- duplicate | near_duplicate | burst | version | video_variant
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  canonical_media_id TEXT          -- optional; if null, computed by rule
);
CREATE INDEX IF NOT EXISTS idx_media_groups_type ON media_groups(group_type);

CREATE TABLE IF NOT EXISTS media_group_members (
  group_id TEXT NOT NULL,
  media_id TEXT NOT NULL,
  score REAL DEFAULT 1.0,          -- confidence/fit score
  created_at TEXT NOT NULL,
  PRIMARY KEY (group_id, media_id)
);
CREATE INDEX IF NOT EXISTS idx_group_members_media ON media_group_members(media_id);

-- Optional explicit duplicate edge storage (for reasoning/explainability)
CREATE TABLE IF NOT EXISTS media_duplicate_links (
  media_id_a TEXT NOT NULL,
  media_id_b TEXT NOT NULL,
  link_type TEXT NOT NULL,         -- exact | near | version | burst | keyframe | duration_match
  score REAL NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (media_id_a, media_id_b)
);

-- Feature store for grouping heuristics
CREATE TABLE IF NOT EXISTS media_features (
  media_id TEXT PRIMARY KEY,
  file_size INTEGER,
  file_hash TEXT,                  -- SHA-256 or BLAKE3
  width INTEGER,
  height INTEGER,
  duration_ms INTEGER,             -- for videos
  fps REAL,
  phash64 INTEGER,                 -- 64-bit pHash for images/keyframes
  dhash64 INTEGER,
  ahash64 INTEGER,
  taken_at TEXT,                   -- EXIF DateTimeOriginal
  camera_make TEXT,
  camera_model TEXT,
  lens_model TEXT,
  device_id TEXT,                  -- EXIF serial if available
  audio_fingerprint TEXT,          -- optional, for video dupes
  keyframe_phashes TEXT,           -- JSON array of 64-bit ints
  embedding_id TEXT,               -- link to vector entry if needed
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_media_features_filehash ON media_features(file_hash);
CREATE INDEX IF NOT EXISTS idx_media_features_takenat ON media_features(taken_at);
CREATE INDEX IF NOT EXISTS idx_media_features_phash ON media_features(phash64);
```

Notes:
- pHash stored as 64-bit integer enables fast XOR+POPCOUNT for Hamming distance.
- `keyframe_phashes` enables video variant matching without decoding whole streams on query.

## Libraries (vetted)

- Image hashing: use `node-image-hash` (pHash/dHash/aHash via sharp) or `blockhash-core` + `sharp`.
- SSIM verification: `ssim.js` on downscaled images.
- EXIF/metadata: `exifr` (fast, pure JS) or `exiftool-vendored` (more complete, external binary).
- File hashing: `blake3-wasm` (fast, modern) or `blake3` native when available.
- BK-tree: `bk-tree` npm for metric indexing on pHash Hamming distance (or lightweight in-house impl).
- Video frames/keyframes: reuse existing `ffmpeg` helpers; extract uniform or key frames only.
- Optional audio fingerprint (later): `chromaprint` via `fpcalc` (AcoustID) wrapper.

## Grouping Pipeline

Run incrementally after ingestion; idempotent; safe to re-run.

1) Exact duplicates (images/videos)
- Rule: identical `file_hash` and `file_size` ⇒ group `duplicate`.
- Canonical: highest resolution; else newest file; else shortest path depth.

2) Version grouping (images)
- Filename normalization: strip suffixes `-edit`, `-copy`, `(1)`, `@2x`, `-export`, `-final`, `-v2`.
- Extension families: RAW+JPG pairs (NEF/CR2/ARW with JPG/PNG), HEIC+JPG.
- Rule: same normalized stem and close `taken_at` ⇒ group `version`.
- Canonical: prefer RAW/HEIC or highest resolution; configurable.

3) Burst detection (images)
- Rule: same `device_id` (if present) and `taken_at` within window W (default 2s), and `phash` distance ≤ D1.
- Cluster via sliding window; group as `burst` with temporal ordering by `taken_at`.
- Canonical: auto-pick via sharpness (Tenengrad) or central frame; manual override allowed.

4) Near-duplicate images
- Rule: `phash` distance ≤ D2 (e.g., 6–12) and resolution ratio within R (e.g., 0.75–1.33).
- Use BK-tree over 64-bit pHash for candidate retrieval; verify with SSIM on downscaled images.
- Group as `near_duplicate`.

5) Video variants
- Pre-filter: durations within ε (e.g., 0.5–1.0%) and resolution/fps similar.
- Keyframe approach: extract K uniform keyframes per video, compute `phash` list; compute Jaccard/overlap ≥ S.
- Optional: audio fingerprint equality for strong signal.
- Fallback: aggregated embeddings cosine similarity ≥ C with duration proximity.
- Group as `video_variant`. Canonical: highest bitrate/resolution.

6) Segment-parent consolidation (existing behavior)
- Use base path (before `#t=`) to map `video_segment` items under their parent `video`.
- Parent card shows segment counts and access to segment timeline.

7) Embedding-based "Similar" (not dedup)
- Provide a per-item "Similar" rail using cosine similarity in `vector.db`.
- Not merged into groups to avoid false positives; pure UX assist.

### Thresholds (initial defaults)
- D1 (burst pHash): 8
- D2 (near-dup pHash): 10
- ε (duration ratio): 0.5%
- S (keyframe set similarity): 0.6
- C (embedding cosine): 0.88 (images), 0.92 (videos)
- W (burst window): 2 seconds

All thresholds are configurable in settings and overridable via a debug panel.

## Feature Extraction

Implement an incremental feature extractor that enriches `media_features`:
- File: size, robust content hash (BLAKE3 recommended), dimensions.
- EXIF: `taken_at`, camera/lens, device id.
- Image: pHash/dHash/aHash; optional sharpness metric.
- Video: duration, fps, resolution; sample K keyframes (re-use existing keyframe extractor) and compute keyframe pHashes; optional audio fingerprint.
- Embeddings: reuse existing embeddings; optionally compute a representative embedding per parent video (mean/weighted over segments).

Placement:
- New module `src/core/feature-extractor.ts` (or integrate into existing processors) with evented, batched writes.
- Logs follow `AGENTS.md` patterns with `[FEATURE-EXTRACT]` prefix.

## User-Controlled Grouping

- Manual controls:
  - Create group from selection; group receives `group_type = user`.
  - Move media between groups; merge/split groups; set/clear canonical.
  - Ungroup (remove membership) with undo.
- UI affordances:
  - Multi-select in gallery, context menu: `Group`, `Move to group…`, `Merge`, `Split`, `Set as cover`.
  - Group detail view shows reason/scores and allows overrides.
- API endpoints (`MainMediaAPI`):
  - `createGroup({type, memberIds, canonicalId?})`
  - `moveToGroup({mediaId, targetGroupId})`
  - `mergeGroups({sourceGroupId, targetGroupId})`
  - `splitGroup({groupId, memberIds})`
  - `setGroupCanonical({groupId, mediaId})`

## Algorithms and Indexing

- pHash neighbor search: BK-tree over 64-bit integers (stored in SQLite; can be in-memory index per session with persisted table for precomputation).
- Fast Hamming: XOR + POPCOUNT (can implement as SQL UDF if needed; otherwise app layer).
- Keyframe similarity: set overlap/Jaccard on small fixed-K sets.
- Embedding similarity: existing `sqlite-vec` cosine queries; used for suggestions and tie-breaks.

## Job Types (expensive, user-triggered)

- Near-duplicate full scan (images): builds/refreshes BK-tree and verifies with SSIM.
- Video variant comparison: duration/fps prefilter → keyframe pHash overlap; optionally audio fingerprint.
- Library-wide reindex: recompute features for changed/new files only.
- All jobs run via existing job processor with progress events and resumability.

## UI/UX

Landing gallery becomes a stack-based view with lightweight controls.

- **Stacks on cards**: Each group shows a stack count badge (e.g., `×7`) and a chip (`Duplicate`, `Burst`, `Version`, `Variant`).
- **Canonical cover**: The canonical item’s thumbnail represents the stack. Hover reveals a fanned preview.
- **Expand**: Clicking opens the stack: 
  - Duplicates/near-duplicates: grid with quick actions: set canonical, hide, delete (soft-delete), compare (flip).
  - Burst: horizontal strip timeline with scrub-on-hover; select best shot; mark favorites.
  - Versions: show format/resolution badges; quick compare; choose canonical.
  - Video parent: show segmented timeline and variants tab (if any).
- **Controls**: Top toggles `Stack duplicates`, `Stack bursts`, `Show similar`, filters for `All | Stacks | Duplicates | Bursts | Versions`.
- **Performance**: Lazy-load group members on expand; cache thumbnails; keep actions local and reversible.

Implementation targets:
- New components: `GroupStack.tsx`, `BurstStrip.tsx`, `VariantBadge.tsx` under `src/components/`.
- Integrate into `DrillerV3.tsx` landing grid and `MediaGrid.tsx` mapping.
- API additions in `MainMediaAPI` to fetch groups, members, set canonical, and list similars.

## Background Jobs and Incrementality

- New `GroupingService` with an incremental scheduler:
  - Triggers on new media ingestion and periodically scans for missed candidates.
  - Emits events: `group:created`, `group:updated`, `group:canonicalChanged`.
  - Safe to interrupt; resumes from last checkpoint (store `updated_at` cursors).
- All operations are additive; deletions are soft (flagged), with undo history.

## Evaluation and Tuning

- Build a small labeled set (~1–2k items) with truth groups for duplicates, bursts, versions.
- Metrics: precision/recall per group type; false merge/split rates.
- Ship a debug panel to export candidate pairs with scores for manual review.

## Optimization Plan

- Batch feature extraction; cache results; avoid reprocessing unchanged files.
- Use sampling to cap near-duplicate candidate explosion; prioritize recent media first.
- Persist BK-tree nodes to reduce warmup time on app start.
- Avoid embedding queries in dedup pipeline; reserve vectors for "Similar" UX and tie-breaks.
- Video compute specifics:
  - Reuse existing keyframes from pipeline; if missing, extract keyframes only (`-skip_frame nokey`) or sparse uniform frames.
  - Downscale to 128–256px for hashing and SSIM to reduce CPU.
  - Pre-filter by duration, fps, and resolution before any per-frame work.
  - Cache `keyframe_phashes` and `duration/fps` in `media_features` to avoid re-decode.
  - Escalation ladder: cheap heuristics → pHash overlap → SSIM sample → audio fingerprint (optional) → embeddings (as last resort).

## API and Storage Changes

- `MainMediaAPI`:
  - `getMediaGroups(params)` → list groups by type with pagination.
  - `getGroupMembers(groupId)` → items with scores and reasons.
  - `setGroupCanonical(groupId, mediaId)` → update canonical.
  - `listSimilar(mediaId)` → embedding-based suggestions.
- Migrations: add tables above to `library.db` using `-- sql: db:library` directives.

## Database Architecture Split and Grounding

- **[Grounded current state in code]**
  - `vector.db` (search): managed by `src/core/sqlite-vec-database.ts`. Holds `vec_embeddings`, `vector_meta`, `media_fts`, and a minimal `media_items` surface used by search. Initialized via `ConfigManager.vectorDbPath`.
  - `video-rag.db` (video workflow): managed by `src/core/video-database.ts`. Holds `video_files`, `video_segments`, `video_keyframes`, `segments_fts`, `video_processing_jobs`, `processing_batches`, etc.
  - `main-media` tables today live in the same physical file as `vector.db` via `src/api/main-media-api.ts` + `src/core/sqlite-main-database.ts` (co-located with vectors).
  - `jobs.db` (orchestrator): `src/orchestrator/sqlite-job-store.ts` for a separate job runner path.

- **[Proposed split (target design)]**
  - `vector.db` (Search index)
    - Tables: `vec_embeddings`, `vector_meta`, `media_fts`, minimal `media_items` for search. No workflow/job tables.
  - `library.db` (Library metadata)
    - Tables: `media_sources`, `media_items`, `indexing_jobs` (image jobs), grouping tables from this ADR: `media_groups`, `media_group_members`, `media_duplicate_links`, `media_features`.
  - `video-meta.db` (Video metadata)
    - Tables: `video_files`, `video_segments`, `video_keyframes`, `segments_fts`, scene/narrative tables.
  - `video-jobs.db` (Video processing jobs)
    - Tables: `video_processing_jobs`, `processing_batches`, `batch_keyframes`, `scene_reconstruction_jobs`, job events.

- **[Module → DB mapping]**
  - `src/core/sqlite-vec-database.ts` → `vector.db`
  - `src/core/sqlite-main-database.ts` → `library.db`
  - `src/core/video-database.ts` → split into `VideoMetaDatabase` (`video-meta.db`) and `VideoJobsDatabase` (`video-jobs.db`) or keep a façade composing both.
  - `src/api/main-media-api.ts` → uses `SqliteMainDatabase` (`library.db`) + `SqliteVecDatabase` (`vector.db`).
  - `src/api/video-media-api.ts` and `src/core/video-job-processor.ts` → use video meta/jobs DBs; `VideoSegmentIndexer` writes searchable segments to `vector.db` and workflow segments to `video-meta.db`.
  - `src/orchestrator/sqlite-job-store.ts` remains separate (`jobs.db`) unless unified later.

## Unified Migrator and Directives

- Extend `src/core/unified-migrator.ts` to support four DB targets:
  - `-- sql: db:vector`
  - `-- sql: db:library`
  - `-- sql: db:video-meta`
  - `-- sql: db:video-jobs`
- Route legacy table name detection accordingly (e.g., `video_processing_jobs` → `video-jobs.db`, `video_segments` → `video-meta.db`, `media_sources`/`media_items` → `library.db`, `vec_embeddings` → `vector.db`).

## Config Paths

- Add explicit config entries in `src/core/config.ts` (and defaults):
  - `vectorDbPath` (exists)
  - `libraryDbPath`
  - `videoMetaDbPath`
  - `videoJobsDbPath`
  - Ensure `MainMediaAPI.initialize()` and `VideoJobProcessor`/`VideoMediaAPI` read these paths.

## Migration Plan (compat-safe)

- **Phase 1: Add new DBs and write-only**
  - Create schemas in `library.db`, `video-meta.db`, `video-jobs.db` via migrations.
  - New writes go to the new DBs; reads remain backward compatible (fallback to old locations if not found).

- **Phase 2: Copy**
  - From `vector.db` → `library.db`: `media_sources`, `media_items`, `indexing_jobs`.
  - From `video-rag.db` → `video-meta.db`: `video_files`, `video_segments`, `video_keyframes`, `segments_fts`.
  - From `video-rag.db` → `video-jobs.db`: `video_processing_jobs`, `processing_batches`, `batch_keyframes`, `scene_reconstruction_jobs`.
  - Verify counts; log per `AGENTS.md` with `[DB-SCHEMA-DEBUG]` and `[DB-INSERT-DEBUG]` patterns.

- **Phase 3: Switch reads**
  - Flip module reads to new DBs. Keep feature flags to toggle fallback.

- **Phase 4: Clean-up**
  - Stop writing to legacy tables; keep read-only fallback for one release.
  - Document in changelog.

## Rollout

- Phase A (Week 1–2): Schema + exact dup + version groups + parent/segment consolidation UI.
- Phase B (Week 3): Burst detection + BurstStrip UI.
- Phase C (Week 4): Video variants (duration/keyframes) + badges.
- Phase D (Week 5): Embedding-based similar rail + tuning panel.

## Risks and Mitigations

- False positives merging distinct items → default to conservative thresholds; provide undo; display reasons and scores.
- Performance on large libraries → incremental processing, indices, lazy member fetching.
- Cross-drive duplicates and moves → rely on content hash vs path; update features on change.

## Alternatives Considered

- Single "Similar" only (no groups): reduces complexity but doesn’t declutter gallery.
- Full DAM approach: overkill for our search-first utility; increases friction.

## Open Questions

- Should image pHash be computed on normalized (e.g., 256px) with aspect correction to better handle crops? (Leaning yes.)
- Audio fingerprint choice for video variants (Chromaprint vs lightweight custom). (Spike later.)
- User-configurable canonical rules vs manual only. (Start with auto + manual override.)
