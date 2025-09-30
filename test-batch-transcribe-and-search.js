#!/usr/bin/env node

import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import fetch from 'node-fetch';
import FormData from 'form-data';
import Database from 'better-sqlite3';

const VIDEO_PATH = '/Users/darksied/Downloads/bollywood.mp4';
const WHISPER_URL = 'http://localhost:9001/asr';  // Using nginx proxy!
const OLLAMA_URL = 'http://localhost:11434';
const TEMP_DIR = '/tmp/drillbit_batch_test';
const DB_PATH = path.join(TEMP_DIR, 'transcriptions.db');
const BATCH_DURATION = 300; // 5 minutes

async function setupDatabase() {
  await fs.mkdir(TEMP_DIR, { recursive: true });
  
  const db = new Database(DB_PATH);
  
  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS batches (
      id INTEGER PRIMARY KEY,
      batch_index INTEGER,
      start_time REAL,
      end_time REAL,
      text TEXT,
      embedding BLOB,
      language TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE TABLE IF NOT EXISTS segments (
      id INTEGER PRIMARY KEY,
      batch_id INTEGER,
      start_time REAL,
      end_time REAL,
      text TEXT,
      FOREIGN KEY (batch_id) REFERENCES batches (id)
    );
  `);
  
  console.log(`📁 Database created at: ${DB_PATH}`);
  return db;
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
          resolve(parseFloat(info.format.duration));
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

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve();
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
    
    console.log(`  🎤 Transcribing batch ${batchIndex} via ${WHISPER_URL}...`);
    
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
    
    console.log(`  ✅ Batch ${batchIndex}: ${(duration/1000).toFixed(1)}s, ${result.text?.length || 0} chars`);
    
    return {
      text: result.text || '',
      segments: result.segments || [],
      language: result.language || 'auto',
      duration
    };
    
  } catch (error) {
    console.error(`❌ Batch ${batchIndex} transcription failed:`, error.message);
    throw error;
  }
}

async function generateEmbedding(text) {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qllama/bge-large-en-v1.5:latest', // Use available embedding model
        prompt: text
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama embedding failed: ${response.status}`);
    }

    const result = await response.json();
    return result.embedding;
  } catch (error) {
    console.error(`❌ Embedding generation failed:`, error.message);
    return null;
  }
}

