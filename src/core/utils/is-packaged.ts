/**
 * Utility to detect if the app is running in packaged (production) mode or development mode
 * Uses VITE_DEV_SERVER_URL as the definitive indicator
 */
export function isPackaged(): boolean {
  // If VITE_DEV_SERVER_URL is set, we're in dev mode (Vite dev server is running)
  // Otherwise, we're in production (packaged app)
  return !process.env.VITE_DEV_SERVER_URL;
}

/**
 * Get the base path for bundled resources (migrations, extensions, etc.)
 */
export function getResourcesPath(): string {
  if (isPackaged()) {
    // In packaged app, resources are in app.asar.unpacked
    const appPath = process.resourcesPath || process.cwd();
    return appPath;
  } else {
    // In development, use project root
    return process.cwd();
  }
}
