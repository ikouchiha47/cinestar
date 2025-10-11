# Memory: Architecture Decisions

**Last Updated:** 2025-10-10

---

## Decision: Simplified PortalSplash

**Date:** 2025-10-10  
**Context:** User feedback that complex portal animation "sucks"

**Decision:**
- Removed complex portal rings, stars, and glow animations
- Simplified to: logo + loading spinner
- Clean, minimal design

**Rationale:**
- User explicitly requested simpler splash
- Complex animations can feel slow/annoying
- Simple loading is more professional

**Implementation:**
- `src/components/PortalSplash.tsx` - Rewritten to minimal design
- Just `DrillbitLogoImage` + spinner + "Loading..." text
- Removed `AnimatePresence`, `onReveal`, `onComplete` callbacks
- Removed `minDurationMs` - shows only while actually loading

---

## Decision: Logo Consistency

**Date:** 2025-10-10  
**Context:** WelcomeScreen had different logo than PortalSplash

**Decision:**
- All screens use `DrillbitLogoImage` component
- Consistent branding across onboarding and splash

**Files Changed:**
- `src/components/onboarding/WelcomeScreen.tsx` - Now uses `DrillbitLogoImage`
- Removed custom gradient box with generic icon

---

## Decision: Force Onboarding ENV Variable

**Date:** 2025-10-10  
**Context:** Need to test onboarding flow repeatedly during development

**Decision:**
- Added `VITE_FORCE_ONBOARDING` environment variable
- When set to `'true'`, always shows onboarding
- Bypasses preferences check

**Usage:**
```bash
VITE_FORCE_ONBOARDING=true npm run dev
```

**Implementation:**
```typescript
// src/App.tsx
const forceOnboarding = import.meta.env.VITE_FORCE_ONBOARDING === 'true';
if (forceOnboarding) {
  setOnboardingComplete(false);
  return;
}
```

**Rationale:**
- Easier to test onboarding flow
- No need to delete preferences.json repeatedly
- Standard development practice

---

## Decision: Conditional Video Processing

**Date:** 2025-10-10  
**Context:** Users should only download AI model if they enable videos/audio

**Decision:**
- Check feature enablement before processing
- Check model download status before processing
- Throw clear error messages guiding users

**Implementation:**
```typescript
// src/api/video-media-api.ts
async processVideo(videoPath: string): Promise<string> {
  const userPrefs = UserPreferencesManager.getInstance();
  
  if (!userPrefs.isFeatureEnabled('videos')) {
    throw new Error('Video processing is not enabled. Please enable it in Settings.');
  }
  
  if (!userPrefs.isWhisperModelDownloaded()) {
    throw new Error('Whisper model not downloaded. Please download it in Settings.');
  }
  
  // Process...
}
```

**Rationale:**
- Prevents wasted processing attempts
- Clear user guidance
- Enforces feature gating

---

## Decision: CamelCase to snake_case Mapping

**Date:** 2025-10-10  
**Context:** Frontend uses camelCase, database uses snake_case

**Problem:**
```
Frontend: orderBy: 'createdAt'
Database: ORDER BY createdAt  ← SQL error: no such column
```

**Decision:**
- Add mapping layer in `MainMediaAPI.getRecentItems()`
- Convert camelCase to snake_case before database query

**Implementation:**
```typescript
const orderByMap: Record<string, 'created_at' | 'modified_at' | 'name' | 'size'> = {
  'createdAt': 'created_at',
  'modifiedAt': 'modified_at',
  'name': 'name',
  'size': 'size'
};
const dbOrderBy = params?.orderBy ? orderByMap[params.orderBy] || 'created_at' : 'created_at';
```

**Rationale:**
- Maintains clean API for frontend (camelCase)
- Maintains SQL conventions (snake_case)
- Single point of translation
- Type-safe mapping

**Alternative Considered:**
- Change database columns to camelCase → Rejected (breaks SQL conventions)
- Change frontend to snake_case → Rejected (breaks JS conventions)

---

## Decision: Preferences Storage Location

**Date:** 2025-10-10  
**Context:** Where to store user preferences

**Decision:**
- Use Electron's `app.getPath('userData')`
- Results in: `~/Library/Application Support/Cinestar/preferences.json`

**Rationale:**
- Standard Electron practice
- OS-appropriate location
- Survives app updates
- User can manually edit if needed

**Alternative Considered:**
- SQLite database → Rejected (overkill for simple preferences)
- LocalStorage → Rejected (main process needs access)

---

## Decision: Singleton Pattern for UserPreferencesManager

**Date:** 2025-10-10  
**Context:** Multiple parts of app need access to preferences

**Decision:**
- Implement as singleton with `getInstance()`
- Single source of truth
- Lazy initialization

**Rationale:**
- Prevents multiple file reads
- Ensures consistency
- Standard pattern for app-wide state

---

## Decision: Onboarding Flow Structure

**Date:** 2025-10-10  
**Context:** How to structure multi-screen onboarding

**Decision:**
- Single `OnboardingFlow` orchestrator component
- Individual screen components (Welcome, FeatureSelection, Download)
- State managed in orchestrator
- Screens are pure presentation

**Rationale:**
- Clear separation of concerns
- Easy to add/remove screens
- Centralized state management
- Testable components

**Flow:**
```
OnboardingFlow (state manager)
  ├─ WelcomeScreen (presentation)
  ├─ FeatureSelectionScreen (presentation)
  └─ ModelDownloadProgress (presentation)
```

---

## Decision: Feature Gating Strategy

**Date:** 2025-10-10  
**Context:** How to handle optional features

**Decision:**
- Images: Always enabled (no AI required)
- Videos: Optional (requires whisper model)
- Audio: Optional (uses same whisper model)

**Rationale:**
- Images work without any AI models
- Videos/audio need transcription (whisper)
- Reduces initial download size from 190MB to 50MB
- Users only download what they need

---

## Future Decisions Needed

1. **Settings Integration:** How to allow enabling features post-onboarding?
2. **Download Retry:** How to handle failed downloads?
3. **Progress Persistence:** Should we save partial download progress?
4. **Model Updates:** How to handle whisper model updates?
5. **Feature Discovery:** How to inform users about disabled features?
