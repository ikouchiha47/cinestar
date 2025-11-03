# Ollama API Pull Analysis - Streaming vs Polling

## Date: Nov 1, 2025 2:48pm

## Question: Does Ollama Support Polling?

**Answer: NO** ❌

Ollama only provides **long-running HTTP connections** for model downloads. There is no polling/status endpoint.

---

## Testing Results

### Test 1: `stream: false`

```bash
curl -X POST http://localhost:11434/api/pull \
  -d '{"name": "moondream:v2", "stream": false}'
```

**Result**:
- ❌ Connection stays open until download completes
- ❌ No progress updates
- ❌ Returns single response at the end
- ❌ Timeout after 30 seconds (download not complete)

**Conclusion**: `stream: false` is **NOT polling** - it's still a long-running connection, just without progress updates.

### Test 2: `stream: true` (Current Implementation)

```bash
curl -X POST http://localhost:11434/api/pull \
  -d '{"name": "moondream:v2", "stream": true}'
```

**Result**:
- ✅ Connection stays open
- ✅ Real-time progress updates
- ✅ Shows download percentage
- ✅ Returns success when complete
- ⏱️ Takes as long as needed (minutes to hours)

**Conclusion**: This is the **ONLY way** to get progress updates.

---

## Ollama API Endpoints

### Available Endpoints

```
POST /api/pull          - Download model (long-running)
GET  /api/tags          - List installed models
POST /api/delete        - Delete a model
POST /api/generate      - Generate text
POST /api/embeddings    - Generate embeddings
```

### Missing Endpoints ❌

```
GET  /api/pull/status   - ❌ Does not exist
GET  /api/jobs          - ❌ Does not exist
GET  /api/downloads     - ❌ Does not exist
```

**Ollama does NOT have**:
- ❌ Background job system
- ❌ Status polling endpoint
- ❌ Download queue API
- ❌ Separate progress check

---

## Connection Type Comparison

### Option 1: `stream: false` (Not Useful)

```typescript
// ❌ BAD: Blocks until complete, no progress
const response = await fetch('/api/pull', {
  body: JSON.stringify({ name: 'model', stream: false })
});

// Waits minutes/hours...
const result = await response.json();
// {"status": "success"} - but no progress shown!
```

**Problems**:
- No progress updates for user
- Connection can timeout
- User has no idea what's happening
- Not suitable for UI

### Option 2: `stream: true` (Current - CORRECT ✅)

```typescript
// ✅ GOOD: Real-time progress
const response = await fetch('/api/pull', {
  body: JSON.stringify({ name: 'model', stream: true })
});

const reader = response.body.getReader();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  
  // Parse progress updates
  const progress = JSON.parse(line);
  updateUI(progress.percentage); // Show to user!
}
```

**Benefits**:
- ✅ Real-time progress
- ✅ User sees what's happening
- ✅ Can show percentage
- ✅ No timeout needed
- ✅ Connection closes automatically when done

### Option 3: Polling (NOT POSSIBLE ❌)

```typescript
// ❌ IMPOSSIBLE: No status endpoint exists
async function pollStatus() {
  while (!complete) {
    const status = await fetch('/api/pull/status'); // ❌ Doesn't exist!
    await sleep(1000);
  }
}
```

**Why not possible**:
- Ollama doesn't have status endpoints
- No background job system
- Must use long-running connection

---

## Timeout Considerations

### Current Implementation

```typescript
// Health check - short timeout (5 seconds)
async isOllamaRunning(): Promise<boolean> {
  const response = await fetch(`${this.baseUrl}/api/tags`, {
    signal: AbortSignal.timeout(5000) // ✅ Good for health check
  });
  return response.ok;
}

// Model download - NO timeout
async pullModel(modelName: string): Promise<void> {
  const response = await fetch(`${this.baseUrl}/api/pull`, {
    // ✅ No timeout - let it run as long as needed
    body: JSON.stringify({ name: modelName, stream: true })
  });
  // ... stream processing
}
```

### Why No Timeout on Downloads?

**Download times vary widely**:
- Small model (340MB): ~1-2 minutes
- Medium model (1.7GB): ~5-10 minutes
- Large model (5GB+): ~30-60 minutes
- **Slow connections**: Could take hours!

**Setting timeout = bad**:
```typescript
// ❌ BAD: Will fail for slow connections
signal: AbortSignal.timeout(300000) // 5 minutes
// User with slow internet: Download fails at 5 min! 😢
```

**No timeout = good**:
```typescript
// ✅ GOOD: Works for all connection speeds
// No timeout - let it run as long as needed
// Connection closes automatically when complete
```

---

