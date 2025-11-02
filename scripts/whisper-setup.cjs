#!/usr/bin/env node
'use strict';

// Non-interactive Whisper model downloader and builder (CommonJS)
// Emits JSON lines for progress the onboarding UI listens to.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

// Progress reporting for welcome screen
function reportProgress(type, data) {
  try {
    console.log(JSON.stringify({ type, ...data }));
  } catch {
    // noop
  }
}

// Detect CUDA availability
function detectCuda() {
  try {
    const res = spawnSync('nvidia-smi', [], { encoding: 'utf-8' });
    return (res.status === 0);
  } catch (_) {
    return false;
  }
}

const MODELS_LIST = [
  'tiny', 'tiny.en',
  'base', 'base.en',
  'small', 'small.en',
  'medium', 'medium.en',
  'large-v1', 'large', 'large-v3-turbo'
];

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

async function downloadAndBuildWhisper(modelName = 'base.en', useCuda = null) {
  try {
    if (!MODELS_LIST.includes(modelName)) {
      throw new Error(`Invalid model name: ${modelName}. Valid options: ${MODELS_LIST.join(', ')}`);
    }

    const useCudaFlag = useCuda !== null ? useCuda : detectCuda();
    reportProgress('whisper:setup:signal', { status: 'started', model: modelName, cuda: useCudaFlag });

    const whisperCppPath = path.join(__dirname, '..', 'node_modules', 'nodejs-whisper', 'cpp', 'whisper.cpp');
    const scriptDir = path.join(whisperCppPath, 'models');

    const targetModelsPath = getUserWhisperModelsPath();
    try { fs.mkdirSync(targetModelsPath, { recursive: true }); } catch {}

    const modelFile = MODEL_OBJECT[modelName];
    const modelPath = path.join(targetModelsPath, modelFile);

    const binaryName = process.platform === 'win32' ? 'main.exe' : 'main';
    const binaryPath = path.join(whisperCppPath, 'build', 'bin', binaryName);
    const altBinaryPath = path.join(whisperCppPath, 'build', binaryName);
    const isBinaryBuilt = fs.existsSync(binaryPath) || fs.existsSync(altBinaryPath);

    if (fs.existsSync(modelPath)) {
      reportProgress('whisper:setup:progress', { progress: 50, message: 'Model already exists, skipping download' });
    } else {
      reportProgress('whisper:setup:progress', { progress: 10, message: 'Starting model download...' });
      const scriptFile = process.platform === 'win32' ? 'download-ggml-model.cmd' : 'download-ggml-model.sh';
      const scriptPathAbs = path.join(scriptDir, scriptFile);
      if (!fs.existsSync(scriptPathAbs)) {
        throw new Error(`Downloader script not found at ${scriptPathAbs}`);
      }
      try { fs.chmodSync(scriptPathAbs, 0o755); } catch {}
      const dl = spawnSync(scriptPathAbs, [modelName, targetModelsPath], { encoding: 'utf-8' });
      if ((dl.status ?? 1) !== 0) {
        throw new Error(`Model download failed: ${dl.stderr || dl.stdout || 'unknown error'}`);
      }
      reportProgress('whisper:setup:progress', { progress: 60, message: 'Model downloaded successfully' });
    }

    if (isBinaryBuilt) {
      reportProgress('whisper:setup:progress', { progress: 100, message: 'Whisper already built, skipping compilation' });
      reportProgress('whisper:setup:signal', { status: 'completed', model: modelName, cuda: useCudaFlag });
      return {
        success: true,
        model: modelName,
        modelPath,
        cuda: useCudaFlag,
        whisperCppPath,
        alreadyBuilt: true
      };
    }

    reportProgress('whisper:setup:progress', { progress: 70, message: 'Building whisper.cpp...' });

    let cmakeArgs = ['-B', 'build'];
    if (useCudaFlag) cmakeArgs = cmakeArgs.concat(['-DGGML_CUDA=1']);
    const configureResult = spawnSync('cmake', cmakeArgs, { cwd: whisperCppPath, encoding: 'utf-8' });
    if ((configureResult.status ?? 1) !== 0) {
      throw new Error(`CMake configuration failed: ${configureResult.stderr || configureResult.stdout || ''}`);
    }

    reportProgress('whisper:setup:progress', { progress: 85, message: 'Building with CMake...' });
    const buildResult = spawnSync('cmake', ['--build', 'build', '--config', 'Release'], { cwd: whisperCppPath, encoding: 'utf-8' });
    if ((buildResult.status ?? 1) !== 0) {
      throw new Error(`Build failed: ${buildResult.stderr || buildResult.stdout || ''}`);
    }

    reportProgress('whisper:setup:progress', { progress: 100, message: 'Setup complete' });
    reportProgress('whisper:setup:signal', { status: 'completed', model: modelName, cuda: useCudaFlag });

    return { success: true, model: modelName, modelPath, cuda: useCudaFlag, whisperCppPath };
  } catch (error) {
    reportProgress('whisper:setup:signal', { status: 'failed', error: error && error.message ? error.message : String(error) });
    return { success: false, error: error && error.message ? error.message : String(error) };
  }
}

if (require.main === module) {
  const modelName = process.argv[2] || 'base.en';
  const useCuda = process.argv[3] === 'true' ? true : process.argv[3] === 'false' ? false : null;
  downloadAndBuildWhisper(modelName, useCuda).then((result) => {
    if (result && result.success) {
      console.log('✅ Whisper setup completed successfully');
    } else {
      console.error('❌ Whisper setup failed:', result ? result.error : 'Unknown error');
      process.exit(1);
    }
  });
}

module.exports = { downloadAndBuildWhisper };
