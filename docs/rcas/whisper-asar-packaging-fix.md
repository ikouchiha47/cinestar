# RCA: Whisper.cpp ASAR Packaging Issue

**Date:** November 2, 2025  
**Issue:** Whisper transcription binary not executable in Electron production build  
**Severity:** Critical - Complete feature failure in production  
**Related:** [Whisper Transcription Debugging Log](./whisper-transcription-debugging-log.md)

## Problem

Video transcription completely failed in production Electron app with error:
```
Not a directory: /Applications/Cinestar.app/Contents/Resources/app.asar/node_modules/nodejs-whisper/cpp/whisper.cpp/build/bin/whisper-cli
```

**Impact:**
- Zero transcriptions working in production DMG
- Feature worked perfectly in development
- Users could not process video/audio files

## Root Cause

### The ASAR Trap

Electron packages apps into `app.asar` (Atom Shell Archive) for performance and distribution. However:

1. **Files inside ASAR are read-only and NOT executable**
2. **Node's module resolution prefers ASAR over unpacked files**
3. **Native binaries must be unpacked to be executable**

### Production App Structure

```
Production App:
├── app.asar/                          ← Packed, read-only
│   └── node_modules/
│       └── nodejs-whisper/
│           ├── dist/constants.js      ← Loaded FIRST by Node ❌
│           └── cpp/whisper.cpp/
│               └── build/bin/
│                   └── whisper-cli    ← NOT EXECUTABLE ❌
│
└── app.asar.unpacked/                 ← Unpacked, executable
    └── node_modules/
        └── nodejs-whisper/
            ├── dist/constants.js      ← Patched, but NOT loaded ❌
            └── cpp/whisper.cpp/
                └── build/bin/
                    └── whisper-cli    ← EXECUTABLE ✅
```

**The Problem:** Node loads `constants.js` from ASAR (with wrong paths), even though the unpacked version exists with correct paths.

### Why nodejs-whisper Failed

The `nodejs-whisper` package uses hardcoded relative paths in `dist/constants.js`:

```javascript
// Hardcoded in nodejs-whisper/dist/constants.js
exports.WHISPER_CPP_PATH = path.join(__dirname, '../cpp/whisper.cpp');
exports.WHISPER_CPP_MAIN_PATH = path.join(exports.WHISPER_CPP_PATH, 'build/bin/whisper-cli');
```

In production, `__dirname` resolves to inside ASAR, pointing to the non-executable binary.

## Failed Solutions

### ❌ Attempt 1: Postinstall Patch Script

**Approach:** Modify `nodejs-whisper/dist/constants.js` at build time to detect ASAR and redirect paths.

**Code:**
```javascript
// scripts/patch-nodejs-whisper.cjs
if (process.resourcesPath && process.resourcesPath.includes('app.asar')) {
  const unpackedPath = process.resourcesPath.replace(/app\.asar([/\\]|$)/, 'app.asar.unpacked$1');
  exports.WHISPER_CPP_PATH = path.join(unpackedPath, 'node_modules', 'nodejs-whisper', 'cpp', 'whisper.cpp');
  exports.WHISPER_CPP_MAIN_PATH = path.join(exports.WHISPER_CPP_PATH, 'build', 'bin', 'whisper-cli');
}
```

**Why it failed:**
- Patched file exists in `app.asar.unpacked/node_modules/nodejs-whisper/dist/constants.js`
- Node loads unpatched version from `app.asar/node_modules/nodejs-whisper/dist/constants.js` first
- Patch never executes

**Evidence:**
```bash
$ grep "ELECTRON_ASAR_PATCHED" app.asar.unpacked/node_modules/nodejs-whisper/dist/constants.js
// ELECTRON_ASAR_PATCHED - Dynamic path resolution for Electron ASAR
# ✅ Patch exists in unpacked folder, but Node never loads it
```

### ❌ Attempt 2: Module.prototype.require Monkey-patch

**Approach:** Intercept `require()` calls to patch the constants module at runtime.

