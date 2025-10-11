# Memory: Testing Checklist

**Last Updated:** 2025-10-10

---

## Onboarding Flow Testing

### First Launch
- [ ] App shows PortalSplash while checking preferences
- [ ] Onboarding flow appears (no preferences.json exists)
- [ ] WelcomeScreen shows with correct logo (DrillbitLogoImage)
- [ ] "Get Started" button advances to FeatureSelectionScreen

### Feature Selection
- [ ] Images checkbox is checked and disabled (always enabled)
- [ ] Videos checkbox is unchecked by default
- [ ] Audio checkbox is unchecked by default
- [ ] Download size shows "140 MB" when videos/audio selected
- [ ] Download size shows "0 MB" when only images selected
- [ ] "Continue" button is always enabled

### Model Download (if videos/audio selected)
- [ ] ModelDownloadProgress screen appears
- [ ] Progress bar animates from 0% to 100%
- [ ] Download speed indicator shows (e.g., "2.5 MB/s")
- [ ] Completion state shows with checkmark
- [ ] Auto-advances to main app after 1 second

### Skip Download (if only images)
- [ ] Goes directly to main app
- [ ] No download screen shown
- [ ] preferences.json created with videos: false, audio: false

### Main App After Onboarding
- [ ] Main app loads normally
- [ ] No onboarding shown on subsequent launches
- [ ] preferences.json exists with onboardingComplete: true

---

## Development Tools Testing

### Force Onboarding Mode
```bash
VITE_FORCE_ONBOARDING=true npm run dev
```

- [ ] Onboarding always shows even if preferences exist
- [ ] Can test onboarding flow repeatedly
- [ ] Console shows: `[APP] VITE_FORCE_ONBOARDING=true - Showing onboarding flow`

### Reset Onboarding
```bash
rm ~/Library/Application\ Support/Cinestar/preferences.json
npm run dev
```

- [ ] Onboarding shows again
- [ ] Fresh preferences created

---

## Conditional Processing Testing

### Video Upload - Feature Disabled
**Setup:** Complete onboarding with only images enabled

- [ ] Try to upload/process a video
- [ ] Error message: "Video processing is not enabled. Please enable it in Settings."
- [ ] Video is not processed
- [ ] User is guided to Settings

### Video Upload - Model Not Downloaded
**Setup:** Enable videos but don't download model (edge case)

- [ ] Try to upload/process a video
- [ ] Error message: "Whisper model not downloaded. Please download it in Settings."
- [ ] Video is not processed

### Video Upload - Feature Enabled + Model Downloaded
**Setup:** Complete onboarding with videos enabled and model downloaded

- [ ] Upload a video
- [ ] Processing starts normally
- [ ] Phase 0 transcription works
- [ ] Phase 1 enhancement works
- [ ] Video becomes searchable

---

## UI Consistency Testing

### Logo Consistency
- [ ] PortalSplash uses DrillbitLogoImage
- [ ] WelcomeScreen uses DrillbitLogoImage
- [ ] Both logos look identical
- [ ] No gradient box with generic icon

### Splash Screen Simplicity
- [ ] PortalSplash shows: logo + spinner + "Loading..."
- [ ] No complex portal rings
- [ ] No stars animation
- [ ] No glow effects
- [ ] Clean, minimal design

---

## Database Testing

### Column Mapping
- [ ] Recent items load without "no such column: createdAt" error
- [ ] Sorting by createdAt works
- [ ] Sorting by modifiedAt works
- [ ] Sorting by name works
- [ ] Sorting by size works

### Pagination
- [ ] First page loads (cursor = undefined)
- [ ] Next page loads with cursor
- [ ] hasMore flag is correct
- [ ] No duplicate items across pages

---

## Preferences Testing

### Save Preferences
```typescript
await window.electronAPI.saveUserPreferences({
  onboardingComplete: true,
  features: { images: true, videos: true, audio: false },
  whisperModelDownloaded: true,
  firstLaunchDate: new Date().toISOString()
});
```

- [ ] preferences.json created at correct location
- [ ] JSON is valid and readable
- [ ] All fields saved correctly

### Load Preferences
```typescript
const result = await window.electronAPI.getUserPreferences();
console.log(result.preferences);
```

- [ ] Preferences load correctly
- [ ] Returns null if file doesn't exist
- [ ] Handles corrupted JSON gracefully

### Feature Checks
```typescript
const prefs = UserPreferencesManager.getInstance();
console.log(prefs.isFeatureEnabled('videos'));  // true/false
console.log(prefs.isWhisperModelDownloaded());  // true/false
```

- [ ] Feature checks return correct values
- [ ] Singleton pattern works (same instance)

---

## Error Handling Testing

### Download Failure
- [ ] Network error during download
- [ ] Shows error message
- [ ] Allows retry (future feature)
- [ ] Doesn't mark model as downloaded

### Corrupted Preferences
- [ ] Manually corrupt preferences.json
- [ ] App handles gracefully
- [ ] Falls back to showing onboarding

### Missing Whisper Binary
- [ ] Delete whisper binary
- [ ] Try to process video
- [ ] Clear error message shown

---

## Performance Testing

### Large Library Load
- [ ] 1000+ items load quickly
- [ ] Cursor pagination is fast
- [ ] No COUNT() queries
- [ ] Memory usage is reasonable

### Concurrent Operations
- [ ] Onboarding while indexing
- [ ] Multiple video uploads
- [ ] Search during processing

---

## Status

### ✅ Completed
- Onboarding flow structure
- Feature selection UI
- Preferences save/load
- Logo consistency
- Splash screen simplification
- ENV variable for force onboarding
- Conditional processing checks
- Database column mapping

### ⏳ Pending
- Actual whisper model download test
- Download progress accuracy
- Download failure handling
- Settings integration
- Feature re-enablement

### 🐛 Known Issues
None currently

---

## Test Commands

```bash
# Normal run
npm run dev

# Force onboarding
VITE_FORCE_ONBOARDING=true npm run dev

# Reset preferences
rm ~/Library/Application\ Support/Cinestar/preferences.json

# Check preferences
cat ~/Library/Application\ Support/Cinestar/preferences.json | jq

# Debug mode
DEBUG_MODE=true npm run dev
```

---

**Last Updated:** 2025-10-10 12:48 IST
