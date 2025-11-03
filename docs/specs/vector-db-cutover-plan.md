---
name: vector db cutover plan
description: Tasks to disable legacy vector.db and move to canonical stores
mandatory: 
    - I’ll keep you posted after each phase so we can validate before moving to the next.
---

# Vector DB Cutover Plan

## Scope
- **Objective** Disable `vector.db` in runtime flows, rely on canonical `media.db`, `image_search.db`, `av_search.db`, and `jobs.db` while keeping legacy DB accessible for one-way backfill tooling.

## Feature Audit & Required Changes

### Ingestion (Uploads, Reconciliation, Backfill)
- **MainMediaAPI.addItemForFile()** Stop calling `SqliteVecDatabase.addMediaItemWithIdAsync()`; write metadata via `CanonicalMediaDatabase.upsertMediaItemFromLegacy()` and queue modality writers.
- **MainMediaAPI.performIndexing()** Replace legacy vector writes with canonical writes before invoking processors.
- **MainMediaAPI.indexUnprocessedImages() / Image reconciliation** Read status from `image_search.db` (`ImageSearchWriter`/`ImageModalityVecDatabase`) instead of `vector.db`; ensure new jobs target canonical IDs.
- **MainMediaAPI.indexUnprocessedVideos() / Video reconciliation** Ensure reconciliation pulls video state from `media.db` and schedules work through `VideoJobCoordinator`; block any writes back to `vector.db` during video upload or retry flows.
- **Canonical dual-write flag** Flip default so `media.db` is primary; gate legacy path behind explicit feature flag for backfill only.

### Search & Discovery
- **MainMediaAPI.unifiedSearch()** Remove `SqliteVecDatabase.searchHybrid()` usage; rely on `SearchService` backed by `ImageSearchStoreSqlite` and `AVSearchStoreSqlite` (optionally `ImageHybridStore`/`AVHybridStore`).
- **Fallback search path** Ensure fallback reads from `CanonicalMediaDatabase` instead of `vector.db.media_items`.
- **Vector query helpers** Deprecate helper methods inside `SqliteVecDatabase`; guard instantiation behind feature flag.

### Background Processors
- **ImageJobProcessor** Already writes to canonical store; after jobs migration, instantiate with `SqliteJobsDatabase`.
- **VideoJobProcessor** Ensure `writeVideoSegment()` never dual-writes to `vector.db`; all embeddings/captions must go through `AVSearchWriter`.
- **Refinement/Incremental processors** Audit for lingering `SqliteVecDatabase` references.

### Job Scheduling & Status
- **MainMediaAPI.createJob()/getActiveJobs()** Swap `SqliteMainDatabase` for `SqliteJobsDatabase`; update imports.
- **ImageJobCoordinator** Replace `this.db.db` references with `jobsDb` connection.
- **IPC handlers (`media:getIndexingStatus`)** Query `jobs.db` tables; remove reads from `vector.db.indexing_jobs`.
- **Migrations** Add script to copy outstanding rows from legacy `indexing_jobs` into `jobs.db`, then truncate legacy table for runtime usage.

### Backfill & Tooling
- MAKE SURE: Backfill media items metadata, search embedding data and indexing jobs data to new database strucutre
- **runModalityBackfillIfNeeded()** Allow read access to `vector.db` solely for migration; ensure runtime flag disables writes.
- **Recon jobs** Mirror reconciliation logic for videos and images against canonical stores (`media.db`, modality caches, `jobs.db`), then decommission legacy `vector.db` reconciliation code paths.

## Rollout Checklist
- **Config** Update `config.db` flags (`dualWrite`, `useNewCatalog`, `useNewImageSearch`, `useNewAVSearch`) defaults.
- **Feature flag** Provide kill-switch to re-enable legacy vector writes in emergencies.
- **Testing**
  - Upload image → verify rows land in `media.db` + `image_search.db`; `vector.db` unchanged.
  - Run unified search → confirm results originate from modality stores.
  - Start image processing job → ensure job row appears in `jobs.db` and UI.