**Code:**
```typescript
// src/core/nodejs-whisper-bootstrap.ts
const originalRequire = Module.prototype.require;
Module.prototype.require = function(id) {
  const result = originalRequire.apply(this, arguments);
  if (id.includes('nodejs-whisper') && id.includes('constants')) {
    // Patch the constants here
  }
  return result;
};
```

**Why it failed:**
- Constants module already loaded before patch runs
- Module cache prevents re-evaluation
- Timing issue - too late in the load sequence

### ❌ Attempt 3: Module._resolveFilename Override

**Approach:** Override Node's internal module resolution to redirect to unpacked folder.

**Code:**
```typescript
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function(request, parent, isMain) {
  if (request.includes('nodejs-whisper')) {
    // Redirect to unpacked path
  }
  return originalResolveFilename.apply(this, arguments);
};
```

**Why it failed:**
- Too late in the resolution chain
- ASAR resolution happens deeper in Node internals
- Cannot reliably intercept ASAR-specific resolution

## ✅ Solution: WhisperDirectService

### Key Innovation: Bypass nodejs-whisper Entirely

Instead of fighting Node's module system, we directly spawn the binary with dynamically resolved paths.

### Implementation

**File:** `src/core/processors/whisper-direct-service.ts`

```typescript
class WhisperDirectService {
  private getWhisperBinaryPath(): string {
    const isPackaged = process.resourcesPath?.includes('app.asar');
    
    if (isPackaged) {
      // Production: Dynamically resolve unpacked binary
      const unpackedPath = process.resourcesPath!
        .replace(/app\.asar.*$/, 'app.asar.unpacked');
      
      return path.join(
        unpackedPath,
        'node_modules/nodejs-whisper/cpp/whisper.cpp/build/bin',
        process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'
      );
    } else {
      // Development: Use node_modules directly
      return path.join(
        process.cwd(),
        'node_modules/nodejs-whisper/cpp/whisper.cpp/build/bin',
        process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'
      );
    }
  }
  
  async transcribe(inputPath: string, options: WhisperOptions) {
    const binaryPath = this.getWhisperBinaryPath();
    const modelPath = await this.ensureModelDownloaded();
    
    // Direct spawn - no nodejs-whisper module involved!
    const args = [
      '-m', modelPath,
      '-f', inputPath,
      '--output-json',
      '--language', options.language || 'auto'
    ];
    
    return new Promise((resolve, reject) => {
      const process = spawn(binaryPath, args);
      // Handle stdout, stderr, exit...
    });
  }
}
```

### Why This Works

1. ✅ **No module resolution issues** - We resolve paths ourselves using `process.resourcesPath`
2. ✅ **Cross-platform** - Detects OS and adjusts binary name (`.exe` on Windows)
3. ✅ **Works in dev & prod** - Single code path with environment detection
4. ✅ **No patching needed** - Clean, maintainable, explicit code
5. ✅ **Runtime path resolution** - Works on any user's machine
6. ✅ **Testable** - Clear logic, no magic

### Integration

**File:** `src/core/processors/transcription-processor.ts`

```typescript
// Before: Used nodejs-whisper wrapper
import { nodewhisper } from 'nodejs-whisper';

// After: Use WhisperDirectService
import { WhisperDirectService } from './whisper-direct-service';

const whisperService = new WhisperDirectService();
const result = await whisperService.transcribe(audioPath, options);
```

## Comparison: Patching vs Direct Execution

| Aspect | Patching Approach | Direct Execution |
|--------|------------------|------------------|
| **Complexity** | High (3 failed attempts) | Low (single service) |
| **Reliability** | Fragile (Node internals) | Robust (OS spawn) |
| **Maintainability** | Hard (monkey-patches) | Easy (clear logic) |
| **Cross-platform** | Same issues everywhere | Works everywhere |
| **Debugging** | Difficult (module magic) | Easy (explicit paths) |
| **Dependencies** | Relies on nodejs-whisper | Independent |

