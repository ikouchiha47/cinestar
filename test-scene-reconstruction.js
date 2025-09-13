#!/usr/bin/env node

import { spawn } from 'child_process';
import fetch from 'node-fetch';

async function runSqlQuery(query) {
  return new Promise((resolve, reject) => {
    const sqlite = spawn('sqlite3', ['./data/video-rag.db', query]);
    let output = '';
    let error = '';

    sqlite.stdout.on('data', (data) => {
      output += data.toString();
    });

    sqlite.stderr.on('data', (data) => {
      error += data.toString();
    });

    sqlite.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`SQLite error: ${error}`));
      } else {
        resolve(output.trim());
      }
    });
  });
}

const OLLAMA_BASE_URL = 'http://localhost:11434';
const MODELS = ['tinyllama'];

// Test prompts for scene reconstruction
const RECONSTRUCTION_PROMPT = `You are a video scene analyst. Create a concise, single sentence that connects audio, visual, and temporal elements into a coherent narrative.

Input:
- Timestamp: {timestamp}
- Audio: {audio}
- Visual: {visual}
- Previous scene: {previous}

Write one clear sentence (max 50 words) that captures the scene transition and relationships:`;

async function checkDatabase() {
  console.log('🔍 Checking database for c_aa video...\n');
  
  try {
    const query = `
      SELECT 
        video_id,
        COUNT(*) as total_segments,
        COUNT(CASE WHEN transcription IS NOT NULL AND transcription != '' THEN 1 END) as with_transcription,
        COUNT(CASE WHEN caption IS NOT NULL AND caption != '' THEN 1 END) as with_captions,
        COUNT(CASE WHEN embedding IS NOT NULL THEN 1 END) as with_embeddings
      FROM video_segments 
      WHERE video_id LIKE '%c_aa%' 
      GROUP BY video_id;
    `;
    
    const result = await runSqlQuery(query);
    
    if (!result) {
      console.log('❌ No c_aa video found in database');
      return null;
    }

    const lines = result.split('\n').filter(line => line.trim());
    if (lines.length === 0) {
      console.log('❌ No c_aa video found in database');
      return null;
    }

    const [video_id, total_segments, with_transcription, with_captions, with_embeddings] = lines[0].split('|');
    
    console.log(`📊 Video: ${video_id}`);
    console.log(`   Total segments: ${total_segments}`);
    console.log(`   With transcription: ${with_transcription}`);
    console.log(`   With captions: ${with_captions}`);
    console.log(`   With embeddings: ${with_embeddings}`);
    
    if (parseInt(with_transcription) > 0 && parseInt(with_captions) > 0) {
      console.log('✅ Video has content data for testing\n');
      return video_id;
    } else {
      console.log('⚠️  Video lacks transcription or caption data\n');
      return null;
    }
  } catch (error) {
    console.error('Database error:', error);
    return null;
  }
}

async function getSampleSegments(videoId, limit = 5) {
  if (!videoId) {
    // Return mock data if no real data available
    return [
      {
        id: 'mock_1',
        start_time: 10.5,
        end_time: 15.2,
        transcription: 'upbeat jazz music playing, footsteps on wooden floor, crowd chatter',
        caption: 'people dancing in a dimly lit club with colorful stage lights',
        previous_caption: 'man walking down a quiet city street at night'
      },
      {
        id: 'mock_2', 
        start_time: 25.8,
        end_time: 30.1,
        transcription: 'car engine revving, tires screeching, dramatic music',
        caption: 'red sports car speeding through narrow alley between buildings',
        previous_caption: 'people dancing in a dimly lit club with colorful stage lights'
      },
      {
        id: 'mock_3',
        start_time: 45.3,
        end_time: 52.7,
        transcription: 'birds chirping, gentle wind, peaceful ambient sounds',
        caption: 'sunrise over calm lake with mountains in background',
        previous_caption: 'red sports car speeding through narrow alley between buildings'
      }
    ];
  }

  const query = `
    SELECT id, start_time, end_time, transcription, caption
    FROM video_segments 
    WHERE video_id = '${videoId}' 
    AND transcription IS NOT NULL 
    AND caption IS NOT NULL
    ORDER BY start_time 
    LIMIT ${limit};
  `;
  
  const result = await runSqlQuery(query);
  const segments = [];
  
  if (result) {
    const lines = result.split('\n').filter(line => line.trim());
    for (const line of lines) {
      const [id, start_time, end_time, transcription, caption] = line.split('|');
      segments.push({
        id,
        start_time: parseFloat(start_time),
        end_time: parseFloat(end_time),
        transcription,
        caption
      });
    }
  }

  // Add previous context
  for (let i = 0; i < segments.length; i++) {
    if (i > 0) {
      segments[i].previous_caption = segments[i-1].caption;
    } else {
      segments[i].previous_caption = 'beginning of video';
    }
  }

  return segments;
}

