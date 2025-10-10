/**
 * User Preferences Management
 * 
 * Stores user preferences in a JSON file in app data directory
 * Handles onboarding state and feature enablement
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

export interface UserPreferences {
  onboardingComplete: boolean;
  featuresEnabled: {
    images: boolean;      // Always enabled
    videos: boolean;      // Requires whisper model
    audio: boolean;       // Requires whisper model
  };
  whisperModelDownloaded: boolean;
  firstLaunchDate?: string;
  lastModified: string;
  version: number;
}

const DEFAULT_PREFERENCES: UserPreferences = {
  onboardingComplete: false,
  featuresEnabled: {
    images: true,   // Always enabled
    videos: false,  // User must opt-in
    audio: false    // User must opt-in
  },
  whisperModelDownloaded: false,
  version: 1,
  lastModified: new Date().toISOString()
};

export class UserPreferencesManager {
  private static instance: UserPreferencesManager;
  private preferencesPath: string;
  private preferences: UserPreferences;

  private constructor() {
    // Store preferences in app data directory
    // macOS: ~/Library/Application Support/Cinestar/preferences.json
    // Linux: ~/.config/Cinestar/preferences.json
    // Windows: %APPDATA%/Cinestar/preferences.json
    const appDataPath = process.env.APPDATA || 
                        path.join(os.homedir(), process.platform === 'darwin' ? 'Library/Application Support' : '.config');
    
    const appDir = path.join(appDataPath, 'Cinestar');
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(appDir)) {
      fs.mkdirSync(appDir, { recursive: true });
    }
    
    this.preferencesPath = path.join(appDir, 'preferences.json');
    this.preferences = this.load();
  }

  static getInstance(): UserPreferencesManager {
    if (!UserPreferencesManager.instance) {
      UserPreferencesManager.instance = new UserPreferencesManager();
    }
    return UserPreferencesManager.instance;
  }

  /**
   * Load preferences from disk
   */
  private load(): UserPreferences {
    try {
      if (fs.existsSync(this.preferencesPath)) {
        const data = fs.readFileSync(this.preferencesPath, 'utf-8');
        const loaded = JSON.parse(data) as UserPreferences;
        
        // Merge with defaults to handle version upgrades
        return {
          ...DEFAULT_PREFERENCES,
          ...loaded,
          featuresEnabled: {
            ...DEFAULT_PREFERENCES.featuresEnabled,
            ...loaded.featuresEnabled
          }
        };
      }
    } catch (error) {
      console.error('[UserPreferences] Failed to load preferences:', error);
    }
    
    // Return defaults if file doesn't exist or failed to load
    return { ...DEFAULT_PREFERENCES };
  }

  /**
   * Save preferences to disk
   */
  private save(): void {
    try {
      this.preferences.lastModified = new Date().toISOString();
      fs.writeFileSync(
        this.preferencesPath, 
        JSON.stringify(this.preferences, null, 2),
        'utf-8'
      );
      console.log('[UserPreferences] Saved preferences to:', this.preferencesPath);
    } catch (error) {
      console.error('[UserPreferences] Failed to save preferences:', error);
    }
  }

  /**
   * Get current preferences
   */
  getPreferences(): UserPreferences {
    return { ...this.preferences };
  }

  /**
   * Check if onboarding is complete
   */
  isOnboardingComplete(): boolean {
    return this.preferences.onboardingComplete;
  }

  /**
   * Mark onboarding as complete
   */
  completeOnboarding(): void {
    this.preferences.onboardingComplete = true;
    if (!this.preferences.firstLaunchDate) {
      this.preferences.firstLaunchDate = new Date().toISOString();
    }
    this.save();
  }

  /**
   * Update feature enablement
   */
  setFeaturesEnabled(features: Partial<UserPreferences['featuresEnabled']>): void {
    this.preferences.featuresEnabled = {
      ...this.preferences.featuresEnabled,
      ...features
    };
    this.save();
  }

  /**
   * Check if a feature is enabled
   */
  isFeatureEnabled(feature: 'images' | 'videos' | 'audio'): boolean {
    return this.preferences.featuresEnabled[feature];
  }

  /**
   * Mark whisper model as downloaded
   */
  setWhisperModelDownloaded(downloaded: boolean): void {
    this.preferences.whisperModelDownloaded = downloaded;
    this.save();
  }

  /**
   * Check if whisper model is downloaded
   */
  isWhisperModelDownloaded(): boolean {
    return this.preferences.whisperModelDownloaded;
  }

  /**
   * Check if user needs whisper model (videos or audio enabled)
   */
  needsWhisperModel(): boolean {
    return this.preferences.featuresEnabled.videos || this.preferences.featuresEnabled.audio;
  }

  /**
   * Reset preferences to defaults (for testing)
   */
  reset(): void {
    this.preferences = { ...DEFAULT_PREFERENCES };
    this.save();
  }

  /**
   * Get preferences file path
   */
  getPreferencesPath(): string {
    return this.preferencesPath;
  }
}

// Export singleton instance
export const userPreferences = UserPreferencesManager.getInstance();
