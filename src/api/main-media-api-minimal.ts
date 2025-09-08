import { MainDatabase } from '../core/main-database';
import { MediaSource } from '../core/types';

/**
 * Minimal Main process MediaAPI for basic functionality
 * This runs in the Electron main process
 */
export class MainMediaAPI {
  private static db: MainDatabase;
  private static initialized = false;

  static async initialize(dbPath: string): Promise<void> {
    if (this.initialized) return;
    
    this.db = new MainDatabase(dbPath);
    await this.db.initialize();
    
    this.initialized = true;
    console.log('MainMediaAPI initialized');
  }

  private static async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      throw new Error('MainMediaAPI not initialized. Call initialize() first.');
    }
  }

  /**
   * Get all media sources
   */
  static async getSources(): Promise<{ success: boolean; sources?: MediaSource[]; error?: string }> {
    try {
      await this.ensureInitialized();
      const sources = await this.db.getSources();
      return { success: true, sources };
    } catch (error) {
      console.error('Failed to get sources:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Add a new media source
   */
  static async addSource(source: Omit<MediaSource, 'id'>): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      await this.ensureInitialized();
      const id = await this.db.addSource(source);
      return { success: true, id };
    } catch (error) {
      console.error('Failed to add source:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Update a media source
   */
  static async updateSource(id: string, updates: Partial<Omit<MediaSource, 'id'>>): Promise<{ success: boolean; error?: string }> {
    try {
      await this.ensureInitialized();
      await this.db.updateSource(id, updates);
      return { success: true };
    } catch (error) {
      console.error('Failed to update source:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Delete a media source
   */
  static async deleteSource(id: string): Promise<{ success: boolean; error?: string }> {
    try {
      await this.ensureInitialized();
      await this.db.deleteSource(id);
      return { success: true };
    } catch (error) {
      console.error('Failed to delete source:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Get recent media items
   */
  static async getRecentItems(params?: { 
    sourceIds?: string[]; 
    types?: Array<'image'|'video'|'audio'>; 
    limit?: number; 
    offset?: number 
  }): Promise<{ success: boolean; items?: any[]; total?: number; error?: string }> {
    try {
      await this.ensureInitialized();
      const allItems = await this.db.getMediaItems();
      
      let filteredItems = allItems;
      
      // Filter by source IDs if provided
      if (params?.sourceIds?.length) {
        const sourceIdSet = new Set(params.sourceIds);
        filteredItems = filteredItems.filter(item => sourceIdSet.has(item.sourceId));
      }
      
      // Filter by types if provided
      if (params?.types?.length) {
        const typeSet = new Set(params.types);
        filteredItems = filteredItems.filter(item => {
          const mime = (item.mimeType || '').toLowerCase();
          if (mime.startsWith('video/')) return typeSet.has('video');
          if (mime.startsWith('audio/')) return typeSet.has('audio');
          return typeSet.has('image');
        });
      }
      
      // Sort by creation date (most recent first)
      filteredItems.sort((a, b) => {
        const aDate = new Date(a.createdAt || 0);
        const bDate = new Date(b.createdAt || 0);
        return bDate.getTime() - aDate.getTime();
      });
      
      const total = filteredItems.length;
      const offset = params?.offset || 0;
      const limit = params?.limit || 50;
      
      const items = filteredItems.slice(offset, offset + limit);
      
      return { success: true, items, total };
    } catch (error) {
      console.error('Failed to get recent items:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
}
