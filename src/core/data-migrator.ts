import fs from 'fs';
import path from 'path';
import os from 'os';
import { app } from 'electron';

export interface MigrationResult {
  success: boolean;
  migratedFiles: string[];
  errors: string[];
  totalSize: number;
}

export class DataMigrator {
  private static readonly LEGACY_PATHS = [
    path.join(os.homedir(), '.driller'),
    path.join(os.homedir(), '.clipwise'),
    './data', // Development path
  ];

  private static readonly CURRENT_DATA_DIR = app?.getPath('userData') || 
    path.join(os.homedir(), '.cinestar-app');

  /**
   * Migrate data from previous installations
   */
  static async migrateFromPreviousInstallations(): Promise<MigrationResult> {
    const result: MigrationResult = {
      success: true,
      migratedFiles: [],
      errors: [],
      totalSize: 0
    };

    console.log('[MIGRATION] Starting data migration check...');
    console.log('[MIGRATION] Current data directory:', this.CURRENT_DATA_DIR);

    // Ensure current data directory exists
    await this.ensureDirectory(this.CURRENT_DATA_DIR);

    // Check each legacy path
    for (const legacyPath of this.LEGACY_PATHS) {
      if (fs.existsSync(legacyPath)) {
        console.log(`[MIGRATION] Found legacy data at: ${legacyPath}`);
        await this.migratePath(legacyPath, result);
      }
    }

    if (result.migratedFiles.length > 0) {
      console.log(`[MIGRATION] Migration completed: ${result.migratedFiles.length} files, ${this.formatBytes(result.totalSize)}`);
    } else {
      console.log('[MIGRATION] No legacy data found to migrate');
    }

    return result;
  }

  /**
   * Clean up temporary files based on settings
   */
  static async cleanupTemporaryFiles(debugMode: boolean = false): Promise<void> {
    const cleanupPaths = [
      './.cache',                                  // dev cache
      path.join(os.homedir(), '.cinestar', 'cache'), // prod cache
      './debug-output',
      path.join(os.tmpdir(), 'driller-compressed'),
      './.temp_frames_batch'
    ];

    console.log(`[CLEANUP] Starting cleanup (debug mode: ${debugMode})`);

    for (const cleanupPath of cleanupPaths) {
      if (fs.existsSync(cleanupPath)) {
        try {
          if (debugMode) {
            console.log(`[CLEANUP] Skipping ${cleanupPath} (debug mode enabled)`);
            continue;
          }

          const stats = await fs.promises.stat(cleanupPath);
          if (stats.isDirectory()) {
            await fs.promises.rm(cleanupPath, { recursive: true, force: true });
            console.log(`[CLEANUP] Removed directory: ${cleanupPath}`);
          } else {
            await fs.promises.unlink(cleanupPath);
            console.log(`[CLEANUP] Removed file: ${cleanupPath}`);
          }
        } catch (error) {
          console.warn(`[CLEANUP] Failed to remove ${cleanupPath}:`, error);
        }
      }
    }
  }

  /**
   * Get data directory for current installation
   */
  static getCurrentDataDirectory(): string {
    return this.CURRENT_DATA_DIR;
  }

  /**
   * Check if this is a fresh installation
   */
  static isFreshInstallation(): boolean {
    const mainDb = path.join(this.CURRENT_DATA_DIR, 'vector.db');
    const configFile = path.join(this.CURRENT_DATA_DIR, 'config.json');
    
    return !fs.existsSync(mainDb) && !fs.existsSync(configFile);
  }

  /**
   * Create backup of current data
   */
  static async createBackup(): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(this.CURRENT_DATA_DIR, `backup-${timestamp}`);
    
    await this.ensureDirectory(backupDir);
    
    // Copy important files
    const filesToBackup = [
      'vector.db',
      'video-rag.db', 
      'config.json',
      'sources.json'
    ];

    for (const file of filesToBackup) {
      const sourcePath = path.join(this.CURRENT_DATA_DIR, file);
      const targetPath = path.join(backupDir, file);
      
      if (fs.existsSync(sourcePath)) {
        await fs.promises.copyFile(sourcePath, targetPath);
        console.log(`[BACKUP] Backed up: ${file}`);
      }
    }

    console.log(`[BACKUP] Backup created at: ${backupDir}`);
    return backupDir;
  }

  private static async migratePath(sourcePath: string, result: MigrationResult): Promise<void> {
    try {
      const files = await fs.promises.readdir(sourcePath, { withFileTypes: true });
      
      for (const file of files) {
        const sourceFile = path.join(sourcePath, file.name);
        const targetFile = path.join(this.CURRENT_DATA_DIR, file.name);

        if (file.isFile() && this.shouldMigrateFile(file.name)) {
          // Don't overwrite existing files
          if (!fs.existsSync(targetFile)) {
            await fs.promises.copyFile(sourceFile, targetFile);
            const stats = await fs.promises.stat(sourceFile);
            
            result.migratedFiles.push(file.name);
            result.totalSize += stats.size;
            
            console.log(`[MIGRATION] Migrated: ${file.name} (${this.formatBytes(stats.size)})`);
          } else {
            console.log(`[MIGRATION] Skipped existing: ${file.name}`);
          }
        }
      }
    } catch (error) {
      const errorMsg = `Failed to migrate from ${sourcePath}: ${error}`;
      result.errors.push(errorMsg);
      result.success = false;
      console.error(`[MIGRATION] ${errorMsg}`);
    }
  }

  private static shouldMigrateFile(filename: string): boolean {
    const importantFiles = [
      'vector.db',
      'video-rag.db',
      'config.json',
      'sources.json',
      'user-preferences.json'
    ];
    
    return importantFiles.includes(filename) || 
           filename.endsWith('.db') || 
           filename.endsWith('.json');
  }

  private static async ensureDirectory(dirPath: string): Promise<void> {
    if (!fs.existsSync(dirPath)) {
      await fs.promises.mkdir(dirPath, { recursive: true });
    }
  }

  private static formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}
