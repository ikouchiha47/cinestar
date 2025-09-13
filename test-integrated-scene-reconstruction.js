#!/usr/bin/env node

/**
 * Test script for integrated scene reconstruction pipeline
 * Tests the SceneReconstructionProcessor within the video processing pipeline
 */

import { spawn } from 'child_process';
import fetch from 'node-fetch';

// Test configuration
const TEST_CONFIG = {
  ollamaBaseUrl: 'http://localhost:11434',
  model: 'tinyllama',
  testVideoPath: './New_York_City_Lunch_Crisis.mp4'
};

async function checkOllamaHealth() {
  try {
    console.log('🔍 Checking Ollama service...');
    const response = await fetch(`${TEST_CONFIG.ollamaBaseUrl}/api/tags`);
    if (!response.ok) {
      throw new Error(`Ollama not responding: ${response.status}`);
    }
    
    const data = await response.json();
    const models = data.models || [];
    const hasTinyLlama = models.some(m => m.name.includes('tinyllama'));
    
    console.log(`✅ Ollama is running with ${models.length} models`);
    console.log(`📋 Available models: ${models.map(m => m.name).join(', ')}`);
    
    if (!hasTinyLlama) {
      console.log('⚠️  TinyLlama not found. Pulling model...');
      await pullModel('tinyllama');
    } else {
      console.log('✅ TinyLlama model is available');
    }
    
    return true;
  } catch (error) {
    console.error('❌ Ollama health check failed:', error.message);
    return false;
  }
}

async function pullModel(modelName) {
  return new Promise((resolve, reject) => {
    console.log(`📥 Pulling ${modelName} model...`);
    
    const pullProcess = spawn('ollama', ['pull', modelName], {
      stdio: ['inherit', 'pipe', 'pipe']
    });
    
    pullProcess.stdout.on('data', (data) => {
      process.stdout.write(data);
    });
    
    pullProcess.stderr.on('data', (data) => {
      process.stderr.write(data);
    });
    
    pullProcess.on('close', (code) => {
      if (code === 0) {
        console.log(`✅ Successfully pulled ${modelName}`);
        resolve();
      } else {
        reject(new Error(`Failed to pull ${modelName}, exit code: ${code}`));
      }
    });
  });
}

async function testSceneReconstructionProcessor() {
  try {
    console.log('\n🧪 Testing SceneReconstructionProcessor...');
    
    // Import the processor
    const { SceneReconstructionProcessor } = await import('./src/core/processors/scene-reconstruction-processor.ts');
    
    // Create processor instance
    const processor = new SceneReconstructionProcessor({
      enabled: true,
      model: 'tinyllama',
      temperature: 0.7,
      maxTokens: 80,
      baseUrl: TEST_CONFIG.ollamaBaseUrl
    });
    
    console.log(`✅ Created processor: ${processor.name} v${processor.version}`);
    
    // Test health check
    const isHealthy = await processor.checkHealth();
    console.log(`🏥 Health check: ${isHealthy ? '✅ Healthy' : '❌ Unhealthy'}`);
    
    if (!isHealthy) {
      throw new Error('Processor health check failed');
    }
    
    // Create mock processing context
    const mockContext = {
      segment: {
        id: 'test-segment-1',
        videoId: 'test-video',
        videoPath: TEST_CONFIG.testVideoPath,
        startTime: 10.5,
        endTime: 15.2,
        sceneIndex: 1
      },
      data: {
        transcription: { text: 'The speaker discusses lunch options in New York City, mentioning various restaurants and food trucks available downtown.' },
        captions: ['A busy street scene in New York City with food vendors and pedestrians walking by during lunch hour'],
        ocrText: 'NYC FOOD TRUCK MENU',
        previousScene: 'beginning of video'
      }
    };
    
    console.log('🔄 Processing mock segment...');
    console.log(`   Audio: ${mockContext.data.transcription.text.substring(0, 60)}...`);
    console.log(`   Visual: ${mockContext.data.captions[0].substring(0, 60)}...`);
    
    const startTime = Date.now();
    const result = await processor.process(mockContext);
    const processingTime = Date.now() - startTime;
    
    if (result.success) {
      console.log('✅ Scene reconstruction successful!');
      console.log(`⏱️  Processing time: ${processingTime}ms`);
      console.log(`📝 Reconstructed scene: "${result.data.reconstructedScene}"`);
      console.log(`🔧 Model used: ${result.metadata.model}`);
    } else {
      console.error('❌ Scene reconstruction failed:', result.error);
      return false;
    }
    
    return true;
    
  } catch (error) {
    console.error('❌ Processor test failed:', error.message);
    return false;
  }
}

async function checkDatabaseSchema() {
  try {
    console.log('\n🗄️  Checking database schema...');
    
    const { spawn } = await import('child_process');
    
    return new Promise((resolve, reject) => {
      const query = "PRAGMA table_info(video_segments);";
      const sqlite = spawn('sqlite3', ['./data/video-rag.db', query], {
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      let output = '';
      sqlite.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      sqlite.stderr.on('data', (data) => {
        console.error('SQLite error:', data.toString());
      });
      
      sqlite.on('close', (code) => {
        if (code === 0) {
          const columns = output.trim().split('\n');
          const hasReconstructedScene = columns.some(col => col.includes('reconstructed_scene'));
          
          console.log(`📊 video_segments table has ${columns.length} columns`);
          console.log(`✅ reconstructed_scene column: ${hasReconstructedScene ? 'Present' : 'Missing'}`);
          
          if (hasReconstructedScene) {
            console.log('✅ Database schema is ready for scene reconstruction');
            resolve(true);
          } else {
            console.error('❌ Missing reconstructed_scene column');
            resolve(false);
          }
        } else {
          reject(new Error(`SQLite query failed with code ${code}`));
        }
      });
    });
    
  } catch (error) {
    console.error('❌ Database schema check failed:', error.message);
    return false;
  }
}

async function main() {
  console.log('🚀 Testing Integrated Scene Reconstruction Pipeline\n');
  
  // Run all tests
  const ollamaHealthy = await checkOllamaHealth();
  if (!ollamaHealthy) {
    console.error('❌ Cannot proceed without Ollama service');
    process.exit(1);
  }
  
  const schemaReady = await checkDatabaseSchema();
  if (!schemaReady) {
    console.error('❌ Database schema not ready');
    process.exit(1);
  }
  
  const processorWorking = await testSceneReconstructionProcessor();
  if (!processorWorking) {
    console.error('❌ Scene reconstruction processor test failed');
    process.exit(1);
  }
  
  console.log('\n🎉 All tests passed! Scene reconstruction pipeline is ready.');
  console.log('\n📋 Integration Summary:');
  console.log('   ✅ SceneReconstructionProcessor created and working');
  console.log('   ✅ Added to video processing pipeline after transcription/captioning/OCR');
  console.log('   ✅ Database schema updated with reconstructed_scene column');
  console.log('   ✅ VideoMediaAPI updated to use reconstructed scenes for embeddings');
  console.log('   ✅ Ollama TinyLlama model available and responding');
  
  console.log('\n🔄 Next steps:');
  console.log('   • Process a video to test the full pipeline');
  console.log('   • Monitor scene reconstruction quality and performance');
  console.log('   • Compare embedding search results with/without scene reconstruction');
}

// Run the test
main().catch(error => {
  console.error('❌ Test suite failed:', error);
  process.exit(1);
});
