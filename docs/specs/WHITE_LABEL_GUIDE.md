# White Label Configuration Guide

## Overview
This guide shows all the changes needed to rebrand the app from "Cinestar" to your custom brand name.

## Current Brand References

### 1. **Package Configuration**
- **File**: `package.json`
  - Line 2: `"name": "cinestar.app"`
  
### 2. **Electron Builder Configuration**
- **File**: `electron-builder.json5`
  - Line 4: `"appId": "com.cinestar.app"`
  - Line 6: `"productName": "Cinestar"`
  - Lines 10, 38, 50, 66: `"icon": "public/cinestar-app.png"`

### 3. **HTML Title**
- **File**: `index.html`
  - Line 7: `<title>Cinestar - AI-Powered Video Search</title>`

### 4. **Electron Main Process**
- **File**: `electron/main.ts`
  - Line 105: `title: 'Cinestar'`

### 5. **React Components** (6 files)
- `src/components/SimplifiedOnboarding.tsx` - Line 371: "Welcome to Cinestar"
- `src/components/onboarding/WelcomeScreen.tsx` - Line 34: "Welcome to Cinestar"
- `src/components/DrillbitLogoImage.tsx` - Line 36: `src="./cinestar-app.png"`
- `src/components/v2/DrillerV2.tsx` - Line 532: "Cinestar"
- `src/components/PortalSplash.tsx` - Line 49: "Cinestar"
- `src/components/SplashScreen.tsx` - Line 128: "Cinestar"

### 6. **Assets**
- **Logo Files**:
  - `public/cinestar-app.png` (main app icon)
  - `public/app-logo.png` (alternative logo)
  - `public/favicon.ico`
  - `public/icons/icon-*.png` (16, 32, 64, 128, 256, 512)

## Recommended Solution: Environment-Based Configuration

### Option A: Add Branding to Config File (Recommended)

Add a `branding` section to `config.template.json`:

```json
{
  "version": 1,
  "branding": {
    "appName": "Cinestar",
    "appId": "com.cinestar.app",
    "tagline": "AI-Powered Video Search",
    "logoPath": "./cinestar-app.png"
  },
  "onboarding": {
    ...
  }
}
```

### Option B: Environment Variables

Create a `.env` file:
```
VITE_APP_NAME=Cinestar
VITE_APP_ID=com.cinestar.app
VITE_APP_TAGLINE=AI-Powered Video Search
VITE_LOGO_PATH=./cinestar-app.png
```

## Implementation Steps

### Step 1: Add Branding Config
1. Update `config.template.json` with branding section
2. Create TypeScript interface for branding config
3. Load branding from config in ConfigManager

### Step 2: Update Components
Replace hardcoded strings with config values:
```tsx
// Before
<h1>Welcome to Cinestar</h1>

// After
<h1>Welcome to {config.branding.appName}</h1>
```

### Step 3: Update Build Configuration
Use config values in `electron-builder.json5`:
```json5
{
  "appId": "${env.APP_ID}",
  "productName": "${env.APP_NAME}",
  "icon": "${env.LOGO_PATH}"
}
```

### Step 4: Asset Management
Create a branding assets folder structure:
```
public/
  branding/
    default/
      app-logo.png
      favicon.ico
      icons/
    custom/
      app-logo.png
      favicon.ico
      icons/
```

## Files That Need Changes

### Core Configuration (3 files)
1. ✅ `package.json` - app name
2. ✅ `electron-builder.json5` - appId, productName, icon paths
3. ✅ `index.html` - page title

### Code Files (7 files)
4. ✅ `electron/main.ts` - window title
5. ✅ `src/components/SimplifiedOnboarding.tsx` - welcome text
6. ✅ `src/components/onboarding/WelcomeScreen.tsx` - welcome text
7. ✅ `src/components/DrillbitLogoImage.tsx` - logo path
8. ✅ `src/components/v2/DrillerV2.tsx` - app name in UI
9. ✅ `src/components/PortalSplash.tsx` - splash screen name
10. ✅ `src/components/SplashScreen.tsx` - splash screen name

### Assets (9 files)
11. ✅ `public/cinestar-app.png` - main logo
12. ✅ `public/app-logo.png` - alternative logo
13. ✅ `public/favicon.ico` - browser icon
14-19. ✅ `public/icons/icon-*.png` - app icons (6 sizes)

## Quick Rebrand Checklist

To rebrand from "Cinestar" to "YourBrand":

- [ ] Update `package.json` name
- [ ] Update `electron-builder.json5` appId and productName
- [ ] Update `index.html` title
- [ ] Update `electron/main.ts` window title
- [ ] Update 6 React component files (search for "Cinestar")
- [ ] Replace logo files in `public/` directory
- [ ] Replace icon files in `public/icons/` directory
- [ ] Update favicon.ico

## Automation Script

A script could be created to automate this:
```bash
#!/bin/bash
# rebrand.sh <new-name> <new-app-id> <logo-path>
```

Would you like me to:
1. Implement the config-based branding system?
2. Create a rebranding automation script?
3. Both?
