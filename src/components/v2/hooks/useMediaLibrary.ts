/**
 * useMediaLibrary - Custom hook for managing media library state
 */

import { useState, useEffect, useRef } from 'react';
import { MediaT, Place } from '../types';

export function useMediaLibrary() {
  const [library, setLibrary] = useState<MediaT[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);
  const [loading, setLoading] = useState(false);

  // Filter out video_segment items - only show parent videos
  const filterMediaItems = (items: any[]): MediaT[] => {
    console.log('[UI-FILTER-DEBUG] Raw items from API:', items.length);
    
    const filteredItems = items.filter((it: any) => {
      const isVideoSegment = it.type === 'video_segment';
      if (isVideoSegment) {
        console.log('[UI-FILTER-DEBUG] Filtering out video segment:', it.name);
      }
      return !isVideoSegment;
    });
    
    console.log('[UI-FILTER-DEBUG] After filtering segments:', filteredItems.length);
    
    return filteredItems.map((it: any) => {
      const mime = (it.mimeType || '').toLowerCase();
      let kind: 'image' | 'video' | 'audio' = 'image';
      if (mime.startsWith('video/')) kind = 'video';
      else if (mime.startsWith('audio/')) kind = 'audio';
      else if (typeof it.type === 'string') {
        const t = it.type.toLowerCase();
        if (t.includes('video')) kind = 'video';
        else if (t.includes('audio')) kind = 'audio';
      }
      return {
        id: String(it.id),
        placeId: String(it.sourceId || ''),
        type: kind,
        name: it.name || 'item',
        path: it.path,
        thumb: it.thumbnailPath,
      } as MediaT;
    });
  };

  // Load initial library
  const loadLibrary = async () => {
    console.log('[DRILLER] Starting library load at:', new Date().toISOString());
    setLoading(true);
    try {
      const res = await window.mediaAPI.getItems();
      console.log('[DRILLER] getItems response:', res);
      if (res?.success && Array.isArray(res.items)) {
        const mapped = filterMediaItems(res.items);
        // Sort by recency (modifiedAt or createdAt)
        const withDate = (it: any) => new Date(it.modifiedAt || it.lastModified || it.createdAt || 0).getTime();
        mapped.sort((a: any, b: any) => withDate(b) - withDate(a));
        setLibrary(mapped);
        console.log('[DRILLER] Library loaded:', mapped.length, 'items at', new Date().toISOString());
      } else {
        setLibrary([]);
        console.log('[DRILLER] No items found, setting empty library at:', new Date().toISOString());
      }
    } catch (e) {
      console.error('[DRILLER] Error loading library:', e, 'at:', new Date().toISOString());
      setLibrary([]);
    } finally {
      setLoading(false);
    }
  };

  // Load places/sources
  const loadPlaces = async () => {
    console.log('[DRILLER] Starting places load at:', new Date().toISOString());
    try {
      const res = await window.mediaAPI.getSources();
      console.log('[DRILLER] getSources response:', res);
      if (res.success && Array.isArray(res.sources)) {
        const mapped: Place[] = res.sources.map((s) => ({
          id: s.id,
          kind: 'local',
          label: s.name,
          path: s.path || '',
          pinned: false,
        }));
        setPlaces(mapped);
        console.log('[DRILLER] Places loaded:', mapped.length, 'items at', new Date().toISOString());
      } else {
        setPlaces([]);
        console.log('[DRILLER] No sources found, setting empty places at:', new Date().toISOString());
      }
    } catch (e) {
      console.error('[DRILLER] Error loading places:', e, 'at:', new Date().toISOString());
      setPlaces([]);
    }
  };

  // Refresh both library and places
  const refresh = async () => {
    await Promise.all([loadLibrary(), loadPlaces()]);
  };

  // Initial load
  useEffect(() => {
    refresh();
  }, []);

  // Poll for indexing completion and refresh
  useEffect(() => {
    let mounted = true;
    let prevActive = false;
    
    const tick = async () => {
      try {
        const st = await window.mediaAPI.getIndexingStatus();
        const active = !!(st?.success && Array.isArray(st.activeJobs) && st.activeJobs.length > 0);
        if (!active && prevActive && mounted) {
          // Jobs just finished — refresh sources and items ONCE
          console.log('[DRILLER] Indexing completed, refreshing library');
          await refresh();
        }
        prevActive = active;
      } catch (e) {
        console.warn('[DRILLER] Failed to check indexing status:', e);
      }
    };

    const interval = setInterval(tick, 3000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  return {
    library,
    places,
    loading,
    refresh,
    loadLibrary,
    loadPlaces,
  };
}
