---
description: ADR-009 — Self‑evolving, pluggable taxonomy for two‑phase search
status: proposed
date: 2025-11-05
---

# Self‑Evolving Taxonomy (with Human-in-the-Loop) for Cinestar Search

## Context
- We have a two‑phase search (fast FTS → unified/semantic). Users will benefit from browsable facets and evolving categories.
- Taxonomy must be able to change over time automatically, using signals (usage analytics, captions/transcripts, object detection, embeddings), with optional human approvals.
- Needs to be pluggable (file/DB/remote providers), safe (stable IDs, versioning, rollbacks), and observable.

## Goals
- Dynamic taxonomy that can create roots/leaves and reorganize itself over time.
- Pluggable providers; default file‑based provider in DATA_DIR.
- Learner suggests and/or auto‑applies structure changes under policy.
- Integrates with both search phases (filters compiled per node).

## Non‑Goals
- Full ontology (arbitrary relations). This ADR focuses on hierarchical taxonomy (tree) with synonyms.

## Glossary
- Taxonomy: Hierarchical categories for organizing media.
- Node: Category entry with optional filters and synonyms.
- Provider: Component that loads/saves taxonomy (file/DB/remote/module).
- Learner: Background job that proposes or applies taxonomy evolution.

## Architecture Overview
- Main Process
  - TaxonomyService: in‑memory tree + persistence + versioning + events
  - Providers: FileProvider (default), optional DB/Remote/Module providers
  - Learner: consumes signals → creates Suggestions → applies per policy
  - IPC: read APIs + mutation endpoints + change events
- Renderer
  - Fetches taxonomy, renders facets, applies node filters to both search phases
  - Optional review UI for human‑in‑the‑loop approvals

```
Renderer ──(IPC)──▶ TaxonomyService (Main)
            ▲            │
            │ taxonomy:changed events
            │            ▼
       Search/Click signals ◀─ Learner (periodic and streaming)
```

## Data Model
```ts
export type TaxonomyNode = {
  id: string;                  // stable ID (opaque)
  parentId?: string | null;    // null means root
  label: string;               // display label
  synonyms?: string[];         // query variants
  filters?: {                  // compiled to search options
    types?: ('image'|'video'|'audio')[];
    tags?: string[];
    mimePrefixes?: string[];   // e.g., image/, video/
  };
  sortIndex?: number;          // per-sibling ordering
  deprecated?: boolean;        // hidden but resolvable
  replaces?: string;           // for merges
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type Taxonomy = {
  id: string;                  // provider id/name
  version: number;             // monotonic
  roots: string[];             // root node IDs
  nodes: Record<string, TaxonomyNode>;
};
```

## Provider Interface (Pluggable)
```ts
export interface TaxonomyProvider {
  meta(): { name: string; version: string; description?: string };
  get(): Promise<Taxonomy>;
  upsert?(node: Partial<TaxonomyNode> & { id?: string }): Promise<TaxonomyNode>; // create/update
  move?(id: string, parentId: string | null, sortIndex?: number): Promise<void>;
  remove?(id: string): Promise<void>;
  watch?(onChange: () => void): () => void; // hot reload
  dispose?(): void;
}
```
- Default: FileProvider at DATA_DIR/taxonomy.json with chokidar watch.
- Optional: DBProvider (SQLite tables taxonomy_nodes/taxonomy_edges).
- Optional: Remote/Module providers (signature check recommended).

## Signals for Evolution
- Usage: searchStarted, itemOpened/clicked (with query, type, timestamp).
- Textual: captions/transcripts (from Whisper), caption tokens, keyword frequencies.
- Visual: object detection labels (from keyframes), OCR, CLIP tags (future).
- Semantic: embedding clusters (existing embedding‑service), co‑click graph.
- Contextual: source/folder, time of day, recency/decay.

