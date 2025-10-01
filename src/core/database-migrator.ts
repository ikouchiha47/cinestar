import Database, { Database as DatabaseType } from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { isPackaged } from './utils/is-packaged';
import { UnifiedMigrator } from './unified-migrator';

export interface MigrationResult {
  success: boolean;
  version: number;
  error?: string;
  migrationsRun: string[];
}

export class DatabaseMigrator {
  private dbPath: string;
  private migrationsDir: string;

  constructor(dbPath: string, migrationsDir?: string) {
    this.dbPath = dbPath;
    
    if (migrationsDir) {
      this.migrationsDir = migrationsDir;
    } else {
      // Detect if we're in packaged app or development
      if (isPackaged()) {
        // In packaged app, migrations are in the app bundle
        const appPath = process.resourcesPath || path.dirname(process.execPath);
        this.migrationsDir = path.join(appPath, 'app.asar.unpacked', 'src', 'core', 'migrations');
      } else {
        // In development, use project root
        const projectRoot = process.cwd();
        this.migrationsDir = path.join(projectRoot, 'src', 'core', 'migrations');
      }
    }
    
    try {
      console.log(`[Migration] Using migrations directory: ${this.migrationsDir}`);
    } catch (e) {
      // Ignore EPIPE errors from console.log
    }
  }

  /**
   * Run all pending migrations on database initialization
   */
  async migrate(): Promise<MigrationResult> {
    try {
      // Ensure database directory exists
      const dbDir = path.dirname(this.dbPath);
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }

      const db = new Database(this.dbPath);
      
      // Create migrations tracking table if it doesn't exist
      db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          filename TEXT NOT NULL,
          applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Get current schema version
      const currentVersion = this.getCurrentVersion(db);
      try {
        console.log(`[Migration] Current schema version: ${currentVersion}`);
      } catch (e) { /* ignore EPIPE */ }

      // Find all migration files
      const migrationFiles = this.getMigrationFiles();
      try {
        console.log(`[Migration] Found ${migrationFiles.length} migration files`);
      } catch (e) { /* ignore EPIPE */ }

      const migrationsRun: string[] = [];
      let newVersion = currentVersion;

      // Run pending migrations
      for (const migration of migrationFiles) {
        if (migration.version > currentVersion) {
          console.log(`[Migration] Running migration: ${migration.filename}`);
          
          try {
            const sql = fs.readFileSync(migration.path, 'utf8');
            
            // Run migration in transaction
            db.transaction(() => {
              db.exec(sql);
              db.prepare(`
                INSERT INTO schema_migrations (version, filename) 
                VALUES (?, ?)
              `).run(migration.version, migration.filename);
            })();

            migrationsRun.push(migration.filename);
            newVersion = migration.version;
            console.log(`[Migration] ✅ Applied ${migration.filename}`);
          } catch (error) {
            console.error(`[Migration] ❌ Failed to apply ${migration.filename}:`, error);
            db.close();
            return {
              success: false,
              version: currentVersion,
              error: `Migration ${migration.filename} failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
              migrationsRun
            };
          }
        }
      }

      db.close();

      console.log(`[Migration] 🎉 Migration complete. Schema version: ${newVersion}`);
      return {
        success: true,
        version: newVersion,
        migrationsRun
      };

    } catch (error) {
      console.error('[Migration] Migration system failed:', error);
      return {
        success: false,
        version: 0,
        error: error instanceof Error ? error.message : 'Unknown migration error',
        migrationsRun: []
      };
    }
  }

  /**
   * Get current schema version from database
   */
  private getCurrentVersion(db: DatabaseType): number {
    try {
      const result = db.prepare(`
        SELECT MAX(version) as version FROM schema_migrations
      `).get() as { version: number | null };
      
      return result?.version || 0;
    } catch {
      // Table doesn't exist yet, this is a fresh database
      return 0;
    }
  }

  /**
   * Scan migrations directory and return sorted migration files
   */
  private getMigrationFiles(): Array<{ version: number; filename: string; path: string }> {
    if (!fs.existsSync(this.migrationsDir)) {
      console.warn(`[Migration] Migrations directory not found: ${this.migrationsDir}`);
      return [];
    }

    const files = fs.readdirSync(this.migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .map(filename => {
        const match = filename.match(/^(\d+)_/);
        const version = match ? parseInt(match[1], 10) : 0;
        return {
          version,
          filename,
          path: path.join(this.migrationsDir, filename)
        };
      })
      .filter(migration => migration.version > 0)
      .sort((a, b) => a.version - b.version);

    return files;
  }

  /**
   * Check if database needs migration (for health checks)
   */
  async needsMigration(): Promise<boolean> {
    try {
      if (!fs.existsSync(this.dbPath)) {
        return true; // Fresh install
      }

      const db = new Database(this.dbPath);
      const currentVersion = this.getCurrentVersion(db);
      const migrationFiles = this.getMigrationFiles();
      const latestVersion = migrationFiles.length > 0 
        ? Math.max(...migrationFiles.map(m => m.version))
        : 0;
      
      db.close();
      return currentVersion < latestVersion;
    } catch {
      return true; // Assume migration needed on error
    }
  }

  /**
   * Get database info for diagnostics
   */
  async getInfo(): Promise<{
    exists: boolean;
    version: number;
    availableMigrations: number;
    needsMigration: boolean;
  }> {
    const exists = fs.existsSync(this.dbPath);
    let version = 0;
    
    if (exists) {
      try {
        const db = new Database(this.dbPath);
        version = this.getCurrentVersion(db);
        db.close();
      } catch {
        version = 0;
      }
    }

    const migrationFiles = this.getMigrationFiles();
    const availableMigrations = migrationFiles.length;
    const needsMigration = await this.needsMigration();

    return {
      exists,
      version,
      availableMigrations,
      needsMigration
    };
  }
}

/**
 * Initialize databases with unified migrations for fresh installs
 */
export async function initializeDatabases(dataDir: string): Promise<{
  success: boolean;
  videoDB: { path: string; migrationsApplied: number };
  mediaDB: { path: string; migrationsApplied: number };
  migrationsRun: string[];
  error?: string;
}> {
  console.log(`[Init] Initializing databases with unified migrations in: ${dataDir}`);

  // Use unified migrator for both databases
  const migrator = new UnifiedMigrator(dataDir);
  const result = await migrator.migrate();

  return result;
}

/**
 * Get default data directory for the application
 */
export function getDefaultDataDir(): string {
  const isDev = process.env.NODE_ENV === 'development';
  
  if (isDev) {
    // Development: use project-relative path
    return path.resolve('./data');
  } else {
    // Production: use the same directory as main app
    return path.join(os.homedir(), '.clipwise');
  }
}
