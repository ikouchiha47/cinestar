import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { distanceToSimilarity, getSimilarityScorer } from './similarity-scorers';
import { ConfigManager } from './config';

export interface ImageSearchRow {
  id: string;
  path: string;
  name?: string;
  size?: number;
  created_at?: string;
}

export interface ImageHybridResult {
  id: string;
  path: string;
  name: string;
  similarity: number;
  distance: number;
}

export class ImageModalityVecDatabase {
  private db: Database.Database;
  private expectedDim: number;

  constructor(dbPath: string) {
    // Ensure directory
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');

    // Load sqlite-vec extension
    const platform = process.platform;
    const arch = process.arch;
    const isDev = !!process.env.VITE_DEV_SERVER_URL;
    const basePath = isDev
      ? '.'
      : path.join((process as any).resourcesPath || path.dirname(process.execPath), 'app.asar.unpacked');

    let extensionPath: string;
    if (platform === 'darwin' && arch === 'arm64') {
      extensionPath = path.resolve(basePath, 'node_modules/sqlite-vec-darwin-arm64/vec0.dylib');
    } else if (platform === 'darwin' && arch === 'x64') {
      extensionPath = path.resolve(basePath, 'node_modules/sqlite-vec-darwin-x64/vec0.dylib');
    } else if (platform === 'linux' && arch === 'x64') {
      extensionPath = path.resolve(basePath, 'node_modules/sqlite-vec-linux-x64/vec0.so');
    } else if (platform === 'linux' && arch === 'arm64') {
      extensionPath = path.resolve(basePath, 'node_modules/sqlite-vec-linux-arm64/vec0.so');
    } else if (platform === 'win32' && arch === 'x64') {
      extensionPath = path.resolve(basePath, 'node_modules/sqlite-vec-windows-x64/vec0.dll');
    } else {
      throw new Error(`Unsupported platform: ${platform}-${arch}`);
    }
    this.db.loadExtension(extensionPath);

    this.expectedDim = this.getExpectedDim();
    this.initializeTables();
  }

  private getExpectedDim(): number {
    try {
      const model = (ConfigManager.getConfig().ai.embeddingModel || '').toLowerCase();
      if (model.includes('nomic-embed-text')) return 768;
      if (model.includes('bge-large')) return 1024;
      if (model.includes('bge-small')) return 384;
      if (model.includes('text-embedding-3-small')) return 1536;
      if (model.includes('text-embedding-3-large')) return 3072;
      return 768;
    } catch {
      return 768;
    }
  }

