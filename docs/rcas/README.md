# Root Cause Analysis (RCA) Documents

This directory contains detailed root cause analyses and debugging logs for significant issues encountered during development.

## Available RCAs

### [Whisper.cpp ASAR Packaging Fix](./whisper-asar-packaging-fix.md)
**Date:** November 2, 2025  
**Severity:** Critical  
**Issue:** Whisper transcription binary not executable in Electron production build

**Summary:** Resolved Electron ASAR packaging issue where native whisper-cli binary was not executable in production. Node's module resolution loaded code from ASAR instead of unpacked folder, causing all transcriptions to fail. Solution: Created WhisperDirectService to bypass nodejs-whisper wrapper and directly spawn the binary with dynamically resolved paths.

**Key Changes:**
- Created WhisperDirectService for direct binary execution
- Dynamic path resolution using process.resourcesPath
- Cross-platform support (Windows/macOS/Linux)
- Removed dependency on nodejs-whisper module wrapper

**Related:** [Debugging Log](./whisper-transcription-debugging-log.md)

---

### [Whisper Transcription Configuration Fix](./WHISPER_CONFIG_FIX_SUMMARY.md)
**Date:** November 2, 2025  
**Severity:** High  
**Issue:** Video transcription not running despite successful model download

**Summary:** Resolved configuration state management issue where three separate flags (`features.videos`, `aiServices.transcription.modelDownloaded`, `aiServices.transcription.enabled`) were not properly coordinated. Implemented resource-level tracking, startup normalization, and proper onboarding gates.

**Key Changes:**
- Added `resources` section to config schema
- Implemented startup config normalizer
- Updated onboarding and settings flows
- Added config invariant enforcement

**Related:** [Debugging Log](./whisper-transcription-debugging-log.md)

---

### [Whisper Transcription Debugging Log](./whisper-transcription-debugging-log.md)
**Date:** November 2, 2025  
**Issue:** Complete investigation of Whisper transcription failures

**Summary:** Chronicles the full debugging journey including ASAR packaging issues and configuration state management problems. Documents multiple attempted solutions and the final working implementation.

**Key Learnings:**
- Node module resolution priority in ASAR packages
- Dynamic path resolution for native binaries in Electron
- Configuration state coordination patterns
- Production verification methodology

**Related:** [Configuration Fix RCA](./WHISPER_CONFIG_FIX_SUMMARY.md)

---

## RCA Template

When creating new RCAs, include:

1. **Header**
   - Date
   - Issue description
   - Severity
   - Related documents

2. **Problem Statement**
   - What was broken
   - Impact on users/system
   - How it was discovered

3. **Root Cause Analysis**
   - Technical details
   - Why it happened
   - Contributing factors

4. **Solution**
   - What was implemented
   - Code changes
   - Configuration updates

5. **Verification**
   - Testing performed
   - Production validation
   - Metrics/logs

6. **Lessons Learned**
   - What we learned
   - How to prevent similar issues
   - Best practices identified

7. **Related Documents**
   - Links to code
   - Architecture docs
   - Other RCAs
