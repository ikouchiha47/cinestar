#!/usr/bin/env tsx

/**
 * Test script for question-answering transformation
 * Tests TinyLlama's ability to transform natural language questions
 * 
 * Usage: 
 *   npx tsx test-question-transform.ts
 *   npx tsx test-question-transform.ts "your custom question"
 */

import { OllamaProvider } from './src/core/llm-provider';
import { ConfigManager } from './src/core/config';

// Test query sets covering different question types
const TEST_QUERIES = [
  // Video content questions
  "which videos have reference to tamil cinema",
  "what videos talk about technology",
  "show me videos about cooking",
  "where is the scene about mountains",
  "who is talking about artificial intelligence",
  
  // Specific topic questions
  "which videos mention machine learning",
  "what content discusses climate change",
  "videos with references to history",
  "clips about music production",
  
  // Action-based questions
  "where someone is dancing",
  "people dancing in a pub",
  "videos showing people working",
  "what videos have someone explaining code",
  
  // Abstract concept questions
  "videos about innovation",
  "content related to education",
  "discussions on philosophy",
  
  // Simple keyword queries (should pass through mostly unchanged)
  "tamil cinema",
  "machine learning tutorial",
  "cooking recipe"
];

interface TransformResult {
  original: string;
  transformed: string;
  entities: string[];
  success: boolean;
  error?: string;
  timeTaken: number;
}

async function testQuestionTransformation(question: string): Promise<TransformResult> {
  const startTime = Date.now();
  const result: TransformResult = {
    original: question,
    transformed: question,
    entities: [],
    success: false,
    timeTaken: 0
  };

  try {
    const config = ConfigManager.getConfig();
    console.log(`\n${'='.repeat(80)}`);
    console.log(`📝 Testing: "${question}"`);
    console.log(`📡 Endpoint: ${config.ai.embedUrl}`);
    console.log(`🤖 Model: ${config.ai.generalPurposeModel}`);
    
    const llm = new OllamaProvider();
    
    // Test question transformation
    console.log(`\n⏳ Transforming question...`);
    const transformStart = Date.now();
    result.transformed = await llm.transformQuestionToQuery(question);
    const transformTime = Date.now() - transformStart;
    console.log(`✅ Transformed (${transformTime}ms): "${result.transformed}"`);
    
    // Test entity extraction
    console.log(`\n⏳ Extracting entities...`);
    const entityStart = Date.now();
    result.entities = await llm.extractSearchEntities(question);
    const entityTime = Date.now() - entityStart;
    console.log(`🎯 Entities (${entityTime}ms): [${result.entities.join(', ')}]`);
    
    result.success = true;
    result.timeTaken = Date.now() - startTime;
    
    // Show comparison
    console.log(`\n📊 Analysis:`);
    console.log(`   Original length: ${question.length} chars`);
    console.log(`   Transformed length: ${result.transformed.length} chars`);
    console.log(`   Entities extracted: ${result.entities.length}`);
    console.log(`   Total time: ${result.timeTaken}ms`);
    
    if (result.transformed === question) {
      console.log(`   ⚠️  No transformation applied (same as original)`);
    } else {
      console.log(`   ✨ Successfully transformed`);
    }
    
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    result.timeTaken = Date.now() - startTime;
    console.error(`\n❌ Error (${result.timeTaken}ms):`, result.error);
  }

  return result;
}

async function runAllTests() {
  console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║                    Question Transformation Test Suite                         ║
║                                                                               ║
║  Testing Llama 3.2:3b's ability to transform natural language questions      ║
║  into optimized search queries                                               ║
╚═══════════════════════════════════════════════════════════════════════════════╝
`);

  const config = ConfigManager.getConfig();
  console.log(`🔧 Configuration:`);
  console.log(`   Embed URL: ${config.ai.embedUrl}`);
  console.log(`   Search URL: ${config.ai.searchUrl}`);
  console.log(`   Embedding Model: ${config.ai.embeddingModel}`);
  console.log(`   Vision Model: ${config.ai.visionModel}`);
  console.log(`   General Purpose Model: ${config.ai.generalPurposeModel}`);

  // Check if custom question provided
  const customQuestion = process.argv[2];
  const queries = customQuestion ? [customQuestion] : TEST_QUERIES;
  
  console.log(`\n📋 Running ${queries.length} test${queries.length > 1 ? 's' : ''}...\n`);

  const results: TransformResult[] = [];
  
  for (const query of queries) {
    const result = await testQuestionTransformation(query);
    results.push(result);
    
    // Small delay between tests to avoid overwhelming the API
    if (queries.length > 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  // Summary report
  console.log(`\n\n${'='.repeat(80)}`);
  console.log(`📊 SUMMARY REPORT`);
  console.log(`${'='.repeat(80)}\n`);

  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  const avgTime = results.reduce((sum, r) => sum + r.timeTaken, 0) / results.length;
  const transformed = results.filter(r => r.transformed !== r.original).length;

  console.log(`Total tests: ${results.length}`);
  console.log(`✅ Successful: ${successful}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`✨ Transformed: ${transformed} (${((transformed / results.length) * 100).toFixed(1)}%)`);
  console.log(`⏱️  Average time: ${avgTime.toFixed(0)}ms`);

  if (successful > 0) {
    console.log(`\n📋 Transformation Examples:\n`);
    results
      .filter(r => r.success && r.transformed !== r.original)
      .slice(0, 5)
      .forEach((r, i) => {
        console.log(`${i + 1}. "${r.original}"`);
        console.log(`   → "${r.transformed}"`);
        console.log(`   🎯 [${r.entities.join(', ')}]\n`);
      });
  }

  if (failed > 0) {
    console.log(`\n❌ Failed Tests:\n`);
    results
      .filter(r => !r.success)
      .forEach((r, i) => {
        console.log(`${i + 1}. "${r.original}"`);
        console.log(`   Error: ${r.error}\n`);
      });
  }

  // Export results to JSON for further analysis
  const fs = await import('fs');
  const outputPath = './test-results-qa-transform.json';
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`\n💾 Detailed results saved to: ${outputPath}`);
  
  console.log(`\n${'='.repeat(80)}\n`);
}

// Run tests
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllTests().catch(console.error);
}

export { testQuestionTransformation, runAllTests };
