# ADR-010: Runtime Adapter + Strategy Cutover (FE → IPC → Main → DB)

## Status
- Accepted
- Target version: next minor

## Context
- We split data into multiple SQLite DBs per ADR-009 and added migrations 022–033 to initialize and backfill:
  - `media.db` (canonical)
  - `image_search.db` (image search store)
  - `av_search.db` (audio/video search store)
  - `jobs.db` (orchestration)
  - `config.db` (migrations/flags)
- The app runtime still reads/writes legacy `vector.db` via `SqliteMainDatabase` and search paths. We need a comprehensive, low-risk way to switch to the new stores without breaking existing users.

## Problem
- Tight coupling to legacy DB (schemas, file path, API surface) across Renderer → IPC → Main process makes a big-bang cutover risky.
- We need progressive enablement, dual-write, and modality-specific routing while maintaining feature parity and enabling rollback.

## Goals
- Provide DI + Strategy-based runtime wiring from FE → IPC → Main → DB.
- Dual-write during transition; selective read switches by modality.
- Feature flags to control rollout per environment/user.
- Comprehensive logging and validation (counts, parity, spot checks).
- Work in dev and packaged builds; no ABI pinning issues leak to users.

## Non-Goals
- Replacing business logic in processors (image/video) beyond routing and storage.
- Full re-architecture of job orchestration (out of scope; only integration points).

## Decision
- Introduce adapters and strategies behind narrow interfaces for catalog and modality stores.
- Use feature flags from `config.db` (fallback to `data/preferences.json` in dev) to choose strategies and dual-write.
- Keep legacy adapters active; enable per-modality cutovers and rollback.

## Architecture
```mermaid
flowchart LR
  subgraph Renderer (FE)
    UI[Views/Services]
  end
  subgraph Main (Electron)
    IPC[IPC Handlers]
    Svc[MainMediaAPI]
    Strat[Strategy Factory]
  end
  subgraph Catalog
    L(LegacyCatalog: vector.db)
    C(CanonicalCatalog: media.db)
  end
  subgraph Search
    IS(ImageSearch: image_search.db)
    AV(AVSearch: av_search.db)
  end
  UI -->|invoke| IPC -->|calls| Svc --> Strat
  Strat --> L
  Strat --> C
  Strat --> IS
  Strat --> AV
```

## Interfaces (TypeScript)
- `IMediaCatalog`: `addSource()`, `getSources()`, `addMediaItem()`, `getMediaItems()`, `getMediaItemsPaginated()`, `removeMediaItem()`, `getStats()`
- `IImageSearchStore`: upsert/list `image_meta_cache`, optional FTS/embeddings
- `IAVSearchStore`: upsert/list `av_meta_cache`, transcripts FTS/embeddings
- `ISearchService`: `search(query, types, limit, offset)` delegates to modality stores

## Adapters
- `LegacyCatalogAdapter` (wraps `SqliteMainDatabase` on `vector.db`)
- `CanonicalMediaDatabase` (new) on `media.db` using canonical schema
- `ImageSearchStoreSqlite` (new) on `image_search.db` (`image_meta_cache`, `image_fts`)
- `AVSearchStoreSqlite` (new) on `av_search.db` (`av_meta_cache`, `transcripts_fts`)

## Strategy + Factory
- Strategy selection in `MainMediaAPI.initialize()` via feature flags:
  - `useNewCatalog` → swap `IMediaCatalog` to canonical
  - `useNewImageSearch` → route image search to image store
  - `useNewAVSearch` → route audio/video search to AV store
  - `dualWrite` → write to both legacy and new catalog
- Feature flag storage
  - Primary: `config.db` table `settings(key TEXT PRIMARY KEY, value TEXT)`
  - Dev fallback: `data/preferences.json`

## IPC Surface (electron/main.ts)
- Existing channels continue unchanged; handlers call `MainMediaAPI` methods:
  - `media:addSource`, `media:addItemForFile`, `media:getSources`, `media:getRecentItems`, `media:search`, etc.
- No renderer changes for API shape; behavior flips behind flags.

## Renderer (FE)
- Keep existing service calls (no breaking changes):
  - `ipcRenderer.invoke('media:addSource', ...)`
  - `ipcRenderer.invoke('media:getRecentItems', ...)`
  - `ipcRenderer.invoke('search:unified', ...)`
