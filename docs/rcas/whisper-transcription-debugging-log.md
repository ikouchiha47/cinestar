# Whisper Transcription Debugging Log

**Investigation Date:** November 2, 2025  
**Related RCAs:** 
- [Whisper ASAR Packaging Fix](./whisper-asar-packaging-fix.md) - Binary execution issue
- [Whisper Configuration Fix](./WHISPER_CONFIG_FIX_SUMMARY.md) - Config state management issue

## Overview
This document chronicles the complete debugging journey for fixing Whisper transcription in the Electron production build, including both the ASAR packaging issues and the configuration state management problems.

## Timeline of Events

### Initial Problem Report
- **Date**: Nov 2, 2025
- **Issue**: Video transcription not working in production Electron app
- **Error**: `Not a directory: /Applications/Cinestar.app/Contents/Resources/app.asar/node_modules/nodejs-whisper/cpp/whisper.cpp/build/bin/whisper-cli`

### Root Cause Analysis

#### Electron ASAR Packaging Behavior
1. Electron packages apps into `app.asar` archive
2. Files inside ASAR are read-only and not executable
3. Native binaries must be in `app.asar.unpacked/` to be executable
4. Node's module resolution loads from ASAR first, even when unpacked version exists

#### nodejs-whisper Package Structure
- Package contains native C++ binary: `whisper-cli`
- Binary location: `node_modules/nodejs-whisper/cpp/whisper.cpp/build/bin/whisper-cli`
- Package uses hardcoded relative paths in `dist/constants.js`

### Attempted Solutions

#### Attempt 1: Postinstall Patch Script
**File**: `scripts/patch-nodejs-whisper.cjs`

**Approach**: Modify `nodejs-whisper/dist/constants.js` at build time to detect ASAR and redirect paths

**Code**:
```javascript
if (process.resourcesPath && process.resourcesPath.includes('app.asar')) {
  const path = require('path');
  const unpackedPath = process.resourcesPath.replace(/app\.asar([/\\]|$)/, 'app.asar.unpacked$1');
  exports.WHISPER_CPP_PATH = path.join(unpackedPath, 'node_modules', 'nodejs-whisper', 'cpp', 'whisper.cpp');
  exports.WHISPER_CPP_MAIN_PATH = path.join(exports.WHISPER_CPP_PATH, 'build', 'bin', 'whisper-cli');
}
```

**Result**: Failed
- Patched file exists in `app.asar.unpacked/node_modules/nodejs-whisper/dist/constants.js`
- Node loads unpatched version from `app.asar/node_modules/nodejs-whisper/dist/constants.js` first
- Patch never executes

**Evidence**:
```bash
$ grep "ELECTRON_ASAR_PATCHED" release/0.1.57/mac-arm64/Cinestar.app/Contents/Resources/app.asar.unpacked/node_modules/nodejs-whisper/dist/constants.js
// ELECTRON_ASAR_PATCHED - Dynamic path resolution for Electron ASAR
```

#### Attempt 2: Module.prototype.require Monkey-patch
**File**: `src/core/nodejs-whisper-bootstrap.ts`

**Approach**: Intercept `require()` calls to patch constants module at runtime

**Code**:
```typescript
Module.prototype.require = function(id: string) {
  const module = originalRequire.apply(this, arguments as any);
  
  if (id === 'nodejs-whisper/dist/constants' || id.endsWith('nodejs-whisper/dist/constants.js')) {
    module.WHISPER_CPP_PATH = whisperCppPath;
    module.WHISPER_CPP_MAIN_PATH = path.join(whisperCppPath, 'build', 'bin', 'whisper-cli');
  }
  
  return module;
};
```

**Result**: Failed
- Constants module already loaded before patch runs
- Monkey-patch installs too late in initialization sequence

#### Attempt 3: Module._resolveFilename Override
**File**: `src/core/nodejs-whisper-bootstrap.ts`

**Approach**: Override Node's module resolution to redirect nodejs-whisper to unpacked folder

