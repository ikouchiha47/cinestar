# IPC Event Debugging Session: media:scan-completed

## Problem Statement
Images were being scanned and added to the database, but the UI wasn't refreshing to show them immediately. Users had to manually refresh or wait for the polling interval to see newly scanned images.

## Root Cause Analysis

### Issue 1: Wrong WebContents Target
**Problem:** IPC events were being sent to the wrong webContents instance.

**Architecture Context:**
- The app uses a `BrowserWindow` with a `BrowserView` for the main UI
- `BrowserWindow` has its own webContents (ID: 1)
- `BrowserView` has a separate webContents (ID: 2)
- The React app runs in the BrowserView's webContents, NOT the window's webContents

**Mistake:**
```typescript
// electron/main.ts - WRONG
MainMediaAPI.setMainWindow(win); // BrowserWindow instance
```

This caused events to be sent to webContents ID 1 (the window), but the IPC listener was registered on webContents ID 2 (the BrowserView).

**Fix:**
```typescript
// electron/main.ts - CORRECT
let appView: BrowserView | null = null; // Module-level variable

async function createWindow() {
  appView = new BrowserView({ ... });
  // ...
  MainMediaAPI.setMainWindow(appView); // Pass BrowserView, not BrowserWindow
}
```

### Issue 2: API Mismatch - BrowserView vs BrowserWindow
**Problem:** Code assumed `mainWindow` was a `BrowserWindow` and called `isDestroyed()` method.

**Error:**
```
TypeError: this.mainWindow.isDestroyed is not a function
```

**Mistake:**
```typescript
// src/api/main-media-api.ts - WRONG
isDestroyed: this.mainWindow ? this.mainWindow.isDestroyed() : 'N/A'
```

`BrowserView` doesn't have an `isDestroyed()` method - only `BrowserWindow` does. However, `webContents.isDestroyed()` exists on both.

**Fix:**
```typescript
// src/api/main-media-api.ts - CORRECT
isDestroyed: this.mainWindow?.webContents?.isDestroyed?.() ?? 'N/A'
```

## Debugging Process

### 1. Initial Investigation
- ✅ Confirmed images were being added to database (43 images)
- ✅ Confirmed background jobs were created
- ✅ Confirmed IPC event was being sent from main process
- ❌ IPC event never reached the renderer process

### 2. Logging Strategy
Added comprehensive logging at key points:

**Main Process (electron/main.ts):**
```typescript
console.log('[MAIN-PROCESS] IS_DEV:', IS_DEV);
console.log('[MAIN-PROCESS] Opening DevTools...');
console.log('[MainMediaAPI] appView webContents ID:', appView.webContents.id);
```

**Main Process (src/api/main-media-api.ts):**
```typescript
console.log(`[INDEXING-IPC-DEBUG] Checking IPC send conditions:`, {
  hasMainWindow: !!this.mainWindow,
  addedCount,
  isDestroyed: ...,
  webContentsId: this.mainWindow ? this.mainWindow.webContents.id : 'N/A'
});
console.log(`[INDEXING] 📡 Sending media:scan-completed event to renderer`);
console.log(`[INDEXING] 📡 Sent scan-completed event to UI`);
```

**Renderer Process (src/components/v2/DrillerV2.tsx):**
```typescript
console.log('[DRILLER-IPC] Setting up media:scan-completed listener');
console.log('[DRILLER-IPC] window.ipcRenderer available:', !!window.ipcRenderer);
console.log('[DRILLER-IPC] Registering listener for media:scan-completed');
console.log('[DRILLER-IPC] Listener registered successfully');
console.log(`[DRILLER-IPC] ✅ Scan completed event RECEIVED: ${data.itemsAdded} items added`);
```

### 3. Key Discoveries

**Discovery 1: Listener was registered**
```
[DRILLER-IPC] Setting up media:scan-completed listener
[DRILLER-IPC] window.ipcRenderer available: true
[DRILLER-IPC] Listener registered successfully
```
✅ The renderer was ready to receive events

**Discovery 2: Event was being sent**
```
[INDEXING] 📡 Sending media:scan-completed event to renderer (43 items)
[INDEXING] 📡 Sent scan-completed event to UI (43 items)
```
✅ The main process was sending the event

**Discovery 3: WebContents ID mismatch**
```
[MainMediaAPI] Main window reference set for IPC events
[INDEXING-IPC-DEBUG] webContentsId: 1  // Wrong! Should be 2
```
❌ Event sent to webContents 1, but listener on webContents 2

