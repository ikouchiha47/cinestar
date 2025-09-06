/**
 * Two-phase media processing system
 * Phase 1: Generate and store image captions
 * Phase 2: Generate embeddings from stored captions
 */

import { VectorDatabase, MediaItem } from './vector-database';
import { LLMProvider } from './llm-provider';
import { ImageCompressor } from './image-compressor';
import { ConfigManager } from './config';
import { ConcurrencyLimiter } from './concurrency-limiter';
import path from 'path';
import os from 'os';
import fs from 'fs';

export interface ProcessingStats {
  phase1: {
    total: number;
    completed: number;
    pending: number;
    failed: number;
    processing: number;
  };
  phase2: {
    total: number;
    completed: number;
    pending: number;
    failed: number;
    processing: number;
  };
}

export class TwoPhaseProcessor {
  private vectorDb: VectorDatabase;
  private llmProvider: LLMProvider;
  private concurrencyLimiter: ConcurrencyLimiter;
  private isProcessing = false;

  constructor(vectorDb: VectorDatabase, llmProvider: LLMProvider) {
    this.vectorDb = vectorDb;
    this.llmProvider = llmProvider;
    
    const config = ConfigManager.getConfig();
    this.concurrencyLimiter = new ConcurrencyLimiter(config.indexing.concurrencyLimit);
  }

  /**
   * Add media items to the database for processing
   */
  addMediaItems(items: Array<{
    id: string;
    sourceId: string;
    name: string;
    path: string;
    size: number;
    type: string;
  }>): void {
    console.log(`📥 [PROCESSOR] Adding ${items.length} items to processing queue`);
    
    for (const item of items) {
      this.vectorDb.addMediaItem({
        ...item,
        createdAt: new Date(),
        updatedAt: new Date(),
        captionStatus: 'pending',
        embeddingStatus: 'pending'
      });
    }
  }

