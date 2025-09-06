/**
 * Enhanced vector search with improved ranking algorithm
 * Addresses the core issue of irrelevant content ranking higher than relevant content
 */

export interface SearchResult {
  id: string;
  similarity: number;
  caption: string;
  path: string;
  name: string;
}

import { MediaItem } from './types';

export class EnhancedVectorSearch {
  /**
   * Enhanced vector similarity search with aggressive relevance filtering
   */
  static searchSimilar(
    items: MediaItem[], 
    queryEmbedding: Float32Array, 
    query: string, 
    limit: number = 10
  ): SearchResult[] {
    console.log(`🔍 [ENHANCED] Starting enhanced vector search with ${items.length} items`);
    console.log(`🔍 [ENHANCED] Query: "${query}"`);
    
    const results: SearchResult[] = [];
    
    for (const item of items) {
      if (!item.embedding || (item.embeddingStatus && item.embeddingStatus !== 'completed')) continue;
      
      const baseSimilarity = this.cosineSimilarity(queryEmbedding, item.embedding);
      
      // Apply enhanced ranking with aggressive penalties
      const enhancedScore = this.calculateEnhancedScore(baseSimilarity, item.caption || '', query);
      
      results.push({
        id: item.id,
        similarity: enhancedScore.score,
        caption: item.caption || '',
        path: item.path || '',
        name: item.name || ''
      });
      
      console.log(`🔍 [ENHANCED] ${item.name}: Base ${baseSimilarity.toFixed(4)}, Enhanced ${enhancedScore.score.toFixed(4)} ${enhancedScore.factors}`);
    }
    
    // Sort by enhanced similarity and limit results
    const sortedResults = results
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
    
    console.log(`🔍 [ENHANCED] Top ${sortedResults.length} results:`);
    sortedResults.forEach((result, index) => {
      console.log(`  ${index + 1}. ${result.name} (${result.similarity.toFixed(4)}) - "${result.caption.substring(0, 80)}..."`);
    });
    
    return sortedResults;
  }

  /**
   * Calculate enhanced score with aggressive relevance filtering
   */
  private static calculateEnhancedScore(baseSimilarity: number, caption: string, query: string): {
    score: number;
    factors: string;
  } {
    let score = baseSimilarity;
    const factors: string[] = [];
    
    const queryLower = query.toLowerCase();
    const captionLower = caption.toLowerCase();
    
    // 1. Strong boost for direct relevance
    const relevanceBoost = this.calculateRelevanceBoost(queryLower, captionLower);
    if (relevanceBoost > 0) {
      score = score * (1 + relevanceBoost); // Multiplicative boost
      factors.push(`relevance:*${(1 + relevanceBoost).toFixed(2)}`);
    }
    
    // 2. Aggressive penalty for irrelevant content
    if (this.isHumanRelatedQuery(queryLower)) {
      const irrelevancePenalty = this.calculateIrrelevancePenalty(captionLower);
      if (irrelevancePenalty > 0) {
        score = score * (1 - irrelevancePenalty); // Multiplicative penalty
        factors.push(`irrelevant:*${(1 - irrelevancePenalty).toFixed(2)}`);
      }
    }
    
    // 3. Context mismatch penalty (very aggressive)
    const contextMismatch = this.calculateContextMismatch(queryLower, captionLower);
    if (contextMismatch > 0) {
      score = score * (1 - contextMismatch);
      factors.push(`context:*${(1 - contextMismatch).toFixed(2)}`);
    }
    
    return {
      score: Math.max(score, 0), // Ensure non-negative
      factors: factors.length > 0 ? `[${factors.join(', ')}]` : ''
    };
  }