**Discovery 4: Crash before event could be sent**
```
[PERFORM-INDEXING] ❌ Indexing job failed: TypeError: this.mainWindow.isDestroyed is not a function
```
❌ Code crashed before reaching the IPC send logic

## Mistakes Made

### Assumption Mistakes

1. **Assumed BrowserWindow and BrowserView were interchangeable**
   - Reality: They have different APIs and separate webContents instances
   - Impact: Events sent to wrong target

2. **Assumed mainWindow was always a BrowserWindow**
   - Reality: Code was refactored to use BrowserView architecture
   - Impact: Called methods that don't exist on BrowserView

3. **Assumed IPC events would "just work" across all webContents**
   - Reality: Events must be sent to the specific webContents where the listener is registered
   - Impact: Silent failure - no error, event just never arrives

### Code Mistakes

1. **Passing wrong object to setMainWindow()**
   ```typescript
   // WRONG
   MainMediaAPI.setMainWindow(win); // BrowserWindow
   
   // CORRECT
   MainMediaAPI.setMainWindow(appView); // BrowserView
   ```

2. **Using BrowserWindow-specific API on BrowserView**
   ```typescript
   // WRONG
   this.mainWindow.isDestroyed()
   
   // CORRECT
   this.mainWindow?.webContents?.isDestroyed?.()
   ```

3. **Not making appView accessible at module level**
   ```typescript
   // WRONG - scoped inside function
   async function createWindow() {
     const appView = new BrowserView(...);
   }
   
   // CORRECT - module level
   let appView: BrowserView | null = null;
   async function createWindow() {
     appView = new BrowserView(...);
   }
   ```

## Solution Summary

### Files Modified

1. **electron/main.ts**
   - Added module-level `appView` variable
   - Changed `const appView` to assignment `appView = ...`
   - Passed `appView` instead of `win` to `setMainWindow()`
   - Added logging for webContents ID

2. **src/api/main-media-api.ts**
   - Fixed `isDestroyed()` call to use `webContents.isDestroyed()`
   - Added comprehensive IPC debugging logs
   - Added error handling around IPC send

3. **src/components/v2/DrillerV2.tsx**
   - Added logging to confirm listener registration
   - Added logging when event is received
   - (No functional changes - already correct)

### Final Working Flow

1. **Scan completes** → 43 images added to database
2. **Main process** → Checks if appView exists and webContents is not destroyed
3. **Main process** → Sends `media:scan-completed` event to appView.webContents (ID: 2)
4. **Renderer process** → Listener receives event on webContents ID: 2
5. **Renderer process** → Calls `getRecentItems()` to fetch new images
6. **UI updates** → Images appear immediately without manual refresh

## Lessons Learned

### 1. Understand the Architecture
- Know the difference between BrowserWindow and BrowserView
- Understand that each has separate webContents instances
- IPC events are webContents-specific, not window-specific

### 2. Log Everything During Debugging
- Log at the point of sending
- Log at the point of receiving
- Log the webContents IDs to verify routing
- Log object types to catch API mismatches

### 3. Don't Assume API Compatibility
- Just because two classes have similar names doesn't mean they have the same API
- Always check documentation when working with Electron APIs
- Use optional chaining (`?.`) when calling methods that might not exist

### 4. Test the Happy Path AND Error Path
- The code worked when mainWindow was a BrowserWindow
- It broke when mainWindow became a BrowserView
- Error handling caught the crash but masked the root cause

### 5. Module-Level State for Cross-Function Access
- When multiple functions need access to the same object, use module-level variables
- This is especially important for IPC routing where the target must be accessible from different contexts

## Verification

### Backend Logs (Success)
```
[INDEXING-IPC-DEBUG] Checking IPC send conditions: {
  hasMainWindow: true,
  addedCount: 43,
  isDestroyed: false,
  webContentsId: 2
}
[INDEXING] 📡 Sending media:scan-completed event to renderer (43 items)
[INDEXING] 📡 Sent scan-completed event to UI (43 items)
```

### Frontend Logs (Success)
```
[DRILLER-IPC] ✅ Scan completed event RECEIVED: 43 items added
[DRILLER] Refreshed library: 43 items
```

## Related Documentation
- Electron BrowserView: https://www.electronjs.org/docs/latest/api/browser-view
- Electron WebContents: https://www.electronjs.org/docs/latest/api/web-contents
- IPC Communication: https://www.electronjs.org/docs/latest/tutorial/ipc

## Tags
#ipc #electron #debugging #browser-view #webcontents #event-routing #architecture
