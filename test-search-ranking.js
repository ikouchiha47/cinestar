/**
 * Test script to investigate search ranking algorithm issues
 * Specifically testing why "woman" queries return irrelevant results first
 */

import { MainMediaAPI } from './src/api/main-media-api.ts';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testSearchRanking() {
  try {
    console.log('🔍 Testing search ranking algorithm...');
    
    // Initialize the API
    const dbPath = path.join(__dirname, 'data', 'test-search.db');
    await MainMediaAPI.initialize(dbPath, 'ollama');
    
    console.log('✅ API initialized');
    
    // Test search for "woman" query
    const query = "woman";
    console.log(`\n🔍 Searching for: "${query}"`);
    
    const results = await MainMediaAPI.searchMedia(query, 10);
    
    console.log(`\n📊 Search Results (${results.length} items):`);
    results.forEach((result, index) => {
      console.log(`${index + 1}. ${result.name}`);
      console.log(`   Similarity: ${result.similarity?.toFixed(4) || 'N/A'}`);
      console.log(`   Caption: "${result.caption?.substring(0, 100) || 'No caption'}..."`);
      console.log(`   Path: ${result.path}`);
      console.log('');
    });
    
    // Analyze the results
    console.log('\n🔬 Analysis:');
    const womanRelatedResults = results.filter(result => 
      result.caption?.toLowerCase().includes('woman') || 
      result.caption?.toLowerCase().includes('female') ||
      result.caption?.toLowerCase().includes('girl') ||
      result.name?.toLowerCase().includes('woman')
    );
    
    console.log(`- Woman-related results: ${womanRelatedResults.length}/${results.length}`);
    
    if (womanRelatedResults.length > 0) {
      const avgWomanSimilarity = womanRelatedResults.reduce((sum, r) => sum + (r.similarity || 0), 0) / womanRelatedResults.length;
      console.log(`- Average similarity for woman-related results: ${avgWomanSimilarity.toFixed(4)}`);
      
      const topWomanResult = womanRelatedResults[0];
      const topWomanIndex = results.findIndex(r => r.id === topWomanResult.id);
      console.log(`- Highest ranking woman-related result is at position: ${topWomanIndex + 1}`);
    }
    
    // Check for irrelevant high-ranking results
    const irrelevantKeywords = ['bsod', 'blue screen', 'error', 'warhammer', 'game', 'computer', 'screen'];
    const irrelevantResults = results.filter(result => 
      irrelevantKeywords.some(keyword => 
        result.caption?.toLowerCase().includes(keyword) ||
        result.name?.toLowerCase().includes(keyword)
      )
    );
    
    console.log(`- Potentially irrelevant results in top 10: ${irrelevantResults.length}`);
    irrelevantResults.forEach((result, index) => {
      const position = results.findIndex(r => r.id === result.id) + 1;
      console.log(`  Position ${position}: ${result.name} (${result.similarity?.toFixed(4)})`);
    });
    
  } catch (error) {
    console.error('❌ Error testing search ranking:', error);
  }
}

// Also test embedding generation for the query
async function testQueryEmbedding() {
  try {
    console.log('\n🧠 Testing query embedding generation...');
    
    const query = "woman";
    const embedding = await MainMediaAPI.generateQueryEmbedding(query);
    
    console.log(`Query: "${query}"`);
    console.log(`Embedding dimensions: ${embedding.length}`);
    console.log(`First 10 values: [${Array.from(embedding.slice(0, 10)).map(v => v.toFixed(4)).join(', ')}...]`);
    
    // Test with different woman-related queries
    const queries = ["woman", "female", "girl", "lady", "person"];
    console.log('\n📊 Comparing embeddings for related queries:');
    
    for (const q of queries) {
      const emb = await MainMediaAPI.generateQueryEmbedding(q);
      console.log(`"${q}": [${Array.from(emb.slice(0, 5)).map(v => v.toFixed(4)).join(', ')}...]`);
    }
    
  } catch (error) {
    console.error('❌ Error testing query embedding:', error);
  }
}

async function main() {
  await testSearchRanking();
  await testQueryEmbedding();
  process.exit(0);
}

main().catch(console.error);
