#!/usr/bin/env node

import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import fetch from 'node-fetch';
import FormData from 'form-data';

const VIDEO_PATH = '/Users/darksied/Downloads/bollywood.mp4';
const WHISPER_URL = process.env.WHISPER_LB_HOST ? `http://${process.env.WHISPER_LB_HOST}/asr` : 'http://localhost:9000/asr';
const TEMP_DIR = '/tmp/drillbit_concurrent_test';
const BATCH_DURATION = 300; // 5 minutes (optimal from previous test)

async function ensureTempDir() {
  try {
    await fs.mkdir(TEMP_DIR, { recursive: true });
  } catch (error) {
    // Directory might already exist
  }
}

async function getVideoDuration(videoPath) {
  return new Promise((resolve, reject) => {
    const ffprobe = spawn('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      videoPath
    ]);
    
    let output = '';
    ffprobe.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    ffprobe.on('close', (code) => {
      if (code === 0) {
        try {
          const info = JSON.parse(output);
          const duration = parseFloat(info.format.duration);
          resolve(duration);
        } catch (error) {
          reject(error);
        }
      } else {
        reject(new Error(`ffprobe failed with code ${code}`));
      }
    });
  });
}

async function extractAudioBatch(videoPath, startTime, duration, outputPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-i', videoPath,
      '-ss', startTime.toString(),
      '-y'
    ];
    
    if (duration) {
      args.push('-t', duration.toString());
    }
    
    args.push(
      '-acodec', 'pcm_s16le',
      '-ac', '1',
      '-ar', '16000',
      '-f', 'wav',
      outputPath
    );

    const ffmpeg = spawn('ffmpeg', args);
    const startExtractionTime = Date.now();

    ffmpeg.on('close', (code) => {
      const extractionTime = Date.now() - startExtractionTime;
      if (code === 0) {
        resolve(extractionTime);
      } else {
        reject(new Error(`FFmpeg failed with code ${code}`));
      }
    });

    ffmpeg.on('error', reject);
  });
}

async function transcribeAudioFile(audioPath, batchIndex) {
  const startTime = Date.now();
  
  try {
    const audioBuffer = await fs.readFile(audioPath);
    const fileSizeMB = (audioBuffer.length / 1024 / 1024).toFixed(2);
    
    const formData = new FormData();
    formData.append('audio_file', audioBuffer, {
      filename: path.basename(audioPath),
      contentType: 'audio/wav'
    });
    
    const params = new URLSearchParams({
      output: 'json',
      word_timestamps: 'true',
      language: 'auto'
    });
    
    const url = `${WHISPER_URL}?${params.toString()}`;
    
    const response = await fetch(url, {
      method: 'POST',
      body: formData,
      timeout: 300000
    });
    
    if (!response.ok) {
      throw new Error(`Whisper service responded with ${response.status}: ${response.statusText}`);
    }
    
    const result = await response.json();
    const duration = Date.now() - startTime;
    
    return {
      batchIndex,
      duration,
      textLength: result.text?.length || 0,
      fileSizeMB: parseFloat(fileSizeMB),
      text: result.text || ''
    };
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`❌ Batch ${batchIndex} transcription failed after ${duration}ms:`, error.message);
    throw error;
  }
}

async function testSequentialTranscription(videoDuration) {
  console.log(`\n🔄 Testing SEQUENTIAL 5min batches...`);
  
  const batchCount = Math.ceil(videoDuration / BATCH_DURATION);
  const results = [];
  let totalExtractionTime = 0;
  let totalTranscriptionTime = 0;
  
  const overallStart = Date.now();
  
  for (let i = 0; i < batchCount; i++) {
    const startTime = i * BATCH_DURATION;
    const remainingTime = videoDuration - startTime;
    const actualDuration = Math.min(BATCH_DURATION, remainingTime);
    
    const audioPath = path.join(TEMP_DIR, `seq_batch_${i}.wav`);
    
    console.log(`  📁 Batch ${i + 1}/${batchCount}: Extracting ${actualDuration.toFixed(1)}s...`);
    const extractionTime = await extractAudioBatch(VIDEO_PATH, startTime, actualDuration, audioPath);
    
    console.log(`  🎤 Batch ${i + 1}/${batchCount}: Transcribing...`);
    const transcriptionResult = await transcribeAudioFile(audioPath, i);
    
    results.push({
      ...transcriptionResult,
      extractionTime,
      startTime,
      actualDuration
    });
    
    totalExtractionTime += extractionTime;
    totalTranscriptionTime += transcriptionResult.duration;
    
    // Cleanup
    await fs.unlink(audioPath).catch(() => {});
    
    console.log(`  ✅ Batch ${i + 1}/${batchCount} complete`);
  }
  
  const totalTime = Date.now() - overallStart;
  
  return {
    method: 'Sequential',
    batchCount,
    totalTime,
    totalExtractionTime,
    totalTranscriptionTime,
    results
  };
}

