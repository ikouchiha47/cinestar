import { QueryClassification } from './llm-provider';
import Database from 'better-sqlite3';
import path from 'path';
import { getDataDir } from './utils/data-dir';

/**
 * Search result from SearchService (flexible format)
 */
export interface SearchResult {
  id: string;
  path: string;
  type?: string;
  score?: number;
  [key: string]: any; // Allow additional properties
}

/**
 * Scored search result with adaptive scoring
 */
export interface ScoredSearchResult extends SearchResult {
  adaptiveScore: number;
  scoreBreakdown: {
    baseSimilarity: number;
    spatialBoost: number;
    temporalBoost: number;
    audioBoost: number;
    elementBoost: number;
    qualityBonus: number;
  };
}

/**
 * SearchScoringService - Applies adaptive scoring to search results
 * based on LLM query classification and multi-pass caption data
 * 
 * Uses:
 * - LLM classification (spatial/temporal/audio/action/mixed)
 * - Multi-pass caption fields (caption_spatial, caption_temporal, caption_elements)
 * - Quality metrics from av_meta_cache
 */
export class SearchScoringService {
  private avSearchDb: Database.Database;

  constructor(avSearchDbPath?: string) {
    const dbPath = avSearchDbPath || path.join(getDataDir(), 'av_search.db');
    this.avSearchDb = new Database(dbPath, { readonly: true });
    console.log(`[SEARCH-SCORING] Initialized with av_search.db at ${dbPath}`);
  }

  /**
   * Apply adaptive scoring to search results based on LLM classification
   */
  async scoreResults(
    results: SearchResult[],
    query: string,
    classification: QueryClassification
  ): Promise<ScoredSearchResult[]> {
    console.log(`[SEARCH-SCORING] Scoring ${results.length} results for query: "${query}"`);
    console.log(`[SEARCH-SCORING] Classification: ${classification.type} (${classification.confidence})`);

    const scoredResults: ScoredSearchResult[] = [];

    for (const result of results) {
      // Extract segment ID from result (could be in id or segmentId field)
      const segmentId = result.segmentId || result.id;
      const metaCache = this.getMetaCache(segmentId);
      
      // Use score field (from SearchService) as base similarity
      const baseSimilarity = result.score || 0.5;
      
      if (!metaCache) {
        // No metadata, use base similarity only
        scoredResults.push({
          ...result,
          adaptiveScore: baseSimilarity,
          scoreBreakdown: {
            baseSimilarity,
            spatialBoost: 0,
            temporalBoost: 0,
            audioBoost: 0,
            elementBoost: 0,
            qualityBonus: 0
          }
        });
        continue;
      }

      // Calculate boosts based on classification and available data
      const spatialBoost = this.calculateSpatialBoost(
        query,
        classification,
        metaCache.caption_spatial
      );

      const temporalBoost = this.calculateTemporalBoost(
        query,
        classification,
        metaCache.caption_temporal
      );

      const audioBoost = this.calculateAudioBoost(
        query,
        classification,
        metaCache.caption
      );

      const elementBoost = this.calculateElementBoost(
        query,
        classification,
        metaCache.caption_elements
      );

      const qualityBonus = this.calculateQualityBonus(metaCache);

      // Combine scores
      const adaptiveScore = Math.min(
        baseSimilarity + spatialBoost + temporalBoost + audioBoost + elementBoost + qualityBonus,
        1.0
      );

      scoredResults.push({
        ...result,
        adaptiveScore,
        scoreBreakdown: {
          baseSimilarity,
          spatialBoost,
          temporalBoost,
          audioBoost,
          elementBoost,
          qualityBonus
        }
      });
    }

    // Sort by adaptive score
    scoredResults.sort((a, b) => (b.adaptiveScore || 0) - (a.adaptiveScore || 0));

    if (scoredResults.length > 0 && scoredResults[0]?.adaptiveScore !== undefined && scoredResults[0]?.score !== undefined) {
      console.log(`[SEARCH-SCORING] Top result: ${scoredResults[0].adaptiveScore.toFixed(3)} (base: ${scoredResults[0].score.toFixed(3)})`);
    }
    
    return scoredResults;
  }

  /**
   * Get metadata from av_meta_cache
   */
  private getMetaCache(segmentId: string): any | null {
    try {
      const row = this.avSearchDb.prepare(`
        SELECT caption, caption_elements, caption_spatial, caption_temporal, caption_tokens
        FROM av_meta_cache
        WHERE segment_id = ?
      `).get(segmentId);
      
      return row || null;
    } catch (error) {
      console.warn(`[SEARCH-SCORING] Failed to get meta_cache for ${segmentId}:`, error);
      return null;
    }
  }

