/**
 * Branding configuration - safe for renderer process
 * This module doesn't import Node.js modules, making it safe for browser context
 */

export interface BrandingConfig {
  appName: string;
  tagline: string;
  logoPath: string;
}

export const DEFAULT_BRANDING: BrandingConfig = {
  appName: "Cinestar",
  tagline: "AI-Powered Media Search",
  logoPath: "./cinestar-app.png"
};

/**
 * Branding manager - safe for renderer process
 * Reads from window.electronAPI if available, falls back to defaults
 */
export class BrandingManager {
  private static branding: BrandingConfig | null = null;

  /**
   * Get branding configuration
   * In renderer: reads from window.electronAPI.getBranding()
   * In main: reads from ConfigManager
   */
  static getBranding(): BrandingConfig {
    // Return cached value if available
    if (this.branding) {
      console.log('[BRANDING] Using cached branding:', this.branding);
      return this.branding;
    }

    // Try to get from Electron IPC (renderer process)
    if (typeof window !== 'undefined' && (window as any).electronAPI?.getBranding) {
      try {
        console.log('[BRANDING] Calling IPC getBranding...');
        const brandingFromIPC = (window as any).electronAPI.getBranding();
        console.log('[BRANDING] Got branding from IPC:', brandingFromIPC);
        if (brandingFromIPC) {
          this.branding = brandingFromIPC;
          return this.branding;
        }
      } catch (error) {
        console.error('[BRANDING] Failed to get branding from IPC:', error);
      }
    } else {
      console.warn('[BRANDING] electronAPI.getBranding not available, window:', typeof window, 'electronAPI:', !!(window as any).electronAPI);
    }

    // Fallback to defaults
    console.warn('[BRANDING] Using default branding (fallback)');
    this.branding = DEFAULT_BRANDING;
    return this.branding;
  }

  /**
   * Set branding (for testing or runtime updates)
   */
  static setBranding(branding: BrandingConfig): void {
    this.branding = branding;
  }

  /**
   * Clear cached branding (force reload)
   */
  static clearCache(): void {
    this.branding = null;
  }
}
