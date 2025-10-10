/**
 * useMediaState hook for DrillerV3
 * Manages media library state and operations
 */

import { useState, useEffect, useCallback } from 'react';
import { MediaItem, Place } from '../types/media';
import { filterAndMapMediaItems } from '../utils/mediaFilters';

interface MediaState {
  library: MediaItem[];
  places: Place[];
  loading: boolean;
  error: string | null;
}

interface UseMediaStateReturn extends MediaState {
  refreshLibrary: () => Promise<void>;
  refreshPlaces: () => Promise<void>;
  addPlace: (place: Omit<Place, 'id'>) => Promise<void>;
  removePlace: (placeId: string) => Promise<void>;
}

export function useMediaState(): UseMediaStateReturn {
  const [state, setState] = useState<MediaState>({
    library: [],
    places: [],
    loading: false,
    error: null,
  });

  const refreshLibrary = useCallback(async () => {
    try {
      setState(prev => ({ ...prev, loading: true, error: null }));
      
      console.log('[MEDIA-STATE-DEBUG] Fetching media items with cursor pagination...');
      const itemsRes = await window.mediaAPI.getRecentItems({
        limit: 100,
        orderBy: 'createdAt',
        orderDirection: 'desc'
      });
      
      if (itemsRes.success && Array.isArray(itemsRes.items)) {
        console.log(`[MEDIA-STATE-DEBUG] Retrieved ${itemsRes.items.length} items from API`);
        
        // Use common filtering function
        const mappedItems = filterAndMapMediaItems(itemsRes.items, '[MEDIA-STATE-DEBUG]') as MediaItem[];
        
        setState(prev => ({ ...prev, library: mappedItems, loading: false }));
      } else {
        throw new Error(itemsRes.error || 'Failed to fetch media items');
      }
    } catch (error) {
      console.error('[MEDIA-STATE-ERROR] Failed to refresh library:', error);
      setState(prev => ({ 
        ...prev, 
        loading: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }));
    }
  }, []);

  const refreshPlaces = useCallback(async () => {
    try {
      console.log('[MEDIA-STATE-DEBUG] Fetching places...');
      const sourcesRes = await window.mediaAPI.getSources();
      
      if (sourcesRes.success && Array.isArray(sourcesRes.sources)) {
        const mappedPlaces: Place[] = sourcesRes.sources.map((source: any) => ({
          id: source.id,
          kind: 'local', // Default to local for now
          label: source.name,
          path: source.path || '',
          pinned: false,
          count: 0, // Could be calculated from library
          enabled: source.enabled !== false,
          config: source.config,
        }));
        
        setState(prev => ({ ...prev, places: mappedPlaces }));
      } else {
        throw new Error(sourcesRes.error || 'Failed to fetch places');
      }
    } catch (error) {
      console.error('[MEDIA-STATE-ERROR] Failed to refresh places:', error);
      setState(prev => ({ 
        ...prev, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }));
    }
  }, []);

  const addPlace = useCallback(async (place: Omit<Place, 'id'>) => {
    try {
      console.log('[MEDIA-STATE-DEBUG] Adding new place:', place);
      const result = await window.mediaAPI.addSource({
        name: place.label,
        type: place.kind,
        path: place.path,
        enabled: place.enabled !== false,
        config: place.config || {},
      });
      
      if (result.success) {
        await refreshPlaces();
      } else {
        throw new Error(result.error || 'Failed to add place');
      }
    } catch (error) {
      console.error('[MEDIA-STATE-ERROR] Failed to add place:', error);
      setState(prev => ({ 
        ...prev, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }));
    }
  }, [refreshPlaces]);

  const removePlace = useCallback(async (placeId: string) => {
    try {
      console.log('[MEDIA-STATE-DEBUG] Removing place:', placeId);
      const result = await window.mediaAPI.removeSource(placeId);
      
      if (result.success) {
        await refreshPlaces();
      } else {
        throw new Error(result.error || 'Failed to remove place');
      }
    } catch (error) {
      console.error('[MEDIA-STATE-ERROR] Failed to remove place:', error);
      setState(prev => ({ 
        ...prev, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }));
    }
  }, [refreshPlaces]);

  // Initial load
  useEffect(() => {
    refreshLibrary();
    refreshPlaces();
  }, [refreshLibrary, refreshPlaces]);

  return {
    ...state,
    refreshLibrary,
    refreshPlaces,
    addPlace,
    removePlace,
  };
}

export default useMediaState;
