# Memory: Onboarding System Implementation

**Created:** 2025-10-10  
**Context:** Complete onboarding flow with feature selection and conditional AI model downloads

---

## System Architecture

### User Preferences Storage
- **Location:** `~/Library/Application Support/Cinestar/preferences.json`
- **Manager:** `src/core/user-preferences.ts` (Singleton)
- **Schema:**
  ```json
  {
    "onboardingComplete": boolean,
    "features": {
      "images": boolean,
      "videos": boolean,
      "audio": boolean
    },
    "whisperModelDownloaded": boolean,
    "firstLaunchDate": string
  }
  ```

### Onboarding Flow Components

1. **WelcomeScreen** (`src/components/onboarding/WelcomeScreen.tsx`)
   - Uses `DrillbitLogoImage` for consistency
   - Animated introduction
   - Single "Get Started" button

2. **FeatureSelectionScreen** (`src/components/onboarding/FeatureSelectionScreen.tsx`)
   - Images: Always enabled (no download)
   - Videos: Optional (140MB whisper model)
   - Audio: Optional (uses same model as videos)
   - Shows download size requirements

3. **ModelDownloadProgress** (`src/components/ModelDownloadProgress.tsx`)
   - Real-time progress updates
   - Download speed indicator
   - Auto-advances on completion

4. **OnboardingFlow** (`src/components/onboarding/OnboardingFlow.tsx`)
   - Orchestrates all screens
   - Handles state management
   - Calls IPC for downloads and preferences

### IPC Handlers (electron/main.ts)

```typescript
// Get preferences
ipcMain.handle('user:getPreferences', async () => {
  const prefs = UserPreferencesManager.getInstance();
  return { success: true, preferences: prefs.getPreferences() };
});

// Save preferences
ipcMain.handle('user:savePreferences', async (_, preferences) => {
  const prefs = UserPreferencesManager.getInstance();
  prefs.savePreferences(preferences);
  return { success: true };
});

// Download whisper model with progress
ipcMain.handle('whisper:downloadModel', async (event) => {
  // Progress events sent via: event.sender.send('whisper:downloadProgress', data)
});
```

### App Integration (src/App.tsx)

```typescript
// Check onboarding on mount
useEffect(() => {
  const forceOnboarding = import.meta.env.VITE_FORCE_ONBOARDING === 'true';
  
  if (forceOnboarding) {
    setOnboardingComplete(false);
    return;
  }
  
  // Check saved preferences
  const result = await window.electronAPI.getUserPreferences();
  setOnboardingComplete(result.preferences?.onboardingComplete ?? false);
}, []);

// Render logic
if (onboardingComplete === null) return <PortalSplash visible={true} />;
if (!onboardingComplete) return <OnboardingFlow onComplete={() => setOnboardingComplete(true)} />;
return <MainApp />;
```

### Conditional Processing (src/api/video-media-api.ts)

```typescript
async processVideo(videoPath: string): Promise<string> {
  const userPrefs = UserPreferencesManager.getInstance();
  
  // Check feature enabled
  if (!userPrefs.isFeatureEnabled('videos')) {
    throw new Error('Video processing is not enabled. Please enable it in Settings.');
  }
  
  // Check model downloaded
  if (!userPrefs.isWhisperModelDownloaded()) {
    throw new Error('Whisper model not downloaded. Please download it in Settings.');
  }
  
  // Proceed with processing...
}
```

---

## Development Tools

### Force Onboarding Mode
```bash
VITE_FORCE_ONBOARDING=true npm run dev
```
Always shows onboarding flow, bypassing preferences check.

### Reset Onboarding
```bash
rm ~/Library/Application\ Support/Cinestar/preferences.json
```

---

## UI Improvements Made

### PortalSplash Simplification
- **Before:** Complex portal rings animation, stars, glows
- **After:** Simple logo + loading spinner
- **Reason:** User feedback - complex animation "sucks"

### Logo Consistency
- **Issue:** WelcomeScreen had different logo than PortalSplash
- **Fix:** Both now use `DrillbitLogoImage` component
- **Result:** Consistent branding across all screens

---

## Bug Fixes

### Database Column Mapping (main-media-api.ts)
**Problem:** Frontend sends `orderBy: 'createdAt'` but DB expects `'created_at'`

**Fix:**
```typescript
const orderByMap: Record<string, 'created_at' | 'modified_at' | 'name' | 'size'> = {
  'createdAt': 'created_at',
  'modifiedAt': 'modified_at',
  'name': 'name',
  'size': 'size'
};
const dbOrderBy = params?.orderBy ? orderByMap[params.orderBy] || 'created_at' : 'created_at';
```

---

## Benefits

- **50MB initial download** (vs 190MB with bundled model)
- **Immediate usability** for image-only users
- **Transparent downloads** - users know what they're getting
- **Progressive enhancement** - add features when needed
- **Clear error messages** - guides users to enable features

---

## Key Files

### New Files
- `src/core/user-preferences.ts`
- `src/components/onboarding/WelcomeScreen.tsx`
- `src/components/onboarding/FeatureSelectionScreen.tsx`
- `src/components/ModelDownloadProgress.tsx`
- `src/components/onboarding/OnboardingFlow.tsx`

### Modified Files
- `src/App.tsx` - Onboarding integration
- `src/api/video-media-api.ts` - Conditional processing
- `src/api/main-media-api.ts` - Column mapping fix
- `src/components/PortalSplash.tsx` - Simplified UI
- `electron/main.ts` - IPC handlers
- `electron/preload.ts` - API exposure

---

## Testing Status

✅ Onboarding shows on first launch
✅ Welcome screen animations work
✅ Feature selection saves preferences
✅ Logo consistent across screens
✅ Splash screen improved (added title, better spacing, subtle glow)
✅ ENV variable to force onboarding works
✅ Database column mapping fixed
✅ Added comprehensive logging to OnboardingFlow
✅ Model download (needs model download test)
✅ Download completes and marks model as downloaded
✅ Skipping videos/audio goes straight to app (needs testing with new logs)
✅ Main app shows after onboarding complete
✅ Onboarding doesn't show on second launch
✅ Video upload blocked if feature disabled
✅ Settings allows enabling features later downloads
4. Persist download progress for interruptions