async function callOllama(model, prompt) {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model,
        prompt: prompt,
        stream: false,
        options: {
          temperature: 0.7,
          top_p: 0.9,
          max_tokens: 80
        }
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    return data.response?.trim() || 'No response';
  } catch (error) {
    return `Error: ${error.message}`;
  }
}

async function testSceneReconstruction(segments) {
  console.log('🎬 Testing Scene Reconstruction\n');
  
  const results = [];

  for (const segment of segments) {
    console.log(`\n📍 Segment ${segment.id} (${segment.start_time}s - ${segment.end_time}s)`);
    console.log(`🎵 Audio: ${segment.transcription}`);
    console.log(`👁️  Visual: ${segment.caption}`);
    console.log(`⏮️  Previous: ${segment.previous_caption}`);
    
    const prompt = RECONSTRUCTION_PROMPT
      .replace('{timestamp}', `${segment.start_time}s - ${segment.end_time}s`)
      .replace('{audio}', segment.transcription || 'no audio')
      .replace('{visual}', segment.caption || 'no visual')
      .replace('{previous}', segment.previous_caption || 'none');

    const segmentResults = { segment: segment.id, models: {} };

    for (const model of MODELS) {
      console.log(`\n🤖 Testing ${model}...`);
      const startTime = Date.now();
      const response = await callOllama(model, prompt);
      const duration = Date.now() - startTime;
      
      console.log(`📝 ${model}: ${response}`);
      console.log(`⏱️  Time: ${duration}ms`);
      
      segmentResults.models[model] = {
        response: response,
        duration: duration,
        success: !response.startsWith('Error:')
      };
    }
    
    results.push(segmentResults);
    console.log('\n' + '='.repeat(80));
  }

  return results;
}

function analyzeResults(results) {
  console.log('\n📊 ANALYSIS SUMMARY\n');
  
  const modelStats = {};
  MODELS.forEach(model => {
    modelStats[model] = {
      successful: 0,
      total: 0,
      avgDuration: 0,
      totalDuration: 0,
      responses: []
    };
  });

  results.forEach(result => {
    MODELS.forEach(model => {
      const modelResult = result.models[model];
      const stats = modelStats[model];
      
      stats.total++;
      stats.totalDuration += modelResult.duration;
      stats.responses.push(modelResult.response);
      
      if (modelResult.success) {
        stats.successful++;
      }
    });
  });

  MODELS.forEach(model => {
    const stats = modelStats[model];
    stats.avgDuration = stats.totalDuration / stats.total;
    
    console.log(`🤖 ${model.toUpperCase()}`);
    console.log(`   Success rate: ${stats.successful}/${stats.total} (${(stats.successful/stats.total*100).toFixed(1)}%)`);
    console.log(`   Avg response time: ${stats.avgDuration.toFixed(0)}ms`);
    console.log(`   Total time: ${stats.totalDuration}ms`);
    
    // Quality assessment
    const avgLength = stats.responses.reduce((sum, r) => sum + r.length, 0) / stats.responses.length;
    console.log(`   Avg response length: ${avgLength.toFixed(0)} chars`);
    console.log('');
  });

  // Comparison
  if (MODELS.length === 2) {
    const [model1, model2] = MODELS;
    const stats1 = modelStats[model1];
    const stats2 = modelStats[model2];
    
    console.log('🔄 COMPARISON');
    console.log(`Speed: ${stats1.avgDuration < stats2.avgDuration ? model1 : model2} is faster`);
    console.log(`Reliability: ${stats1.successful >= stats2.successful ? model1 : model2} is more reliable`);
  }
}

async function main() {
  console.log('🎥 Scene Reconstruction Test\n');
  
  // Check database
  const videoId = await checkDatabase();
  
  // Get sample segments
  console.log('📋 Loading sample segments...');
  const segments = await getSampleSegments(videoId, 3);
  console.log(`Found ${segments.length} segments for testing\n`);
  
  if (segments.length === 0) {
    console.log('❌ No segments available for testing');
    process.exit(1);
  }

  // Test reconstruction
  const results = await testSceneReconstruction(segments);
  
  // Analyze results
  analyzeResults(results);
  
  console.log('✅ Testing complete!');
  process.exit(0);
}

// Handle cleanup
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down...');
  process.exit(0);
});

main().catch(error => {
  console.error('💥 Script failed:', error);
  process.exit(1);
});