- Add diagnostics panel toggle to show which backend is active per modality (flags snapshot).

## Data Flow (write)
1. FE uploads file → `media:addItemForFile`
2. Main `MainMediaAPI.addItemForFile()`
3. Catalog strategy: if `dualWrite=true`, write to both legacy (`vector.db`) and canonical (`media.db`). If disabled, write to selected catalog only.
4. Background jobs populate modality stores (or migration-based refresh).

## Data Flow (read/search)
- `ISearchService` dispatches per-modality:
  - If `useNewImageSearch=true`, query `image_search.db` only; otherwise legacy path.
  - If `useNewAVSearch=true`, query `av_search.db` only; otherwise legacy path.
- Catalog reads (`getRecentItems`, `getItems`) controlled by `useNewCatalog`.

## Migrations and Backfill (prereqs)
- Already implemented:
  - 022–026: initialize new DBs
  - 027–028: meta cache backfill
  - 029–031: legacy → canonical backfill (sources, items, segments)
  - 032–033: cache refresh
- Pending (to add):
  - Transcripts FTS backfill from `media.segments.transcript` → `av_search.transcripts_fts`
  - Embeddings migration or re-index jobs with versioning

## Logging & Telemetry (Debugging Guide)
- Add structured logs with prefixes:
  - `[STRATEGY] Selected: { useNewCatalog, useNewImageSearch, useNewAVSearch, dualWrite }`
  - `[WRITE-ROUTE] catalog=legacy|canonical, dualWrite=<bool>`
  - `[SEARCH-ROUTE] images=legacy|new, av=legacy|new`
  - `[API-DEBUG] IPC: media:addSource payload/response`
  - `[DB-DEBUG] SQL params (counts only, no PII)`
- Add counters in memory (dev) for parity checks (e.g., results count diffs).

## Validation & Parity
- **CLI-only, no UI**
  - Validation is performed via CLI using `sqlite3` and stored as editor/LLM memory artifacts.
  - No in-app diagnostics modal; use structured logs and memory files only.

- **`./memory/QUERIES.md` (LLM/editor artifact)**
  - Purpose: persist schema snippets and repeatable SQL queries, grouped by intent/workflow.
  - Contents should include:
    - Media counts in `media.db` vs `vector.db`
    - Segment counts in `media.db` vs `video-rag.db`
    - Cache counts in `image_search.db` and `av_search.db`
    - Spot checks (random items by path; compare fields)

- **Examples (run via CLI)**

```sql
-- Counts (attach all DBs first)
ATTACH 'data/media.db' AS media;
ATTACH 'data/vector.db' AS legacy;
ATTACH 'data/video-rag.db' AS vr;
ATTACH 'data/image_search.db' AS img;
ATTACH 'data/av_search.db' AS av;
SELECT 'media_items', (SELECT COUNT(*) FROM media.media_items);
SELECT 'legacy_media_items', (SELECT COUNT(*) FROM legacy.media_items);
SELECT 'segments', (SELECT COUNT(*) FROM media.segments);
SELECT 'video_segments', (SELECT COUNT(*) FROM vr.video_segments);
SELECT 'image_meta_cache', (SELECT COUNT(*) FROM img.image_meta_cache);
SELECT 'av_cache_items', (SELECT SUM(CASE WHEN segment_id IS NULL THEN 1 ELSE 0 END) FROM av.av_meta_cache);
SELECT 'av_cache_segments', (SELECT SUM(CASE WHEN segment_id IS NOT NULL THEN 1 ELSE 0 END) FROM av.av_meta_cache);
```

```sql
-- Spot checks
SELECT id, type, path FROM media.media_items ORDER BY RANDOM() LIMIT 5;
-- Then verify caches for those ids
-- image_search
-- SELECT item_id, path FROM img.image_meta_cache WHERE item_id IN (?, ?, ?, ?, ?);
-- av_search
-- SELECT item_id, segment_id, media_type FROM av.av_meta_cache WHERE item_id IN (?, ?, ?, ?, ?) LIMIT 20;
```

- **Optional historical capture (`./memory/parity.sqlite`)**
  - Store results over time for pagination and comparisons.