  /**
   * Calculate spatial boost if query has spatial intent
   */
  private calculateSpatialBoost(
    query: string,
    classification: QueryClassification,
    captionSpatial: string | null
  ): number {
    if (!captionSpatial || !classification.spatialElements || classification.spatialElements.length === 0) {
      return 0;
    }

    const lowerQuery = query.toLowerCase();
    const lowerSpatial = captionSpatial.toLowerCase();
    
    let boost = 0;

    // Check if spatial elements from classification match the caption_spatial field
    for (const element of classification.spatialElements) {
      if (lowerSpatial.includes(element.toLowerCase())) {
        boost += 0.1;
      }
    }

    // Extra boost for spatial query type
    if (classification.type === 'spatial' || classification.type === 'mixed') {
      boost *= 1.5;
    }

    return Math.min(boost, 0.3); // Cap at 0.3
  }

  /**
   * Calculate temporal boost if query has temporal intent
   */
  private calculateTemporalBoost(
    query: string,
    classification: QueryClassification,
    captionTemporal: string | null
  ): number {
    if (!captionTemporal) {
      return 0;
    }

    const lowerQuery = query.toLowerCase();
    const lowerTemporal = captionTemporal.toLowerCase();
    
    let boost = 0;

    // Check for temporal keywords in caption_temporal
    const temporalKeywords = ['walking', 'running', 'moving', 'jumping', 'dancing', 'motion', 'action'];
    for (const keyword of temporalKeywords) {
      if (lowerQuery.includes(keyword) && lowerTemporal.includes(keyword)) {
        boost += 0.1;
      }
    }

    // Extra boost for action/temporal query type
    if (classification.type === 'action' || classification.type === 'temporal') {
      boost *= 1.5;
    }

    return Math.min(boost, 0.3); // Cap at 0.3
  }

  /**
   * Calculate audio boost if query has audio intent
   */
  private calculateAudioBoost(
    query: string,
    classification: QueryClassification,
    caption: string | null
  ): number {
    if (!caption || !classification.audioElements || classification.audioElements.length === 0) {
      return 0;
    }

    const lowerQuery = query.toLowerCase();
    const lowerCaption = caption.toLowerCase();
    
    let boost = 0;

    // Check if audio elements match the caption (transcription)
    for (const element of classification.audioElements) {
      if (lowerCaption.includes(element.toLowerCase())) {
        boost += 0.1;
      }
    }

    // Extra boost for audio query type
    if (classification.type === 'audio') {
      boost *= 1.5;
    }

    return Math.min(boost, 0.3); // Cap at 0.3
  }

  /**
   * Calculate element boost based on visual elements
   */
  private calculateElementBoost(
    query: string,
    classification: QueryClassification,
    captionElements: string | null
  ): number {
    if (!captionElements) {
      return 0;
    }

    try {
      const elements = JSON.parse(captionElements);
      if (!Array.isArray(elements)) {
        return 0;
      }

      const lowerQuery = query.toLowerCase();
      let boost = 0;

      // Check if query terms match any elements
      for (const element of elements) {
        if (typeof element === 'string' && lowerQuery.includes(element.toLowerCase())) {
          boost += 0.05;
        }
      }

      return Math.min(boost, 0.2); // Cap at 0.2
    } catch (error) {
      return 0;
    }
  }

  /**
   * Calculate quality bonus based on metadata completeness
   */
  private calculateQualityBonus(metaCache: any): number {
    let bonus = 0;

    // Bonus for having spatial data
    if (metaCache.caption_spatial && metaCache.caption_spatial.length > 10) {
      bonus += 0.05;
    }

    // Bonus for having temporal data
    if (metaCache.caption_temporal && metaCache.caption_temporal.length > 10) {
      bonus += 0.05;
    }

    // Bonus for having elements
    if (metaCache.caption_elements) {
      try {
        const elements = JSON.parse(metaCache.caption_elements);
        if (Array.isArray(elements) && elements.length > 0) {
          bonus += 0.05;
        }
      } catch (e) {
        // Invalid JSON, no bonus
      }
    }

    return Math.min(bonus, 0.15); // Cap at 0.15
  }

  /**
   * Close database connection
   */
  close(): void {
    this.avSearchDb.close();
  }
}
