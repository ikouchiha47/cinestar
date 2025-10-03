#!/usr/bin/env node

/**
 * Test Moondream vision model with sequential requests to avoid memory issues
 * Tests path-based routing and error handling
 */

import fs from 'fs';

const NGINX_LB_URL = 'http://localhost:9001';
const TEST_IMAGE = './chroma-gather-ui/src/assets/media-placeholder-1.jpg';

async function testVisionSequential() {
  console.log('🧪 [TEST] Testing Moondream vision with sequential requests...');
  console.log(`📍 [TEST] Nginx LB URL: ${NGINX_LB_URL}`);
  
  try {
    // Check if test image exists
    if (!fs.existsSync(TEST_IMAGE)) {
      throw new Error(`Test image not found: ${TEST_IMAGE}`);
    }
    
    // Read and encode image
    const imageBuffer = fs.readFileSync(TEST_IMAGE);
    const base64Image = imageBuffer.toString('base64');
    
    console.log(`📊 [TEST] Image size: ${Math.round(imageBuffer.length / 1024)}KB`);
    
    // Test 1: Check models via /api/ path
    console.log('\n🔍 [TEST] Step 1: Testing /api/ path routing...');
    const modelsResponse = await fetch(`${NGINX_LB_URL}/api/tags`);
    
    if (!modelsResponse.ok) {
      throw new Error(`Failed to fetch models: ${modelsResponse.status} ${modelsResponse.statusText}`);
    }
    
    const models = await modelsResponse.json();
    console.log(`✅ [TEST] /api/ path working! Found ${models.models?.length || 0} models`);
    
    // Test 2: Single vision request
    console.log('\n🎯 [TEST] Step 2: Single Moondream request...');
    
    const singleRequest = {
      model: 'moondream:v2',
      prompt: 'Describe this image briefly in one sentence.',
      images: [base64Image],
      stream: false,
      options: {
        temperature: 0.1,
        num_predict: 50  // Limit tokens to reduce memory usage
      }
    };
    
    const startTime = Date.now();
    const response1 = await fetch(`${NGINX_LB_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(singleRequest)
    });
    
    const duration1 = Date.now() - startTime;
    
    if (!response1.ok) {
      const errorText = await response1.text();
      console.log(`❌ [TEST] Single request failed: ${response1.status} - ${errorText}`);
    } else {
      const result1 = await response1.json();
      console.log(`✅ [TEST] Single request succeeded in ${duration1}ms`);
      console.log(`🎨 [TEST] Caption: "${result1.response}"`);
      
      // Test 3: Sequential requests (not concurrent)
      console.log('\n🔄 [TEST] Step 3: Sequential requests (avoiding memory conflicts)...');
      
      for (let i = 1; i <= 3; i++) {
        console.log(`   🎯 [TEST] Sequential request ${i}/3...`);
        
        const seqRequest = {
          model: 'moondream:v2',
          prompt: `Describe this image (request ${i}).`,
          images: [base64Image],
          stream: false,
          options: {
            temperature: 0.1,
            num_predict: 30
          }
        };
        
        const seqStart = Date.now();
        const seqResponse = await fetch(`${NGINX_LB_URL}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(seqRequest)
        });
        
        const seqDuration = Date.now() - seqStart;
        
        if (!seqResponse.ok) {
          const errorText = await seqResponse.text();
          console.log(`   ❌ Request ${i} failed: ${seqResponse.status} - ${errorText}`);
        } else {
          const seqResult = await seqResponse.json();
          console.log(`   ✅ Request ${i} succeeded in ${seqDuration}ms`);
          console.log(`   📝 Response: "${seqResult.response.substring(0, 60)}..."`);
        }
        
        // Small delay between requests to allow memory cleanup
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    console.log('\n🎉 [TEST] Vision sequential test completed!');
    
  } catch (error) {
    console.error('❌ [TEST] Test failed:', error.message);
    process.exit(1);
  }
}

// Run the test
testVisionSequential().catch(console.error);
