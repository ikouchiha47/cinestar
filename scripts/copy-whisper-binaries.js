#!/usr/bin/env node

/**
 * Copy nodejs-whisper binaries and models to resources/ for Electron bundling
 * 
 * This script runs after `npx nodejs-whisper download` to copy the downloaded
 * whisper.cpp binaries and models from the cache directory to our resources/
 * folder so they can be bundled with the Electron app.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// nodejs-whisper stores models in node_modules/nodejs-whisper/cpp/whisper.cpp/models/
const whisperModelsDir = path.join(__dirname, '..', 'node_modules', 'nodejs-whisper', 'cpp', 'whisper.cpp', 'models');
const targetDir = path.join(__dirname, '..', 'resources', 'whisper');

console.log('[copy-whisper-binaries] Starting...');
console.log(`[copy-whisper-binaries] Source: ${whisperModelsDir}`);
console.log(`[copy-whisper-binaries] Target: ${targetDir}`);

// Check if source directory exists
if (!fs.existsSync(whisperModelsDir)) {
  console.error('[copy-whisper-binaries] ❌ Whisper models directory not found!');
  console.error('[copy-whisper-binaries] Expected: node_modules/nodejs-whisper/cpp/whisper.cpp/models/');
  console.error('[copy-whisper-binaries] Run: npm install nodejs-whisper');
  process.exit(1);
}

// Create target directory if it doesn't exist
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
  console.log('[copy-whisper-binaries] Created target directory');
}

// Copy all model files from node_modules to resources
try {
  // Remove old files first
  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true, force: true });
    fs.mkdirSync(targetDir, { recursive: true });
  }
  
  // Copy model files (*.bin)
  const sourceFiles = fs.readdirSync(whisperModelsDir);
  const modelFiles = sourceFiles.filter(f => f.endsWith('.bin'));
  
  if (modelFiles.length === 0) {
    console.error('[copy-whisper-binaries] ❌ No model files found!');
    process.exit(1);
  }
  
  for (const file of modelFiles) {
    const src = path.join(whisperModelsDir, file);
    const dest = path.join(targetDir, file);
    fs.copyFileSync(src, dest);
    console.log(`[copy-whisper-binaries] Copied: ${file}`);
  }
  
  console.log('[copy-whisper-binaries] ✅ Successfully copied whisper binaries and models');
  
  // List what was copied
  const copiedFiles = fs.readdirSync(targetDir);
  console.log('[copy-whisper-binaries] Files copied:');
  copiedFiles.forEach(file => {
    const stats = fs.statSync(path.join(targetDir, file));
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
    console.log(`  - ${file} (${sizeMB} MB)`);
  });
  
} catch (error) {
  console.error('[copy-whisper-binaries] ❌ Failed to copy files:', error.message);
  process.exit(1);
}

console.log('[copy-whisper-binaries] Done!');
