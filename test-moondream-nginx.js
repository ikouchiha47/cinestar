#!/usr/bin/env node

/**
 * Test Moondream image captioning via nginx load balancer (port 9001)
 * This tests that the nginx load balancer correctly routes to Ollama instances
 */

import fs from 'fs';
import path from 'path';

const NGINX_LB_URL = 'http://localhost:9001';
const TEST_IMAGE = './chroma-gather-ui/src/assets/media-placeholder-1.jpg';

async function testMoondreamViaNginx() {
  console.log('🧪 [TEST] Testing Moondream via nginx load balancer...');
  console.log(`📍 [TEST] Nginx LB URL: ${NGINX_LB_URL}`);
  console.log(`🖼️  [TEST] Test image: ${TEST_IMAGE}`);
  
  try {
    // Check if test image exists
    if (!fs.existsSync(TEST_IMAGE)) {
      throw new Error(`Test image not found: ${TEST_IMAGE}`);
    }
    
    // Read and encode image
    const imageBuffer = fs.readFileSync(TEST_IMAGE);
    const base64Image = imageBuffer.toString('base64');
    
    console.log(`📊 [TEST] Image size: ${Math.round(imageBuffer.length / 1024)}KB`);
    
    // Test 1: Check if Moondream model is available
    console.log('\n🔍 [TEST] Step 1: Checking available models...');
    const modelsResponse = await fetch(`${NGINX_LB_URL}/caption/api/tags`);
    
    if (!modelsResponse.ok) {
      throw new Error(`Failed to fetch models: ${modelsResponse.status} ${modelsResponse.statusText}`);
    }
    
    const models = await modelsResponse.json();
    console.log(`✅ [TEST] Available models:`, models.models?.map(m => m.name) || []);
    
    const hasMoondream = models.models?.some(m => m.name.includes('moondream'));
    if (!hasMoondream) {
      console.log('⚠️  [TEST] Moondream not found, attempting to pull...');
      
      // Pull Moondream model
      const pullResponse = await fetch(`${NGINX_LB_URL}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'moondream:v2' })
      });
      
      if (!pullResponse.ok) {
        throw new Error(`Failed to pull Moondream: ${pullResponse.status}`);
      }
      
      console.log('📥 [TEST] Pulling Moondream model... (this may take a while)');
      // Note: In real scenario, we'd stream the response to see progress
    }
    
    // Test 2: Caption the image
    console.log('\n🎯 [TEST] Step 2: Captioning image with Moondream...');
    
    const captionRequest = {
      model: 'moondream:v2',
      prompt: 'Describe this image in detail.',
      images: [base64Image],
      stream: false,
      options: {
        temperature: 0.1,
        top_p: 0.9
      }
    };
    
    const startTime = Date.now();
    const captionResponse = await fetch(`${NGINX_LB_URL}/caption/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(captionRequest)
    });
    
    if (!captionResponse.ok) {
      const errorText = await captionResponse.text();
      throw new Error(`Caption request failed: ${captionResponse.status} ${captionResponse.statusText}\n${errorText}`);
    }
    
    const captionResult = await captionResponse.json();
    const duration = Date.now() - startTime;
    
    console.log(`⏱️  [TEST] Caption generation took: ${duration}ms`);
    console.log(`🎨 [TEST] Generated caption:`);
    console.log(`"${captionResult.response}"`);
    
    // Test 3: Multiple requests to test load balancing
    console.log('\n🔄 [TEST] Step 3: Testing load balancing with multiple requests...');
    
    const promises = [];
    for (let i = 0; i < 3; i++) {
      promises.push(
        fetch(`${NGINX_LB_URL}/caption/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'moondream:v2',
            prompt: `Describe this image briefly (request ${i + 1}).`,
            images: [base64Image],
            stream: false
          })
        }).then(async (res) => {
          const result = await res.json();
          return { request: i + 1, response: result.response, status: res.status };
        }).catch(err => ({ request: i + 1, error: err.message }))
      );
    }
    
    const loadBalanceResults = await Promise.all(promises);
    console.log('🎯 [TEST] Load balancing results:');
    loadBalanceResults.forEach(result => {
      if (result.error) {
        console.log(`❌ Request ${result.request}: ERROR - ${result.error}`);
      } else if (result.response && typeof result.response === 'string') {
        console.log(`✅ Request ${result.request}: "${result.response.substring(0, 80)}..."`);
      } else {
        console.log(`⚠️ Request ${result.request}: Unexpected response format:`, result);
      }
    });
    
    console.log('\n🎉 [TEST] Moondream via nginx load balancer test completed successfully!');
    
  } catch (error) {
    console.error('❌ [TEST] Test failed:', error.message);
    process.exit(1);
  }
}

// Run the test
testMoondreamViaNginx().catch(console.error);