async function testConcurrentTranscription(videoDuration) {
  console.log(`\n🚀 Testing CONCURRENT 5min batches...`);
  
  const batchCount = Math.ceil(videoDuration / BATCH_DURATION);
  
  const overallStart = Date.now();
  
  // Step 1: Extract all audio batches first (sequential - FFmpeg doesn't handle concurrent well)
  console.log(`  📁 Extracting all ${batchCount} audio batches...`);
  const extractionPromises = [];
  let totalExtractionTime = 0;
  
  for (let i = 0; i < batchCount; i++) {
    const startTime = i * BATCH_DURATION;
    const remainingTime = videoDuration - startTime;
    const actualDuration = Math.min(BATCH_DURATION, remainingTime);
    const audioPath = path.join(TEMP_DIR, `conc_batch_${i}.wav`);
    
    const extractionTime = await extractAudioBatch(VIDEO_PATH, startTime, actualDuration, audioPath);
    totalExtractionTime += extractionTime;
    
    console.log(`    ✅ Extracted batch ${i + 1}/${batchCount}`);
  }
  
  // Step 2: Transcribe all batches concurrently
  console.log(`  🎤 Transcribing all ${batchCount} batches CONCURRENTLY...`);
  const transcriptionStart = Date.now();
  
  const transcriptionPromises = [];
  for (let i = 0; i < batchCount; i++) {
    const audioPath = path.join(TEMP_DIR, `conc_batch_${i}.wav`);
    transcriptionPromises.push(
      transcribeAudioFile(audioPath, i).then(result => {
        console.log(`    ✅ Batch ${i + 1} transcription complete (${(result.duration/1000).toFixed(1)}s)`);
        return result;
      })
    );
  }
  
  // Wait for all transcriptions to complete
  const transcriptionResults = await Promise.all(transcriptionPromises);
  const totalTranscriptionTime = Date.now() - transcriptionStart;
  
  // Cleanup all files
  for (let i = 0; i < batchCount; i++) {
    const audioPath = path.join(TEMP_DIR, `conc_batch_${i}.wav`);
    await fs.unlink(audioPath).catch(() => {});
  }
  
  const totalTime = Date.now() - overallStart;
  
  return {
    method: 'Concurrent',
    batchCount,
    totalTime,
    totalExtractionTime,
    totalTranscriptionTime,
    results: transcriptionResults.sort((a, b) => a.batchIndex - b.batchIndex)
  };
}

