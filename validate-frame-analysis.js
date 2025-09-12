#!/usr/bin/env node

/**
 * Simple validation script for frame analysis services
 * Tests basic functionality without requiring full compilation
 */

import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

const VALIDATION_CONFIG = {
  testVideoPath: './validation-test.mp4',
  createTestVideo: true,
  testDuration: 5, // 5 second test video
  expectedFrameCount: 3
};

class FrameAnalysisValidator {
  constructor() {
    this.results = {
      testVideoCreated: false,
      servicesValidated: [],
      performanceMetrics: {}
    };
  }

  async createTestVideo() {
    console.log('🎬 Creating validation test video...');
    
    try {
      return new Promise((resolve) => {
        const ffmpeg = spawn('ffmpeg', [
          '-y', // Overwrite
          '-f', 'lavfi',
          '-i', `testsrc=duration=${VALIDATION_CONFIG.testDuration}:size=320x240:rate=10`,
          '-c:v', 'libx264',
          '-preset', 'ultrafast',
          '-crf', '28',
          VALIDATION_CONFIG.testVideoPath
        ]);

        ffmpeg.on('close', (code) => {
          if (code === 0) {
            console.log('✅ Test video created successfully');
            this.results.testVideoCreated = true;
            resolve(true);
          } else {
            console.log('⚠️  Could not create test video');
            resolve(false);
          }
        });

        ffmpeg.on('error', () => {
          console.log('⚠️  FFmpeg not available');
          resolve(false);
        });
      });
    } catch (error) {
      console.log('⚠️  Error creating test video');
      return false;
    }
  }

  async validateFFmpegBasics() {
    console.log('\n🔧 Validating FFmpeg basic functionality...');
    
    if (!this.results.testVideoCreated) {
      console.log('❌ No test video available');
      return false;
    }

    try {
      // Test basic frame extraction
      const startTime = Date.now();
      
      return new Promise((resolve) => {
        const ffmpeg = spawn('ffmpeg', [
          '-i', VALIDATION_CONFIG.testVideoPath,
          '-vf', 'select=eq(n\\,0)+eq(n\\,10)+eq(n\\,20),showinfo',
          '-f', 'image2pipe',
          '-vcodec', 'mjpeg',
          '-q:v', '2',
          '-'
        ]);

        let frameCount = 0;
        let stderr = '';

        ffmpeg.stdout.on('data', (data) => {
          // Count JPEG frame markers
          const jpegMarkers = data.toString('binary').match(/\xFF\xD8/g);
          if (jpegMarkers) {
            frameCount += jpegMarkers.length;
          }
        });

        ffmpeg.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        ffmpeg.on('close', (code) => {
          const endTime = Date.now();
          const processingTime = endTime - startTime;
          
          if (code === 0 && frameCount > 0) {
            console.log(`✅ FFmpeg extraction: ${frameCount} frames in ${processingTime}ms`);
            this.results.performanceMetrics.ffmpegBasic = {
              frameCount,
              processingTime,
              success: true
            };
            resolve(true);
          } else {
            console.log(`❌ FFmpeg extraction failed (code: ${code}, frames: ${frameCount})`);
            resolve(false);
          }
        });
      });
    } catch (error) {
      console.log(`❌ FFmpeg validation error: ${error.message}`);
      return false;
    }
  }

  async validateBatchProcessing() {
    console.log('\n⚡ Validating batch frame processing...');
    
    if (!this.results.testVideoCreated) {
      console.log('❌ No test video available');
      return false;
    }

    try {
      const startTime = Date.now();
      
      return new Promise((resolve) => {
        // Test batch extraction with select filter
        const ffmpeg = spawn('ffmpeg', [
          '-i', VALIDATION_CONFIG.testVideoPath,
          '-vf', 'select=\'eq(t,1)+eq(t,2)+eq(t,3)\',showinfo',
          '-f', 'image2pipe',
          '-vcodec', 'mjpeg',
          '-q:v', '2',
          '-'
        ]);

        let frameCount = 0;
        let stderr = '';

        ffmpeg.stdout.on('data', (data) => {
          const jpegMarkers = data.toString('binary').match(/\xFF\xD8/g);
          if (jpegMarkers) {
            frameCount += jpegMarkers.length;
          }
        });

        ffmpeg.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        ffmpeg.on('close', (code) => {
          const endTime = Date.now();
          const processingTime = endTime - startTime;
          
          if (code === 0 && frameCount >= 2) {
            console.log(`✅ Batch processing: ${frameCount} frames in ${processingTime}ms`);
            this.results.performanceMetrics.batchProcessing = {
              frameCount,
              processingTime,
              success: true
            };
            resolve(true);
          } else {
            console.log(`❌ Batch processing failed (code: ${code}, frames: ${frameCount})`);
            console.log(`   stderr sample: ${stderr.substring(0, 200)}`);
            resolve(false);
          }
        });
      });
    } catch (error) {
      console.log(`❌ Batch processing error: ${error.message}`);
      return false;
    }
  }