## Evolution Mechanics
- Create Leaf: frequent coherent query/cluster under a suitable parent.
- Create Root: when a large, coherent area spans multiple parents.
- Merge: high overlap nodes → keep primary ID, add synonyms, mark secondary deprecated.
- Split: multi‑modal distribution inside a node → split into children.
- Reparent: move a node to a better parent (cooldown to avoid flapping).
- Synonyms: add common query variants; used in FTS/unified expansion.
- Prune/Demote: low‑usage nodes become hidden/deprecated (reversible).

## Decision Policy (Auto + Guardrails)
- Thresholds: frequency, purity (cluster cohesion), lift (CTR improvement), stability over N days.
- Decay: exponential decay for recency‑weighted counts.
- Cooldowns: minimum time between structural changes per node.
- Safety: stable IDs, keep deprecations not hard deletes, audit + rollback.

## IPC Surface
- Queries (Renderer → Main)
  - taxonomy:get() → { success, taxonomy }
  - taxonomy:listProviders(), taxonomy:getActiveProvider()
- Mutations (auto or human‑approved)
  - taxonomy:createNode({ parentId, label, filters?, sortIndex? })
  - taxonomy:updateNode({ id, label?, synonyms?, filters?, deprecated? })
  - taxonomy:moveNode({ id, parentId, sortIndex? })
  - taxonomy:deleteNode({ id })
  - taxonomy:refresh()
- Events (Main → Renderer)
  - taxonomy:changed { version, changedNodeIds }

Preload additions under window.mediaAPI mirror the above.

## Renderer Integration (DrillerV2)
- On mount: fetch taxonomy; render roots as chips; expand to children on select.
- Selecting a node compiles filters and applies to both phases:
  - fastFTSSearch(query, compiledFilters)
  - unifiedSearch(query, compiledFilters)
- Show subtle badge if results driven by auto‑evolved category (with tooltip).

## Storage & Observability
- taxonomy.json: authoritative tree (versioned), taxonomy.log.jsonl for audit.
- analytics.db (SQLite):
  - events(search_started, item_opened …)
  - aggregates (daily counters, co‑click edges)
  - suggestions(id, type, payload, confidence, metrics, status, appliedBy, createdAt)
- Logs: learner decisions with metrics; ability to replay.

## Rollout Plan
1) Phase 1 — Read‑Only
   - File provider + watcher, IPC taxonomy:get + taxonomy:changed
   - Render root/leaf facets in UI; compile filters for search
2) Phase 2 — Suggestions + Auto‑Create Leaf
   - Collect analytics, daily learner job (freq + purity)
   - Auto‑create leaf when confidence ≥ threshold; emit change
   - Optional review panel to list suggestions
3) Phase 3 — Merge/Split/Reparent + Providers
   - Add advanced operations with cooldowns
   - Enable DB/Remote/Module providers and provider selection in settings
4) Phase 4 — Visual/NER Signals
   - Ingest object detection labels and NER → richer proposals

## Risks & Mitigations
- Drift/Instability → thresholds + cooldowns + review UI
- Bad proposals → human approval for structural changes by default
- Conflicting providers → single active provider, validate schema on load
- User confusion → deprecate/hide vs hard delete; keep synonyms

## Mapping to Existing Pipeline
- Captioning/Transcription already available → immediate textual signals.
- Object Detection/Keyframes (present/near‑term) → visual label signals.
- Embeddings service → clustering and semantic similarity for merges/splits.

## Open Questions
- How to present subtle taxonomy changes without disrupting user mental model?
- What default thresholds make sense for small vs large libraries?

## Appendix: Example Types & Events
```ts
// Analytics events
analytics:searchStarted { query: string; types?: ('image'|'video'|'audio')[]; ts: string }
analytics:itemOpened    { itemId: string; type: 'image'|'video'|'audio'; query?: string; ts: string }

// Suggestion payloads
CreateLeaf { parentId: string|null; label: string; filters?: TaxonomyNode['filters'] }
Merge      { primaryId: string; secondaryId: string }
Split      { nodeId: string; childLabels: string[] }
Reparent   { id: string; newParentId: string }
Synonym    { nodeId: string; synonym: string }
Prune      { nodeId: string }
```