  private initializeTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS vector_meta (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);
    this.ensureVectorTableDimension();
  }

  private ensureVectorTableDimension(): void {
    const row = this.db.prepare("SELECT value FROM vector_meta WHERE key = 'embedding_dim'").get() as any;
    const currentDim = row ? Number(row.value) : undefined;
    if (!currentDim) {
      this.recreateVectorTable(this.expectedDim, true);
      return;
    }
    if (currentDim !== this.expectedDim) {
      this.recreateVectorTable(this.expectedDim);
    }
  }

  private recreateVectorTable(dim: number, skipReset: boolean = false): void {
    this.db.exec('DROP TABLE IF EXISTS image_vec_embeddings');
    this.db.exec(`
      CREATE VIRTUAL TABLE image_vec_embeddings USING vec0(
        item_id TEXT PRIMARY KEY,
        embedding FLOAT[${dim}]
      );
    `);
    this.db.prepare("INSERT OR REPLACE INTO vector_meta (key, value) VALUES ('embedding_dim', ?)").run(String(dim));
    if (!skipReset) {
      // No-op for now; backfill job will repopulate vectors
    }
  }

  getImageMeta(id: string): ImageSearchRow | null {
    const stmt = this.db.prepare(`SELECT item_id as id, path, '' as name, NULL as size, created_at FROM image_meta_cache WHERE item_id = ?`);
    const row = stmt.get(id) as any;
    return row || null;
  }

  async searchSimilar(queryEmbedding: Float32Array, limit: number, cutoff?: { tsISO: string; id: string }): Promise<{ results: ImageHybridResult[]; total: number; hasMore: boolean }> {
    const countStmt = this.db.prepare(`
      SELECT COUNT(v.item_id) as total
      FROM image_vec_embeddings v
      JOIN image_meta_cache c ON v.item_id = c.item_id
      WHERE v.embedding MATCH ? AND k = 1000
    `);

    const stmt = this.db.prepare(`
      WITH knn AS (
        SELECT c.item_id as id, c.path, c.created_at as created_at, distance
        FROM image_vec_embeddings v
        JOIN image_meta_cache c ON v.item_id = c.item_id
        WHERE v.embedding MATCH ? AND k = ?
      )
      SELECT * FROM knn
      ${cutoff ? `WHERE (datetime(created_at) < datetime(?) OR (datetime(created_at) = datetime(?) AND id < ?))` : ''}
      ORDER BY distance ASC, id ASC
      LIMIT ?
    `);

    const qbuf = Buffer.alloc(queryEmbedding.length * 4);
    for (let i = 0; i < queryEmbedding.length; i++) qbuf.writeFloatLE(queryEmbedding[i], i * 4);

    const totalCount = (countStmt.get(qbuf) as any)?.total || 0;
    const kValue = Math.min(Math.max(limit * 4, 50), 1000);
    const rows = cutoff ? stmt.all(qbuf, kValue, cutoff.tsISO, cutoff.tsISO, cutoff.id, limit) : stmt.all(qbuf, kValue, limit);

    const results: ImageHybridResult[] = [];
    for (const row of rows as any[]) {
      const similarity = distanceToSimilarity(row.distance);
      results.push({ id: row.id, path: row.path, name: path.basename(row.path || ''), similarity, distance: row.distance });
    }
    return { results, total: totalCount, hasMore: results.length > 0 && results.length <= totalCount };
  }

  async searchFTS(query: string, limit: number, cutoff?: { tsISO: string; id: string }): Promise<{ results: ImageHybridResult[]; total: number; hasMore: boolean }> {
    const ftsQuery = query.trim().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean).join(' OR ');
    console.log(`[IMAGE-FTS] Original query: "${query}" → FTS query: "${ftsQuery}"`);

    const countStmt = this.db.prepare(`
      SELECT COUNT(1) as total FROM image_fts WHERE image_fts MATCH ?
    `);
    const stmt = this.db.prepare(`
      WITH ranked AS (
        SELECT c.item_id as id, c.path, c.created_at as created_at, bm25(image_fts) as fts_score
        FROM image_fts f
        JOIN image_meta_cache c ON f.item_id = c.item_id
        WHERE image_fts MATCH ?
      )
      SELECT * FROM ranked
      ${cutoff ? `WHERE (datetime(created_at) < datetime(?) OR (datetime(created_at) = datetime(?) AND id < ?))` : ''}
      ORDER BY fts_score ASC, id ASC
      LIMIT ?
    `);
    const total = (countStmt.get(ftsQuery) as any)?.total || 0;
    console.log(`[IMAGE-FTS] Total FTS matches: ${total}`);

    const rows = cutoff ? stmt.all(ftsQuery, cutoff.tsISO, cutoff.tsISO, cutoff.id, limit) : stmt.all(ftsQuery, limit);
    console.log(`[IMAGE-FTS] Retrieved ${rows.length} FTS rows (limit=${limit})`);
    const results: ImageHybridResult[] = [];
    if (rows.length > 0) {
      const scores = rows.map((r: any) => r.fts_score);
      const minScore = Math.min(...scores);
      const maxScore = Math.max(...scores);
      const range = maxScore - minScore || 1;
      for (const r of rows as any[]) {
        const score = 1 - ((r.fts_score - minScore) / range);
        results.push({ id: r.id, path: r.path, name: path.basename(r.path || ''), similarity: score, distance: 0 });
      }
    }
    return { results, total, hasMore: results.length > 0 && results.length <= total };
  }

  async searchHybrid(query: string, embedding: Float32Array, options: {
    limit?: number;
    alpha?: number;
    cutoff?: { tsISO: string; id: string };
    minSimilarity?: number;    // Hybrid score cutoff
    minVectorSim?: number;     // Vector similarity cutoff (pre-merge)
    maxDistance?: number;      // Legacy distance cutoff (not recommended)
  } = {}) {
    const limit = options.limit || 10;
    let alpha = options.alpha ?? 0.75;
    let minSimilarity = options.minSimilarity ?? 0.5;
    let minVectorSim = options.minVectorSim ?? 0.60;
    const maxDistance = options.maxDistance ?? 0;

    console.log(`[IMAGE-HYBRID] Starting hybrid search for: "${query}"`);
    console.log(`[IMAGE-HYBRID] alpha=${alpha}, minSimilarity=${minSimilarity}, minVectorSim=${minVectorSim}, maxDistance=${maxDistance}, limit=${limit}`);

    // Reasonable candidate multiplier: 2-3x is enough for hybrid search
    // Cap at 100 to avoid fetching too many candidates
    const candidateK = Math.min(Math.max(limit * 3, 30), 100);
    console.log(`[IMAGE-HYBRID] Fetching candidateK=${candidateK} vector results (limit×3, min 30, max 100)`);
    const [vec, fts] = await Promise.all([
      this.searchSimilar(embedding, candidateK, options.cutoff),
      this.searchFTS(query, limit * 3, options.cutoff)
    ]);

    console.log(`[IMAGE-HYBRID] Raw results - Vector: ${vec.results.length}/${candidateK}, FTS: ${fts.results.length}`);

    let filteredVec = vec.results.filter(r => r.similarity >= minVectorSim);
    console.log(`[IMAGE-HYBRID] After vector cutoff (≥${minVectorSim}): ${filteredVec.length} vector results`);
    if (maxDistance && maxDistance > 0) {
      filteredVec = filteredVec.filter(r => (r as any).distance <= maxDistance);
      console.log(`[IMAGE-HYBRID] After legacy distance cutoff (≤${maxDistance}): ${filteredVec.length} vector results`);
    }

    const map = new Map<string, { item: ImageHybridResult; vs: number; fs: number; distance?: number }>();
    for (const it of filteredVec) {
      map.set(it.id, { item: it, vs: it.similarity, fs: 0, distance: (it as any).distance });
    }
    for (const it of fts.results) {
      const ex = map.get(it.id);
      if (ex) ex.fs = it.similarity; else map.set(it.id, { item: it, vs: 0, fs: it.similarity });
    }

    // Calculate all scored results FIRST (before filtering)
    const allScored = Array.from(map.values())
      .map(({ item, vs, fs, distance }) => {
        const hybridScore = alpha * vs + (1 - alpha) * fs;
        return { ...item, similarity: hybridScore, _debug: { vectorScore: vs, ftsScore: fs, hybridScore, distance } };
      })
      .sort((a, b) => b.similarity - a.similarity);

    // When FTS contributes nothing, we already filtered by minVectorSim
    // So skip the hybrid quality filter to avoid double-filtering
    const hasFTSResults = fts.results.length > 0;
    let scoredResults: typeof allScored;

    if (!hasFTSResults) {
      // No FTS results - use all vector results that passed minVectorSim
      console.log(`[IMAGE-HYBRID] ⚠️  No FTS results, skipping hybrid quality filter (already filtered by minVectorSim=${minVectorSim})`);
      scoredResults = allScored;
    } else {
      // FTS contributed - apply hybrid quality filter
      scoredResults = allScored.filter(r => r.similarity >= minSimilarity);
      console.log(`[IMAGE-HYBRID] Quality filtered: ${scoredResults.length} results (≥${minSimilarity})`);
    }

    console.log(`[IMAGE-HYBRID] 📊 Top 10 scored results (before quality filter):`);
    allScored.slice(0, 10).forEach((r, i) => {
      const debug = (r as any)._debug;
      const passed = r.similarity >= minSimilarity ? '✅' : '❌';
      console.log(`  ${passed} ${i + 1}. ${r.name}: hybrid=${r.similarity.toFixed(3)} (α=${alpha.toFixed(2)}×vec=${debug.vectorScore.toFixed(3)} + ${(1 - alpha).toFixed(2)}×fts=${debug.ftsScore.toFixed(3)})${debug.distance ? `, dist=${debug.distance.toFixed(3)}` : ''}`);
    });

    // Log top results after filtering
    if (scoredResults.length > 0) {
      console.log(`[IMAGE-HYBRID] ✅ ${scoredResults.length} results passed quality filter (≥${minSimilarity})`);
    } else {
      console.log(`[IMAGE-HYBRID] ⚠️  No results passed quality filter (≥${minSimilarity})`);
      console.log(`[IMAGE-HYBRID] 💡 Suggestion: Lower minSimilarity threshold or check if FTS is working`);
    }

    const finalResults = scoredResults.slice(0, limit);
    const hasMore = scoredResults.length > limit;
    return { results: finalResults, total: scoredResults.length, hasMore };
  }

  // Potential future helpers (not used yet):
  private relaxVectorCandidates(vecResults: ImageHybridResult[], currentCutoff: number, limit: number): { filtered: ImageHybridResult[]; newCutoff: number } {
    const sims = vecResults.map(r => r.similarity).sort((a, b) => b - a);
    const p80 = sims.length ? sims[Math.floor(sims.length * 0.20)] : currentCutoff;
    const p70 = sims.length ? sims[Math.floor(sims.length * 0.30)] : currentCutoff;
    for (const t of [p80, p70]) {
      if (t < currentCutoff) {
        const filtered = vecResults.filter(r => r.similarity >= t);
        if (filtered.length >= Math.min(limit, 5)) return { filtered, newCutoff: t };
      }
    }

    return { filtered: vecResults.filter(r => r.similarity >= currentCutoff), newCutoff: currentCutoff };
  }

  private fallbackTopByVector(vecResults: ImageHybridResult[], alpha: number, limit: number): ImageHybridResult[] {
    return vecResults
      .slice(0, Math.min(limit, vecResults.length))
      .map((it) => ({
        ...it,
        similarity: alpha * it.similarity,
        _debug: { vectorScore: it.similarity, ftsScore: 0, hybridScore: alpha * it.similarity, distance: (it as any).distance }
      } as any))
      .sort((a, b) => b.similarity - a.similarity);
  }
}