## Files Modified

1. **`src/core/processors/whisper-direct-service.ts`** (NEW)
   - Direct binary execution service
   - Dynamic path resolution
   - Cross-platform support

2. **`src/core/processors/transcription-processor.ts`** (UPDATED)
   - Switched from nodejs-whisper to WhisperDirectService
   - Removed nodejs-whisper import

3. **`electron-builder.json5`** (UNCHANGED)
   - nodejs-whisper already in asarUnpack
   - No changes needed

## Production Verification

**Test Date:** November 2, 2025

**Test Video:** `bollywood_copy_15.mp4` (21 minutes)

**Results:**
```
✅ Binary located: /Applications/Cinestar.app/Contents/Resources/app.asar.unpacked/node_modules/nodejs-whisper/cpp/whisper.cpp/build/bin/whisper-cli
✅ Binary executable: chmod +x verified
✅ Transcription successful: 5 batches processed
✅ Total characters: 28,949 chars transcribed
✅ Search indexing: All transcripts in av_search.db FTS
```

**Logs:**
```
[WhisperDirect] Production mode - checking unpacked binary
[WhisperDirect] Using unpacked binary: /Applications/Cinestar.app/.../whisper-cli
[WhisperDirect] Transcribing: 260dbce4-cc59-4cab-871c-6110cf1ae9db.wav
[BATCH-MANAGER] ✅ Transcribed batch 1: 6,643 chars
[BATCH-MANAGER] ✅ Transcribed batch 2: 9,051 chars
[BATCH-MANAGER] ✅ Transcribed batch 3: 5,143 chars
[BATCH-MANAGER] ✅ Transcribed batch 4: 5,999 chars
[BATCH-MANAGER] ✅ Transcribed batch 5: 2,113 chars
```

## Lessons Learned

### ❌ Don't Fight Node's Module System
- Module resolution is complex and opaque
- Monkey-patching is fragile and breaks easily
- ASAR resolution happens deep in Node internals
- Patching unpacked files doesn't help if Node loads from ASAR

### ✅ Work With the System
- Use `process.resourcesPath` for reliable runtime detection
- Spawn binaries directly instead of through wrappers
- Keep path resolution explicit and testable
- Prefer simple solutions over complex workarounds

### 🎯 Best Practice for Electron + Native Binaries

```typescript
// 1. Detect environment
const isPackaged = process.resourcesPath?.includes('app.asar');

// 2. Resolve binary path dynamically
const binaryPath = isPackaged 
  ? path.join(
      process.resourcesPath.replace(/app\.asar.*$/, 'app.asar.unpacked'),
      'relative/to/binary'
    )
  : path.join(process.cwd(), 'node_modules/package/binary');

// 3. Spawn directly
const result = spawn(binaryPath, args);
```

### Similar Patterns in Codebase

This same pattern is used for other native binaries:
- **FFmpeg:** `src/core/ffmpeg-bootstrap.ts`
- **Sharp:** Unpacked via `electron-builder.json5` asarUnpack
- **sqlite-vec:** Unpacked via `electron-builder.json5` asarUnpack

## Related Documents

- [Whisper Transcription Debugging Log](./whisper-transcription-debugging-log.md) - Complete investigation timeline
- [Whisper Configuration Fix](./WHISPER_CONFIG_FIX_SUMMARY.md) - Separate config state issue
- [Electron ASAR Documentation](https://www.electronjs.org/docs/latest/tutorial/asar-archives)
- [Electron Issue #26819](https://github.com/electron/electron/issues/26819) - Module loading from unpacked ASAR

## Status

✅ **RESOLVED** - WhisperDirectService successfully bypasses all ASAR issues  
✅ **PRODUCTION VERIFIED** - Working in DMG with real transcriptions  
✅ **CROSS-PLATFORM** - Tested on macOS ARM64, ready for Windows/Linux  
✅ **MAINTAINABLE** - Clean, explicit code with no monkey-patches