  /**
   * Process Phase 1: Generate captions for images
   */
  async processPhase1(batchSize: number = 10): Promise<void> {
    if (this.isProcessing) {
      console.log('⚠️ [PHASE1] Already processing, skipping...');
      return;
    }

    this.isProcessing = true;
    console.log('🚀 [PHASE1] Starting caption generation phase...');

    try {
      const items = this.vectorDb.getItemsNeedingCaptions(batchSize);
      
      if (items.length === 0) {
        console.log('✅ [PHASE1] No items need captions');
        return;
      }

      console.log(`📋 [PHASE1] Processing ${items.length} items for caption generation`);

      // Process items with concurrency control
      await this.concurrencyLimiter.processItems(
        items,
        async (item) => await this.generateCaption(item)
      );

      console.log('🎉 [PHASE1] Caption generation batch completed');
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process Phase 2: Generate embeddings from captions
   */
  async processPhase2(batchSize: number = 20): Promise<void> {
    if (this.isProcessing) {
      console.log('⚠️ [PHASE2] Already processing, skipping...');
      return;
    }

    this.isProcessing = true;
    console.log('🚀 [PHASE2] Starting embedding generation phase...');

    try {
      const items = this.vectorDb.getItemsNeedingEmbeddings(batchSize);
      
      if (items.length === 0) {
        console.log('✅ [PHASE2] No items need embeddings');
        return;
      }

      console.log(`📋 [PHASE2] Processing ${items.length} items for embedding generation`);

      // Process embeddings with higher concurrency (text processing is lighter)
      const embeddingLimiter = new ConcurrencyLimiter(Math.min(batchSize, 5));
      
      await embeddingLimiter.processItems(
        items,
        async (item) => await this.generateEmbedding(item)
      );

      console.log('🎉 [PHASE2] Embedding generation batch completed');
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Generate caption for a single item (Phase 1)
   */
  private async generateCaption(item: MediaItem): Promise<void> {
    console.log(`📝 [PHASE1] Generating caption for: ${item.name}`);
    
    // Mark as processing
    this.vectorDb.updateStatus(item.id, 'processing');

    try {
      // Compress image first
      const tempDir = path.join(os.tmpdir(), 'driller-compressed');
      const config = ConfigManager.getConfig();
      const settings = ImageCompressor.getOptimalSettings(item.path, item.size, config.ai.visionModelDims);
      
      let compressedPath = item.path;
      if (config.compression.enabled && item.size > config.compression.minSizeKB * 1024) {
        console.log(`  🗜️ [${item.name}] Compressing image...`);
        const compressionResult = await ImageCompressor.compressImage(item.path, tempDir, settings);
        compressedPath = compressionResult.compressedPath;
        console.log(`  ✅ [${item.name}] Compressed: ${compressionResult.compressionRatio.toFixed(1)}% savings`);
      }

      // Generate caption using vision model (try compressed first, then original)
      const caption = await this.llmProvider.generateImageDescription(compressedPath, item.path);
      
      // Clean up compressed file if it was created
      if (compressedPath !== item.path) {
        try {
          await fs.promises.unlink(compressedPath);
        } catch (error) {
          console.warn(`  ⚠️ [${item.name}] Failed to clean up compressed file: ${error}`);
        }
      }

      // Store caption in database
      this.vectorDb.updateCaption(item.id, caption, 'completed');
      console.log(`  ✅ [PHASE1] Caption generated for: ${item.name} - "${caption.substring(0, 100)}..."`);

    } catch (error) {
      console.error(`  ❌ [PHASE1] Failed to generate caption for ${item.name}:`, error);
      this.vectorDb.updateCaption(item.id, 'Error generating caption', 'failed');
    }
  }

  /**
   * Generate embedding for a single item (Phase 2)
   */
  private async generateEmbedding(item: MediaItem): Promise<void> {
    if (!item.caption) {
      console.error(`  ❌ [PHASE2] No caption available for: ${item.name}`);
      this.vectorDb.updateStatus(item.id, undefined, 'failed');
      return;
    }

    console.log(`🧠 [PHASE2] Generating embedding for: ${item.name}`);
    
    // Mark as processing
    this.vectorDb.updateStatus(item.id, undefined, 'processing');

    try {
      // Generate embedding from caption
      const embedding = await this.llmProvider.generateEmbedding(item.caption);
      
      // Store embedding in database
      this.vectorDb.updateEmbedding(item.id, embedding, 'completed');
      console.log(`  ✅ [PHASE2] Embedding generated for: ${item.name} (${embedding.length} dimensions)`);

    } catch (error) {
      console.error(`  ❌ [PHASE2] Failed to generate embedding for ${item.name}:`, error);
      this.vectorDb.updateStatus(item.id, undefined, 'failed');
    }
  }

  /**
   * Get processing statistics
   */
  getStats(): ProcessingStats {
    const dbStats = this.vectorDb.getStats();
    
    return {
      phase1: {
        total: dbStats.total,
        completed: dbStats.captionsCompleted,
        pending: dbStats.captionsPending,
        failed: dbStats.captionsFailed,
        processing: 0 // TODO: Track processing items
      },
      phase2: {
        total: dbStats.captionsCompleted, // Only items with captions can have embeddings
        completed: dbStats.embeddingsCompleted,
        pending: dbStats.embeddingsPending,
        failed: dbStats.embeddingsFailed,
        processing: 0 // TODO: Track processing items
      }
    };
  }

  /**
   * Run both phases automatically
   */
  async runProcessing(phase1BatchSize: number = 5, phase2BatchSize: number = 10): Promise<void> {
    console.log('🔄 [PROCESSOR] Starting two-phase processing...');
    
    const stats = this.getStats();
    console.log(`📊 [PROCESSOR] Current stats:
  Phase 1 (Captions): ${stats.phase1.completed}/${stats.phase1.total} completed, ${stats.phase1.pending} pending
  Phase 2 (Embeddings): ${stats.phase2.completed}/${stats.phase2.total} completed, ${stats.phase2.pending} pending`);

    // Run Phase 1 if there are pending captions
    if (stats.phase1.pending > 0) {
      await this.processPhase1(phase1BatchSize);
    }

    // Run Phase 2 if there are pending embeddings
    const updatedStats = this.getStats();
    if (updatedStats.phase2.pending > 0) {
      await this.processPhase2(phase2BatchSize);
    }

    console.log('✅ [PROCESSOR] Two-phase processing completed');
  }

  /**
   * Search for media items by text query
   */
  async search(query: string, limit: number = 10): Promise<Array<{ item: MediaItem; similarity: number }>> {
    console.log(`🔍 [SEARCH] Searching for: "${query}"`);
    
    // Generate embedding for the query
    const queryEmbedding = await this.llmProvider.generateEmbedding(query);
    
    // Search in vector database
    const results = await this.vectorDb.searchByText(queryEmbedding, limit);
    
    console.log(`📋 [SEARCH] Found ${results.length} results`);
    return results;
  }
}