**Code**:
```typescript
Module._resolveFilename = function(request: string, parent: any, isMain: boolean) {
  if (request === 'nodejs-whisper' || request.startsWith('nodejs-whisper/')) {
    const unpackedRequest = path.join(unpackedPath, 'node_modules', request);
    return unpackedRequest;
  }
  return originalResolveFilename.call(this, request, parent, isMain);
};
```

**Result**: Failed
- ASAR resolution happens before this override
- Too late in the resolution chain

### Working Solution: WhisperDirectService

#### Approach
Bypass nodejs-whisper package entirely and spawn binary directly

#### Implementation
**File**: `src/core/processors/whisper-direct-service.ts`

**Key Method**:
```typescript
private getWhisperBinaryPath(): string {
  // Check if we have resourcesPath (production DMG)
  if (process.resourcesPath && fs.existsSync(process.resourcesPath)) {
    // Production: Use unpacked binary
    const unpackedPath = process.resourcesPath.replace(/app\.asar.*$/, 'app.asar.unpacked');
    const binaryPath = path.join(
      unpackedPath,
      'node_modules',
      'nodejs-whisper',
      'cpp',
      'whisper.cpp',
      'build',
      'bin',
      process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'
    );
    
    if (!fs.existsSync(binaryPath)) {
      throw new Error(`Whisper binary not found at: ${binaryPath}`);
    }
    
    return binaryPath;
  }
  
  // Development: Try multiple possible locations
  const possiblePaths = [
    path.join(process.cwd(), 'node_modules', 'nodejs-whisper', 'cpp', 'whisper.cpp', 'build', 'bin'),
    path.join(__dirname, '..', '..', '..', 'node_modules', 'nodejs-whisper', 'cpp', 'whisper.cpp', 'build', 'bin'),
  ];
  
  // Try each path...
}
```

#### Why This Works
1. Does not rely on nodejs-whisper's module resolution
2. Directly resolves binary path using `process.resourcesPath`
3. Uses `child_process.spawn()` to execute binary directly
4. No module loading issues

### Debugging Evidence

#### Log Analysis - Build 0.1.57 (before final fix)

**Timestamp**: 2025-11-02T11:36:20

**Logs**:
```
[2025-11-02T11:36:16.976Z] [INFO] [BATCH-MANAGER] 🚀 Starting Phase 0 for /Users/darksied/Downloads/bollywood_copy_11.mp4
[2025-11-02T11:36:20.041Z] [INFO] [WhisperDirect] Using dev binary: /node_modules/nodejs-whisper/cpp/whisper.cpp/build/bin/whisper-cli
[2025-11-02T11:36:20.064Z] [ERROR] [BATCH-MANAGER] ❌ Phase 0 failed for batch 1: Error: No transcription services available
```

**Analysis**:
- Path shows `/node_modules/...` (absolute path starting with `/`)
- This indicates `process.cwd()` returned `/` (root directory)
- Binary does not exist at `/node_modules/nodejs-whisper/...`
- `isAvailable()` returned false, causing "No transcription services available"

#### process.cwd() Behavior in Packaged Electron

**Evidence**:
```
[2025-11-02T11:35:36.533Z] [INFO] [UNIFIED-MIGRATION-DEBUG] process.cwd(): /
```

**Finding**: In packaged Electron apps, `process.cwd()` returns `/` (root), not the project directory

#### Binary Verification

**Command**:
```bash
ls -la /Applications/Cinestar.app/Contents/Resources/app.asar.unpacked/node_modules/ | grep nodejs
```

**Result**: No nodejs-whisper in initial builds

**After Fix**:
```bash
ls release/0.1.57/mac-arm64/Cinestar.app/Contents/Resources/app.asar.unpacked/node_modules/ | grep nodejs
nodejs-whisper
```

**Verification**:
```bash
ls -la node_modules/nodejs-whisper/cpp/whisper.cpp/build/bin/whisper-cli
-rwxr-xr-x@ 1 darksied  staff  809064 Oct 20 02:49 node_modules/nodejs-whisper/cpp/whisper.cpp/build/bin/whisper-cli*
```

Binary exists in development environment.

### Configuration Files

