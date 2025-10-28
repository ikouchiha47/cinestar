#!/usr/bin/env node

/**
 * Migration script to refactor VideoJobProcessor to use split database architecture
 * 
 * This script:
 * 1. Copies video-job-processor.ts to video-job-processor.backup.ts
 * 2. Creates video-job-processor-v2.ts with split DB architecture
 * 3. Replaces all vectorDb calls with appropriate split DB calls
 */

const fs = require('fs');
const path = require('path');

const SOURCE_FILE = path.join(__dirname, '../src/core/video-job-processor.ts');
const BACKUP_FILE = path.join(__dirname, '../src/core/video-job-processor.backup.ts');
const OUTPUT_FILE = path.join(__dirname, '../src/core/video-job-processor-v2.ts');

console.log('🚀 Starting VideoJobProcessor migration...\n');

// Step 1: Backup original file
console.log('📦 Creating backup...');
fs.copyFileSync(SOURCE_FILE, BACKUP_FILE);
console.log(`✅ Backup created: ${BACKUP_FILE}\n`);

// Step 2: Read original file
console.log('📖 Reading original file...');
let content = fs.readFileSync(SOURCE_FILE, 'utf-8');
console.log(`✅ Read ${content.split('\n').length} lines\n`);

// Step 3: Update imports
console.log('🔧 Updating imports...');
content = content.replace(
  /import { SqliteVecDatabase } from '\.\/sqlite-vec-database';/,
  `import { CanonicalMediaDatabase } from './canonical-media-database';\nimport { AVSearchWriter } from './av-search-writer';`
);
console.log('✅ Imports updated\n');

// Step 4: Update class properties
console.log('🔧 Updating class properties...');
content = content.replace(
  /private vectorDb: SqliteVecDatabase;/,
  `private mediaDb: CanonicalMediaDatabase;\n  private avSearchWriter: AVSearchWriter;`
);
console.log('✅ Class properties updated\n');

