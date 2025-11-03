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

## Consolidation Plan (Phased) - ✅ COMPLETED

✅ Phase 1 — Decide canonical backends and unblock UI
- ✅ Adopted `SqliteMainDatabase` for sources/items/jobs; kept migrations via `DatabaseMigrator`.
- ✅ Adopted `SqliteVecDatabase` for captions/embeddings + vector search.
- ✅ Forced `MainMediaAPI.initialize()` to always select SQLite backend by default.
- ✅ Replaced duplicate `getMimeType` in `MainMediaAPI` with shared `src/core/utils.ts#getMimeType`.

✅ Phase 2 — Renderer path cleanup
- ✅ Confirmed UI already uses IPC calls to `mediaAPI` (main process) exclusively.
- ✅ Removed `src/api/media-api.ts` and `src/core/media-search-engine.ts`.
- ✅ Removed `src/core/database.ts` and `src/core/file-database.ts`.

✅ Phase 3 — API surface dedupe
- ✅ Removed `src/api/main-media-api-minimal.ts`.
- ✅ `getSuggestions` already consolidated in main process (placeholder implementation).

✅ Phase 4 — Vector search unification
- ✅ Deleted `src/core/vector-database.ts`.
- ✅ Ranking unified in `SqliteVecDatabase`.

✅ Phase 5 — Repo hygiene
- ✅ Deleted unused `src/core/sqlite-database.ts` and empty `src/core/video-pipeline-fixed.ts`.
- ✅ Removed deprecated JSON `src/core/main-database.ts`.
- ✅ Verified no lingering imports.

---

## ✅ REFACTOR COMPLETE - Summary of Changes

**Files Removed (9 total):**
- `src/core/sqlite-database.ts` - Unused in-memory SQLite stub
- `src/core/vector-database.ts` - Legacy vector DB (replaced by sqlite-vec)
- `src/core/video-pipeline-fixed.ts` - Empty file
- `src/api/media-api.ts` - Renderer-side API facade (replaced by IPC)
- `src/core/media-search-engine.ts` - Renderer-side search engine (replaced by IPC)
- `src/api/main-media-api-minimal.ts` - Duplicate minimal API
- `src/core/database.ts` - Renderer DB manager (replaced by IPC)
- `src/core/file-database.ts` - File-backed DB via IPC (replaced by direct IPC)
- `src/core/main-database.ts` - JSON-backed main DB (replaced by SQLite)

**Code Changes:**
- ✅ Forced SQLite backend in `MainMediaAPI.initialize()` (removed JSON fallback)
- ✅ Replaced duplicate `getMimeType` helper with shared `src/core/utils.ts` import
- ✅ Removed unused `MainDatabase` import

**Architecture Simplified:**
- **Before:** Multiple parallel data paths (renderer JSON/SQLite + main process JSON/SQLite + legacy vector DB)
- **After:** Single canonical path: UI → IPC → `MainMediaAPI` → `SqliteMainDatabase` + `SqliteVecDatabase`

**Benefits Achieved:**
- Eliminated 9 redundant/duplicate files (~2,500+ lines of code removed)
- Unified on SQLite for all persistence (metadata + vectors)
- Single API surface via IPC (no renderer-side database logic)
- Consistent MIME type handling via shared utility
- Simplified maintenance and reduced drift potential

---

## Remaining Considerations

- **sqlite-vec availability**: `SqliteVecDatabase` loads platform-specific extensions and handles dimension mismatch; ensure CI/build includes the right artifacts.
- **Data migration**: If users have existing JSON data stores, they would need a one-time migration script to import into SQLite (not implemented in this refactor).

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