- **Cleanup** After verification, archive `vector.db` or limit to read-only for backfill.

## Risks & Mitigations
- **Risk** Legacy search code path still referenced. **Mitigation** static analysis for `SqliteVecDatabase` usage, add runtime assertions when feature flag off.
- **Risk** Job UI regressions after DB swap. **Mitigation** integration test for `getIndexingStatus` IPC; monitor logs for `[DB-ACTIVE-JOBS-DEBUG]`.
- **Risk** Backfill scripts unintentionally write to legacy DB. **Mitigation** set `SqliteVecDatabase` to open read-only when cutover flag enabled.

# Findings
- **Vector DB touchpoints** still live throughout [src/api/main-media-api.ts](cci:7://file:///Users/darksied/dev/pocs/drillbit/src/api/main-media-api.ts:0:0-0:0) (ingestion, reconciliation, background captioning, unified search, cleanup) and the legacy video processor files. Despite [video-job-processor-v2.ts](cci:7://file:///Users/darksied/dev/pocs/drillbit/src/core/video-job-processor-v2.ts:0:0-0:0) already writing to `media.db`/`av_search.db`, legacy helpers like [queueImageForCaptioning()](cci:1://file:///Users/darksied/dev/pocs/drillbit/src/api/main-media-api.ts:863:2-898:3) still push updates through `this.vecDb`.
- **Jobs pipeline** is coupled to `indexing_jobs` inside `vector.db` via [SqliteMainDatabase](cci:2://file:///Users/darksied/dev/pocs/drillbit/src/core/sqlite-main-database.ts:5:0-593:1). No `SqliteJobsDatabase` exists yet, so moving queues to `jobs.db` requires introducing a dedicated adapter and updating `ImageJobCoordinator`, `ImageJobProcessor`, UI polling handlers, and migrator scripts.
- **Search stack** mixes `SearchService` (new modality stores) with semantic fallback that depends on `SqliteVecDatabase.searchHybrid()`. Removing `vector.db` write path means replacing that branch with image/video modality stores or disabling semantic search until AV/Image hybrid stores support embeddings.
- **Backfill/reconciliation** in [main-media-api.ts](cci:7://file:///Users/darksied/dev/pocs/drillbit/src/api/main-media-api.ts:0:0-0:0) and [core/modality-backfill.ts](cci:7://file:///Users/darksied/dev/pocs/drillbit/src/core/modality-backfill.ts:0:0-0:0) still reads legacy `vector.db` tables. We need to ensure the backfill stays read-only and retrofit the recon jobs (images/videos) to use canonical stores and `jobs.db`.

# Phases
## Recommended Actions
- **Phase 1 – Ingestion shutoff**
  - Strip `SqliteVecDatabase` instantiation in [MainMediaAPI.initialize()](cci:1://file:///Users/darksied/dev/pocs/drillbit/src/api/main-media-api.ts:187:2-276:3) behind the backfill-only flag.
  - Update [addItemForFile()](cci:1://file:///Users/darksied/dev/pocs/drillbit/src/api/main-media-api.ts:496:2-636:3), [performIndexing()](cci:1://file:///Users/darksied/dev/pocs/drillbit/src/api/main-media-api.ts:1486:2-1627:3), and reconciliation helpers to write exclusively via `CanonicalMediaDatabase`, [ImageSearchWriter](cci:2://file:///Users/darksied/dev/pocs/drillbit/src/core/image-search-writer.ts:8:0-156:1), and `AVSearchWriter`.
  - Ensure [queueImageForCaptioning()](cci:1://file:///Users/darksied/dev/pocs/drillbit/src/api/main-media-api.ts:863:2-898:3) enqueues work without touching `vecDb`; hand off to `ImageJobProcessor` (already using split architecture).

- **Phase 2 – Search migration**
  - Remove the semantic search branch that calls `this.vecDb.searchHybrid()` and rely on `SearchService` backed by modality stores. Optionally gate multimodal enhancements until embeddings can be generated without `vector.db`.
  - Drop all legacy lookups like `this.vecDb.getMediaItem()` during cleanup/deletion, replacing them with canonical queries or search-writer cleanup.

- **Phase 3 – Jobs database**
  - Introduce a new `SqliteJobsDatabase` pointing at `jobs.db`.
  - Refactor [MainMediaAPI](cci:2://file:///Users/darksied/dev/pocs/drillbit/src/api/main-media-api.ts:26:0-2332:1) job helpers, `ImageJobCoordinator`, and background processors to use the new adapter; update IPC job status routes accordingly.
  - Provide migration logic to copy outstanding rows from `vector.db.indexing_jobs` into `jobs.db`.

- **Phase 4 – Video pipeline audit**
  - Confirm [video-job-processor-v2.ts](cci:7://file:///Users/darksied/dev/pocs/drillbit/src/core/video-job-processor-v2.ts:0:0-0:0) no longer imports legacy `SqliteVecDatabase`; remove stray references in backup/unused files or guard them behind the backfill flag.
  - Ensure reconcilers (`indexUnprocessedVideos()`) build from `media.db` state and schedule jobs through canonical coordinators only.

    Once ingestion is clean, proceed to search removal, then jobs DB refactor, followed by recon/backfill adjustments.

- **Phase 5 – Backfill & safeguards**
  - Keep [runModalityBackfillIfNeeded()](cci:1://file:///Users/darksied/dev/pocs/drillbit/src/core/modality-backfill.ts:269:0-320:1) as read-only consumer of `vector.db`; add runtime flag preventing writes.
  - Wire config defaults (`dualWrite`, `useNewCatalog`, `useNewImageSearch`, `useNewAVSearch`) to canonical-only mode, with emergency override to re-enable legacy path if needed.


- **[Phase 6: Search cutover (canonical-only)]**
  - Switch unified search to query only `image_search.db` and `av_search.db`.
  - Remove `SqliteVecDatabase` usage from search paths and IPC.
  - Touchpoints:
    - [src/api/main-media-api.ts](cci:7://file:///Users/darksied/dev/pocs/drillbit/src/api/main-media-api.ts:0:0-0:0) → [unifiedSearch()](cci:1://file:///Users/darksied/dev/pocs/drillbit/src/api/main-media-api.ts:1543:2-1846:3)
    - `src/core/image-modality-vec-database.ts` (read-only)
    - `src/core/av-search-store-sqlite.ts` (read-only)
    - `src/preload/index.ts`, `src/types/global.d.ts` (API shape)

- **[Phase 7: Video worker migration (split DBs)]**
  - Ensure `VideoJobProcessorV2` is active and wired to:
    - Read/write metadata in `media.db` ([CanonicalMediaDatabase](cci:2://file:///Users/darksied/dev/pocs/drillbit/src/core/canonical-media-database.ts:4:0-118:1))
    - Write embeddings/transcripts to `av_search.db` via `AVSearchWriter`
    - Use `jobs.db` for job queue ([SqliteJobsDatabase](cci:2://file:///Users/darksied/dev/pocs/drillbit/src/core/sqlite-jobs-database.ts:20:0-258:1))
  - Remove any remaining writes to legacy `vector.db`.
  - Touchpoints:
    - [src/core/video-job-processor-v2.ts](cci:7://file:///Users/darksied/dev/pocs/drillbit/src/core/video-job-processor-v2.ts:0:0-0:0)
    - `src/core/av-search-writer.ts`
    - `electron/main.ts` (worker bootstrap)

- **[Phase 8: Legacy removal (vector.db deprecation)]**
  - Remove [src/core/sqlite-vec-database.ts](cci:7://file:///Users/darksied/dev/pocs/drillbit/src/core/sqlite-vec-database.ts:0:0-0:0) and all imports.
  - Eliminate dual-write/legacy branches in [MainMediaAPI](cci:2://file:///Users/darksied/dev/pocs/drillbit/src/api/main-media-api.ts:27:0-2248:1) and workers.
  - Migrations/cleanup to ignore `vector.db` in runtime (keep for archival if needed).
  - Touchpoints:
    - [src/api/main-media-api.ts](cci:7://file:///Users/darksied/dev/pocs/drillbit/src/api/main-media-api.ts:0:0-0:0)
    - `electron/main.ts`
    - Any `SqliteVecDatabase` references

- **[Phase 9: Feature parity (filters + listings)]**
  - Restore `sourceIds` filter in canonical paginator and thread through:
    - [MainMediaAPI.canonicalGetMediaItemsPaginated()](cci:1://file:///Users/darksied/dev/pocs/drillbit/src/api/main-media-api.ts:512:2-566:3)
    - [getRecentItems()](cci:1://file:///Users/darksied/dev/pocs/drillbit/src/api/main-media-api.ts:376:2-427:3), [getRecentItemsGrouped()](cci:1://file:///Users/darksied/dev/pocs/drillbit/src/api/main-media-api.ts:54:2-129:3)
  - Ensure [getVideosByPath()](cci:1://file:///Users/darksied/dev/pocs/drillbit/src/api/main-media-api.ts:568:2-585:3) reads from `media.db`.
  - Touchpoints:
    - [src/api/main-media-api.ts](cci:7://file:///Users/darksied/dev/pocs/drillbit/src/api/main-media-api.ts:0:0-0:0)

- **[Phase 10: Backfill + health checks]**
  - Verify parity:
    - `media.db` counts vs `image_search.db`/`av_search.db` counts for embeddings/FTS/meta cache.
    - `vec0` extension loads in-process (runtime), migrations 036/037 applied.
  - Add small runtime smoke tests (e.g., a self-check endpoint/log) to validate:
    - FTS search
    - Vec search
    - Cursor pagination
  - Touchpoints:
    - [src/core/unified-migrator.ts](cci:7://file:///Users/darksied/dev/pocs/drillbit/src/core/unified-migrator.ts:0:0-0:0)
    - `migrations_flat/036_add_image_vec_virtual.sql`, `037_add_av_vec_virtual.sql`
    - Add a minimal self-check in [MainMediaAPI.initialize()](cci:1://file:///Users/darksied/dev/pocs/drillbit/src/api/main-media-api.ts:189:2-295:3) logs

- **[Phase 11: Packaging (vec0 in prod)]**
  - Ensure `sqlite-vec` is unpacked/loaded in packaged apps:
    - `electron-builder.json5` `asarUnpack` includes vec packages
    - Runtime path resolution for `vec0.*` (already implemented for images; mirror for AV)
  - Validate DMG/installer runs vector/FTS queries successfully.
  - Touchpoints:
    - `electron-builder.json5`
    - [src/core/image-search-writer.ts](cci:7://file:///Users/darksied/dev/pocs/drillbit/src/core/image-search-writer.ts:0:0-0:0), `src/core/av-search-writer.ts`

- **[Phase 12: Documentation + cleanup]**
  - Update [docs/vector-db-cutover-plan.md](cci:7://file:///Users/darksied/dev/pocs/drillbit/docs/vector-db-cutover-plan.md:0:0-0:0), ADRs.
  - Remove deprecated IPC handlers and types.
  - Add ops/runbooks for migrations, backfill, packaging checks.

# Concrete Next Moves

- **[do now]** Phase 4: Redirect [unifiedSearch()](cci:1://file:///Users/darksied/dev/pocs/drillbit/src/api/main-media-api.ts:1543:2-1846:3) to `image_search.db` and `av_search.db` only, remove `SqliteVecDatabase` from that path.
- **[then]** Phase 5: Confirm `VideoJobProcessorV2` is the one started in `electron/main.ts` and routes to `AVSearchWriter` + `jobs.db`.

# Status

- Canonical listings and grouped UI: wired to `media.db`.
- Jobs: `jobs.db` used; image pipeline healthy (43 items end-to-end).
- Remaining: search cutover, video worker finalize, legacy cleanup, parity checks, packaging, docs.