  /**
   * Calculate relevance boost for matching content
   */
  private static calculateRelevanceBoost(query: string, caption: string): number {
    let boost = 0;
    const queryLower = query.toLowerCase();
    const captionLower = caption.toLowerCase();
    
    // Check if this is an explicit filename search
    const isFilenameSearch = queryLower.startsWith('file:');
    
    if (isFilenameSearch) {
      // For explicit filename searches, boost filename matches
      const filename = queryLower.replace('file:', '').trim();
      if (captionLower.includes(filename)) {
        boost += 0.8; // Strong boost for explicit filename searches
      }
    } else {
      // For content searches, focus on semantic meaning, not filenames
      // Direct keyword match in caption content - moderate boost
      if (captionLower.includes(queryLower)) {
        boost += 0.3; // Reduced from 0.5 - less emphasis on exact text matches
      }
      
      // Semantic matches - prioritize these over exact text
      const semanticMatches = this.getSemanticMatches(queryLower);
      for (const match of semanticMatches) {
        if (captionLower.includes(match)) {
          boost += 0.4; // Increased from 0.3 - prioritize semantic understanding
        }
      }
    }
    
    return Math.min(boost, 1.0); // Cap at 100% boost
  }

  /**
   * Calculate irrelevance penalty for technical/gaming content in human searches
   */
  private static calculateIrrelevancePenalty(caption: string): number {
    const captionLower = caption.toLowerCase();
    
    // Very strong penalties for clearly irrelevant content
    const highIrrelevanceKeywords = [
      'helmet', 'skull emblem', 'armor', 'warrior', 'soldier',
      'bsod', 'blue screen', 'error', 'crash', 'system failure',
      'truck', 'vehicle', 'highway', 'road'
    ];
    
    const mediumIrrelevanceKeywords = [
      'computer', 'software', 'hardware', 'code', 'programming',
      'terminal', 'console', 'technology', 'digital', 'screen'
    ];
    
    let penalty = 0;
    
    // High penalty keywords - 70% reduction
    for (const keyword of highIrrelevanceKeywords) {
      if (captionLower.includes(keyword)) {
        penalty = Math.max(penalty, 0.7);
      }
    }
    
    // Medium penalty keywords - 30% reduction
    for (const keyword of mediumIrrelevanceKeywords) {
      if (captionLower.includes(keyword)) {
        penalty = Math.max(penalty, 0.3);
      }
    }
    
    return penalty;
  }

  /**
   * Calculate context mismatch penalty
   */
  private static calculateContextMismatch(query: string, caption: string): number {
    // If searching for humans but caption has no human-related terms
    if (this.isHumanRelatedQuery(query)) {
      const hasHumanContext = this.hasHumanContext(caption);
      if (!hasHumanContext) {
        // Strong penalty for complete context mismatch
        return 0.4; // 40% penalty
      }
    }
    
    return 0;
  }

  /**
   * Check if caption has human-related context
   */
  private static hasHumanContext(caption: string): boolean {
    const captionLower = caption.toLowerCase();
    const humanContextKeywords = [
      'woman', 'man', 'person', 'people', 'human', 'girl', 'boy', 
      'lady', 'guy', 'individual', 'face', 'portrait', 'figure',
      'character', 'someone', 'wearing', 'standing', 'sitting'
    ];
    
    return humanContextKeywords.some(keyword => captionLower.includes(keyword));
  }

  /**
   * Get semantic matches for query terms
   */
  private static getSemanticMatches(query: string): string[] {
    const semanticMap: { [key: string]: string[] } = {
      'woman': ['female', 'lady', 'girl', 'person', 'human'],
      'man': ['male', 'guy', 'person', 'human'],
      'person': ['human', 'individual', 'people', 'figure'],
      'people': ['person', 'human', 'individuals', 'group'],
      'human': ['person', 'people', 'individual']
    };
    
    return semanticMap[query] || [];
  }

  /**
   * Check if query is human-related
   */
  private static isHumanRelatedQuery(query: string): boolean {
    const humanKeywords = [
      'woman', 'man', 'person', 'people', 'human', 'girl', 'boy', 
      'lady', 'guy', 'individual', 'face', 'portrait'
    ];
    return humanKeywords.some(keyword => query.includes(keyword));
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private static cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have the same length');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }
}
