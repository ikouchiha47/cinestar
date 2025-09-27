/**
 * Common media filtering utilities
 * Prevents duplication and ensures consistent filtering across components
 */

export interface RawMediaItem {
  id: string;
  name?: string;
  path: string;
  type?: string;
  mimeType?: string;
  sourceId?: string;
  size?: number;
  createdAt?: string | Date;
  modifiedAt?: string | Date;
  lastModified?: string | Date;
  metadata?: any;
}

export interface FilteredMediaItem {
  id: string;
  placeId: string;
  type: 'image' | 'video' | 'audio';
  name: string;
  path: string;
  size?: number;
  createdAt?: Date;
  modifiedAt?: Date;
  lastModified?: Date;
  mimeType?: string;
  metadata?: any;
}

/**
 * Filters out video segments and maps raw items to filtered format
 * This is the SINGLE SOURCE OF TRUTH for media filtering
 */
export function filterAndMapMediaItems(
  rawItems: RawMediaItem[],
  debugPrefix = '[MEDIA-FILTER]'
): FilteredMediaItem[] {
  console.log(`${debugPrefix} Processing ${rawItems.length} raw items`);
  
  // Step 1: Filter out video segments
  const displayableItems = rawItems.filter((item) => {
    const itemType = (item.type || '').toLowerCase();
    const isVideoSegment = itemType === 'video_segment';
    
    if (isVideoSegment) {
      console.log(`${debugPrefix} Excluding video segment: ${item.name}`);
    }
    
    return !isVideoSegment;
  });
  
  console.log(`${debugPrefix} Filtered to ${displayableItems.length} displayable items`);
  
  // Step 2: Map to consistent format
  const mappedItems: FilteredMediaItem[] = displayableItems.map((item) => {
    const mime = (item.mimeType || '').toLowerCase();
    let type: 'image' | 'video' | 'audio' = 'image';
    
    // Determine type from MIME type first (most reliable)
    if (mime.startsWith('video/')) {
      type = 'video';
    } else if (mime.startsWith('audio/')) {
      type = 'audio';
    } else if (typeof item.type === 'string') {
      // Fallback to item.type with EXACT matching
      const t = item.type.toLowerCase();
      if (t === 'video') {
        type = 'video'; // Only exact 'video' type, not 'video_segment'
      } else if (t.includes('audio')) {
        type = 'audio';
      }
    }
    
    return {
      id: String(item.id),
      placeId: String(item.sourceId || ''),
      type,
      name: item.name || 'Untitled',
      path: item.path,
      size: item.size,
      createdAt: item.createdAt ? new Date(item.createdAt) : undefined,
      modifiedAt: item.modifiedAt ? new Date(item.modifiedAt) : undefined,
      lastModified: item.lastModified ? new Date(item.lastModified) : undefined,
      mimeType: item.mimeType,
      metadata: item.metadata,
    };
  });
  
  // Step 3: Sort by date (newest first)
  mappedItems.sort((a, b) => {
    const aDate = a.modifiedAt || a.lastModified || a.createdAt || new Date(0);
    const bDate = b.modifiedAt || b.lastModified || b.createdAt || new Date(0);
    return bDate.getTime() - aDate.getTime();
  });
  
  console.log(`${debugPrefix} Final result: ${mappedItems.length} items`);
  
  // Log video items specifically for debugging
  const videoItems = mappedItems.filter(item => item.type === 'video');
  if (videoItems.length > 0) {
    console.log(`${debugPrefix} Video items:`, videoItems.map(v => ({
      id: v.id,
      name: v.name,
      type: v.type
    })));
  }
  
  return mappedItems;
}

/**
 * Quick check if an item should be displayed (not a video segment)
 */
export function shouldDisplayItem(item: RawMediaItem): boolean {
  const itemType = (item.type || '').toLowerCase();
  return itemType !== 'video_segment';
}

/**
 * Get the correct media type for an item
 */
export function getMediaType(item: RawMediaItem): 'image' | 'video' | 'audio' {
  const mime = (item.mimeType || '').toLowerCase();
  
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  
  if (typeof item.type === 'string') {
    const t = item.type.toLowerCase();
    if (t === 'video') return 'video'; // Exact match only
    if (t.includes('audio')) return 'audio';
  }
  
  return 'image';
}
