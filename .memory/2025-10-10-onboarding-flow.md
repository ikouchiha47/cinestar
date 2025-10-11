# Memory: Onboarding Flow with Feature Selection

**Date:** 2025-10-10 12:21 IST  
**Status:** ✅ IMPLEMENTED  
**Priority:** High (UX Critical)

---

## Problem

**Forcing 140MB download on all users is bad UX:**
- 🚫 Users who only want images don't need AI models
- 🚫 Large initial download discourages adoption
- 🚫 No transparency about what's being downloaded
- 🚫 Can't use app while downloading

---

## Solution

**Progressive onboarding with feature selection (like games):**
- ✅ Welcome screen introduces the app
- ✅ User selects which features they want
- ✅ Only downloads AI model if videos/audio selected
- ✅ Can use images immediately without waiting
- ✅ Can enable video/audio features later

---

## User Flow

```
App Launch
    ↓
[1] Welcome Screen
    - "Welcome to Cinestar"
    - Shows key features
    - [Get Started] button
    ↓
[2] Feature Selection Screen
    - ✓ Images (always enabled, no download)
    - ☐ Videos (optional, 140MB download)
    - ☐ Audio (optional, uses same model)
    - Clear download requirements
    ↓
[3a] If Videos/Audio Selected:
     Download Progress Screen
     - Shows progress bar
     - Download speed
     - "This only happens once"
     ↓
[3b] If Only Images:
     Skip directly to app
     ↓
[4] Main App
    - Features enabled based on selection
    - Can enable more features in settings later
```

---

## Implementation

### 1. User Preferences System

**File:** `src/core/user-preferences.ts`

**Storage Location:**
- macOS: `~/Library/Application Support/Cinestar/preferences.json`
- Linux: `~/.config/Cinestar/preferences.json`
- Windows: `%APPDATA%/Cinestar/preferences.json`

**Schema:**
```typescript
interface UserPreferences {
  onboardingComplete: boolean;
  featuresEnabled: {
    images: boolean;      // Always true
    videos: boolean;      // User opt-in
    audio: boolean;       // User opt-in
  };
  whisperModelDownloaded: boolean;
  firstLaunchDate?: string;
  lastModified: string;
  version: number;
}
```

**Key Methods:**
```typescript
userPreferences.isOnboardingComplete()
userPreferences.completeOnboarding()
userPreferences.setFeaturesEnabled({ videos: true, audio: true })
userPreferences.isFeatureEnabled('videos')
userPreferences.setWhisperModelDownloaded(true)
userPreferences.needsWhisperModel()
```

---

### 2. Welcome Screen

**File:** `src/components/onboarding/WelcomeScreen.tsx`

**Features:**
- Animated entrance with framer-motion
- Shows 3 key features (Smart Search, AI Transcription, Offline First)
- Gradient background
- "Get Started" CTA button

---

### 3. Feature Selection Screen

**File:** `src/components/onboarding/FeatureSelectionScreen.tsx`

**Features:**
- **Images Card** (always enabled, green checkmark)
  - "No additional setup required"
  
- **Videos Card** (optional, clickable)
  - "AI-powered transcription"
  - "📦 Requires 140MB download"
  
- **Audio Card** (optional, clickable)
  - "Transcribe podcasts & recordings"
  - "Uses same AI model as videos"

**Info Box:**
- Shows when videos/audio selected
- Explains what will be downloaded
- "Enables offline transcription without Docker"

---

### 4. Download Progress Screen

**File:** `src/components/ModelDownloadProgress.tsx`

**Features:**
- Animated progress bar
- Download speed indicator (simulated)
- Percentage display
- Changes to "Download Complete!" at 100%
- Auto-advances after completion

---

### 5. Onboarding Orchestrator

**File:** `src/components/onboarding/OnboardingFlow.tsx`

**Responsibilities:**
- Manages state between screens
- Saves user preferences
- Triggers model download
- Handles completion

**State Machine:**
```typescript
type OnboardingStep = 'welcome' | 'features' | 'download' | 'complete';
```

---

## Conditional Processing

### Video/Audio Upload Blocking

```typescript
// When user tries to upload video
if (!userPreferences.isFeatureEnabled('videos')) {
  showDialog({
    title: 'Video Processing Not Enabled',
    message: 'Enable video processing in Settings to transcribe videos.',
    actions: ['Go to Settings', 'Cancel']
  });
  return;
}

// If enabled but model not downloaded
if (!userPreferences.isWhisperModelDownloaded()) {
  showDialog({
    title: 'Downloading AI Model',
    message: 'The transcription model is being downloaded. Please wait...',
  });
  await downloadWhisperModel();
}
```

### Graceful Degradation

**User can still:**
- ✅ Browse and organize images
- ✅ Upload videos (stored, not processed)
- ✅ Search existing content
- ✅ Enable features later in settings

**When enabling videos later:**
- Show download screen
- Download model
- Process pending videos in background

---

## IPC Handlers Needed

### 1. Save User Preferences

```typescript
// electron/main.ts
ipcMain.handle('user:savePreferences', async (_evt, prefs: Partial<UserPreferences>) => {
  try {
    const manager = UserPreferencesManager.getInstance();
    
    if (prefs.featuresEnabled) {
      manager.setFeaturesEnabled(prefs.featuresEnabled);
    }
    
    if (prefs.onboardingComplete !== undefined) {
      if (prefs.onboardingComplete) {
        manager.completeOnboarding();
      }
    }
    
    if (prefs.whisperModelDownloaded !== undefined) {
      manager.setWhisperModelDownloaded(prefs.whisperModelDownloaded);
    }
    
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
```

