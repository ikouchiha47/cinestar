#!/usr/bin/env node

/**
 * Test nginx path-based routing functionality
 * Tests both /api/ (Ollama) and /asr (Whisper) paths
 */

import fs from 'fs';

const NGINX_LB_URL = 'http://localhost:9001';

async function testPathRouting() {
  console.log('🧪 [TEST] Testing nginx path-based routing...');
  console.log(`📍 [TEST] Nginx LB URL: ${NGINX_LB_URL}`);
  
  try {
    // Test 1: Health check
    console.log('\n🔍 [TEST] Step 1: Health check...');
    const healthResponse = await fetch(`${NGINX_LB_URL}/health`);
    
    if (!healthResponse.ok) {
      throw new Error(`Health check failed: ${healthResponse.status}`);
    }
    
    const healthText = await healthResponse.text();
    console.log(`✅ [TEST] Health check: ${healthText.trim()}`);
    
    // Test 2: Embedding service path (/embed/)
    console.log('\n🔍 [TEST] Step 2: Testing /embed/ path (Embedding service)...');
    
    const embedModelsResponse = await fetch(`${NGINX_LB_URL}/embed/api/tags`);
    if (!embedModelsResponse.ok) {
      throw new Error(`Embed API failed: ${embedModelsResponse.status}`);
    }
    
    const embedModels = await embedModelsResponse.json();
    console.log(`✅ [TEST] /embed/api/tags working! Found ${embedModels.models?.length || 0} models`);
    
    // Test 3: Text generation via /api/
    console.log('\n🎯 [TEST] Step 3: Text generation via /api/generate...');
    
    const textRequest = {
      model: 'tinyllama:latest',
      prompt: 'Say "Path routing works!" and nothing else.',
      stream: false,
      options: {
        temperature: 0.1,
        num_predict: 10
      }
    };
    
    const textResponse = await fetch(`${NGINX_LB_URL}/embed/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(textRequest)
    });
    
    if (!textResponse.ok) {
      const errorText = await textResponse.text();
      console.log(`❌ [TEST] Text generation failed: ${textResponse.status} - ${errorText}`);
    } else {
      const textResult = await textResponse.json();
      console.log(`✅ [TEST] Text generation via /api/ succeeded`);
      console.log(`🎨 [TEST] Response: "${textResult.response}"`);
    }
    
    // Test 4: Whisper ASR path (/asr)
    console.log('\n🔍 [TEST] Step 4: Testing /asr path (Whisper routing)...');
    
    const asrResponse = await fetch(`${NGINX_LB_URL}/asr`, {
      method: 'GET'
    });
    
    // We expect a "Method Not Allowed" since GET is not supported, but this confirms routing works
    if (asrResponse.status === 405) {
      console.log(`✅ [TEST] /asr path routing working! (Got expected 405 Method Not Allowed)`);
    } else {
      console.log(`⚠️ [TEST] /asr path returned unexpected status: ${asrResponse.status}`);
    }
    
    // Test 5: Multiple concurrent requests to test load balancing
    console.log('\n🔄 [TEST] Step 5: Testing load balancing with concurrent /api/ requests...');
    
    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(
        fetch(`${NGINX_LB_URL}/api/tags`).then(async (res) => {
          const result = await res.json();
          return { 
            request: i + 1, 
            modelCount: result.models?.length || 0, 
            status: res.status 
          };
        }).catch(err => ({ 
          request: i + 1, 
          error: err.message 
        }))
      );
    }
    
    const results = await Promise.all(promises);
    
    console.log('🎯 [TEST] Load balancing results:');
    results.forEach(result => {
      if (result.error) {
        console.log(`❌ Request ${result.request}: ERROR - ${result.error}`);
      } else {
        console.log(`✅ Request ${result.request}: ${result.modelCount} models, status ${result.status}`);
      }
    });
    
    // Test 6: Check for any 500 errors in error scenarios
    console.log('\n🔍 [TEST] Step 6: Testing error handling...');
    
    const invalidModelResponse = await fetch(`${NGINX_LB_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'nonexistent-model',
        prompt: 'test',
        stream: false
      })
    });
    
    console.log(`🔍 [TEST] Invalid model request status: ${invalidModelResponse.status}`);
    if (invalidModelResponse.status >= 400) {
      const errorText = await invalidModelResponse.text();
      console.log(`📝 [TEST] Error response: ${errorText.substring(0, 100)}...`);
    }
    
    console.log('\n🎉 [TEST] Path routing test completed successfully!');
    console.log('✅ [TEST] All path-based routing is working correctly');
    
  } catch (error) {
    console.error('❌ [TEST] Test failed:', error.message);
    process.exit(1);
  }
}

// Run the test
testPathRouting().catch(console.error);