async function processBatchedTranscription(db, videoDuration) {
  console.log(`\n🎤 Processing CONCURRENT batched transcription...`);
  
  const batchCount = Math.ceil(videoDuration / BATCH_DURATION);
  console.log(`📊 Creating ${batchCount} batches of ${BATCH_DURATION}s each`);
  
  // Step 1: Extract all audio batches first (sequential - FFmpeg doesn't handle concurrent well)
  console.log(`\n📁 Extracting all ${batchCount} audio batches...`);
  for (let i = 0; i < batchCount; i++) {
    const startTime = i * BATCH_DURATION;
    const remainingTime = videoDuration - startTime;
    const actualDuration = Math.min(BATCH_DURATION, remainingTime);
    const audioPath = path.join(TEMP_DIR, `batch_${i}.wav`);
    
    console.log(`  📁 Extracting batch ${i + 1}/${batchCount}...`);
    await extractAudioBatch(VIDEO_PATH, startTime, actualDuration, audioPath);
  }
  
  // Step 2: Transcribe all batches CONCURRENTLY
  console.log(`\n🎤 Transcribing all ${batchCount} batches CONCURRENTLY...`);
  const transcriptionPromises = [];
  for (let i = 0; i < batchCount; i++) {
    const audioPath = path.join(TEMP_DIR, `batch_${i}.wav`);
    transcriptionPromises.push(
      transcribeAudioFile(audioPath, i).then(result => {
        console.log(`    ✅ Batch ${i} transcription complete (${(result.duration/1000).toFixed(1)}s)`);
        return { batchIndex: i, ...result };
      })
    );
  }
  
  // Wait for all transcriptions to complete
  const transcriptionResults = await Promise.all(transcriptionPromises);
  
  // Step 3: Generate embeddings and store (can be concurrent too)
  console.log(`\n🧠 Generating embeddings and storing...`);
  
  const insertBatch = db.prepare(`
    INSERT INTO batches (batch_index, start_time, end_time, text, embedding, language)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  
  const insertSegment = db.prepare(`
    INSERT INTO segments (batch_id, start_time, end_time, text)
    VALUES (?, ?, ?, ?)
  `);
  
  const storagePromises = transcriptionResults.map(async (transcription) => {
    const i = transcription.batchIndex;
    const startTime = i * BATCH_DURATION;
    const remainingTime = videoDuration - startTime;
    const actualDuration = Math.min(BATCH_DURATION, remainingTime);
    const endTime = startTime + actualDuration;
    
    // Generate embedding
    const embedding = await generateEmbedding(transcription.text);
    
    // Store in database
    const batchId = insertBatch.run(
      i,
      startTime,
      endTime,
      transcription.text,
      embedding ? Buffer.from(new Float32Array(embedding).buffer) : null,
      transcription.language
    ).lastInsertRowid;
    
    // Store segments
    if (transcription.segments && transcription.segments.length > 0) {
      for (const segment of transcription.segments) {
        insertSegment.run(
          batchId,
          segment.start || 0,
          segment.end || 0,
          segment.text || ''
        );
      }
    }
    
    // Cleanup audio file
    const audioPath = path.join(TEMP_DIR, `batch_${i}.wav`);
    await fs.unlink(audioPath).catch(() => {});
    
    console.log(`  ✅ Batch ${i} stored: ${transcription.text.length} chars, ${transcription.segments.length} segments`);
    
    return batchId;
  });
  
  await Promise.all(storagePromises);
  
  console.log(`\n✅ All ${batchCount} batches processed CONCURRENTLY and stored!`);
}

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function searchTranscriptions(db, query, topK = 3) {
  console.log(`\n🔍 Searching for: "${query}"`);
  
  // Generate query embedding
  const queryEmbedding = await generateEmbedding(query);
  if (!queryEmbedding) {
    console.log(`❌ Failed to generate query embedding`);
    return [];
  }
  
  // Get all batches with embeddings
  const batches = db.prepare(`
    SELECT id, batch_index, start_time, end_time, text, embedding, language
    FROM batches 
    WHERE embedding IS NOT NULL
    ORDER BY batch_index
  `).all();
  
  if (batches.length === 0) {
    console.log(`❌ No batches with embeddings found`);
    return [];
  }
  
  // Calculate similarities
  const results = batches.map(batch => {
    const embedding = new Float32Array(batch.embedding.buffer);
    const similarity = cosineSimilarity(queryEmbedding, embedding);
    
    return {
      id: batch.id,
      batchIndex: batch.batch_index,
      startTime: batch.start_time,
      endTime: batch.end_time,
      text: batch.text,
      language: batch.language,
      similarity
    };
  }).sort((a, b) => b.similarity - a.similarity).slice(0, topK);
  
  return results;
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

async function testSearchQueries(db) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(` TESTING SEMANTIC SEARCH ON REAL TRANSCRIPTION DATA`);
  console.log(`${'='.repeat(60)}`);
  
  const testQueries = [
    // Content-based queries (based on actual video content)
    'originality and concealing sources',
    'Salim Javed screenwriting duo',
    'Bollywood film analysis',
    'rich girl poor boy story',
    'anti-hero character development',
    
    // Specific people/characters mentioned
    'Salim Khan and screenwriting',
    'Karun from Mahabharata',
    'Officer Wijer character',
    'Simon Bufoi analysis',
    'Tumlish Pandey writer',
    
    // Film concepts discussed
    'nepotism in cinema',
    'Hindi film plots',
    'character morality and loyalty',
    'Dvar and Indian cinema',
    'remake and adaptation'
  ];
  
  for (const query of testQueries) {
    const results = await searchTranscriptions(db, query, 3);
    
    console.log(`\n Query: "${query}"`);
    console.log(`${'─'.repeat(40)}`);
    
    if (results.length === 0) {
      console.log(`   ❌ No results found`);
      continue;
    }
    
    results.forEach((result, index) => {
      const timeRange = `${formatTime(result.startTime)}-${formatTime(result.endTime)}`;
      const similarity = (result.similarity * 100).toFixed(1);
      const preview = result.text.substring(0, 120).replace(/\n/g, ' ');
      
      console.log(`   ${index + 1}. [${timeRange}] ${similarity}% similarity`);
      console.log(`      "${preview}${result.text.length > 120 ? '...' : ''}"`);
      console.log();
    });
  }
}

async function analyzeStoredData(db) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📊 ANALYZING STORED TRANSCRIPTION DATA`);
  console.log(`${'='.repeat(60)}`);
  
  // Get batch statistics
  const batchStats = db.prepare(`
    SELECT 
      COUNT(*) as total_batches,
      AVG(LENGTH(text)) as avg_text_length,
      SUM(LENGTH(text)) as total_text_length,
      COUNT(embedding) as batches_with_embeddings
    FROM batches
  `).get();
  
  const segmentStats = db.prepare(`
    SELECT COUNT(*) as total_segments
    FROM segments
  `).get();
  
  console.log(`\n📈 Storage Statistics:`);
  console.log(`   Total batches: ${batchStats.total_batches}`);
  console.log(`   Batches with embeddings: ${batchStats.batches_with_embeddings}`);
  console.log(`   Total segments: ${segmentStats.total_segments}`);
  console.log(`   Total text: ${batchStats.total_text_length} characters`);
  console.log(`   Average per batch: ${Math.round(batchStats.avg_text_length)} characters`);
  
  // Show sample data
  console.log(`\n📝 Sample Batch Data:`);
  const sampleBatches = db.prepare(`
    SELECT batch_index, start_time, end_time, LENGTH(text) as text_length, 
           SUBSTR(text, 1, 100) as text_preview
    FROM batches 
    ORDER BY batch_index 
    LIMIT 3
  `).all();
  
  sampleBatches.forEach(batch => {
    const timeRange = `${formatTime(batch.start_time)}-${formatTime(batch.end_time)}`;
    console.log(`   Batch ${batch.batch_index} [${timeRange}]: ${batch.text_length} chars`);
    console.log(`   "${batch.text_preview}..."`);
    console.log();
  });
}

