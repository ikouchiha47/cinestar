#!/usr/bin/env node

import { performance } from 'perf_hooks';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// Import both frame analysis services
import { FrameAnalysisService } from './src/core/processors/frame-analysis-service.js';
import { FluentFrameAnalysisService } from './src/core/processors/fluent-frame-analysis-service.js';
import { OptimizedFrameAnalysisService } from './src/core/processors/optimized-frame-analysis-service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Benchmark configuration
const BENCHMARK_CONFIG = {
  testVideoPath: process.argv[2] || './test-video.mp4', // Pass video path as argument
  iterations: 3,
  frameOptions: {
    maxFrames: 20,
    sampleInterval: 30,
    sceneThreshold: 0.15,
    useHardwareAccel: false,
    concurrencyLimit: 4,
    precision: 8
  }
};

class FrameAnalysisBenchmark {
  constructor() {
    this.originalService = new FrameAnalysisService();
    this.fluentService = new FluentFrameAnalysisService();
    this.optimizedService = new OptimizedFrameAnalysisService();
    this.results = [];
  }

  async validateTestVideo() {
    try {
      await fs.access(BENCHMARK_CONFIG.testVideoPath);
      const stats = await fs.stat(BENCHMARK_CONFIG.testVideoPath);
      console.log(`✅ Test video found: ${BENCHMARK_CONFIG.testVideoPath} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
      return true;
    } catch (error) {
      console.error(`❌ Test video not found: ${BENCHMARK_CONFIG.testVideoPath}`);
      console.log('Please provide a valid video file path as the first argument.');
      console.log('Usage: node benchmark-frame-analysis.js /path/to/video.mp4');
      return false;
    }
  }

  async benchmarkService(serviceName, service, method, ...args) {
    console.log(`\n🔄 Benchmarking ${serviceName}...`);
    const times = [];
    const memoryUsage = [];
    
    for (let i = 0; i < BENCHMARK_CONFIG.iterations; i++) {
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }
      
      const memBefore = process.memoryUsage();
      const startTime = performance.now();
      
      try {
        const result = await service[method](...args);
        const endTime = performance.now();
        const memAfter = process.memoryUsage();
        
        const executionTime = endTime - startTime;
        const memoryDelta = memAfter.heapUsed - memBefore.heapUsed;
        
        times.push(executionTime);
        memoryUsage.push(memoryDelta);
        
        console.log(`  Iteration ${i + 1}: ${executionTime.toFixed(2)}ms, ${result.length || 0} frames, Memory: ${(memoryDelta / 1024 / 1024).toFixed(2)}MB`);
      } catch (error) {
        console.error(`  ❌ Iteration ${i + 1} failed:`, error.message);
        times.push(null);
        memoryUsage.push(null);
      }
    }
    
    // Calculate statistics
    const validTimes = times.filter(t => t !== null);
    const validMemory = memoryUsage.filter(m => m !== null);
    
    if (validTimes.length === 0) {
      return {
        serviceName,
        failed: true,
        error: 'All iterations failed'
      };
    }
    
    const avgTime = validTimes.reduce((a, b) => a + b, 0) / validTimes.length;
    const minTime = Math.min(...validTimes);
    const maxTime = Math.max(...validTimes);
    const avgMemory = validMemory.reduce((a, b) => a + b, 0) / validMemory.length;
    
    return {
      serviceName,
      avgTime: avgTime.toFixed(2),
      minTime: minTime.toFixed(2),
      maxTime: maxTime.toFixed(2),
      avgMemory: (avgMemory / 1024 / 1024).toFixed(2),
      successRate: (validTimes.length / BENCHMARK_CONFIG.iterations * 100).toFixed(1)
    };
  }

  async runBenchmarks() {
    console.log('🚀 Starting Frame Analysis Performance Benchmark');
    console.log('=' .repeat(60));
    console.log(`Test Video: ${BENCHMARK_CONFIG.testVideoPath}`);
    console.log(`Iterations: ${BENCHMARK_CONFIG.iterations}`);
    console.log(`Frame Options:`, BENCHMARK_CONFIG.frameOptions);
    
    if (!(await this.validateTestVideo())) {
      return;
    }

    const videoPath = BENCHMARK_CONFIG.testVideoPath;
    const options = BENCHMARK_CONFIG.frameOptions;

    // Benchmark Original FrameAnalysisService
    try {
      const originalResult = await this.benchmarkService(
        'Original FrameAnalysisService',
        this.originalService,
        'analyzeVideoFrames',
        videoPath,
        options
      );
      this.results.push(originalResult);
    } catch (error) {
      console.error('❌ Original service benchmark failed:', error.message);
      this.results.push({
        serviceName: 'Original FrameAnalysisService',
        failed: true,
        error: error.message
      });
    }

    // Benchmark FluentFrameAnalysisService
    try {
      const fluentResult = await this.benchmarkService(
        'Fluent FrameAnalysisService',
        this.fluentService,
        'analyzeVideoScenes',
        videoPath,
        options
      );
      this.results.push(fluentResult);
    } catch (error) {
      console.error('❌ Fluent service benchmark failed:', error.message);
      this.results.push({
        serviceName: 'Fluent FrameAnalysisService',
        failed: true,
        error: error.message
      });
    }

    // Benchmark OptimizedFrameAnalysisService
    try {
      const optimizedResult = await this.benchmarkService(
        'Optimized FrameAnalysisService',
        this.optimizedService,
        'analyzeVideoFrames',
        videoPath,
        options
      );
      this.results.push(optimizedResult);
    } catch (error) {
      console.error('❌ Optimized service benchmark failed:', error.message);
      this.results.push({
        serviceName: 'Optimized FrameAnalysisService',
        failed: true,
        error: error.message
      });
    }

    this.printResults();
    await this.saveResults();
  }

  printResults() {
    console.log('\n📊 BENCHMARK RESULTS');
    console.log('=' .repeat(80));
    
    const successfulResults = this.results.filter(r => !r.failed);
    const failedResults = this.results.filter(r => r.failed);
    
    if (successfulResults.length > 0) {
      console.log('\n✅ Successful Benchmarks:');
      console.log('-'.repeat(80));
      console.log('Service'.padEnd(30) + 'Avg Time'.padEnd(12) + 'Min Time'.padEnd(12) + 'Max Time'.padEnd(12) + 'Memory'.padEnd(10) + 'Success');
      console.log('-'.repeat(80));
      
      successfulResults.forEach(result => {
        console.log(
          result.serviceName.padEnd(30) +
          `${result.avgTime}ms`.padEnd(12) +
          `${result.minTime}ms`.padEnd(12) +
          `${result.maxTime}ms`.padEnd(12) +
          `${result.avgMemory}MB`.padEnd(10) +
          `${result.successRate}%`
        );
      });
      
      // Find fastest service
      const fastest = successfulResults.reduce((prev, current) => 
        parseFloat(prev.avgTime) < parseFloat(current.avgTime) ? prev : current
      );
      
      console.log(`\n🏆 Fastest: ${fastest.serviceName} (${fastest.avgTime}ms avg)`);
      
      // Calculate performance improvements
      const original = successfulResults.find(r => r.serviceName.includes('Original'));
      if (original && successfulResults.length > 1) {
        console.log('\n📈 Performance Improvements vs Original:');
        successfulResults.forEach(result => {
          if (result !== original) {
            const improvement = ((parseFloat(original.avgTime) - parseFloat(result.avgTime)) / parseFloat(original.avgTime) * 100).toFixed(1);
            const memoryChange = ((parseFloat(result.avgMemory) - parseFloat(original.avgMemory)) / parseFloat(original.avgMemory) * 100).toFixed(1);
            console.log(`  ${result.serviceName}: ${improvement > 0 ? '+' : ''}${improvement}% speed, ${memoryChange > 0 ? '+' : ''}${memoryChange}% memory`);
          }
        });
      }
    }
    
    if (failedResults.length > 0) {
      console.log('\n❌ Failed Benchmarks:');
      failedResults.forEach(result => {
        console.log(`  ${result.serviceName}: ${result.error}`);
      });
    }
  }

  async saveResults() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `benchmark-results-${timestamp}.json`;
    const filepath = path.join(__dirname, filename);
    
    const reportData = {
      timestamp: new Date().toISOString(),
      config: BENCHMARK_CONFIG,
      results: this.results,
      system: {
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        memory: process.memoryUsage()
      }
    };
    
    try {
      await fs.writeFile(filepath, JSON.stringify(reportData, null, 2));
      console.log(`\n💾 Results saved to: ${filename}`);
    } catch (error) {
      console.error('❌ Failed to save results:', error.message);
    }
  }
}

// Run benchmark if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const benchmark = new FrameAnalysisBenchmark();
  benchmark.runBenchmarks().catch(console.error);
}

export { FrameAnalysisBenchmark };
