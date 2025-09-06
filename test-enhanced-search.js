/**
 * Test script for enhanced vector search algorithm
 */

// Mock data for testing
const mockItems = [
  {
    id: '1',
    name: 'woman-portrait.jpg',
    path: '/images/woman-portrait.jpg',
    caption: 'A beautiful woman with long hair standing in a garden',
    embedding: new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]),
    embeddingStatus: 'completed'
  },
  {
    id: '2', 
    name: 'warhammer-miniature.jpg',
    path: '/images/warhammer-miniature.jpg',
    caption: 'A detailed Warhammer 40k miniature figure painted in blue and gold',
    embedding: new Float32Array([0.2, 0.1, 0.4, 0.3, 0.6]),
    embeddingStatus: 'completed'
  },
  {
    id: '3',
    name: 'bsod-error.jpg', 
    path: '/images/bsod-error.jpg',
    caption: 'Blue screen of death error message on computer screen',
    embedding: new Float32Array([0.3, 0.4, 0.2, 0.1, 0.7]),
    embeddingStatus: 'completed'
  },
  {
    id: '4',
    name: 'lady-walking.jpg',
    path: '/images/lady-walking.jpg', 
    caption: 'An elegant lady walking down a city street',
    embedding: new Float32Array([0.15, 0.25, 0.35, 0.45, 0.55]),
    embeddingStatus: 'completed'
  }
];

// Mock query embedding for "woman"
const queryEmbedding = new Float32Array([0.12, 0.22, 0.32, 0.42, 0.52]);

// Enhanced Vector Search Algorithm (simplified version)
class TestEnhancedVectorSearch {
  static searchSimilar(items, queryEmbedding, query, limit = 10) {
    console.log(`🔍 [TEST] Starting enhanced vector search with ${items.length} items`);
    console.log(`🔍 [TEST] Query: "${query}"`);
    
    const results = [];
    
    for (const item of items) {
      if (!item.embedding || (item.embeddingStatus && item.embeddingStatus !== 'completed')) continue;
      
      const baseSimilarity = this.cosineSimilarity(queryEmbedding, item.embedding);
      const enhancedScore = this.calculateEnhancedScore(baseSimilarity, item.caption || '', query);
      
      results.push({
        id: item.id,
        similarity: enhancedScore.score,
        caption: item.caption || '',
        path: item.path || '',
        name: item.name || ''
      });
      
      console.log(`🔍 [TEST] ${item.name}: Base ${baseSimilarity.toFixed(4)}, Enhanced ${enhancedScore.score.toFixed(4)} ${enhancedScore.factors}`);
    }
    
    const sortedResults = results
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
    
    console.log(`🔍 [TEST] Top ${sortedResults.length} results:`);
    sortedResults.forEach((result, index) => {
      console.log(`  ${index + 1}. ${result.name} (${result.similarity.toFixed(4)}) - "${result.caption.substring(0, 60)}..."`);
    });
    
    return sortedResults;
  }

  static calculateEnhancedScore(baseSimilarity, caption, query) {
    let score = baseSimilarity;
    const factors = [];
    
    const queryLower = query.toLowerCase();
    const captionLower = caption.toLowerCase();
    
    // 1. Strong boost for direct relevance
    const relevanceBoost = this.calculateRelevanceBoost(queryLower, captionLower);
    if (relevanceBoost > 0) {
      score = score * (1 + relevanceBoost);
      factors.push(`relevance:*${(1 + relevanceBoost).toFixed(2)}`);
    }
    
    // 2. Aggressive penalty for irrelevant content
    if (this.isHumanRelatedQuery(queryLower)) {
      const irrelevancePenalty = this.calculateIrrelevancePenalty(captionLower);
      if (irrelevancePenalty > 0) {
        score = score * (1 - irrelevancePenalty);
        factors.push(`irrelevant:*${(1 - irrelevancePenalty).toFixed(2)}`);
      }
    }
    
    // 3. Context mismatch penalty
    const contextMismatch = this.calculateContextMismatch(queryLower, captionLower);
    if (contextMismatch > 0) {
      score = score * (1 - contextMismatch);
      factors.push(`context:*${(1 - contextMismatch).toFixed(2)}`);
    }
    
    return {
      score: Math.max(score, 0),
      factors: factors.length > 0 ? `[${factors.join(', ')}]` : ''
    };
  }

