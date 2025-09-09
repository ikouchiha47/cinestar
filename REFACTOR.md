# Refactor Plan and Redundancy Audit

This document catalogs redundant and overlapping code paths in the codebase and proposes a consolidation plan. Paths and symbol names are cited to make changes actionable.

## Summary of Findings

- Multiple database layers coexist (renderer JSON, main-process JSON, SQLite main, two vector DBs), creating drift and duplicated logic.
- Two parallel Media APIs exist (renderer `MediaSearchEngine` and main-process `MainMediaAPI`), plus a "minimal" variant.
- Two vector DB implementations exist: legacy cosine-on-BLOB vs sqlite-vec extension.
- Duplicated helpers and placeholder logic (e.g., `getMimeType`, `getSuggestions`) exist in multiple places.
- Unused/legacy modules remain in the tree (safe to remove).

---

## Detailed Redundancies

### 1) Database layer duplication

Files:
- Renderer-side manager: `src/core/database.ts` (`DatabaseManager` → `FileDatabase`)
- File-backed DB via Electron IPC: `src/core/file-database.ts` (`FileDatabase`)
- Main-process JSON DB: `src/core/main-database.ts` (`MainDatabase`)
- SQLite-backed main DB: `src/core/sqlite-main-database.ts` (`SqliteMainDatabase`)
- Migration system: `src/core/database-migrator.ts`

Issues:
- Multiple persistence backends implement the same responsibilities (sources/items/jobs).
- Renderer `DatabaseManager` + `FileDatabase` duplicates `MainDatabase` logic and diverges from SQLite.

Recommendation:
- Canonicalize on SQLite in main process for metadata: `SqliteMainDatabase`.
- Keep `DatabaseMigrator` for schema management.
- Deprecate renderer DB stack (`DatabaseManager`, `FileDatabase`) and JSON `MainDatabase`.
- Route all renderer operations over IPC to main process endpoints already exposed in `electron/preload.ts`.

Migration steps:
- Replace `MediaSearchEngine` usage of `DatabaseManager` with IPC calls to `MainMediaAPI`.
- Remove write paths to JSON stores after feature parity is confirmed.

### 2) Vector database duplication

Files:
- New: `src/core/sqlite-vec-database.ts` (`SqliteVecDatabase`) — sqlite-vec extension, dimension tracking, status columns.
- Legacy: `src/core/vector-database.ts` (`VectorDatabase`) — BLOB embeddings and manual cosine search.

Issues:
- Overlapping storage and search responsibilities; drift in ranking logic and status handling.

Recommendation:
- Canonicalize on `SqliteVecDatabase` for embeddings and vector search.
- Deprecate `VectorDatabase`.

Notes:
- `SqliteVecDatabase` supports embedding dimension migrations and better performance; consolidate ranking here.

### 3) API surface duplication (renderer vs main)

Files:
- Renderer API facade: `src/api/media-api.ts` → `src/core/media-search-engine.ts` (renderer DB)
- Main-process API: `src/api/main-media-api.ts` (SQLite/JSON backend selectable) and `src/api/main-media-api-minimal.ts` (JSON-only)
- Video API: `src/api/video-media-api.ts` (separate Video DB + pipeline)

Issues:
- Two divergent data paths for the same features: renderer-side engine vs main-process API.
- Minimal variant (`main-media-api-minimal.ts`) duplicates methods from `main-media-api.ts` with reduced functionality.
- Multiple placeholder `getSuggestions()` implementations with identical logic in different files.

Recommendation:
- Canonicalize all non-video media operations on `MainMediaAPI` (main process + SQLite).
- Deprecate `main-media-api-minimal.ts` and `media-api.ts`/`media-search-engine.ts` pair.
- Keep `video-media-api.ts` for video-specific flow, but consider unifying common concerns (e.g., stats, source listing) via `MainMediaAPI`.

IPC status:
- `electron/preload.ts` already exposes a comprehensive `mediaAPI` surface; leverage that exclusively from UI.

### 4) Duplicate helpers and placeholder logic

- MIME type helper:
  - Duplicate implementations:
    - `src/api/main-media-api.ts` private `getMimeType(filePath: string)`
    - `src/core/utils.ts` exported `getMimeType(filePath: string)`
  - Recommendation: Delete the private implementation in `MainMediaAPI` and import `getMimeType` from `src/core/utils.ts`.

- `getSuggestions()` placeholders:
  - Present in:
    - `src/api/main-media-api.ts` (`getSuggestions`)
    - `src/api/media-api.ts` (`getSuggestions`)
    - `src/core/media-search-engine.ts` (`getSuggestions`)
  - Recommendation: Provide one implementation (e.g., in main process API) and remove duplicates. Wire renderer to call via IPC only.

