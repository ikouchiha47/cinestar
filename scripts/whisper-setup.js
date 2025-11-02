#!/usr/bin/env node

/**
 * Non-interactive Whisper model downloader and builder
 * Accepts model name and CUDA detection via arguments
 * Integrates with welcome screen progress system
 */

import path from 'path';
import shell from 'shelljs';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Constants from nodejs-whisper
const MODELS_LIST = ['tiny', 'tiny.en', 'base', 'base.en', 'small', 'small.en', 'medium', 'medium.en', 'large-v1', 'large', 'large-v3-turbo'];
const MODEL_OBJECT = {
  'tiny': 'ggml-tiny.bin',
  'tiny.en': 'ggml-tiny.en.bin',
  'base': 'ggml-base.bin',
  'base.en': 'ggml-base.en.bin',
  'small': 'ggml-small.bin',
  'small.en': 'ggml-small.en.bin',
  'medium': 'ggml-medium.bin',
  'medium.en': 'ggml-medium.en.bin',
  'large-v1': 'ggml-large-v1.bin',
  'large': 'ggml-large.bin',
  'large-v3-turbo': 'ggml-large-v3-turbo.bin'
};

// Progress reporting for welcome screen
function reportProgress(type, data) {
  console.log(JSON.stringify({ type, ...data }));
}

// Detect CUDA availability
function detectCuda() {
  try {
    const result = shell.exec('nvidia-smi', { silent: true });
    return result.code === 0;
  } catch (error) {
    return false;
  }
}

// Main download and build function
async function downloadAndBuildWhisper(modelName = 'base.en', useCuda = null) {
  try {
    // Validate model name
    if (!MODELS_LIST.includes(modelName)) {
      throw new Error(`Invalid model name: ${modelName}. Valid options: ${MODELS_LIST.join(', ')}`);
    }

    // Auto-detect CUDA if not specified
    const useCudaFlag = useCuda !== null ? useCuda : detectCuda();
    
    reportProgress('whisper:setup:signal', { status: 'started', model: modelName, cuda: useCudaFlag });

    const whisperCppPath = path.join(__dirname, '..', 'node_modules', 'nodejs-whisper', 'cpp', 'whisper.cpp');
    const scriptDir = path.join(whisperCppPath, 'models');

    // Compute target models cache path used by runtime (matches WhisperDirectService)
    function getUserWhisperModelsPath() {
      // macOS: ~/Library/Application Support/Cinestar/whisper-models
      // Linux: ~/.config/Cinestar/whisper-models
      // Windows: %APPDATA%/Cinestar/whisper-models
      if (process.platform === 'win32') {
        const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
        return path.join(appData, 'Cinestar', 'whisper-models');
      }
      const base = process.platform === 'darwin'
        ? path.join(os.homedir(), 'Library', 'Application Support')
        : path.join(os.homedir(), '.config');
      return path.join(base, 'Cinestar', 'whisper-models');
    }
    const targetModelsPath = getUserWhisperModelsPath();

    // Ensure target cache directory exists
    shell.mkdir('-p', targetModelsPath);

    // Check if model already exists
    const modelFile = MODEL_OBJECT[modelName];
    const modelPath = path.join(targetModelsPath, modelFile);
    
    // Check if whisper binary is already built (optional; bundled in production)
    const binaryName = process.platform === 'win32' ? 'main.exe' : 'main';
    const binaryPath = path.join(whisperCppPath, 'build', 'bin', binaryName);
    const altBinaryPath = path.join(whisperCppPath, 'build', binaryName); // Some builds put it here
    const isBinaryBuilt = fs.existsSync(binaryPath) || fs.existsSync(altBinaryPath);
    
    if (fs.existsSync(modelPath)) {
      reportProgress('whisper:setup:progress', { progress: 50, message: 'Model already exists, skipping download' });
    } else {
      reportProgress('whisper:setup:progress', { progress: 10, message: 'Starting model download...' });

      // Locate upstream downloader in whisper.cpp models folder
      const scriptFile = process.platform === 'win32' ? 'download-ggml-model.cmd' : 'download-ggml-model.sh';
      const scriptPathAbs = path.join(scriptDir, scriptFile);

      if (!fs.existsSync(scriptPathAbs)) {
        throw new Error(`Downloader script not found at ${scriptPathAbs}`);
      }

      shell.chmod('+x', scriptPathAbs);

      // Execute download with explicit target models_path (do NOT cd)
      // Usage: download-ggml-model.sh <model> [models_path]
      const quotedTarget = `"${targetModelsPath}"`;
      const cmd = `${scriptPathAbs} ${modelName} ${quotedTarget}`;
      const downloadResult = shell.exec(cmd, { silent: false });
      
      if (downloadResult.code !== 0) {
        throw new Error(`Model download failed: ${downloadResult.stderr}`);
      }

      reportProgress('whisper:setup:progress', { progress: 60, message: 'Model downloaded successfully' });
    }

    // Build whisper.cpp only if not already built
    if (isBinaryBuilt) {
      reportProgress('whisper:setup:progress', { progress: 100, message: 'Whisper already built, skipping compilation' });
      reportProgress('whisper:setup:signal', { status: 'completed', model: modelName, cuda: useCudaFlag });
      
      return {
        success: true,
        model: modelName,
        modelPath: modelPath,
        cuda: useCudaFlag,
        whisperCppPath: whisperCppPath,
        alreadyBuilt: true
      };
    }
    
    reportProgress('whisper:setup:progress', { progress: 70, message: 'Building whisper.cpp...' });
    
    shell.cd(whisperCppPath);

    // Configure CMake
    let configureCommand = 'cmake -B build';
    if (useCudaFlag) {
      configureCommand += ' -DGGML_CUDA=1';
    }

    const configureResult = shell.exec(configureCommand, { silent: false });
    if (configureResult.code !== 0) {
      throw new Error(`CMake configuration failed: ${configureResult.stderr}`);
    }

    reportProgress('whisper:setup:progress', { progress: 85, message: 'Building with CMake...' });

    // Build
    const buildResult = shell.exec('cmake --build build --config Release', { silent: false });
    if (buildResult.code !== 0) {
      throw new Error(`Build failed: ${buildResult.stderr}`);
    }

    reportProgress('whisper:setup:progress', { progress: 100, message: 'Setup complete' });
    reportProgress('whisper:setup:signal', { status: 'completed', model: modelName, cuda: useCudaFlag });

    return {
      success: true,
      model: modelName,
      modelPath: modelPath,
      cuda: useCudaFlag,
      whisperCppPath: whisperCppPath
    };

  } catch (error) {
    reportProgress('whisper:setup:signal', { 
      status: 'failed', 
      error: error.message 
    });
    
    return {
      success: false,
      error: error.message
    };
  }
}

// CLI usage
if (process.argv[1] === __filename) {
  const modelName = process.argv[2] || 'base.en';
  const useCuda = process.argv[3] === 'true' ? true : process.argv[3] === 'false' ? false : null;
  
  downloadAndBuildWhisper(modelName, useCuda).then(result => {
    if (result.success) {
      console.log('✅ Whisper setup completed successfully');
    } else {
      console.error('❌ Whisper setup failed:', result.error);
      process.exit(1);
    }
  });
}

export { downloadAndBuildWhisper };
