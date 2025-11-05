I'll create a structured TODO list for the white-labeling work and scan the codebase to find all static occurrences of the current brand (Cinestar) and related identifiers. Then I'll pause for your review.





# White-labeling: Task List and Findings

## TODOs
- **[config-branding]** Add `branding` section in config (appName, appId, tagline, logoPath)
- **[ui-bindings]** Replace hardcoded UI strings with config-driven values (6 files)
- **[electron-title]** Use `branding.appName` for `BrowserWindow` title
- **[document-title]** Set `document.title` from branding on app boot (replace static index.html title)
- **[builder-params]** Parameterize [electron-builder.json5](cci:7://file:///Users/darksied/dev/pocs/drillbit/electron-builder.json5:0:0-0:0) (appId, productName, icon) via env/build vars
- **[data-dirs]** Centralize data paths to derive from branding (replace `.cinestar`/`Cinestar` paths)
- **[env-compat]** Introduce generic env var (e.g., `APP_DATA_DIR`) and keep `CINESTAR_DATA_DIR` as legacy alias
- **[assets]** Organize branding assets (logo, favicon, icons) with swappable folder or config path
- **[migration]** Optional: migrate existing user data (`~/.cinestar*`, `Application Support/Cinestar`) to new brand
- **[qa-build]** Verify app name, id, icons across mac/win/linux installers
- **[qa-ui]** Verify splash/onboarding/header show configured brand

I added this plan to the tracker and marked inventory as complete.

## Static Brand References Found

- **package.json**
  - `name: "cinestar.app"`

- **electron-builder.json5**
  - `appId: "com.cinestar.app"`
  - `productName: "Cinestar"`
  - `icon: "public/cinestar-app.png"` (root + per-platform)

- **index.html**
  - `<title>Cinestar - AI-Powered Video Search</title>`
  - `<link rel="icon" href="/favicon.ico">` (keep but consider brand-specific)

- **Electron (main process)**
  - [electron/main.ts](cci:7://file:///Users/darksied/dev/pocs/drillbit/electron/main.ts:0:0-0:0): `title: 'Cinestar'`

- **React UI (hardcoded strings / asset paths)**
  - [src/components/SimplifiedOnboarding.tsx](cci:7://file:///Users/darksied/dev/pocs/drillbit/src/components/SimplifiedOnboarding.tsx:0:0-0:0): “Welcome to Cinestar”
  - [src/components/onboarding/WelcomeScreen.tsx](cci:7://file:///Users/darksied/dev/pocs/drillbit/src/components/onboarding/WelcomeScreen.tsx:0:0-0:0): “Welcome to Cinestar”
  - [src/components/DrillbitLogoImage.tsx](cci:7://file:///Users/darksied/dev/pocs/drillbit/src/components/DrillbitLogoImage.tsx:0:0-0:0): `src="./cinestar-app.png"`
  - [src/components/v2/DrillerV2.tsx](cci:7://file:///Users/darksied/dev/pocs/drillbit/src/components/v2/DrillerV2.tsx:0:0-0:0): “Cinestar”
  - [src/components/PortalSplash.tsx](cci:7://file:///Users/darksied/dev/pocs/drillbit/src/components/PortalSplash.tsx:0:0-0:0): “Cinestar”
  - [src/components/SplashScreen.tsx](cci:7://file:///Users/darksied/dev/pocs/drillbit/src/components/SplashScreen.tsx:0:0-0:0): “Cinestar”

- **Brand-specific data directories / env**
  - [src/core/utils/data-dir.ts](cci:7://file:///Users/darksied/dev/pocs/drillbit/src/core/utils/data-dir.ts:0:0-0:0): `~/.cinestar`, marker at `~/.cinestar/startup-marker.txt`, `CINESTAR_DATA_DIR`
  - [src/core/config.ts](cci:7://file:///Users/darksied/dev/pocs/drillbit/src/core/config.ts:0:0-0:0): default DB when prod → `~/.cinestar/vector.db`
  - [src/core/video-processing.ts](cci:7://file:///Users/darksied/dev/pocs/drillbit/src/core/video-processing.ts:0:0-0:0): prod cache → `~/.cinestar/cache`
  - [src/core/data-migrator.ts](cci:7://file:///Users/darksied/dev/pocs/drillbit/src/core/data-migrator.ts:0:0-0:0), [src/main/llm-config-handler.ts](cci:7://file:///Users/darksied/dev/pocs/drillbit/src/main/llm-config-handler.ts:0:0-0:0): fallback `~/.cinestar-app`
  - `src/core/processors/whisper-*.ts`: prod models under `Application Support/Cinestar/whisper-models` and env `CINESTAR_DATA_DIR`

- **Assets**
  - [public/cinestar-app.png](cci:7://file:///Users/darksied/dev/pocs/drillbit/public/Users/darksied/dev/pocs/drillbit/public/cinestar-app.png:0:0-0:0)
  - [public/favicon.ico](cci:7://file:///Users/darksied/dev/pocs/drillbit/public/Users/darksied/dev/pocs/drillbit/public/favicon.ico:0:0-0:0)
  - `public/icons/icon-*.png` (used by builder config and main window icon)

- **Docs/Logs (optional to change)**
  - Various references to “Cinestar” in docs and logs (non-functional)

## Recommended Changes (High Level)
- **Config-first branding**: Add `branding` to [config.template.json](cci:7://file:///Users/darksied/dev/pocs/drillbit/config.template.json:0:0-0:0) and a getter in ConfigManager, then swap hardcoded strings to use it.
- **Build-time overrides**: Allow `APP_NAME`, `APP_ID`, `APP_LOGO` envs for [electron-builder.json5](cci:7://file:///Users/darksied/dev/pocs/drillbit/electron-builder.json5:0:0-0:0) (via build script interpolation).
- **Path abstraction**: Centralize data-dir logic to compute brand-aware paths based on `branding.appName` with legacy compatibility for `CINESTAR_DATA_DIR` and existing `~/.cinestar*`.

## Open Questions
- Do you want env-based overrides for builders (APP_NAME/APP_ID) or config-only?
- Keep backward compatibility for existing `~/.cinestar*` data or force a clean brand separation?

# Status
- Task list prepared and tracked.
- Codebase scan completed; all known static occurrences listed.
- Waiting for your review before implementing.