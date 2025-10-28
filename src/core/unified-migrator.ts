/**
 * Unified Migration System
 * Replaces the fragmented migration approach with a single, coordinated system
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { isPackaged, getResourcesPath } from './utils/is-packaged';
import { pathToFileURL } from 'url';

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
  private mediaDbPath: string; // legacy vector.db
  private canonicalMediaDbPath: string; // media.db (new canonical)
  private imageSearchDbPath: string; // image_search.db
  private avSearchDbPath: string; // av_search.db
  private jobsDbPath: string; // jobs.db
  private configDbPath: string; // config.db
  private migrationsDir: string;
  private scriptsDir: string;
  private dataDirRoot: string;

  constructor(dataDir?: string) {
    const defaultDataDir = dataDir || this.getDefaultDataDir();
    this.dataDirRoot = defaultDataDir;
    
    this.videoDbPath = path.join(defaultDataDir, 'video-rag.db');
    this.mediaDbPath = path.join(defaultDataDir, 'vector.db');
    this.canonicalMediaDbPath = path.join(defaultDataDir, 'media.db');
    this.imageSearchDbPath = path.join(defaultDataDir, 'image_search.db');
    this.avSearchDbPath = path.join(defaultDataDir, 'av_search.db');
    this.jobsDbPath = path.join(defaultDataDir, 'jobs.db');
    this.configDbPath = path.join(defaultDataDir, 'config.db');
    
    // Use the new unified migrations directory
    this.migrationsDir = this.getMigrationsDir();
    this.scriptsDir = this.getScriptsDir();
  }

  private getSqliteVecExtensionPath(): string {
    const packed = isPackaged();
    const basePath = packed
      ? path.join(getResourcesPath(), 'app.asar.unpacked')
      : process.cwd();
    const platform = process.platform;
    const arch = process.arch;
    let extensionPath: string;
    if (platform === 'darwin' && arch === 'arm64') {
      extensionPath = path.resolve(basePath, 'node_modules/sqlite-vec-darwin-arm64/vec0.dylib');
    } else if (platform === 'darwin' && arch === 'x64') {
      extensionPath = path.resolve(basePath, 'node_modules/sqlite-vec-darwin-x64/vec0.dylib');
    } else if (platform === 'linux' && arch === 'x64') {
      extensionPath = path.resolve(basePath, 'node_modules/sqlite-vec-linux-x64/vec0.so');
    } else if (platform === 'linux' && arch === 'arm64') {
      extensionPath = path.resolve(basePath, 'node_modules/sqlite-vec-linux-arm64/vec0.so');
    } else if (platform === 'win32' && arch === 'x64') {
      extensionPath = path.resolve(basePath, 'node_modules/sqlite-vec-windows-x64/vec0.dll');
    } else {
      throw new Error(`Unsupported platform for sqlite-vec: ${platform}-${arch}`);
    }
    return extensionPath;
  }

  private getScriptsDir(): string {
    const packed = isPackaged();
    if (packed) {
      const appPath = getResourcesPath();
      const scriptsPath = path.join(appPath, 'app.asar.unpacked', 'migrations_scripts');
      console.log(`[UNIFIED-MIGRATION-DEBUG] Using packaged scripts path: ${scriptsPath}`);
      return scriptsPath;
    } else {
      const scriptsPath = path.join(process.cwd(), 'migrations_scripts');
      console.log(`[UNIFIED-MIGRATION-DEBUG] Using dev scripts path: ${scriptsPath}`);
      return scriptsPath;
    }
  }

  private getDefaultDataDir(): string {
    if (isPackaged()) {
      // Production: use user data directory  
      return path.join(os.homedir(), '.clipwise');
    } else {
      // Development: use project data directory
      return path.join(process.cwd(), 'data');
    }
  }

  private getMigrationsDir(): string {
    // Use common utility for consistent packaged detection
    const packed = isPackaged();
    
    console.log(`[UNIFIED-MIGRATION-DEBUG] isPackaged: ${packed}, VITE_DEV_SERVER_URL: ${process.env.VITE_DEV_SERVER_URL}`);
    console.log(`[UNIFIED-MIGRATION-DEBUG] resourcesPath: ${process.resourcesPath}`);
    console.log(`[UNIFIED-MIGRATION-DEBUG] process.cwd(): ${process.cwd()}`);
    
    if (packed) {
      // In packaged app, migrations are in app.asar.unpacked
      const appPath = getResourcesPath();
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
    [
      path.dirname(this.videoDbPath),
      path.dirname(this.mediaDbPath),
      path.dirname(this.canonicalMediaDbPath),
      path.dirname(this.imageSearchDbPath),
      path.dirname(this.avSearchDbPath),
      path.dirname(this.jobsDbPath),
      path.dirname(this.configDbPath)
    ].forEach(dir => {
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
      if (dbName === 'media') {
        return this.canonicalMediaDbPath;
      }
      if (dbName === 'image_search') {
        return this.imageSearchDbPath;
      }
      if (dbName === 'av_search') {
        return this.avSearchDbPath;
      }
      if (dbName === 'jobs') {
        return this.jobsDbPath;
      }
      if (dbName === 'config') {
        return this.configDbPath;
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
    
    // Default to legacy media (vector) database (safer fallback for old migrations)
    return this.mediaDbPath;
  }

  private applyMigration(migrationFile: string, targetDb: string): void {
    const migrationPath = path.join(this.migrationsDir, migrationFile);
    const version = parseInt(migrationFile.split('_')[0]);
    // Normalize version for recording: 101->1, 102->2, 103->3
    const normalizedVersion = version > 100 ? version - 100 : version;
    const content = fs.readFileSync(migrationPath, 'utf8');
    // Detect attach directives: -- sql: attach:<role>
    const attachMatches = Array.from(content.matchAll(/--\s*sql:\s*attach:(\S+)/g)).map(m => m[1]);
    const uniqueAttaches = Array.from(new Set(attachMatches));
    let scriptPathToApply = migrationPath;
    let tempScriptPath: string | null = null;
    // Detect if sqlite-vec (vec0) is referenced in this migration
    const needsVecExtension = /using\s+vec0|vec0\s*\(/i.test(content);
    if (uniqueAttaches.length > 0 || needsVecExtension) {
      const roleToPath = (role: string): string | null => {
        switch (role) {
          case 'video-rag': return this.videoDbPath;
          case 'video_rag': return this.videoDbPath;
          case 'vector': return this.mediaDbPath;
          case 'media': return this.canonicalMediaDbPath;
          case 'image_search': return this.imageSearchDbPath;
          case 'av_search': return this.avSearchDbPath;
          case 'jobs': return this.jobsDbPath;
          case 'config': return this.configDbPath;
          default: return null;
        }
      };
      const preludeLines: string[] = [];
      if (needsVecExtension) {
        try {
          const extPath = this.getSqliteVecExtensionPath();
          const exists = fs.existsSync(extPath);
          console.log(`[UNIFIED-MIGRATION-DEBUG] Loading sqlite-vec for CLI migration: ${extPath} (exists: ${exists})`);
          if (exists) {
            // Use sqlite3 CLI dot-command to load extension
            preludeLines.push(`.load '${extPath.replace(/'/g, "''")}'`);
          } else {
            console.warn(`[UNIFIED-MIGRATION-DEBUG] sqlite-vec extension not found at ${extPath}. Migration may fail if it uses vec0.`);
          }
        } catch (e) {
          console.warn(`[UNIFIED-MIGRATION-DEBUG] Could not resolve sqlite-vec extension path:`, e);
        }
      }
      if (uniqueAttaches.length > 0) {
        preludeLines.push(
          ...uniqueAttaches
            .map(role => {
              const p = roleToPath(role);
              if (!p) return '';
              return `ATTACH '${p.replace(/'/g, "''")}' AS ${role};`;
            })
            .filter(Boolean)
        );
      }
      if (preludeLines.length > 0) {
        tempScriptPath = path.join(os.tmpdir(), `unified_migration_${Date.now()}_${path.basename(migrationFile)}`);
        fs.writeFileSync(tempScriptPath, `${preludeLines.join('\n')}\n\n${content}`);
        scriptPathToApply = tempScriptPath;
      }
    }
    
    try {
      console.log(`[UNIFIED-MIGRATION] Applying ${migrationFile} to ${path.basename(targetDb)}...`);
    } catch (e) {
      // Ignore EPIPE errors in production
    }
    
    try {
      // Apply the migration (with pre-attached schemas if requested)
      execSync(`sqlite3 "${targetDb}" < "${scriptPathToApply}"`, { stdio: 'pipe' });
      
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

  async migrate(progressCb?: (e: { phase: 'sql'|'script'; action: 'start'|'apply'|'skip'|'done'|'error'; file?: string; message?: string }) => void): Promise<UnifiedMigrationResult> {
    try {
      try {
        console.log('[UNIFIED-MIGRATION] Starting unified database migrations...');
      } catch (e) {}
      try { progressCb?.({ phase: 'sql', action: 'start' }); } catch {}
      
      // Ensure directories exist
      this.ensureDirectoriesExist();
      
      // Create schema_migrations tables for all known DBs
      [
        this.videoDbPath,
        this.mediaDbPath,
        this.canonicalMediaDbPath,
        this.imageSearchDbPath,
        this.avSearchDbPath,
        this.jobsDbPath,
        this.configDbPath
      ].forEach(db => this.createSchemaMigrationsTable(db));
      
      // Get applied migrations for all databases
      const appliedMap = new Map<string, number[]>();
      [
        this.videoDbPath,
        this.mediaDbPath,
        this.canonicalMediaDbPath,
        this.imageSearchDbPath,
        this.avSearchDbPath,
        this.jobsDbPath,
        this.configDbPath
      ].forEach(db => appliedMap.set(db, this.getAppliedMigrations(db)));

      console.log(`[UNIFIED-MIGRATION] Video DB: ${appliedMap.get(this.videoDbPath)!.length} migrations applied`);
      console.log(`[UNIFIED-MIGRATION] Media (vector) DB: ${appliedMap.get(this.mediaDbPath)!.length} migrations applied`);
      console.log(`[UNIFIED-MIGRATION] Canonical media DB: ${appliedMap.get(this.canonicalMediaDbPath)!.length} migrations applied`);
      console.log(`[UNIFIED-MIGRATION] Image search DB: ${appliedMap.get(this.imageSearchDbPath)!.length} migrations applied`);
      console.log(`[UNIFIED-MIGRATION] AV search DB: ${appliedMap.get(this.avSearchDbPath)!.length} migrations applied`);
      console.log(`[UNIFIED-MIGRATION] Jobs DB: ${appliedMap.get(this.jobsDbPath)!.length} migrations applied`);
      console.log(`[UNIFIED-MIGRATION] Config DB: ${appliedMap.get(this.configDbPath)!.length} migrations applied`);
      
      // Get all migration files
      if (!fs.existsSync(this.migrationsDir)) {
        console.warn(`[UNIFIED-MIGRATION] Migrations directory not found: ${this.migrationsDir}`);
        return {
          success: true,
          migrationsRun: [],
          videoDB: { path: this.videoDbPath, migrationsApplied: (appliedMap.get(this.videoDbPath) || []).length },
          mediaDB: { path: this.mediaDbPath, migrationsApplied: (appliedMap.get(this.mediaDbPath) || []).length }
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
      
      console.log(`[UNIFIED-MIGRATION-DEBUG] Found ${migrationFiles.length} migration files:`, migrationFiles);
      console.log(`[UNIFIED-MIGRATION-DEBUG] Migrations directory: ${this.migrationsDir}`);
      
      const migrationsRun: string[] = [];
      
      for (const migrationFile of migrationFiles) {
        const version = parseInt(migrationFile.split('_')[0]);
        // Normalize version for checking: 101->1, 102->2, 103->3
        const normalizedVersion = version > 100 ? version - 100 : version;
        const migrationContent = fs.readFileSync(path.join(this.migrationsDir, migrationFile), 'utf8');
        const targetDb = this.determineTargetDatabase(migrationContent);
        
        // Check if migration has been applied to the target database
        const appliedMigrations = appliedMap.get(targetDb) || [];
        
        console.log(`[UNIFIED-MIGRATION-DEBUG] Processing ${migrationFile}:`);
        console.log(`[UNIFIED-MIGRATION-DEBUG] - Raw version: ${version}, Normalized: ${normalizedVersion}`);
        console.log(`[UNIFIED-MIGRATION-DEBUG] - Target DB: ${path.basename(targetDb)}`);
        console.log(`[UNIFIED-MIGRATION-DEBUG] - Applied migrations: [${appliedMigrations.join(', ')}]`);
        console.log(`[UNIFIED-MIGRATION-DEBUG] - Already applied? ${appliedMigrations.includes(normalizedVersion)}`);
        
        if (!appliedMigrations.includes(normalizedVersion)) {
          try { progressCb?.({ phase: 'sql', action: 'apply', file: migrationFile }); } catch {}
          console.log(`[UNIFIED-MIGRATION-DEBUG] Applying ${migrationFile}...`);
          try {
            this.applyMigration(migrationFile, targetDb);
            migrationsRun.push(migrationFile);
            console.log(`[UNIFIED-MIGRATION-DEBUG] ✅ Successfully applied ${migrationFile}`);
          } catch (error) {
            console.error(`[UNIFIED-MIGRATION-DEBUG] ❌ Failed to apply ${migrationFile}:`, error);
            try { progressCb?.({ phase: 'sql', action: 'error', file: migrationFile, message: String((error as any)?.message || error) }); } catch {}
            throw error;
          }
        } else {
          console.log(`[UNIFIED-MIGRATION] ⏭️  Skipping ${migrationFile} (already applied)`);
          try { progressCb?.({ phase: 'sql', action: 'skip', file: migrationFile }); } catch {}
        }
      }
      
      console.log(`[UNIFIED-MIGRATION] 🎉 SQL migration complete! Applied ${migrationsRun.length} new migrations.`);
      try { progressCb?.({ phase: 'sql', action: 'done' }); } catch {}

      // After SQL migrations, run script migrations (idempotent)
      try {
        // Ensure script_migrations table in config DB (centralized)
        try { progressCb?.({ phase: 'script', action: 'start' }); } catch {}
        const scriptMigSql = `CREATE TABLE IF NOT EXISTS script_migrations (
          version INTEGER PRIMARY KEY,
          filename TEXT NOT NULL,
          applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );`;
        execSync(`sqlite3 "${this.configDbPath}" "${scriptMigSql}"`, { stdio: 'pipe' });

        if (fs.existsSync(this.scriptsDir)) {
          const scriptFiles = fs.readdirSync(this.scriptsDir)
            .filter(f => f.match(/^\d+_.+\.(js|cjs|mjs)$/))
            .sort((a, b) => {
              const va = parseInt(a.split('_')[0]);
              const vb = parseInt(b.split('_')[0]);
              const norm = (v: number) => v > 100 ? v - 100 : v;
              return norm(va) - norm(vb);
            });

          const appliedScriptsRaw = execSync(`sqlite3 "${this.configDbPath}" "SELECT version FROM script_migrations ORDER BY version;"`, {
            encoding: 'utf8', stdio: 'pipe'
          }).trim();
          const appliedScripts = appliedScriptsRaw ? appliedScriptsRaw.split('\n').map(v => parseInt(v)).filter(Boolean) : [];

          console.log(`[UNIFIED-MIGRATION] Script migrations directory: ${this.scriptsDir}`);
          console.log(`[UNIFIED-MIGRATION] Found ${scriptFiles.length} script migrations. Already applied: [${appliedScripts.join(', ')}]`);

          for (const file of scriptFiles) {
            const version = parseInt(file.split('_')[0]);
            const normalized = version > 100 ? version - 100 : version;
            if (appliedScripts.includes(normalized)) {
              console.log(`[UNIFIED-MIGRATION] ⏭️  Skipping script ${file} (already applied)`);
              continue;
            }
            const fullPath = path.join(this.scriptsDir, file);
            console.log(`[UNIFIED-MIGRATION] ▶️  Running script migration ${file} ...`);
            try { progressCb?.({ phase: 'script', action: 'apply', file }); } catch {}
            try {
              const mod = await import(pathToFileURL(fullPath).href);
              const fn = (mod && typeof mod.run === 'function')
                ? mod.run
                : (typeof mod?.default === 'function' ? mod.default : (typeof mod?.default?.run === 'function' ? mod.default.run : null));
              if (!fn) {
                console.warn(`[UNIFIED-MIGRATION] ⚠️  Script ${file} has no runnable export (run or default). Skipping.`);
              } else {
                await fn({
                  dataDir: this.dataDirRoot,
                  dbPaths: {
                    video: this.videoDbPath,
                    vector: this.mediaDbPath,
                    media: this.canonicalMediaDbPath,
                    image_search: this.imageSearchDbPath,
                    av_search: this.avSearchDbPath,
                    jobs: this.jobsDbPath,
                    config: this.configDbPath
                  }
                });
                const record = `INSERT INTO script_migrations (version, filename) VALUES (${normalized}, '${file}');`;
                execSync(`sqlite3 "${this.configDbPath}" "${record}"`, { stdio: 'pipe' });
                console.log(`[UNIFIED-MIGRATION] ✅ Script migration applied: ${file}`);
              }
            } catch (e) {
              const msg = String((e as any)?.message || e).toLowerCase();
              const benign = msg.includes('already exists') || msg.includes('unique constraint failed') || msg.includes('duplicate');
              if (benign) {
                console.warn(`[UNIFIED-MIGRATION] ⚠️  Benign duplicate during script ${file}. Marking as applied.`);
                try {
                  const record = `INSERT INTO script_migrations (version, filename) VALUES (${normalized}, '${file}');`;
                  execSync(`sqlite3 "${this.configDbPath}" "${record}"`, { stdio: 'pipe' });
                } catch {}
                continue;
              }
              console.error(`[UNIFIED-MIGRATION] ❌ Script migration failed: ${file}`, e);
              try { progressCb?.({ phase: 'script', action: 'error', file, message: String((e as any)?.message || e) }); } catch {}
              throw e;
            }
          }
        } else {
          console.log('[UNIFIED-MIGRATION] No script migrations directory found; skipping.');
        }
      } catch (e) {
        console.warn('[UNIFIED-MIGRATION] Script migrations stage encountered a non-fatal error:', e);
      }
      try { progressCb?.({ phase: 'script', action: 'done' }); } catch {}

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
  if (isPackaged()) {
    return path.join(os.homedir(), '.clipwise');
  } else {
    return path.join(process.cwd(), 'data');
  }
}
