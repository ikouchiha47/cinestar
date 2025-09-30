/**
 * Unified Migration System
 * Replaces the fragmented migration approach with a single, coordinated system
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

export interface UnifiedMigrationResult {
  success: boolean;
  error?: string;
  migrationsRun: string[];
  videoDB: {
    path: string;
    migrationsApplied: number;
  };
  mediaDB: {
    path: string;
    migrationsApplied: number;
  };
}

export class UnifiedMigrator {
  private videoDbPath: string;
  private mediaDbPath: string;
  private migrationsDir: string;

  constructor(dataDir?: string) {
    const defaultDataDir = dataDir || this.getDefaultDataDir();
    
    this.videoDbPath = path.join(defaultDataDir, 'video-rag.db');
    this.mediaDbPath = path.join(defaultDataDir, 'vector.db');
    
    // Use the new unified migrations directory
    this.migrationsDir = this.getMigrationsDir();
  }

  private getDefaultDataDir(): string {
    const isProduction = process.env.NODE_ENV === 'production' || process.resourcesPath;
    
    if (isProduction) {
      // Production: use user data directory  
      return path.join(os.homedir(), '.clipwise');
    } else {
      // Development: use project data directory
      return path.join(process.cwd(), 'data');
    }
  }

  private getMigrationsDir(): string {
    // Use proper Electron packaged detection - app.isPackaged is the reliable way
    const isPackaged = process.env.NODE_ENV === 'production' && process.resourcesPath && !process.env.VITE_DEV_SERVER_URL;
    
    console.log(`[UNIFIED-MIGRATION-DEBUG] isPackaged: ${isPackaged}, NODE_ENV: ${process.env.NODE_ENV}, resourcesPath: ${process.resourcesPath}, VITE_DEV_SERVER_URL: ${process.env.VITE_DEV_SERVER_URL}`);
    
    if (isPackaged) {
      // In packaged app, migrations are in the app bundle
      const appPath = process.resourcesPath || path.dirname(process.execPath);
      const migrationsPath = path.join(appPath, 'app.asar.unpacked', 'migrations_flat');
      console.log(`[UNIFIED-MIGRATION-DEBUG] Using packaged migrations path: ${migrationsPath}`);
      return migrationsPath;
    } else {
      // In development, use project root
      const migrationsPath = path.join(process.cwd(), 'migrations_flat');
      console.log(`[UNIFIED-MIGRATION-DEBUG] Using dev migrations path: ${migrationsPath}`);
      return migrationsPath;
    }
  }

  private ensureDirectoriesExist(): void {
    // Ensure database directories exist
    [path.dirname(this.videoDbPath), path.dirname(this.mediaDbPath)].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  private createSchemaMigrationsTable(dbPath: string): void {
    const sql = `CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      filename TEXT NOT NULL,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );`;
    
    try {
      execSync(`sqlite3 "${dbPath}" "${sql}"`, { stdio: 'pipe' });
    } catch (error) {
      console.error(`Failed to create schema_migrations table in ${dbPath}:`, error);
      throw error;
    }
  }

  private getAppliedMigrations(dbPath: string): number[] {
    try {
      const result = execSync(`sqlite3 "${dbPath}" "SELECT version FROM schema_migrations ORDER BY version;"`, { 
        encoding: 'utf8',
        stdio: 'pipe'
      });
      return result.trim().split('\n').filter(v => v).map(v => parseInt(v));
    } catch (error) {
      // If query fails, assume no migrations have been applied
      return [];
    }
  }

  private determineTargetDatabase(migrationContent: string): string {
    const content = migrationContent.toLowerCase();
    
    // Check for explicit sql directive: -- sql: db:video-rag or -- sql: db:vector
    const dbDirectiveMatch = content.match(/--\s*sql:\s*db:(\S+)/);
    if (dbDirectiveMatch) {
      const dbName = dbDirectiveMatch[1];
      if (dbName === 'video-rag') {
        return this.videoDbPath;
      }
      if (dbName === 'vector') {
        return this.mediaDbPath;
      }
    }
    
    // Check for explicit database indicators in comments (legacy)
    if (content.includes('target: video database') || content.includes('video database')) {
      return this.videoDbPath;
    }
    if (content.includes('target: media database') || content.includes('media database')) {
      return this.mediaDbPath;
    }
    
    // Check for table names that indicate which database
    if (content.includes('video_files') || 
        content.includes('video_segments') || 
        content.includes('video_processing_jobs') ||
        content.includes('processing_batches') ||
        content.includes('transcription_segments') ||
        content.includes('batch_keyframes')) {
      return this.videoDbPath;
    }
    if (content.includes('media_sources') || content.includes('media_items') || content.includes('media_fts') || content.includes('indexing_jobs')) {
      return this.mediaDbPath;
    }
    
    // Check for specific migration patterns
    if (content.includes('vec_embeddings') || content.includes('vector_meta')) {
      return this.mediaDbPath;
    }
    
    // Default to media database (safer fallback)
    return this.mediaDbPath;
  }

  private applyMigration(migrationFile: string, targetDb: string): void {
    const migrationPath = path.join(this.migrationsDir, migrationFile);
    const version = parseInt(migrationFile.split('_')[0]);
    // Normalize version for recording: 101->1, 102->2, 103->3
    const normalizedVersion = version > 100 ? version - 100 : version;
    
    try {
      console.log(`[UNIFIED-MIGRATION] Applying ${migrationFile} to ${path.basename(targetDb)}...`);
    } catch (e) {
      // Ignore EPIPE errors in production
    }
    
    try {
      // Apply the migration
      execSync(`sqlite3 "${targetDb}" < "${migrationPath}"`, { stdio: 'pipe' });
      
      // Record the migration
      const recordSql = `INSERT INTO schema_migrations (version, filename) VALUES (${normalizedVersion}, '${migrationFile}');`;
      execSync(`sqlite3 "${targetDb}" "${recordSql}"`, { stdio: 'pipe' });
      
      try {
        console.log(`[UNIFIED-MIGRATION] ✅ Applied ${migrationFile}`);
      } catch (e) {
        // Ignore EPIPE errors in production
      }
    } catch (error) {
      // Handle benign idempotency errors gracefully so we can continue
      const msg = (error && (error as any).stderr ? String((error as any).stderr) : String((error as any)?.message || error)).toLowerCase();
      const isBenignDuplicate =
        msg.includes('duplicate column name') ||
        msg.includes('already exists') ||
        msg.includes('table ') && msg.includes(' already exists') ||
        msg.includes('index ') && msg.includes(' already exists') ||
        msg.includes('trigger ') && msg.includes(' already exists') ||
        msg.includes('unique constraint failed: schema_migrations');

      if (isBenignDuplicate) {
        try {
          console.warn(`[UNIFIED-MIGRATION] ⚠️  Benign duplicate while applying ${migrationFile}. Treating as already applied.`);
        } catch {}
        // Still record the migration so we don't retry it
        try {
          const recordSql = `INSERT INTO schema_migrations (version, filename) VALUES (${normalizedVersion}, '${migrationFile}');`;
          execSync(`sqlite3 "${targetDb}" "${recordSql}"`, { stdio: 'pipe' });
        } catch (e) {
          // If recording fails due to PK conflict, it's already recorded; continue
        }
        return; // Continue with next migration
      }

      // Non-benign error: rethrow
      console.error(`[UNIFIED-MIGRATION] ❌ Failed to apply ${migrationFile}:`, error);
      throw error;
    }
  }

  async migrate(): Promise<UnifiedMigrationResult> {
    try {
      try {
        console.log('[UNIFIED-MIGRATION] Starting unified database migrations...');
      } catch (e) {
        // Ignore EPIPE errors in production
      }
      
      // Ensure directories exist
      this.ensureDirectoriesExist();
      
      // Create schema_migrations tables
      this.createSchemaMigrationsTable(this.videoDbPath);
      this.createSchemaMigrationsTable(this.mediaDbPath);
      
      // Get applied migrations for both databases
      const appliedVideoMigrations = this.getAppliedMigrations(this.videoDbPath);
      const appliedMediaMigrations = this.getAppliedMigrations(this.mediaDbPath);
      
      console.log(`[UNIFIED-MIGRATION] Video DB: ${appliedVideoMigrations.length} migrations applied`);
      console.log(`[UNIFIED-MIGRATION] Media DB: ${appliedMediaMigrations.length} migrations applied`);
      
      // Get all migration files
      if (!fs.existsSync(this.migrationsDir)) {
        console.warn(`[UNIFIED-MIGRATION] Migrations directory not found: ${this.migrationsDir}`);
        return {
          success: true,
          migrationsRun: [],
          videoDB: { path: this.videoDbPath, migrationsApplied: appliedVideoMigrations.length },
          mediaDB: { path: this.mediaDbPath, migrationsApplied: appliedMediaMigrations.length }
        };
      }
      
      const migrationFiles = fs.readdirSync(this.migrationsDir)
        .filter(f => f.endsWith('.sql') && f.match(/^\d+_/))
        .sort((a, b) => {
          const versionA = parseInt(a.split('_')[0]);
          const versionB = parseInt(b.split('_')[0]);
          // Handle the renumbering: 101->1, 102->2, 103->3, then 4,5,6...
          const normalizeVersion = (v: number) => v > 100 ? v - 100 : v;
          return normalizeVersion(versionA) - normalizeVersion(versionB);
        });
      
      const migrationsRun: string[] = [];
      
      for (const migrationFile of migrationFiles) {
        const version = parseInt(migrationFile.split('_')[0]);
        // Normalize version for checking: 101->1, 102->2, 103->3
        const normalizedVersion = version > 100 ? version - 100 : version;
        const migrationContent = fs.readFileSync(path.join(this.migrationsDir, migrationFile), 'utf8');
        const targetDb = this.determineTargetDatabase(migrationContent);
        
        // Check if migration has been applied to the target database
        const appliedMigrations = targetDb === this.videoDbPath ? appliedVideoMigrations : appliedMediaMigrations;
        
        if (!appliedMigrations.includes(normalizedVersion)) {
          this.applyMigration(migrationFile, targetDb);
          migrationsRun.push(migrationFile);
        } else {
          console.log(`[UNIFIED-MIGRATION] ⏭️  Skipping ${migrationFile} (already applied)`);
        }
      }
      
      console.log(`[UNIFIED-MIGRATION] 🎉 Migration complete! Applied ${migrationsRun.length} new migrations.`);
      
      return {
        success: true,
        migrationsRun,
        videoDB: { 
          path: this.videoDbPath, 
          migrationsApplied: this.getAppliedMigrations(this.videoDbPath).length 
        },
        mediaDB: { 
          path: this.mediaDbPath, 
          migrationsApplied: this.getAppliedMigrations(this.mediaDbPath).length 
        }
      };
      
    } catch (error) {
      console.error('[UNIFIED-MIGRATION] Migration failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown migration error',
        migrationsRun: [],
        videoDB: { path: this.videoDbPath, migrationsApplied: 0 },
        mediaDB: { path: this.mediaDbPath, migrationsApplied: 0 }
      };
    }
  }
}

// Helper function for backward compatibility
export function getDefaultDataDir(): string {
  const isProduction = process.env.NODE_ENV === 'production' || process.resourcesPath;
  
  if (isProduction) {
    return path.join(os.homedir(), '.clipwise');
  } else {
    return path.join(process.cwd(), 'data');
  }
}
