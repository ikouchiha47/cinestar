import path from 'path';
import os from 'os';

/**
 * Get the unified data directory for the application
 * Development: ./data
 * Production: ~/.cinestar
 */
export function getDataDir(): string {
  // Prefer explicit env-provided dirs
  const envDir = process.env.CINESTAR_DATA_DIR || process.env.MAIN_DB_DIR;
  if (envDir && envDir.trim().length > 0) {
    return envDir;
  }

  // SIMPLE APPROACH: If VITE_DEV_SERVER_URL is set, we're in dev mode
  // Otherwise, we're in production (packaged app)
  const isDev = !!process.env.VITE_DEV_SERVER_URL;
  
  const dataDir = isDev 
    ? path.join(process.cwd(), 'data')
    : path.join(os.homedir(), '.cinestar');
  
  // Write marker file to confirm this function was called and what it returned
  try {
    const fs = require('fs');
    const markerPath = path.join(os.homedir(), '.cinestar', 'startup-marker.txt');
    fs.mkdirSync(path.dirname(markerPath), { recursive: true });
    fs.writeFileSync(markerPath, `getDataDir() called at ${new Date().toISOString()}\nVITE_DEV_SERVER_URL: ${process.env.VITE_DEV_SERVER_URL}\nisDev: ${isDev}\nReturning: ${dataDir}\n`, { flag: 'a' });
  } catch (e) {
    // Ignore errors
  }
  
  return dataDir;
}
