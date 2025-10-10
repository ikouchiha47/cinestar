#!/usr/bin/env node

/**
 * Download whisper model using nodejs-whisper's auto-download feature
 * This will download the base.en model to ~/.cache/nodejs-whisper/
 */

import { nodewhisper } from 'nodejs-whisper';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function downloadModel() {
  console.log('[download-whisper-model] Starting model download...');
  console.log('[download-whisper-model] Model: base.en');
  
  // Create a dummy audio file for the download trigger
  const dummyAudioPath = path.join(__dirname, 'dummy.wav');
  
  // Create a minimal WAV file (1 second of silence)
  const wavHeader = Buffer.from([
    0x52, 0x49, 0x46, 0x46, // "RIFF"
    0x24, 0x00, 0x00, 0x00, // File size - 8
    0x57, 0x41, 0x56, 0x45, // "WAVE"
    0x66, 0x6D, 0x74, 0x20, // "fmt "
    0x10, 0x00, 0x00, 0x00, // Subchunk1Size (16 for PCM)
    0x01, 0x00,             // AudioFormat (1 for PCM)
    0x01, 0x00,             // NumChannels (1 = mono)
    0x80, 0x3E, 0x00, 0x00, // SampleRate (16000)
    0x00, 0x7D, 0x00, 0x00, // ByteRate
    0x02, 0x00,             // BlockAlign
    0x10, 0x00,             // BitsPerSample (16)
    0x64, 0x61, 0x74, 0x61, // "data"
    0x00, 0x00, 0x00, 0x00  // Subchunk2Size (0 for empty)
  ]);
  
  fs.writeFileSync(dummyAudioPath, wavHeader);
  console.log('[download-whisper-model] Created dummy audio file');
  
  try {
    // This will trigger the auto-download of base.en model
    await nodewhisper(dummyAudioPath, {
      modelName: 'base.en',
      autoDownloadModelName: 'base.en', // This triggers the download
      removeWavFileAfterTranscription: true,
      whisperOptions: {
        outputInText: true
      }
    });
    
    console.log('[download-whisper-model] ✅ Model downloaded successfully!');
    console.log('[download-whisper-model] Location: ~/.cache/nodejs-whisper/');
    
  } catch (error) {
    console.error('[download-whisper-model] ❌ Download failed:', error.message);
    process.exit(1);
  } finally {
    // Clean up dummy file
    if (fs.existsSync(dummyAudioPath)) {
      fs.unlinkSync(dummyAudioPath);
      console.log('[download-whisper-model] Cleaned up dummy audio file');
    }
  }
}

downloadModel().catch(error => {
  console.error('[download-whisper-model] Fatal error:', error);
  process.exit(1);
});