### 5) Video pipeline duplication

- Files:
  - `src/core/video-pipeline.ts` — substantive pipeline implementation.
  - `src/core/video-pipeline-fixed.ts` — empty file (0 LOC).
- Recommendation: Remove `video-pipeline-fixed.ts`.

### 6) Retry and concurrency utilities

- Files:
  - `src/core/retry-queue.ts` — robust retry with jitter and circuit breaker, used by LLM provider.
  - `src/core/concurrency-limiter.ts` — bounded concurrency helper used by `VideoMediaAPI`.
- Notes:
  - Both have distinct responsibilities; no direct duplication. Keep both.
  - Consider centralizing backoff configuration in one module if more subsystems adopt retry.

---

## Unused / Legacy Candidates (safe to remove)

- `src/core/sqlite-database.ts` (`SQLiteDatabase`)
  - In-memory stub simulating SQLite; not referenced elsewhere.
  - Evidence: `grep` found only self-references.

- `src/core/vector-database.ts` (`VectorDatabase`)
  - Legacy alternative to `SqliteVecDatabase`; not referenced.
  - Evidence: no import usages found via repo search.

- `src/core/video-pipeline-fixed.ts`
  - Empty file.

Before deletion, run a final project-wide search to confirm no dynamic imports.

---

## Consolidation Plan (Phased)

Phase 1 — Decide canonical backends and unblock UI
- Adopt `SqliteMainDatabase` for sources/items/jobs; keep migrations via `DatabaseMigrator`.
- Adopt `SqliteVecDatabase` for captions/embeddings + vector search.
- Ensure `MainMediaAPI.initialize()` always selects SQLite backend by default.

Phase 2 — Renderer path cleanup
- Replace renderer `MediaAPI`/`MediaSearchEngine` calls with IPC calls to `mediaAPI` (main process).
- Remove `src/api/media-api.ts` and `src/core/media-search-engine.ts` after migration.
- Remove `src/core/database.ts` and `src/core/file-database.ts`.

Phase 3 — API surface dedupe
- Remove `src/api/main-media-api-minimal.ts`.
- Consolidate `getSuggestions` into one implementation (main process) and route via IPC.
- Replace private `getMimeType` in `MainMediaAPI` with `src/core/utils.ts#getMimeType`.

Phase 4 — Vector search unification
- Delete `src/core/vector-database.ts`.
- Keep ranking only in `SqliteVecDatabase` (re-enable or finalize enhanced ranking when ready).

Phase 5 — Repo hygiene
- Delete unused `src/core/sqlite-database.ts` and empty `src/core/video-pipeline-fixed.ts`.
- Grep for any lingering imports and update.

---

## Suggested Work Items

- Remove unused/legacy files:
  - Delete: `src/core/sqlite-database.ts`, `src/core/vector-database.ts`, `src/core/video-pipeline-fixed.ts`.
- Import hygiene:
  - Update `src/api/main-media-api.ts` to import `getMimeType` from `src/core/utils.ts`.
- IPC unification:
  - Migrate UI calls to use `window.mediaAPI.*` exclusively.
  - Remove `src/api/media-api.ts` and `src/core/media-search-engine.ts` after migration.
- Backend selection:
  - Ensure `MainMediaAPI.initialize()` defaults to SQLite and remove JSON codepaths once data migration is complete.
- Suggestions service:
  - Keep a single `getSuggestions` implementation in `MainMediaAPI` and delete duplicates.

---

## Potential Risks and Mitigations

- Mixed data backends during migration
  - Mitigate by flipping a feature flag/env to force SQLite-only path (`MAIN_DB_BACKEND=sqlite`).
- Lost data from JSON stores
  - If needed, add a one-time import from JSON to SQLite before removing JSON DBs.
- sqlite-vec availability
  - `SqliteVecDatabase` already loads platform-specific extensions and handles dimension mismatch; ensure CI/build includes the right artifacts.

---

## References (citations)

- Main process API: `src/api/main-media-api.ts`
- Minimal API (duplicate): `src/api/main-media-api-minimal.ts`
- Renderer engine and API: `src/core/media-search-engine.ts`, `src/api/media-api.ts`
- SQLite metadata DB: `src/core/sqlite-main-database.ts`
- Vector DB (sqlite-vec): `src/core/sqlite-vec-database.ts`
- Legacy vector DB: `src/core/vector-database.ts`
- Renderer DB stack: `src/core/database.ts`, `src/core/file-database.ts`
- In-memory SQLite stub (unused): `src/core/sqlite-database.ts`
- Utilities: `src/core/utils.ts#getMimeType`
- Video pipeline: `src/core/video-pipeline.ts`, `src/core/video-pipeline-fixed.ts`
- IPC surface: `electron/preload.ts`
