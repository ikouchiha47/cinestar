# Path Diagnostics CLI

## Purpose

Debug native binary path resolution issues in Electron apps across development and production environments.

## Usage

```bash
# Run diagnostics
npm run diagnose:paths

# Or directly
node scripts/diagnose-paths.cjs
```

## What It Checks

### 1. Environment Detection
- Current working directory
- Platform and architecture
- Node version
- Electron resources path
- Packaged vs development mode

### 2. Whisper Binary Resolution
- **Development**: Tries `process.cwd()` and `__dirname` fallbacks
- **Production**: Checks `app.asar.unpacked` location
- Verifies file existence and executable permissions

### 3. FFmpeg/FFprobe Binaries
- Platform-specific paths
- Executable verification

### 4. ASAR Unpack Verification (Production Only)
- Checks if required modules are unpacked:
  - `nodejs-whisper`
  - `ffmpeg-static`
  - `ffprobe-static`
  - `sharp`
  - `better-sqlite3`
  - `sqlite-vec`

## Example Output

### Development Mode
```
🔍 Electron Native Binary Path Diagnostics

============================================================
  Environment Detection
============================================================
CWD: /Users/user/project
Platform: darwin
Arch: arm64
Is Packaged: ❌ No (Development)

============================================================
  Whisper Binary Resolution
============================================================
✅ Dev (process.cwd)
   Path: /Users/user/project/node_modules/nodejs-whisper/.../whisper-cli
   Size: 809064 bytes
   ✅ Executable

✅ Whisper binary found and accessible!
```

### Production Mode (Packaged App)
```
============================================================
  Environment Detection
============================================================
Resources Path: /Applications/App.app/Contents/Resources
Is Packaged: ✅ Yes

============================================================
  Whisper Binary Resolution
============================================================
✅ Production (app.asar.unpacked)
   Path: /Applications/App.app/.../app.asar.unpacked/.../whisper-cli
   ✅ Executable

❌ Production (WRONG - missing unpacked)
   Path: /Applications/App.app/.../node_modules/.../whisper-cli
   (File not found)

============================================================
  ASAR Unpack Verification
============================================================
✅ nodejs-whisper
✅ ffmpeg-static
❌ sharp
   Missing: Add to asarUnpack in electron-builder.json5
```

## Common Issues & Fixes

### Issue: Binary Not Found
**Symptom**: `❌ Whisper binary not found!`

**Fixes**:
1. Install module: `npm install nodejs-whisper`
2. Rebuild native modules: `npm run postinstall`
3. Check `electron-builder.json5` has module in `asarUnpack`

### Issue: Not Executable
**Symptom**: `⚠️ Not executable`

**Fix**: Run `chmod +x` on the binary (should be automatic in postinstall)

### Issue: Wrong Path in Production
**Symptom**: Checking `/Applications/.../node_modules/...` instead of `.../app.asar.unpacked/...`

**Fix**: Update path resolution to use `app.asar.unpacked`:
```typescript
const binaryPath = path.join(
  process.resourcesPath,
  'app.asar.unpacked',  // ← Must include this
  'node_modules',
  'nodejs-whisper',
  // ...
);
```

### Issue: Module Not Unpacked
**Symptom**: `❌ nodejs-whisper` in ASAR Unpack Verification

**Fix**: Add to `electron-builder.json5`:
```json5
"asarUnpack": [
  "node_modules/nodejs-whisper/**/*"
]
```

## Integration with Code

Use the CLI's logic in your runtime path resolution:

```typescript
import { detectEnvironment, resolveWhisperPaths } from '../scripts/diagnose-paths.cjs';

const env = detectEnvironment();
const whisperPath = resolveWhisperPaths(env);

if (!whisperPath) {
  throw new Error('Whisper binary not found - run npm run diagnose:paths');
}
```

## Exit Codes

- `0`: All checks passed, binary found
- `1`: Binary not found or error occurred

## When to Run

- After `npm install`
- Before building production DMG
- When debugging "binary not found" errors
- After updating `electron-builder.json5`
- When deploying to new platform/architecture

## Related Files

- `scripts/diagnose-paths.cjs` - CLI implementation
- `electron-builder.json5` - ASAR unpack configuration
- `src/core/processors/whisper-direct-service.ts` - Runtime path resolution
- `docs/whisper-transcription-debugging-log.md` - Full debugging history
