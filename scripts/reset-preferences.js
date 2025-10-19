#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const preferencesPath = path.join(__dirname, '..', 'data', 'preferences.json');
const defaultPreferencesPath = path.join(__dirname, '..', 'data', 'preferences.default.json');

try {
  // Read the default preferences
  const defaultPreferences = JSON.parse(fs.readFileSync(defaultPreferencesPath, 'utf8'));
  
  // Write the default preferences to preferences.json
  fs.writeFileSync(preferencesPath, JSON.stringify(defaultPreferences, null, 2));
  
  console.log('✅ Preferences reset to default values');
  console.log('Welcome screen will be shown on next startup');

  // Also reset onboarding gating in config.*.json so welcome flow appears
  const configDevPath = path.join(__dirname, '..', 'data', 'config.dev.json');
  const configProdPath = path.join(__dirname, '..', 'data', 'config.json');
  const configPath = fs.existsSync(configDevPath) ? configDevPath : configProdPath;

  try {
    if (fs.existsSync(configPath)) {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      cfg.onboarding = { ...(cfg.onboarding || {}), complete: false, firstLaunchDate: null };
      // modelDownloaded now derives from preferences via config:get; no need to touch here
      cfg.lastModified = new Date().toISOString();
      fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
      console.log(`✅ Onboarding reset in ${path.basename(configPath)}`);
    } else {
      console.log('ℹ️ No config file found to reset (it will be created by the app on launch)');
    }
  } catch (e) {
    console.warn('⚠️ Failed to reset onboarding in config:', e.message);
  }
} catch (error) {
  console.error('❌ Failed to reset preferences:', error.message);
  process.exit(1);
}