### 2. Get User Preferences

```typescript
ipcMain.handle('user:getPreferences', async () => {
  try {
    const manager = UserPreferencesManager.getInstance();
    return { 
      success: true, 
      preferences: manager.getPreferences() 
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
```

### 3. Download Whisper Model

```typescript
ipcMain.handle('whisper:downloadModel', async (evt, options: { modelName: string }) => {
  try {
    const { nodewhisper } = await import('nodejs-whisper');
    const modelsPath = getWhisperModelsPath();
    
    // Create dummy audio to trigger download
    const dummyAudioPath = createDummyAudio();
    
    // Track progress (nodejs-whisper doesn't provide progress, so simulate)
    let progress = 0;
    const progressInterval = setInterval(() => {
      progress += 5;
      evt.sender.send('whisper:downloadProgress', Math.min(progress, 95));
    }, 1000);
    
    // Trigger download
    await nodewhisper(dummyAudioPath, {
      modelName: options.modelName,
      autoDownloadModelName: options.modelName,
      whisperOptions: { outputInText: true }
    });
    
    clearInterval(progressInterval);
    evt.sender.send('whisper:downloadProgress', 100);
    
    // Clean up
    fs.unlinkSync(dummyAudioPath);
    
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
```

---

## Integration with Main App

### App.tsx Changes

```typescript
function App() {
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    // Check onboarding status on mount
    window.electronAPI.getUserPreferences().then(result => {
      if (result.success) {
        setOnboardingComplete(result.preferences.onboardingComplete);
      }
      setLoading(false);
    });
  }, []);
  
  if (loading) {
    return <SplashScreen />;
  }
  
  if (!onboardingComplete) {
    return <OnboardingFlow onComplete={() => setOnboardingComplete(true)} />;
  }
  
  return <MainApp />;
}
```

---

## Settings Integration

### Enable Features Later

```typescript
// Settings Modal
function SettingsModal() {
  const [features, setFeatures] = useState({ videos: false, audio: false });
  
  const handleEnableVideos = async () => {
    // Save preference
    await window.electronAPI.saveUserPreferences({
      featuresEnabled: { videos: true }
    });
    
    // Check if model needs download
    const prefs = await window.electronAPI.getUserPreferences();
    if (!prefs.preferences.whisperModelDownloaded) {
      // Show download modal
      setShowDownloadModal(true);
    }
  };
  
  return (
    <div>
      <Toggle 
        label="Video Processing"
        checked={features.videos}
        onChange={handleEnableVideos}
      />
      <p className="text-xs text-neutral-500">
        Requires 140MB AI model download
      </p>
    </div>
  );
}
```

---

## Benefits

### User Experience
- ✅ **Smaller initial download** - No 140MB if only using images
- ✅ **Immediate usability** - Can browse images right away
- ✅ **Transparent** - User knows exactly what they're getting
- ✅ **Progressive** - Add features when needed
- ✅ **Non-blocking** - Don't wait for download to use app

### Technical
- ✅ **Persistent preferences** - Survives app updates
- ✅ **Graceful degradation** - App works without AI features
- ✅ **Conditional processing** - Only process what's enabled
- ✅ **Settings integration** - Can change preferences later

---

## Bundle Size Impact

| Scenario | App Size | First Launch |
|----------|----------|--------------|
| Images only | ~50MB | Instant |
| Images + Videos | ~50MB | +140MB download |
| All features | ~50MB | +140MB download |

**vs Previous Approach:**
- Before: 190MB app download for everyone
- After: 50MB app + optional 140MB

---

## Testing Checklist

- [ ] Onboarding shows on first launch
- [ ] Welcome screen animations work
- [ ] Feature selection saves preferences
- [ ] Download progress shows correctly
- [ ] Download completes and marks model as downloaded
- [ ] Skipping videos/audio goes straight to app
- [ ] Main app shows after onboarding complete
- [ ] Onboarding doesn't show on second launch
- [ ] Video upload blocked if feature disabled
- [ ] Settings allows enabling features later
- [ ] Enabling videos later triggers download
- [ ] Preferences persist across app restarts

---

## Files Created

1. `src/core/user-preferences.ts` - Preferences management
2. `src/components/onboarding/WelcomeScreen.tsx` - Welcome screen
3. `src/components/onboarding/FeatureSelectionScreen.tsx` - Feature selection
4. `src/components/ModelDownloadProgress.tsx` - Download progress (updated)
5. `src/components/onboarding/OnboardingFlow.tsx` - Orchestrator

---

## Files to Modify

1. `electron/main.ts` - Add IPC handlers
2. `electron/preload.ts` - Expose IPC methods
3. `src/types/global.d.ts` - Add type definitions
4. `src/App.tsx` - Integrate onboarding flow
5. `src/components/v2/components/SettingsModal.tsx` - Add feature toggles

---

**Status:** Components built, ready for IPC integration  
**Next:** Implement IPC handlers and integrate into App.tsx

---

**Last Updated:** 2025-10-10 12:21 IST