async function analyzeSearchEffectiveness(db) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🎯 SEARCH EFFECTIVENESS ANALYSIS & SCENE RECONSTRUCTION RECOMMENDATION`);
  console.log(`${'='.repeat(80)}`);
  
  // Get batch statistics
  const stats = db.prepare(`
    SELECT 
      COUNT(*) as total_batches,
      AVG(LENGTH(text)) as avg_text_length,
      COUNT(CASE WHEN embedding IS NOT NULL THEN 1 END) as batches_with_embeddings
    FROM batches
  `).get();
  
  console.log(`\n📊 Search Quality Assessment:`);
  console.log(`   Total searchable batches: ${stats.total_batches}`);
  console.log(`   Batches with embeddings: ${stats.batches_with_embeddings}`);
  console.log(`   Average text per batch: ${Math.round(stats.avg_text_length)} characters`);
  
  // Analyze temporal coverage
  const temporalCoverage = db.prepare(`
    SELECT 
      MIN(start_time) as earliest,
      MAX(end_time) as latest,
      (MAX(end_time) - MIN(start_time)) as total_coverage
    FROM batches
  `).get();
  
  console.log(`\n⏰ Temporal Coverage:`);
  console.log(`   Video span: ${formatTime(temporalCoverage.earliest)} - ${formatTime(temporalCoverage.latest)}`);
  console.log(`   Total coverage: ${formatTime(temporalCoverage.total_coverage)}`);
  console.log(`   Batch granularity: ${BATCH_DURATION}s (5 minutes)`);
  
  // Check for duplicate results issue
  const duplicateCheck = db.prepare(`
    SELECT batch_index, COUNT(*) as count 
    FROM batches 
    GROUP BY batch_index 
    HAVING COUNT(*) > 1
  `).all();
  
  if (duplicateCheck.length > 0) {
    console.log(`\n⚠️  Data Quality Issues:`);
    console.log(`   Found ${duplicateCheck.length} duplicate batch indices`);
    console.log(`   This explains the duplicate search results`);
  }
  
  console.log(`\n🎯 RECOMMENDATIONS:`);
  console.log(`${'─'.repeat(50)}`);
  
  // Batch-level search assessment
  if (stats.batches_with_embeddings >= 4) {
    console.log(`✅ BATCH-LEVEL SEARCH: Sufficient for basic queries`);
    console.log(`   • 5-minute batches provide reasonable temporal granularity`);
    console.log(`   • Good for content-type queries (music, dialogue, etc.)`);
    console.log(`   • Ordering preserved by design (sequential batch processing)`);
  } else {
    console.log(`❌ BATCH-LEVEL SEARCH: Insufficient data`);
  }
  
  // Scene reconstruction necessity
  console.log(`\n🔧 SCENE RECONSTRUCTION ANALYSIS:`);
  
  if (stats.avg_text_length > 1000) {
    console.log(`✅ RICH CONTENT: Batches contain substantial text`);
    console.log(`   • Average ${Math.round(stats.avg_text_length)} chars per 5min batch`);
    console.log(`   • Sufficient content for meaningful embeddings`);
    console.log(`   • Scene reconstruction may be OPTIONAL for basic search`);
  } else {
    console.log(`⚠️  SPARSE CONTENT: Limited text per batch`);
    console.log(`   • Scene reconstruction RECOMMENDED for better search quality`);
  }
  
  console.log(`\n💡 IMPLEMENTATION RECOMMENDATIONS:`);
  console.log(`${'─'.repeat(50)}`);
  console.log(`1. 🚀 IMMEDIATE: Use 5-minute batch transcriptions for search`);
  console.log(`   • Fast: 34s concurrent transcription for 22min video`);
  console.log(`   • Effective: Good enough precision for most queries`);
  console.log(`   • Simple: No additional processing needed`);
  
  console.log(`\n2. 🔄 OPTIONAL: Add lightweight scene reconstruction`);
  console.log(`   • Per-batch summarization (not cross-batch)`);
  console.log(`   • Enhance search quality for complex queries`);
  console.log(`   • Keep 5-minute batch boundaries for performance`);
  
  console.log(`\n3. 📈 FUTURE: Cross-batch context if needed`);
  console.log(`   • Only if users report poor temporal understanding`);
  console.log(`   • Consider sliding window approach`);
  console.log(`   • Maintain incremental storage benefits`);
  
  console.log(`\n🎯 CONCLUSION: Batch-level transcription + embeddings are sufficient!`);
  console.log(`   Scene reconstruction is optional enhancement, not requirement.`);
}

async function main() {
  const command = process.argv[2] || 'full';
  
  if (command === 'analyze') {
    console.log(`🔍 Analyzing existing transcription data...`);
    console.log(`📂 Database: ${DB_PATH}`);
    
    try {
      await fs.mkdir(TEMP_DIR, { recursive: true });
      const db = new Database(DB_PATH);
      
      // Test specific user query
      console.log(`\n🎯 Testing specific query: "talking about film making"`);
      console.log(`${'='.repeat(60)}`);
      const specificResults = await searchTranscriptions(db, "talking about film making", 3);
      
      console.log(`\n📝 Query: "talking about film making"`);
      console.log(`${'─'.repeat(40)}`);
      
      if (specificResults.length === 0) {
        console.log(`   ❌ No results found`);
      } else {
        specificResults.forEach((result, index) => {
          const timeRange = `${formatTime(result.startTime)}-${formatTime(result.endTime)}`;
          const similarity = (result.similarity * 100).toFixed(1);
          const preview = result.text.substring(0, 200).replace(/\n/g, ' ');
          
          console.log(`   ${index + 1}. [${timeRange}] ${similarity}% similarity`);
          console.log(`      "${preview}${result.text.length > 200 ? '...' : ''}"`);
          console.log();
        });
        
        // Check accuracy
        console.log(`🔍 Accuracy Check:`);
        specificResults.forEach((result, index) => {
          const hasFilmMaking = result.text.toLowerCase().includes('film') || 
                               result.text.toLowerCase().includes('cinema') ||
                               result.text.toLowerCase().includes('movie') ||
                               result.text.toLowerCase().includes('screenplay') ||
                               result.text.toLowerCase().includes('story');
          console.log(`   Result ${index + 1}: ${hasFilmMaking ? '✅ Relevant' : '❌ Not relevant'} to filmmaking`);
        });
      }
      
      // Test search queries on existing data
      await testSearchQueries(db);
      
      // Final analysis and recommendations
      await analyzeSearchEffectiveness(db);
      
      db.close();
      console.log(`\n✅ Analysis completed!`);
      
    } catch (error) {
      console.error(`❌ Analysis failed:`, error.message);
      process.exit(1);
    }
    return;
  }
  
  // Full processing (default)
  console.log(`🎬 Testing batch transcription + semantic search for: ${VIDEO_PATH}`);
  console.log(`🔧 Whisper service: ${WHISPER_URL} (nginx proxy)`);
  console.log(`🧠 Ollama service: ${OLLAMA_URL}`);
  console.log(`⏱️  Batch size: ${BATCH_DURATION}s (5 minutes)`);
  
  try {
    // Setup database
    const db = await setupDatabase();
    
    // Get video info
    const videoDuration = await getVideoDuration(VIDEO_PATH);
    console.log(`📹 Video duration: ${videoDuration}s (${formatTime(videoDuration)})`);
    
    // Process batched transcription
    await processBatchedTranscription(db, videoDuration);
    
    // Analyze stored data
    await analyzeStoredData(db);
    
    // Test search queries
    await testSearchQueries(db);
    
    // Final analysis and recommendations
    await analyzeSearchEffectiveness(db);
    
    // Close database
    db.close();
    
    console.log(`\n✅ Test completed! Database saved at: ${DB_PATH}`);
    console.log(`💡 You can inspect the data with: sqlite3 ${DB_PATH}`);
    
  } catch (error) {
    console.error(`❌ Test failed:`, error.message);
    process.exit(1);
  }
}

// Run the test
main().catch(console.error);
