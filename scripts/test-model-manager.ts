/**
 * Test script for ModelManager
 * Run with: npx ts-node scripts/test-model-manager.ts
 */

import { ModelManager } from '../src/core/model-manager';

async function testModelManager() {
  console.log('🧪 Testing ModelManager...\n');

  const manager = new ModelManager();

  // Test 1: Check if Ollama is running
  console.log('1️⃣ Checking if Ollama is running...');
  const isRunning = await manager.isOllamaRunning();
  console.log(`   ${isRunning ? '✅' : '❌'} Ollama is ${isRunning ? 'running' : 'not running'}\n`);

  if (!isRunning) {
    console.error('❌ Ollama is not running. Please start Ollama and try again.');
    process.exit(1);
  }

  // Test 2: Get installed models
  console.log('2️⃣ Getting installed models...');
  try {
    const installed = await manager.getInstalledModels();
    console.log(`   ✅ Found ${installed.length} installed models:`);
    installed.forEach(model => {
      const size = ModelManager.formatSize(model.size || 0);
      console.log(`      - ${model.name} (${size})`);
    });
    console.log();
  } catch (error) {
    console.error('   ❌ Failed to get installed models:', error);
  }

  // Test 3: Check required models
  console.log('3️⃣ Checking required models...');
  try {
    const { missing, existing, all } = await manager.checkRequiredModels();
    
    console.log(`   📊 Status:`);
    console.log(`      Total required: ${all.length}`);
    console.log(`      Installed: ${existing.length}`);
    console.log(`      Missing: ${missing.length}`);
    
    if (existing.length > 0) {
      console.log(`\n   ✅ Installed models:`);
      existing.forEach(model => {
        console.log(`      - ${model.name} (${model.purpose}) ${model.size}`);
      });
    }
    
    if (missing.length > 0) {
      console.log(`\n   ⚠️  Missing models:`);
      missing.forEach(model => {
        console.log(`      - ${model.name} (${model.purpose}) ${model.size}`);
      });
    }
    console.log();
  } catch (error) {
    console.error('   ❌ Failed to check required models:', error);
  }

  // Test 4: Check specific model
  console.log('4️⃣ Checking specific model (qwen3:4b)...');
  try {
    const exists = await manager.checkModel('qwen3:4b');
    console.log(`   ${exists ? '✅' : '❌'} qwen3:4b is ${exists ? 'installed' : 'not installed'}\n`);
  } catch (error) {
    console.error('   ❌ Failed to check model:', error);
  }

  console.log('✅ All tests completed!\n');
}

// Run tests
testModelManager().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