## Error Handling

### Network Errors

```typescript
try {
  await modelManager.pullModel('moondream:v2', onProgress);
} catch (error) {
  // Handle:
  // - Network disconnected
  // - Ollama crashed
  // - Connection lost
  // - Disk full
  updateTask(taskId, {
    status: 'error',
    message: error.message
  });
}
```

### User Cancellation (Optional)

```typescript
const controller = new AbortController();

// User clicks "Cancel" button
cancelButton.onclick = () => controller.abort();

// Pass to fetch
fetch(url, { signal: controller.signal });
```

---

## Recommended Approach

### ✅ Use Streaming (Current Implementation)

**Why**:
1. **Only option** for progress updates
2. **Works for all connection speeds**
3. **Real-time feedback** for users
4. **Automatic cleanup** when complete
5. **No polling overhead**

**Implementation** (already done in ModelManager):

```typescript
async pullModel(
  modelName: string,
  onProgress?: (progress: DownloadProgress) => void
): Promise<void> {
  console.log(`[MODEL-MANAGER] Starting download of ${modelName}...`);

  const response = await fetch(`${this.baseUrl}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: modelName,
      stream: true // ✅ Enable streaming
    })
    // ✅ No timeout - let it run as long as needed
  });

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;

      const progress = JSON.parse(line);
      
      // Calculate percentage
      if (progress.total && progress.completed) {
        progress.percentage = Math.round(
          (progress.completed / progress.total) * 100
        );
      }

      // Callback with progress
      if (onProgress) {
        onProgress({
          model: modelName,
          ...progress
        });
      }

      // Check for completion
      if (progress.status === 'success') {
        console.log(`✅ Successfully downloaded ${modelName}`);
        return;
      }

      // Check for errors
      if (progress.error) {
        throw new Error(progress.error);
      }
    }
  }
}
```

---

## UI Considerations

### Show Progress to User

```typescript
// In SimplifiedOnboarding.tsx
await modelManager.pullModel(model.name, (progress) => {
  updateTask(taskId, {
    status: 'running',
    progress: progress.percentage || 0,
    message: getStatusMessage(progress.status)
  });
});
```

### Status Messages

```typescript
function getStatusMessage(status: string): string {
  if (status === 'pulling manifest') {
    return 'Preparing download...';
  }
  if (status.startsWith('pulling ')) {
    return 'Downloading...';
  }
  if (status === 'verifying sha256 digest') {
    return 'Verifying integrity...';
  }
  if (status === 'writing manifest') {
    return 'Saving to disk...';
  }
  if (status === 'success') {
    return 'Download complete!';
  }
  return status;
}
```

### Handle Slow Connections

```tsx
<SetupTask>
  <ProgressBar value={progress} />
  <StatusMessage>
    {progress < 100 
      ? `Downloading... ${progress}%`
      : 'Download complete!'
    }
  </StatusMessage>
  {progress > 0 && progress < 100 && (
    <HelpText>
      This may take a while on slower connections.
      You can continue using the app while downloading.
    </HelpText>
  )}
</SetupTask>
```

---

## Summary

### Ollama API Reality

| Feature | Available? | Notes |
|---------|-----------|-------|
| Streaming download | ✅ Yes | `stream: true` |
| Progress updates | ✅ Yes | Via streaming |
| Polling endpoint | ❌ No | Doesn't exist |
| Background jobs | ❌ No | Not supported |
| Status check | ❌ No | Must use streaming |

### Our Implementation

| Aspect | Status | Notes |
|--------|--------|-------|
| Streaming | ✅ Implemented | ModelManager.pullModel() |
| Progress tracking | ✅ Working | Real-time updates |
| Timeout | ✅ None | Works for all speeds |
| Error handling | ✅ Implemented | Try/catch + callbacks |
| UI integration | ✅ Ready | SetupProgress component |

### Recommendations

1. ✅ **Keep streaming approach** - It's the only option
2. ✅ **No timeout on downloads** - Let them run as long as needed
3. ✅ **Show progress to user** - Real-time percentage updates
4. ✅ **Handle errors gracefully** - Network issues, disk full, etc.
5. ✅ **Allow cancellation** - Optional AbortController for user cancel

---

## Conclusion

**Ollama does NOT support polling.** The only way to download models is via long-running HTTP connections with streaming.

**Our current implementation is correct!** ✅

- Uses `stream: true` for progress updates
- No timeout (works for all connection speeds)
- Real-time progress tracking
- Automatic cleanup on completion
- Proper error handling

**No changes needed** - the implementation is production-ready for users with any internet speed, from fast fiber to slow mobile connections. 🚀