function formatTime(ms) {
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

async function main() {
  console.log(`🎬 Testing concurrent vs sequential transcription for: ${VIDEO_PATH}`);
  console.log(`🔧 Whisper service: ${WHISPER_URL}`);
  console.log(`📂 Temp directory: ${TEMP_DIR}`);
  console.log(`⏱️  Batch size: ${BATCH_DURATION}s (5 minutes)`);
  
  try {
    await ensureTempDir();
    
    // Get video info
    const videoDuration = await getVideoDuration(VIDEO_PATH);
    console.log(`📹 Video duration: ${videoDuration}s (${formatDuration(videoDuration)})`);
    
    const batchCount = Math.ceil(videoDuration / BATCH_DURATION);
    console.log(`📊 Will create ${batchCount} batches of ${BATCH_DURATION}s each`);
    
    // Test sequential processing
    console.log(`\n${'='.repeat(60)}`);
    const sequentialResult = await testSequentialTranscription(videoDuration);
    
    // Test concurrent processing
    console.log(`\n${'='.repeat(60)}`);
    const concurrentResult = await testConcurrentTranscription(videoDuration);
    
    // Compare results
    console.log(`\n${'='.repeat(80)}`);
    console.log(`📊 CONCURRENT vs SEQUENTIAL COMPARISON`);
    console.log(`${'='.repeat(80)}`);
    
    console.log(`| Method     | Batches | Extraction | Transcription | Total Time | Speed Ratio | Improvement |`);
    console.log(`|------------|---------|------------|---------------|------------|-------------|-------------|`);
    
    const seqSpeedRatio = videoDuration / (sequentialResult.totalTime / 1000);
    const concSpeedRatio = videoDuration / (concurrentResult.totalTime / 1000);
    const improvement = ((sequentialResult.totalTime - concurrentResult.totalTime) / sequentialResult.totalTime * 100);
    
    console.log(`| Sequential | ${sequentialResult.batchCount.toString().padEnd(7)} | ${formatTime(sequentialResult.totalExtractionTime).padEnd(10)} | ${formatTime(sequentialResult.totalTranscriptionTime).padEnd(13)} | ${formatTime(sequentialResult.totalTime).padEnd(10)} | ${seqSpeedRatio.toFixed(2)}x`.padEnd(11) + ` | baseline    |`);
    console.log(`| Concurrent | ${concurrentResult.batchCount.toString().padEnd(7)} | ${formatTime(concurrentResult.totalExtractionTime).padEnd(10)} | ${formatTime(concurrentResult.totalTranscriptionTime).padEnd(13)} | ${formatTime(concurrentResult.totalTime).padEnd(10)} | ${concSpeedRatio.toFixed(2)}x`.padEnd(11) + ` | ${improvement > 0 ? '+' : ''}${improvement.toFixed(1)}%`.padEnd(11) + ` |`);
    
    // Analysis
    console.log(`\n📈 Analysis:`);
    if (improvement > 10) {
      console.log(`🚀 Concurrent processing is ${improvement.toFixed(1)}% faster!`);
      console.log(`💡 Recommendation: Use multiple Whisper containers for better performance`);
      console.log(`🐳 Consider scaling Whisper service to 2-3 containers`);
    } else if (improvement > 0) {
      console.log(`⚡ Concurrent processing is slightly faster (${improvement.toFixed(1)}%)`);
      console.log(`💡 Recommendation: Single Whisper container is sufficient`);
    } else {
      console.log(`⚠️  Sequential processing is actually faster`);
      console.log(`💡 Recommendation: Keep single Whisper container, bottleneck is elsewhere`);
    }
    
    // Detailed timing analysis
    console.log(`\n🔍 Detailed Analysis:`);
    console.log(`  📊 Sequential transcription time: ${formatTime(sequentialResult.totalTranscriptionTime)}`);
    console.log(`  📊 Concurrent transcription time: ${formatTime(concurrentResult.totalTranscriptionTime)}`);
    console.log(`  📊 Concurrent efficiency: ${(sequentialResult.totalTranscriptionTime / concurrentResult.totalTranscriptionTime).toFixed(2)}x`);
    
    if (concurrentResult.totalTranscriptionTime < sequentialResult.totalTranscriptionTime / 2) {
      console.log(`\n🎯 RECOMMENDATION: Add second Whisper container!`);
      console.log(`   The concurrent approach shows significant parallelization benefits.`);
    } else {
      console.log(`\n💡 RECOMMENDATION: Single Whisper container is sufficient.`);
      console.log(`   The bottleneck appears to be the Whisper service capacity, not our batching.`);
    }
    
    // Cleanup
    console.log(`\n🧹 Cleaning up temp directory...`);
    await fs.rmdir(TEMP_DIR, { recursive: true }).catch(() => {});
    
    console.log(`✅ Concurrent transcription test completed!`);
    
  } catch (error) {
    console.error(`❌ Test failed:`, error.message);
    
    // Cleanup on error
    await fs.rmdir(TEMP_DIR, { recursive: true }).catch(() => {});
    
    process.exit(1);
  }
}

// Run the test
main().catch(console.error);