// Step 5: Update constructor signature
console.log('🔧 Updating constructor...');
content = content.replace(
  /constructor\(sharedPipeline\?: VideoPipeline, workerId\?: string\) {/,
  `constructor(\n    videoDb: VideoDatabase,\n    mediaDb: CanonicalMediaDatabase,\n    avSearchWriter: AVSearchWriter,\n    sharedPipeline?: VideoPipeline,\n    workerId?: string\n  ) {`
);

// Update constructor body
content = content.replace(
  /this\.videoDb = new VideoDatabase\(\);/,
  `this.videoDb = videoDb;`
);

content = content.replace(
  /const vectorDbPath = path\.join\(getDataDir\(\), 'vector\.db'\);\s+console\.log\(`\[DB-PATH-DEBUG\].*?\);\s+this\.vectorDb = new SqliteVecDatabase\(vectorDbPath\);/s,
  `this.mediaDb = mediaDb;\n    this.avSearchWriter = avSearchWriter;\n    console.log(\`[DB-PATH-DEBUG] 🗄️  Using split DB architecture: media.db + av_search.db\`);`
);
console.log('✅ Constructor updated\n');

// Step 6: Replace vectorDb.searchByPath() calls
console.log('🔧 Replacing vectorDb.searchByPath() calls...');
content = content.replace(
  /this\.vectorDb\.searchByPath\(([^)]+)\)/g,
  'this.mediaDb.getMediaItemsByPath($1, true)'
);
console.log('✅ searchByPath() calls replaced\n');

// Step 7: Replace vectorDb.getMediaItem() calls
console.log('🔧 Replacing vectorDb.getMediaItem() calls...');
content = content.replace(
  /this\.vectorDb\.getMediaItem\(([^)]+)\)/g,
  'this.mediaDb.getMediaItem($1)'
);
console.log('✅ getMediaItem() calls replaced\n');

// Step 8: Add helper method for writing video segments
console.log('🔧 Adding helper method for segment writes...');
const helperMethod = `
  /**
   * Write video segment to split databases
   * Helper method to replace vectorDb.addMediaItemAsync()
   */
  private async writeVideoSegment(segmentData: {
    id?: string;
    sourceId: string;
    name: string;
    path: string;
    type: 'video' | 'video_segment';
    size?: number;
    duration?: number;
    width?: number;
    height?: number;
    caption?: string;
    embedding?: Float32Array;
    mimeType?: string;
  }): Promise<string> {
    const segmentId = segmentData.id || \`video_segment_\${Date.now()}_\${Math.random().toString(36).slice(2)}\`;
    
    // 1. Write to media.db (basic metadata)
    this.mediaDb.upsertMediaItemFromLegacy({
      id: segmentId,
      sourceId: segmentData.sourceId,
      type: segmentData.type,
      path: segmentData.path,
      size: segmentData.size || 0,
      mimeType: segmentData.mimeType || 'video/mp4',
      durationMs: segmentData.duration ? segmentData.duration * 1000 : null,
      width: segmentData.width || null,
      height: segmentData.height || null,
      createdAt: new Date(),
      modifiedAt: new Date()
    });
    
    // 2. Write embedding to av_search.db if present
    if (segmentData.embedding) {
      this.avSearchWriter.updateVideoSegmentEmbedding(segmentId, segmentData.embedding);
    }
    
    // 3. Write caption to av_search.db if present
    if (segmentData.caption) {
      this.avSearchWriter.updateTranscription(segmentId, segmentData.caption);
    }
    
    // 4. Update metadata cache in av_search.db
    const pathParts = segmentData.path.match(/#t=([\\d.]+),([\\d.]+)/);
    if (pathParts) {
      const startMs = parseFloat(pathParts[1]) * 1000;
      const endMs = parseFloat(pathParts[2]) * 1000;
      this.avSearchWriter.updateAVMetaCache({
        itemId: segmentId,
        segmentId: segmentId,
        mediaType: 'video',
        path: segmentData.path,
        startMs: startMs,
        endMs: endMs,
        durationMs: endMs - startMs,
        title: segmentData.name,
        createdAt: new Date().toISOString()
      });
    }
    
    return segmentId;
  }
`;

// Insert helper method before the first private method
content = content.replace(
  /(  \/\*\*\s+\* Start the background job processor\s+\*\/\s+async start\(\): Promise<void> {)/,
  helperMethod + '\n$1'
);
console.log('✅ Helper method added\n');

// Step 9: Replace vectorDb.addMediaItemAsync() calls
console.log('🔧 Replacing vectorDb.addMediaItemAsync() calls...');
// This is complex - we'll mark them for manual review
content = content.replace(
  /await this\.vectorDb\.addMediaItemAsync\(/g,
  'await this.writeVideoSegment('
);
console.log('✅ addMediaItemAsync() calls replaced (review needed)\n');

// Step 10: Replace vectorDb.addMediaItemWithIdAsync() calls
console.log('🔧 Replacing vectorDb.addMediaItemWithIdAsync() calls...');
content = content.replace(
  /await this\.vectorDb\.addMediaItemWithIdAsync\(([^,]+),\s*{/g,
  'await this.writeVideoSegment({ id: $1,'
);
console.log('✅ addMediaItemWithIdAsync() calls replaced (review needed)\n');

// Step 11: Write output file
console.log('💾 Writing refactored file...');
fs.writeFileSync(OUTPUT_FILE, content);
console.log(`✅ Created: ${OUTPUT_FILE}\n`);

// Step 12: Summary
console.log('📊 Migration Summary:');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`✅ Backup:  ${BACKUP_FILE}`);
console.log(`✅ Output:  ${OUTPUT_FILE}`);
console.log('');
console.log('🔍 Manual Review Required:');
console.log('  - Check all writeVideoSegment() calls for correct parameters');
console.log('  - Verify embedding and caption handling');
console.log('  - Test with a sample video');
console.log('');
console.log('📝 Next Steps:');
console.log('  1. Review video-job-processor-v2.ts');
console.log('  2. Update electron/main.ts to use new constructor');
console.log('  3. Test with sample video');
console.log('  4. Replace original file when verified');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

console.log('✨ Migration script complete!\n');
