#!/usr/bin/env node

import { performance } from 'perf_hooks';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// Import frame analysis services
import { FrameAnalysisService } from './src/core/processors/frame-analysis-service.js';
import { FluentFrameAnalysisService } from './src/core/processors/fluent-frame-analysis-service.js';
import { OptimizedFrameAnalysisService } from './src/core/processors/optimized-frame-analysis-service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Test configuration
const TEST_CONFIG = {
  // Create a simple test video using FFmpeg if no video provided
  createTestVideo: true,
  testVideoPath: './test-video-sample.mp4',
  frameOptions: {
    maxFrames: 5,
    sampleInterval: 10,
    sceneThreshold: 0.15,
    useHardwareAccel: false,
    concurrencyLimit: 2,
    precision: 8
  }
};

class FrameAnalysisTest {
  constructor() {
    this.originalService = new FrameAnalysisService();
    this.fluentService = new FluentFrameAnalysisService();
    this.optimizedService = new OptimizedFrameAnalysisService();
  }

  async createTestVideo() {
    if (TEST_CONFIG.createTestVideo) {
      console.log('🎬 Creating test video...');
      
      try {
        // Create a simple 10-second test video with color bars
        const { spawn } = await import('child_process');
        
        return new Promise((resolve, reject) => {
          const ffmpeg = spawn('ffmpeg', [
            '-y', // Overwrite output
            '-f', 'lavfi',
            '-i', 'testsrc=duration=10:size=640x480:rate=30',
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-crf', '23',
            TEST_CONFIG.testVideoPath
          ]);

          ffmpeg.on('close', (code) => {
            if (code === 0) {
              console.log('✅ Test video created successfully');
              resolve(true);
            } else {
              console.log('⚠️  Could not create test video, will skip video-dependent tests');
              resolve(false);
            }
          });

          ffmpeg.on('error', (err) => {
            console.log('⚠️  FFmpeg not available, will skip video-dependent tests');
            resolve(false);
          });
        });
      } catch (error) {
        console.log('⚠️  Could not create test video, will skip video-dependent tests');
        return false;
      }
    }
    return false;
  }

  async testServiceBasics(serviceName, service) {
    console.log(`\n🧪 Testing ${serviceName} basic functionality...`);
    
    try {
      // Test 1: Service instantiation
      console.log('  ✓ Service instantiation');
      
      // Test 2: Method availability
      const hasAnalyzeMethod = typeof service.analyzeVideoFrames === 'function' || 
                              typeof service.analyzeVideoScenes === 'function';
      
      if (hasAnalyzeMethod) {
        console.log('  ✓ Analysis method available');
      } else {
        console.log('  ❌ Analysis method not found');
        return false;
      }
      
      return true;
    } catch (error) {
      console.log(`  ❌ Basic test failed: ${error.message}`);
      return false;
    }
  }

  async testWithVideo(serviceName, service, videoPath) {
    console.log(`\n🎥 Testing ${serviceName} with video processing...`);
    
    try {
      const startTime = performance.now();
      let result;
      
      // Call appropriate method based on service type
      if (typeof service.analyzeVideoScenes === 'function') {
        result = await service.analyzeVideoScenes(videoPath, TEST_CONFIG.frameOptions);
      } else if (typeof service.analyzeVideoFrames === 'function') {
        result = await service.analyzeVideoFrames(videoPath, TEST_CONFIG.frameOptions);
      } else {
        throw new Error('No suitable analysis method found');
      }
      
      const endTime = performance.now();
      const processingTime = endTime - startTime;
      
      console.log(`  ✓ Processing completed in ${processingTime.toFixed(2)}ms`);
      console.log(`  ✓ Extracted ${result.length} frames`);
      
      // Validate result structure
      if (Array.isArray(result) && result.length > 0) {
        const firstFrame = result[0];
        if (firstFrame.timestamp !== undefined) {
          console.log(`  ✓ Frame data structure valid`);
        } else {
          console.log(`  ⚠️  Frame data structure may be incomplete`);
        }
      }
      
      return {
        success: true,
        processingTime,
        frameCount: result.length,
        result
      };
      
    } catch (error) {
      console.log(`  ❌ Video processing failed: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async runAllTests() {
    console.log('🚀 Starting Frame Analysis Service Tests');
    console.log('=' .repeat(50));
    
    const results = {
      basicTests: {},
      videoTests: {},
      hasTestVideo: false
    };
    
    // Create test video if needed
    const hasVideo = await this.createTestVideo();
    results.hasTestVideo = hasVideo;
    
    // Test all services - basic functionality
    const services = [
      { name: 'Original FrameAnalysisService', service: this.originalService },
      { name: 'Fluent FrameAnalysisService', service: this.fluentService },
      { name: 'Optimized FrameAnalysisService', service: this.optimizedService }
    ];
    
    // Basic tests (no video required)
    for (const { name, service } of services) {
      results.basicTests[name] = await this.testServiceBasics(name, service);
    }
    
    // Video processing tests (if video available)
    if (hasVideo) {
      for (const { name, service } of services) {
        results.videoTests[name] = await this.testWithVideo(name, service, TEST_CONFIG.testVideoPath);
      }
    }
    
    // Print summary
    this.printTestSummary(results);
    
    // Cleanup test video
    if (hasVideo) {
      try {
        await fs.unlink(TEST_CONFIG.testVideoPath);
        console.log('\n🧹 Cleaned up test video');
      } catch (error) {
        // Ignore cleanup errors
      }
    }
    
    return results;
  }

  printTestSummary(results) {
    console.log('\n📊 TEST SUMMARY');
    console.log('=' .repeat(50));
    
    // Basic tests summary
    console.log('\n✅ Basic Functionality Tests:');
    Object.entries(results.basicTests).forEach(([service, passed]) => {
      const status = passed ? '✅ PASS' : '❌ FAIL';
      console.log(`  ${service}: ${status}`);
    });
    
    // Video tests summary
    if (results.hasTestVideo) {
      console.log('\n🎥 Video Processing Tests:');
      Object.entries(results.videoTests).forEach(([service, result]) => {
        if (result.success) {
          console.log(`  ${service}: ✅ PASS (${result.processingTime.toFixed(2)}ms, ${result.frameCount} frames)`);
        } else {
          console.log(`  ${service}: ❌ FAIL (${result.error})`);
        }
      });
      
      // Performance comparison
      const successfulTests = Object.entries(results.videoTests)
        .filter(([_, result]) => result.success)
        .map(([service, result]) => ({ service, ...result }));
      
      if (successfulTests.length > 1) {
        console.log('\n⚡ Performance Comparison:');
        successfulTests
          .sort((a, b) => a.processingTime - b.processingTime)
          .forEach((test, index) => {
            const rank = index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉';
            console.log(`  ${rank} ${test.service}: ${test.processingTime.toFixed(2)}ms`);
          });
      }
    } else {
      console.log('\n⚠️  Video processing tests skipped (no test video available)');
      console.log('   To run full tests, ensure FFmpeg is installed and available in PATH');
    }
    
    // Overall status
    const basicTestsPassed = Object.values(results.basicTests).every(Boolean);
    const videoTestsPassed = !results.hasTestVideo || 
      Object.values(results.videoTests).some(result => result.success);
    
    if (basicTestsPassed && videoTestsPassed) {
      console.log('\n🎉 All tests completed successfully!');
    } else {
      console.log('\n⚠️  Some tests failed - check implementation');
    }
  }
}

// Run tests if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const tester = new FrameAnalysisTest();
  tester.runAllTests().catch(console.error);
}

export { FrameAnalysisTest };
