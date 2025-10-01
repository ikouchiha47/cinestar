#!/usr/bin/env node

import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import fetch from 'node-fetch';
import FormData from 'form-data';

const VIDEO_PATH = '/Users/darksied/Downloads/bollywood.mp4';
const WHISPER_URL = 'http://localhost:9000/asr';
const TEMP_DIR = '/tmp/drillbit_batch_test';

// Batch configuration - reasonable sizes for processing
const BATCH_CONFIGS = [
  { name: '2min batches', durationSeconds: 120, description: 'Small batches for quick feedback' },
  { name: '5min batches', durationSeconds: 300, description: 'Medium batches for balanced processing' },
  { name: '10min batches', durationSeconds: 600, description: 'Large batches for efficiency' },
  { name: 'Full audio', durationSeconds: null, description: 'Single full transcription (baseline)' }
];

async function ensureTempDir() {
  try {
    await fs.mkdir(TEMP_DIR, { recursive: true });
  } catch (error) {
    // Directory might already exist
  }
}

async function getVideoDuration(videoPath) {
  console.log(`⏱️  Getting video duration...`);
  
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
      '-y' // Overwrite output file
    ];
    
    if (duration) {
      args.push('-t', duration.toString());
    }
    
    args.push(
      '-acodec', 'pcm_s16le',
      '-ac', '1', // Mono
      '-ar', '16000', // 16kHz sample rate
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

async function transcribeAudioFile(audioPath, batchIndex = null) {
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
      timeout: 300000 // 5 minute timeout
    });
    
    if (!response.ok) {
      throw new Error(`Whisper service responded with ${response.status}: ${response.statusText}`);
    }
    
    const result = await response.json();
    const duration = Date.now() - startTime;
    
    return {
      duration,
      textLength: result.text?.length || 0,
      fileSizeMB: parseFloat(fileSizeMB),
      text: result.text || '',
      batchIndex
    };
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`❌ Transcription failed for ${audioPath} after ${duration}ms:`, error.message);
    throw error;
  }
}