```sql
-- One-time setup
CREATE TABLE IF NOT EXISTS metrics(
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  value INTEGER,
  collected_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_metrics_collected_at ON metrics(collected_at);
```

```bash
# Insert a snapshot of counts
sqlite3 ./memory/parity.sqlite "INSERT INTO metrics(name,value,collected_at) VALUES
('media_items', 0, datetime('now')),
('legacy_media_items', 0, datetime('now')),
('segments', 0, datetime('now')),
('video_segments', 0, datetime('now')),
('image_meta_cache', 0, datetime('now')),
('av_cache_items', 0, datetime('now')),
('av_cache_segments', 0, datetime('now'));"
```

- **Structured logs (for run-time confirmation)**
  - Use prefixes: `[STRATEGY]`, `[WRITE-ROUTE]`, `[SEARCH-ROUTE]`, `[API-DEBUG]`, `[DB-DEBUG]`.

## Rollout Plan
- Phase 0: Preconditions
  - Ensure migrations 022–033 applied; legacy DBs attached when present
  - Feature flags default: all false, `dualWrite=false`
- Phase 1: Dual-write dry-run
  - Enable `dualWrite=true`
  - Keep reads from legacy; validate catalog parity (counts; spot checks)
- Phase 2: Image search cutover
  - Enable `useNewImageSearch=true`
  - Validate search results parity (counts, relevance); dedup logic retained
- Phase 3: AV search cutover
  - Enable `useNewAVSearch=true`
  - Validate transcripts/segments parity
- Phase 4: Catalog read cutover
  - Enable `useNewCatalog=true`
  - Validate FE lists, pagination, filters
- Phase 5: Disable dual-write
  - Keep rollback window; snapshot legacy DBs

## Checklists
- FE
  - [ ] Add Diagnostics modal (flags snapshot, backend selection, parity results)
  - [ ] Ensure no breaking IPC changes
- IPC (electron/main.ts)
  - [ ] No API changes; add `[API-DEBUG]` logs on critical handlers
  - [ ] Surface strategy snapshot via `media:getConfiguration`
- Main (`src/api/main-media-api.ts`)
  - [ ] Add Strategy Factory reading flags
  - [ ] Replace direct `new SqliteMainDatabase(vector.db)` with catalog strategy
  - [ ] Inject `ISearchService` that routes by modality and flags
  - [ ] Implement dual-write on writes
- Adapters (new files under `src/core/`)
  - [ ] `interfaces/media-catalog.ts`
  - [ ] `interfaces/search-store.ts`
  - [ ] `canonical-media-database.ts`
  - [ ] `image-search-store-sqlite.ts`
  - [ ] `av-search-store-sqlite.ts`
  - [ ] `legacy-catalog-adapter.ts`
- Config/Flags
  - [ ] `config.db`: `settings(key TEXT PK, value TEXT)`; fallback to `preferences.json`
  - [ ] Add `MainMediaAPI.getConfiguration()` to return snapshot
- Migrations
  - [ ] Add transcripts FTS backfill
  - [ ] Add embeddings migration or re-index jobs
- Validation
  - [ ] `./memory/QUERIES.md` with parity/diagnostics
  - [ ] Add dev-only parity command in UI (invokes IPC to run queries and return summary)

## Risks & Mitigations
- Divergence during dual-write → periodic parity checks, logs, and corrective jobs
- Performance regressions → per-modality single-DB queries, indexes reviewed, WAL
- Packaged build pathing issues → continue using unified migrator and `app.asar.unpacked` for SQL; avoid Node ABI traps in main process by sticking to better-sqlite3 in app, sqlite3 CLI for migrations

## Rollback
- Flags off to revert reads to legacy and disable new stores
- Keep legacy DBs intact until cutover + validation pass
- Maintain backup snapshots pre-cutover

## Acceptance Criteria
- With flags off: behavior identical to legacy
- With `dualWrite=true`: writes mirrored; no user-visible changes
- With modality flags on: search correctness parity within tolerance; performance acceptable
- With `useNewCatalog=true`: FE lists and filters operate on canonical `media.db` correctly

## Open Questions
- Where to persist per-user rollout flags in production (config.db vs remote toggle)?
- Embedding versioning and re-indexing scheduling strategy
- Retention for `jobs.db` and cache pruning policies
