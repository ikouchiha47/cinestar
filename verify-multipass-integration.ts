/**
 * Verification script for multi-pass captioning integration
 * 
 * Checks:
 * 1. Database schema has required columns
 * 2. Config has multiPass section
 * 3. Services are available
 * 4. Integration code exists
 */

import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import { ConfigManager } from './src/core/config';
import { MultiPassCaptioningService } from './src/core/processors/multi-pass-captioning-service';
import { LLMExtractionService } from './src/core/processors/llm-extraction-service';

async function verify() {
  console.log('='.repeat(80));
  console.log('Multi-Pass Integration Verification');
  console.log('='.repeat(80));
  console.log();

  let allChecks = true;

  // Check 1: Database schema
  console.log('📋 Check 1: Database Schema');
  console.log('-'.repeat(80));
  try {
    const dbPath = path.join(process.cwd(), 'data', 'video-rag.db');
    const db = new Database(dbPath);
    
    const columns = db.prepare('PRAGMA table_info(video_keyframes)').all() as any[];
    const requiredColumns = ['caption_elements', 'caption_spatial', 'caption_temporal', 'caption_tokens'];
    
    const missingColumns = requiredColumns.filter(col => 
      !columns.some((c: any) => c.name === col)
    );
    
    if (missingColumns.length === 0) {
      console.log('✅ All required columns exist in video_keyframes table');
      requiredColumns.forEach(col => {
        const colInfo = columns.find((c: any) => c.name === col);
        console.log(`   - ${col}: ${colInfo.type}`);
      });
    } else {
      console.log('❌ Missing columns:', missingColumns.join(', '));
      allChecks = false;
    }
    
    db.close();
  } catch (error) {
    console.log('❌ Database check failed:', error);
    allChecks = false;
  }
  console.log();

  // Check 2: Config
  console.log('⚙️  Check 2: Configuration');
  console.log('-'.repeat(80));
  try {
    const config = ConfigManager.getConfig();
    
    if (config.multiPass) {
      console.log('✅ multiPass config exists');
      console.log(`   - enabled: ${config.multiPass.enabled}`);
      console.log(`   - extractionModel: ${config.multiPass.extractionModel}`);
      console.log(`   - phases.enableExtraction: ${config.multiPass.phases?.enableExtraction}`);
      console.log(`   - phases.enableSpatial: ${config.multiPass.phases?.enableSpatial}`);
      console.log(`   - phases.enableTemporal: ${config.multiPass.phases?.enableTemporal}`);
      console.log(`   - phases.enableSegmentationCheck: ${config.multiPass.phases?.enableSegmentationCheck}`);
    } else {
      console.log('❌ multiPass config missing');
      allChecks = false;
    }
  } catch (error) {
    console.log('❌ Config check failed:', error);
    allChecks = false;
  }
  console.log();

  // Check 3: Services availability
  console.log('🔌 Check 3: Services Availability');
  console.log('-'.repeat(80));
  try {
    const multiPassService = new MultiPassCaptioningService();
    const available = await multiPassService.isAvailable();
    
    if (available) {
      console.log('✅ Multi-pass service available');
      console.log('   - moondream:v2 is running');
      console.log('   - llama3.2:3b is running');
    } else {
      console.log('❌ Multi-pass service not available');
      console.log('   Check if moondream:v2 and llama3.2:3b are running:');
      console.log('   curl http://localhost:11434/api/tags');
      allChecks = false;
    }
  } catch (error) {
    console.log('❌ Service check failed:', error);
    allChecks = false;
  }
  console.log();

  // Check 4: Integration code
  console.log('🔗 Check 4: Integration Code');
  console.log('-'.repeat(80));
  try {
    const fs = await import('fs/promises');
    const processorPath = path.join(process.cwd(), 'src/core/video-job-processor-v2.ts');
    const content = await fs.readFile(processorPath, 'utf-8');
    
    const checks = [
      { name: 'MultiPassCaptioningService import', pattern: /import.*MultiPassCaptioningService/ },
      { name: 'multiPassService initialization', pattern: /this\.multiPassService\s*=\s*new\s+MultiPassCaptioningService/ },
      { name: 'storeMultiPassData method', pattern: /private\s+async\s+storeMultiPassData/ },
      { name: 'Multi-pass in captionBatchKeyframes', pattern: /useMultiPass.*config\.multiPass/ }
    ];
    
    let allIntegrated = true;
    for (const check of checks) {
      if (check.pattern.test(content)) {
        console.log(`✅ ${check.name}`);
      } else {
        console.log(`❌ ${check.name} not found`);
        allIntegrated = false;
      }
    }
    
    if (!allIntegrated) {
      allChecks = false;
    }
  } catch (error) {
    console.log('❌ Integration code check failed:', error);
    allChecks = false;
  }
  console.log();

  // Summary
  console.log('='.repeat(80));
  console.log('Summary');
  console.log('='.repeat(80));
  if (allChecks) {
    console.log('✅ All checks passed! Multi-pass integration is ready.');
    console.log();
    console.log('Next steps:');
    console.log('1. Enable multi-pass in config: multiPass.enabled = true');
    console.log('2. Enable phases incrementally:');
    console.log('   - Start with enableExtraction = true');
    console.log('   - Then enable enableSpatial = true');
    console.log('   - Finally enable enableTemporal = true');
    console.log('3. Process a test video and verify results');
    console.log('4. Check token usage and quality');
  } else {
    console.log('❌ Some checks failed. Please review the output above.');
    process.exit(1);
  }
  console.log('='.repeat(80));
}

verify().catch(error => {
  console.error('Verification failed:', error);
  process.exit(1);
});