async function testBatchedTranscription(videoDuration, batchDurationSeconds) {
  console.log(`\n🔄 Testing ${batchDurationSeconds ? `${batchDurationSeconds}s` : 'full'} batches...`);
  
  const results = {
    batches: [],
    totalExtractionTime: 0,
    totalTranscriptionTime: 0,
    totalTextLength: 0,
    batchCount: 0
  };
  
  if (!batchDurationSeconds) {
    // Full audio transcription
    const audioPath = path.join(TEMP_DIR, 'full_audio.wav');
    
    console.log(`  📁 Extracting full audio...`);
    const extractionTime = await extractAudioBatch(VIDEO_PATH, 0, null, audioPath);
    
    console.log(`  🎤 Transcribing full audio...`);
    const transcriptionResult = await transcribeAudioFile(audioPath, 0);
    
    results.totalExtractionTime = extractionTime;
    results.totalTranscriptionTime = transcriptionResult.duration;
    results.totalTextLength = transcriptionResult.textLength;
    results.batchCount = 1;
    results.batches.push({
      index: 0,
      startTime: 0,
      duration: videoDuration,
      extractionTime,
      transcriptionTime: transcriptionResult.duration,
      textLength: transcriptionResult.textLength,
      fileSizeMB: transcriptionResult.fileSizeMB
    });
    
    // Cleanup
    await fs.unlink(audioPath).catch(() => {});
    
  } else {
    // Batched transcription
    const batchCount = Math.ceil(videoDuration / batchDurationSeconds);
    console.log(`  📊 Creating ${batchCount} batches of ${batchDurationSeconds}s each`);
    
    for (let i = 0; i < batchCount; i++) {
      const startTime = i * batchDurationSeconds;
      const remainingTime = videoDuration - startTime;
      const actualDuration = Math.min(batchDurationSeconds, remainingTime);
      
      const audioPath = path.join(TEMP_DIR, `batch_${i}.wav`);
      
      console.log(`  📁 Batch ${i + 1}/${batchCount}: Extracting ${actualDuration.toFixed(1)}s from ${startTime.toFixed(1)}s...`);
      const extractionTime = await extractAudioBatch(VIDEO_PATH, startTime, actualDuration, audioPath);
      
      console.log(`  🎤 Batch ${i + 1}/${batchCount}: Transcribing...`);
      const transcriptionResult = await transcribeAudioFile(audioPath, i);
      
      results.batches.push({
        index: i,
        startTime,
        duration: actualDuration,
        extractionTime,
        transcriptionTime: transcriptionResult.duration,
        textLength: transcriptionResult.textLength,
        fileSizeMB: transcriptionResult.fileSizeMB
      });
      
      results.totalExtractionTime += extractionTime;
      results.totalTranscriptionTime += transcriptionResult.duration;
      results.totalTextLength += transcriptionResult.textLength;
      results.batchCount++;
      
      // Cleanup batch file
      await fs.unlink(audioPath).catch(() => {});
      
      // Show progress
      const progress = ((i + 1) / batchCount * 100).toFixed(1);
      console.log(`  ✅ Batch ${i + 1}/${batchCount} complete (${progress}%)`);
    }
  }
  
  return results;
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
  console.log(`🎬 Testing batched transcription timing for: ${VIDEO_PATH}`);
  console.log(`🔧 Whisper service: ${WHISPER_URL}`);
  console.log(`📂 Temp directory: ${TEMP_DIR}`);
  
  try {
    await ensureTempDir();
    
    // Get video info
    const videoDuration = await getVideoDuration(VIDEO_PATH);
    console.log(`📹 Video duration: ${videoDuration}s (${formatDuration(videoDuration)})`);
    
    const allResults = [];
    
    // Test each batch configuration
    for (const config of BATCH_CONFIGS) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`🧪 Testing: ${config.name} - ${config.description}`);
      console.log(`${'='.repeat(60)}`);
      
      const startTime = Date.now();
      const results = await testBatchedTranscription(videoDuration, config.durationSeconds);
      const totalTime = Date.now() - startTime;
      
      const analysisResult = {
        config: config.name,
        batchSize: config.durationSeconds || 'full',
        batchCount: results.batchCount,
        totalExtractionTime: results.totalExtractionTime,
        totalTranscriptionTime: results.totalTranscriptionTime,
        totalTime: totalTime,
        totalTextLength: results.totalTextLength,
        speedRatio: videoDuration / (totalTime / 1000),
        avgBatchTranscriptionTime: results.totalTranscriptionTime / results.batchCount,
        batches: results.batches
      };
      
      allResults.push(analysisResult);
      
      console.log(`\n📊 Results for ${config.name}:`);
      console.log(`  🔢 Batches: ${results.batchCount}`);
      console.log(`  🎵 Total extraction: ${formatTime(results.totalExtractionTime)}`);
      console.log(`  🎤 Total transcription: ${formatTime(results.totalTranscriptionTime)}`);
      console.log(`  ⏱️  Total time: ${formatTime(totalTime)}`);
      console.log(`  ⚡ Speed ratio: ${analysisResult.speedRatio.toFixed(2)}x`);
      console.log(`  📝 Total text: ${results.totalTextLength} chars`);
      console.log(`  📊 Avg per batch: ${formatTime(analysisResult.avgBatchTranscriptionTime)}`);
    }
    
    // Final comparison
    console.log(`\n${'='.repeat(80)}`);
    console.log(`📊 BATCHED TRANSCRIPTION COMPARISON`);
    console.log(`${'='.repeat(80)}`);
    
    console.log(`| Batch Size | Batches | Extraction | Transcription | Total Time | Speed Ratio | Avg/Batch |`);
    console.log(`|------------|---------|------------|---------------|------------|-------------|-----------|`);
    
    for (const result of allResults) {
      const batchSize = typeof result.batchSize === 'number' ? `${result.batchSize}s` : result.batchSize;
      console.log(`| ${batchSize.padEnd(10)} | ${result.batchCount.toString().padEnd(7)} | ${formatTime(result.totalExtractionTime).padEnd(10)} | ${formatTime(result.totalTranscriptionTime).padEnd(13)} | ${formatTime(result.totalTime).padEnd(10)} | ${result.speedRatio.toFixed(2)}x`.padEnd(11) + ` | ${formatTime(result.avgBatchTranscriptionTime).padEnd(9)} |`);
    }
    
    // Find best performing configuration
    const fastest = allResults.reduce((best, current) => 
      current.totalTime < best.totalTime ? current : best
    );
    
    console.log(`\n🏆 Fastest configuration: ${fastest.config}`);
    console.log(`   ⚡ Total time: ${formatTime(fastest.totalTime)}`);
    console.log(`   🚀 Speed ratio: ${fastest.speedRatio.toFixed(2)}x faster than real-time`);
    
    // Cleanup
    console.log(`\n🧹 Cleaning up temp directory...`);
    await fs.rmdir(TEMP_DIR, { recursive: true }).catch(() => {});
    
    console.log(`✅ Batched transcription test completed!`);
    
  } catch (error) {
    console.error(`❌ Test failed:`, error.message);
    
    // Cleanup on error
    await fs.rmdir(TEMP_DIR, { recursive: true }).catch(() => {});
    
    process.exit(1);
  }
}

// Run the test
main().catch(console.error);
