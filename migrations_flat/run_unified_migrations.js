#!/usr/bin/env node

/**
 * Unified Migration Runner - ES Modules
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Database paths - use development paths when not in production
const isDev = process.env.NODE_ENV !== 'production' && !process.resourcesPath;
const VIDEO_DB = isDev 
  ? path.join(process.cwd(), 'data', 'video-rag.db')
  : path.join(os.homedir(), '.driller', 'video-rag.db');
const MEDIA_DB = isDev 
  ? path.join(process.cwd(), 'data', 'vector.db') 
  : path.join(os.homedir(), '.clipwise', 'vector.db');

function getAppliedMigrations(dbPath) {
  try {
    const result = execSync(`sqlite3 "${dbPath}" "SELECT version FROM schema_migrations ORDER BY version;"`, { encoding: 'utf8' });
    return result.trim().split('\n').filter(v => v).map(v => parseInt(v));
  } catch (error) {
    return [];
  }
}

function createSchemaMigrationsTable(dbPath) {
  const sql = `CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, filename TEXT NOT NULL, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP);`;
  execSync(`sqlite3 "${dbPath}" "${sql}"`);
}

function determineTargetDatabase(migrationContent) {
  const content = migrationContent.toLowerCase();
  
  if (content.includes('video database') || content.includes('video_files') || content.includes('video_segments')) {
    return VIDEO_DB;
  }
  return MEDIA_DB;
}

function applyMigration(migrationFile, targetDb) {
  const migrationPath = path.join(__dirname, migrationFile);
  const version = parseInt(migrationFile.split('_')[0]);
  // Normalize version for recording: 101->1, 102->2, 103->3
  const normalizedVersion = version > 100 ? version - 100 : version;
  
  console.log(`📦 Applying ${migrationFile}...`);
  
  try {
    execSync(`sqlite3 "${targetDb}" < "${migrationPath}"`);
    const recordSql = `INSERT INTO schema_migrations (version, filename) VALUES (${normalizedVersion}, '${migrationFile}');`;
    execSync(`sqlite3 "${targetDb}" "${recordSql}"`);
    console.log(`✅ Applied ${migrationFile}`);
  } catch (error) {
    console.error(`❌ Failed to apply ${migrationFile}:`, error.message);
    process.exit(1);
  }
}

function main() {
  console.log('🚀 Starting unified migration runner...\n');
  console.log('📍 Video DB path:', VIDEO_DB);
  console.log('📍 Media DB path:', MEDIA_DB);
  console.log('📍 Migrations dir:', __dirname);
  
  // Ensure database directories exist
  [path.dirname(VIDEO_DB), path.dirname(MEDIA_DB)].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
  
  // Create schema_migrations tables
  createSchemaMigrationsTable(VIDEO_DB);
  createSchemaMigrationsTable(MEDIA_DB);
  
  // Get applied migrations
  const appliedVideoMigrations = getAppliedMigrations(VIDEO_DB);
  const appliedMediaMigrations = getAppliedMigrations(MEDIA_DB);
  
  console.log(`📊 Video DB: ${appliedVideoMigrations.length} migrations applied`);
  console.log(`📊 Media DB: ${appliedMediaMigrations.length} migrations applied\n`);
  
  // Get migration files and sort them properly by version number
  const migrationFiles = fs.readdirSync(__dirname)
    .filter(f => f.endsWith('.sql') && f.match(/^\d+_/))
    .sort((a, b) => {
      const versionA = parseInt(a.split('_')[0]);
      const versionB = parseInt(b.split('_')[0]);
      // Handle the renumbering: 101->1, 102->2, 103->3, then 4,5,6...
      const normalizeVersion = (v) => v > 100 ? v - 100 : v;
      return normalizeVersion(versionA) - normalizeVersion(versionB);
    });
  
  let appliedCount = 0;
  
  for (const migrationFile of migrationFiles) {
    const version = parseInt(migrationFile.split('_')[0]);
    // Normalize version for checking: 101->1, 102->2, 103->3
    const normalizedVersion = version > 100 ? version - 100 : version;
    const migrationContent = fs.readFileSync(path.join(__dirname, migrationFile), 'utf8');
    const targetDb = determineTargetDatabase(migrationContent);
    
    const appliedMigrations = targetDb === VIDEO_DB ? appliedVideoMigrations : appliedMediaMigrations;
    
    if (!appliedMigrations.includes(normalizedVersion)) {
      applyMigration(migrationFile, targetDb);
      appliedCount++;
    } else {
      console.log(`⏭️  Skipping ${migrationFile} (already applied)`);
    }
  }
  
  console.log(`\n🎉 Migration complete! Applied ${appliedCount} new migrations.`);
}

main();