  static calculateRelevanceBoost(query, caption) {
    let boost = 0;
    
    if (caption.includes(query)) {
      boost += 0.5; // 50% boost
    }
    
    const semanticMatches = this.getSemanticMatches(query);
    for (const match of semanticMatches) {
      if (caption.includes(match)) {
        boost += 0.3; // 30% boost per semantic match
      }
    }
    
    return Math.min(boost, 1.0);
  }

  static calculateIrrelevancePenalty(caption) {
    const highIrrelevanceKeywords = [
      'warhammer', 'miniature', 'fantasy', 'game', 'gaming', 'rpg',
      'bsod', 'blue screen', 'error', 'crash', 'system failure'
    ];
    
    const mediumIrrelevanceKeywords = [
      'computer', 'software', 'hardware', 'code', 'programming',
      'terminal', 'console', 'technology', 'digital', 'screen'
    ];
    
    let penalty = 0;
    
    for (const keyword of highIrrelevanceKeywords) {
      if (caption.includes(keyword)) {
        penalty = Math.max(penalty, 0.7); // 70% reduction
      }
    }
    
    for (const keyword of mediumIrrelevanceKeywords) {
      if (caption.includes(keyword)) {
        penalty = Math.max(penalty, 0.3); // 30% reduction
      }
    }
    
    return penalty;
  }

  static calculateContextMismatch(query, caption) {
    if (this.isHumanRelatedQuery(query)) {
      const hasHumanContext = this.hasHumanContext(caption);
      if (!hasHumanContext) {
        return 0.4; // 40% penalty
      }
    }
    return 0;
  }

  static hasHumanContext(caption) {
    const humanContextKeywords = [
      'woman', 'man', 'person', 'people', 'human', 'girl', 'boy', 
      'lady', 'guy', 'individual', 'face', 'portrait', 'figure',
      'character', 'someone', 'wearing', 'standing', 'sitting'
    ];
    
    return humanContextKeywords.some(keyword => caption.includes(keyword));
  }

  static getSemanticMatches(query) {
    const semanticMap = {
      'woman': ['female', 'lady', 'girl', 'person', 'human'],
      'man': ['male', 'guy', 'person', 'human'],
      'person': ['human', 'individual', 'people', 'figure'],
      'people': ['person', 'human', 'individuals', 'group'],
      'human': ['person', 'people', 'individual']
    };
    
    return semanticMap[query] || [];
  }

  static isHumanRelatedQuery(query) {
    const humanKeywords = [
      'woman', 'man', 'person', 'people', 'human', 'girl', 'boy', 
      'lady', 'guy', 'individual', 'face', 'portrait'
    ];
    return humanKeywords.some(keyword => query.includes(keyword));
  }

  static cosineSimilarity(a, b) {
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

// Run the test
console.log('='.repeat(80));
console.log('🧪 TESTING ENHANCED VECTOR SEARCH ALGORITHM');
console.log('='.repeat(80));

console.log('\n📊 BEFORE Enhancement (Base Similarity Only):');
for (const item of mockItems) {
  const baseSim = TestEnhancedVectorSearch.cosineSimilarity(queryEmbedding, item.embedding);
  console.log(`  ${item.name}: ${baseSim.toFixed(4)} - "${item.caption.substring(0, 50)}..."`);
}

console.log('\n🚀 AFTER Enhancement (With Ranking Algorithm):');
const results = TestEnhancedVectorSearch.searchSimilar(mockItems, queryEmbedding, 'woman', 10);

console.log('\n✅ EXPECTED BEHAVIOR:');
console.log('  - Woman/lady images should rank highest');
console.log('  - Warhammer content should be heavily penalized');
console.log('  - BSOD/technical content should be penalized');
console.log('  - Semantic matches (lady = woman) should get boost');

console.log('\n📈 ANALYSIS:');
const womanImages = results.filter(r => r.name.includes('woman') || r.name.includes('lady'));
const irrelevantImages = results.filter(r => r.name.includes('warhammer') || r.name.includes('bsod'));

console.log(`  ✓ Woman/lady images in top results: ${womanImages.length}`);
console.log(`  ✓ Irrelevant images pushed down: ${irrelevantImages.length > 0 ? 'Some still visible' : 'Successfully filtered'}`);

if (results.length > 0) {
  const topResult = results[0];
  if (topResult.name.includes('woman') || topResult.name.includes('lady')) {
    console.log('  🎉 SUCCESS: Relevant content ranks highest!');
  } else {
    console.log('  ⚠️  WARNING: Irrelevant content still ranking highest');
  }
}