#### electron-builder.json5
```json5
"asarUnpack": [
  "node_modules/sharp/**/*",
  "node_modules/@img/**/*",
  "node_modules/ffmpeg-static/**/*",
  "node_modules/ffprobe-static/**/*",
  "node_modules/sqlite-vec*/**/*",
  "node_modules/better-sqlite3/**/*",
  "node_modules/bindings/**/*",
  "node_modules/file-uri-to-path/**/*",
  "node_modules/nodejs-whisper/**/*"  // Added for whisper binary
]
```

#### vite.config.ts
```typescript
external: [
  'nodejs-whisper',  // Prevent Vite from bundling
  // ... other externals
]
```

### File Structure Comparison

#### Development
```
/Users/darksied/dev/pocs/drillbit/
└── node_modules/
    └── nodejs-whisper/
        ├── dist/
        │   └── constants.js
        └── cpp/
            └── whisper.cpp/
                └── build/
                    └── bin/
                        └── whisper-cli (executable)
```

#### Production (Packaged)
```
/Applications/Cinestar.app/Contents/Resources/
├── app.asar (read-only archive)
│   └── node_modules/
│       └── nodejs-whisper/
│           └── dist/
│               └── constants.js (loaded first by Node)
│
└── app.asar.unpacked/ (extracted files)
    └── node_modules/
        └── nodejs-whisper/
            ├── dist/
            │   └── constants.js (patched, but not loaded)
            └── cpp/
                └── whisper.cpp/
                    └── build/
                        └── bin/
                            └── whisper-cli (executable)
```

### Key Learnings

1. **Node Module Resolution Priority**: Node loads from ASAR before checking unpacked folder
2. **process.cwd() in Electron**: Returns `/` in packaged apps, not project directory
3. **process.resourcesPath**: Reliable way to detect and locate packaged app resources
4. **Patching Limitations**: Cannot reliably patch modules that are loaded from ASAR
5. **Direct Binary Execution**: Most reliable approach for native binaries in Electron

### Final Solution Status

**Implementation**: WhisperDirectService with `process.resourcesPath` detection
**Files Modified**:
- `src/core/processors/whisper-direct-service.ts` (created)
- `src/core/processors/transcription-processor.ts` (updated to use WhisperDirectService)

**Testing Required**:
1. Install DMG: `release/0.1.57/Cinestar-0.1.57-mac.dmg`
2. Upload video file
3. Verify logs show: `[WhisperDirect] Production mode - checking unpacked binary:`
4. Confirm transcription completes without errors

### Related Issues

**Similar Problems Solved**:
- FFmpeg binary resolution (see: `src/core/ffmpeg-bootstrap.ts`)
- Sharp native module (see: electron-builder.json5 asarUnpack)
- sqlite-vec extension (see: electron-builder.json5 asarUnpack)

**Pattern**: All native binaries require unpacking and dynamic path resolution in Electron production builds

## Configuration State Management Issue

After fixing the ASAR packaging issue, a second problem was discovered: transcription was still not running because the configuration state was inconsistent.

**Problem**: Three separate flags (`features.videos`, `aiServices.transcription.modelDownloaded`, `aiServices.transcription.enabled`) were not properly coordinated.

**Solution**: See [Whisper ASAR Packaging Fix RCA](./whisper-asar-packaging-fix.md) for complete details on the binary execution solution, and [Whisper Configuration Fix RCA](./WHISPER_CONFIG_FIX_SUMMARY.md) for config state management details:
- Resource-level tracking implementation
- Config invariants and startup normalization
- Onboarding and settings flow updates
- Production verification results

## Final Status

✅ **ASAR Packaging Issue**: Resolved via WhisperDirectService with dynamic path resolution  
✅ **Configuration Issue**: Resolved via resource tracking and startup normalization  
✅ **Production Verification**: Confirmed working with logs showing successful transcription  
✅ **Database Verification**: 30 batches transcribed, 57,898 characters indexed in FTS

**Test Results** (Nov 2, 2025):
- Video: `bollywood_copy_15.mp4` (21 minutes)
- Batches: 5 (0-300s, 300-600s, 600-900s, 900-1200s, 1200-1309s)
- Transcriptions: All successful (6,643 to 9,051 chars per batch)
- Search indexing: All transcripts in `av_search.db` FTS
- Phase 1 captioning: 4/4 keyframes captioned successfully