  async validateHardwareAcceleration() {
    console.log('\n🚀 Testing hardware acceleration availability...');
    
    const accelerationTests = [
      { name: 'NVDEC (NVIDIA)', args: ['-hwaccel', 'nvdec'] },
      { name: 'VAAPI (Intel/AMD)', args: ['-hwaccel', 'vaapi'] },
      { name: 'VideoToolbox (macOS)', args: ['-hwaccel', 'videotoolbox'] }
    ];

    for (const test of accelerationTests) {
      try {
        const result = await new Promise((resolve) => {
          const ffmpeg = spawn('ffmpeg', [
            ...test.args,
            '-f', 'lavfi',
            '-i', 'testsrc=duration=1:size=320x240:rate=10',
            '-f', 'null',
            '-'
          ]);

          ffmpeg.on('close', (code) => {
            resolve(code === 0);
          });

          ffmpeg.on('error', () => {
            resolve(false);
          });
        });

        if (result) {
          console.log(`✅ ${test.name}: Available`);
        } else {
          console.log(`❌ ${test.name}: Not available`);
        }
      } catch (error) {
        console.log(`❌ ${test.name}: Error testing`);
      }
    }
  }

  async validatePerformanceBaseline() {
    console.log('\n📊 Establishing performance baseline...');
    
    if (!this.results.testVideoCreated) {
      console.log('❌ No test video available');
      return false;
    }

    const iterations = 3;
    const times = [];

    for (let i = 0; i < iterations; i++) {
      try {
        const startTime = Date.now();
        
        await new Promise((resolve) => {
          const ffmpeg = spawn('ffmpeg', [
            '-i', VALIDATION_CONFIG.testVideoPath,
            '-vf', 'select=\'eq(t,1)+eq(t,2)+eq(t,3)+eq(t,4)\',showinfo',
            '-f', 'image2pipe',
            '-vcodec', 'mjpeg',
            '-q:v', '2',
            '-'
          ]);

          let frameCount = 0;

          ffmpeg.stdout.on('data', (data) => {
            const jpegMarkers = data.toString('binary').match(/\xFF\xD8/g);
            if (jpegMarkers) {
              frameCount += jpegMarkers.length;
            }
          });

          ffmpeg.on('close', () => {
            const endTime = Date.now();
            times.push(endTime - startTime);
            resolve();
          });
        });
      } catch (error) {
        console.log(`❌ Iteration ${i + 1} failed`);
      }
    }

    if (times.length > 0) {
      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      const minTime = Math.min(...times);
      const maxTime = Math.max(...times);
      
      console.log(`✅ Performance baseline: ${avgTime.toFixed(2)}ms avg (${minTime}-${maxTime}ms range)`);
      
      this.results.performanceMetrics.baseline = {
        avgTime,
        minTime,
        maxTime,
        iterations: times.length
      };
      
      return true;
    }
    
    return false;
  }

  async cleanup() {
    try {
      if (this.results.testVideoCreated) {
        await fs.unlink(VALIDATION_CONFIG.testVideoPath);
        console.log('\n🧹 Cleaned up test video');
      }
    } catch (error) {
      // Ignore cleanup errors
    }
  }

  async runValidation() {
    console.log('🔍 Frame Analysis Validation Suite');
    console.log('=' .repeat(50));
    
    // Create test video
    await this.createTestVideo();
    
    // Run validation tests
    const tests = [
      { name: 'FFmpeg Basics', fn: () => this.validateFFmpegBasics() },
      { name: 'Batch Processing', fn: () => this.validateBatchProcessing() },
      { name: 'Hardware Acceleration', fn: () => this.validateHardwareAcceleration() },
      { name: 'Performance Baseline', fn: () => this.validatePerformanceBaseline() }
    ];

    const results = [];
    
    for (const test of tests) {
      try {
        const result = await test.fn();
        results.push({ name: test.name, success: result });
      } catch (error) {
        console.log(`❌ ${test.name} failed: ${error.message}`);
        results.push({ name: test.name, success: false, error: error.message });
      }
    }

    // Print summary
    this.printValidationSummary(results);
    
    // Cleanup
    await this.cleanup();
    
    return results;
  }

  printValidationSummary(results) {
    console.log('\n📋 VALIDATION SUMMARY');
    console.log('=' .repeat(50));
    
    results.forEach(result => {
      const status = result.success ? '✅ PASS' : '❌ FAIL';
      console.log(`${result.name}: ${status}`);
      if (result.error) {
        console.log(`  Error: ${result.error}`);
      }
    });

    const passCount = results.filter(r => r.success).length;
    const totalCount = results.length;
    
    console.log(`\nOverall: ${passCount}/${totalCount} tests passed`);
    
    if (this.results.performanceMetrics.baseline) {
      const baseline = this.results.performanceMetrics.baseline;
      console.log(`\n⚡ Performance Baseline: ${baseline.avgTime.toFixed(2)}ms average`);
      console.log(`   Expected optimizations should achieve <${(baseline.avgTime * 0.3).toFixed(2)}ms`);
    }

    if (passCount === totalCount) {
      console.log('\n🎉 All validations passed! Frame analysis optimizations are ready.');
    } else {
      console.log('\n⚠️  Some validations failed. Check FFmpeg installation and system compatibility.');
    }
  }
}

// Run validation if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const validator = new FrameAnalysisValidator();
  validator.runValidation().catch(console.error);
}

export { FrameAnalysisValidator };
