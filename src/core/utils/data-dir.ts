import path from 'path';
import os from 'os';

/**
 * Get the unified data directory for the application
 * Development: ./data
 * Production: ~/.clipwise
 */
export function getDataDir(): string {
  // Prefer explicit env-provided dirs
  const envDir = process.env.CLIPWISE_DATA_DIR || process.env.MAIN_DB_DIR;
  if (envDir && envDir.trim().length > 0) {
    return envDir;
  }

  const isProduction = process.env.NODE_ENV === 'production' || (process as any).resourcesPath;
  if (isProduction) {
    return path.join(os.homedir(), '.clipwise');
  }
  return path.join(process.cwd(), 'data');
}
