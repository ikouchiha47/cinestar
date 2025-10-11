import React, { useMemo, useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AutoSizer, List } from 'react-virtualized';
import MediaUpload from '../MediaUpload';
import { VideoPlayerModal } from '../VideoPlayer/VideoPlayerModal';
import { useVideoPlayer } from '../../hooks/useVideoPlayer';

// Import decomposed components
import { Icon } from './components/Icons';
import { PlacesGrid } from './components/PlacesGrid';
import { MediaGroup, MediaCard } from './components/MediaGrid';
import { ConnectModal } from './components/ConnectModal';
import { SettingsModal } from './components/SettingsModal';
import { useMediaLibrary } from './hooks/useMediaLibrary';
import { useDebounce } from './hooks/useDebounce';
import { Scope, Place, MediaT } from './types';


export default function DrillerV2(props: { overallProgress?: number; onOpenIndexing: () => void }) {
  const { overallProgress = -1, onOpenIndexing } = props;

  // Video player state
  const { playerState, openVideoPlayer, closeVideoPlayer } = useVideoPlayer();

  const [q, setQ] = useState('');
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [scope, setScope] = useState<Scope>('all');
  const [selectedPlace, setSelectedPlace] = useState<string | undefined>();
  const [connectOpen, setConnectOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [places, setPlaces] = useState<Place[]>([]);
  const [searchResults, setSearchResults] = useState<MediaT[]>([]);
  // const [videoSearchResults, setVideoSearchResults] = useState<MediaT[]>([]);
  // const [videoHasMore, setVideoHasMore] = useState<boolean>(false);
  // const [videoOffset, setVideoOffset] = useState<number>(0);
  const [library, setLibrary] = useState<MediaT[]>([]);
  const [libraryCursor, setLibraryCursor] = useState<string | undefined>();
  const [libraryHasMore, setLibraryHasMore] = useState(false);
  const [searching, setSearching] = useState(false);
  const [expandedType, setExpandedType] = useState<'image' | 'video' | 'audio' | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentSearchIdRef = useRef<string | null>(null);

  // Load places from real sources, fall back to demo
  useEffect(() => {
    (async () => {
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
    })();
  }, []);

  // Remove demo media; show results only when searching
  // Initial library load for start page (newest first) - CURSOR PAGINATION
  useEffect(() => {
    (async () => {
      console.log('[DRILLER] Starting library load with cursor pagination at:', new Date().toISOString());
      try {
        const res = await window.mediaAPI.getRecentItems({
          limit: 50,
          cursor: undefined, // First page
          orderBy: 'createdAt',
          orderDirection: 'desc'
        });
        console.log('[DRILLER] getRecentItems response:', res);
        if (res?.success && Array.isArray(res.items)) {
          const items: any[] = res.items;
          console.log('[UI-FILTER-DEBUG] Raw items from API:', items.length);
          
          // Filter out video_segment items - only show parent videos
          const filteredItems = items.filter((it: any) => {
            const isVideoSegment = it.type === 'video_segment';
            if (isVideoSegment) {
              console.log('[UI-FILTER-DEBUG] Filtering out video segment:', it.name);
            }
            return !isVideoSegment;
          });
          
          console.log('[UI-FILTER-DEBUG] After filtering segments:', filteredItems.length);
          
          const mapped: MediaT[] = filteredItems.map((it: any) => {
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
              thumb: it.metadata?.thumbnailPath || undefined,
            } as MediaT;
          });
          setLibrary(mapped);
          setLibraryCursor(res.nextCursor);
          setLibraryHasMore(res.hasMore || false);
          console.log('[DRILLER] Library loaded:', mapped.length, 'items, hasMore:', res.hasMore, 'at', new Date().toISOString());
        } else {
          setLibrary([]);
          setLibraryCursor(undefined);
          setLibraryHasMore(false);
          console.log('[DRILLER] No items found, setting empty library at:', new Date().toISOString());
        }
      } catch (e) {
        console.error('[DRILLER] Error loading library:', e, 'at:', new Date().toISOString());
        setLibrary([]);
        setLibraryCursor(undefined);
        setLibraryHasMore(false);
      }
    })();
  }, []);

  // Refresh library when selected place changes - CURSOR PAGINATION
  useEffect(() => {
    (async () => {
      try {
        const res = await window.mediaAPI.getRecentItems({
          sourceIds: selectedPlace ? [selectedPlace] : undefined,
          limit: 50,
          cursor: undefined,
          orderBy: 'createdAt',
          orderDirection: 'desc'
        });
        if (res?.success && Array.isArray(res.items)) {
          const items: any[] = res.items;
          
          // Filter out video_segment items - only show parent videos
          const filteredItems = items.filter((it: any) => {
            return it.type !== 'video_segment';
          });
          
          const mapped: MediaT[] = filteredItems.map((it: any) => {
            const mime = (it.mimeType || '').toLowerCase();
            let kind: 'image' | 'video' | 'audio' = 'image';
            if (mime.startsWith('video/')) kind = 'video';
            else if (mime.startsWith('audio/')) kind = 'audio';
            else if (typeof it.type === 'string') {
              const t = it.type.toLowerCase();
              if (t.includes('video')) kind = 'video';
              else if (t.includes('audio')) kind = 'audio';
            }
            return { id: String(it.id), placeId: String(it.sourceId || ''), type: kind, name: it.name || 'item', path: it.path, thumb: it.metadata?.thumbnailPath || undefined } as MediaT;
          });
          setLibrary(mapped);
          setLibraryCursor(res.nextCursor);
          setLibraryHasMore(res.hasMore || false);
        }
      } catch {}
    })();
  }, [selectedPlace]);

  // Listen for scan completion events to refresh UI immediately
  useEffect(() => {
    console.log('[DRILLER-IPC] Setting up media:scan-completed listener');
    console.log('[DRILLER-IPC] window.ipcRenderer available:', !!window.ipcRenderer);
    
    const handleScanCompleted = async (_event: any, data: { sourceId: string; itemsAdded: number }) => {
      console.log(`[DRILLER-IPC] ✅ Scan completed event RECEIVED: ${data.itemsAdded} items added`);
      
      // Refresh sources and items immediately
      (async () => {
        try {
          const res = await (window.mediaAPI as any).getRecentItems({
            limit: 50,
            cursor: undefined,
            orderBy: 'createdAt',
            orderDirection: 'desc'
          });
          
          if (res?.success && Array.isArray(res.items)) {
            const items: any[] = res.items;
            const displayableItems = items.filter((it: any) => (it.type || '').toLowerCase() !== 'video_segment');
            
            const mapped: MediaT[] = displayableItems.map((it: any) => {
              const kind: MediaT['type'] = (it.type === 'video' || it.type === 'video_segment') ? 'video' : (it.type === 'audio' ? 'audio' : 'image');
              return { id: String(it.id), placeId: String(it.sourceId || ''), type: kind, name: it.name || 'item', path: it.path, thumb: it.metadata?.thumbnailPath || undefined } as MediaT;
            });
            
            setLibrary(mapped);
            setLibraryCursor(res.nextCursor);
            setLibraryHasMore(res.hasMore || false);
            console.log(`[DRILLER] Refreshed library: ${mapped.length} items`);
          }
        } catch (error) {
          console.error('[DRILLER] Failed to refresh after scan:', error);
        }
      })();
    };
    
    // @ts-ignore - Electron IPC
    if (window.ipcRenderer) {
      console.log('[DRILLER-IPC] Registering listener for media:scan-completed');
      window.ipcRenderer.on('media:scan-completed', handleScanCompleted);
      console.log('[DRILLER-IPC] Listener registered successfully');
    } else {
      console.error('[DRILLER-IPC] ❌ window.ipcRenderer is NOT available!');
    }
    
    return () => {
      // @ts-ignore
      if (window.ipcRenderer) {
        console.log('[DRILLER-IPC] Removing listener for media:scan-completed');
        window.ipcRenderer.off('media:scan-completed', handleScanCompleted);
      }
    };
  }, []);

  // Poll indexing status; when jobs finish, refresh places and library
  useEffect(() => {
    let mounted = true;
    let prevActive = false;
    const tick = async () => {
      try {
        const st = await window.mediaAPI.getIndexingStatus();
        const active = !!(st?.success && Array.isArray(st.activeJobs) && st.activeJobs.length > 0);
        if (!active && prevActive && mounted) {
          // Jobs just finished — refresh sources and items ONCE
          try {
            const [sourcesRes, itemsRes] = await Promise.all([
              window.mediaAPI.getSources(),
              window.mediaAPI.getRecentItems({ limit: 50, cursor: undefined, orderBy: 'createdAt', orderDirection: 'desc' })
            ]);
            
            if (sourcesRes.success && Array.isArray(sourcesRes.sources)) {
              const mapped: Place[] = sourcesRes.sources.map((s) => ({ id: s.id, kind: 'local', label: s.name, path: s.path || '', pinned: false }));
              setPlaces(mapped);
            }
            
            if (itemsRes.success && Array.isArray(itemsRes.items)) {
              console.log(`[UI-MAPPING-DEBUG] Processing ${itemsRes.items.length} items for UI display`);
              
              // Filter out video segments - they should only be searchable, not displayed as separate cards
              const displayableItems = itemsRes.items.filter((it: any) => {
                const itemType = (it.type || '').toLowerCase();
                const isVideoSegment = itemType === 'video_segment';
                if (isVideoSegment) {
                  console.log(`[UI-FILTER-DEBUG] Excluding video segment from display: ${it.name}`);
                }
                return !isVideoSegment;
              });
              
              console.log(`[UI-FILTER-DEBUG] Filtered ${itemsRes.items.length} items down to ${displayableItems.length} displayable items`);
              
              const mapped: MediaT[] = displayableItems.map((it: any, index: number) => {
                const mime = (it.mimeType || '').toLowerCase();
                let kind: 'image' | 'video' | 'audio' = 'image';
                if (mime.startsWith('video/')) kind = 'video';
                else if (mime.startsWith('audio/')) kind = 'audio';
                else if (typeof it.type === 'string') {
                  const t = it.type.toLowerCase();
                  if (t === 'video') kind = 'video'; // Only exact 'video' type, not 'video_segment'
                  else if (t.includes('audio')) kind = 'audio';
                }
                
                const mappedItem = { id: String(it.id), placeId: String(it.sourceId || ''), type: kind, name: it.name || 'item', path: it.path } as MediaT;
                
                // Log video items specifically
                if (kind === 'video') {
                  console.log(`[UI-MAPPING-DEBUG] Video item ${index + 1}:`, {
                    originalItem: {
                      id: it.id,
                      name: it.name,
                      type: it.type,
                      path: it.path,
                      sourceId: it.sourceId
                    },
                    mappedItem: mappedItem
                  });
                }
                
                return mappedItem;
              });
              
              // Final check for duplicates in UI
              const videoItems = mapped.filter(item => item.type === 'video');
              if (videoItems.length > 1) {
                console.warn(`[UI-MAPPING-DEBUG] ⚠️ Multiple video items will be displayed: ${videoItems.length}`);
                videoItems.forEach((item, index) => {
                  console.log(`[UI-MAPPING-DEBUG] UI Video ${index + 1}: ${item.name} (${item.id})`);
                });
              }
              
              setLibrary(mapped);
              setLibraryCursor(itemsRes.nextCursor);
              setLibraryHasMore(itemsRes.hasMore || false);
            }
          } catch {}
        }
        prevActive = active;
      } catch {}
    };
    const h = setInterval(tick, 1500);
    return () => { mounted = false; clearInterval(h); };
  }, []);

  // Real search integration (debounced ~4s) when not on Folders tab
  useEffect(() => {
    let alive = true;

    const performSearch = async () => {
      const query = q.trim();
      if (!query || scope === 'folders') {
        if (alive) {
          setSearchResults([]);
          // setVideoSearchResults([]);
        }
        return;
      }
      
      // Generate unique search ID
      const searchId = `search_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      currentSearchIdRef.current = searchId;
      
      try {
        setSearching(true);
        // Unified search across media (images via vec) and videos (segments FTS)
        console.log(`[SEARCH-CANCEL] Starting search ${searchId} for: "${query}"`);
        const res: any = await (window.mediaAPI as any).unifiedSearch(query, { limit: 40, offset: 0 });
        
        // Check if this search is still current
        if (currentSearchIdRef.current !== searchId) {
          console.log(`[SEARCH-CANCEL] Ignoring stale results for search ${searchId} (current: ${currentSearchIdRef.current})`);
          return;
        }
        
        if (!alive) return;
        
        console.log(`[SEARCH-CANCEL] Search ${searchId} completed - applying results`);
        console.log('[SEARCH-DEBUG] Images array:', res?.results?.images);
        console.log('[SEARCH-DEBUG] Videos array:', res?.results?.videos);

        // Map images (media/vector)
        const images: any[] = Array.isArray(res?.results?.images) ? res.results.images : [];
        const mediaItems: MediaT[] = images.map((it: any) => {
          const mime = (it.mimeType || '').toLowerCase();
          let kind: 'image' | 'video' | 'audio' = 'image';
          if (mime.startsWith('video/')) kind = 'video';
          else if (mime.startsWith('audio/')) kind = 'audio';
          else if (typeof it.type === 'string') {
            const t = it.type.toLowerCase();
            if (t.includes('video')) kind = 'video';
            else if (t.includes('audio')) kind = 'audio';
          } else if (typeof it.name === 'string') {
            const n = it.name.toLowerCase();
            if (n.match(/\.(mp4|mov|mkv|webm|avi)$/)) kind = 'video';
            else if (n.match(/\.(mp3|wav|flac|aac|m4a)$/)) kind = 'audio';
          }
          return { id: String(it.id), placeId: String(it.sourceId || ''), type: kind, name: it.name || 'item', path: it.path, thumb: it.metadata?.thumbnailPath || undefined } as MediaT;
        });

        // Map videos (video DB segments -> flattened video files)
        const videos: any[] = Array.isArray(res?.results?.videos) ? res.results.videos : [];
        const videoItems: MediaT[] = videos.map((r: any) => ({
          id: String(r.id || Math.random().toString(36).slice(2)),
          placeId: String(r.sourceId || ''),
          type: 'video',
          name: String(r.name || 'video'),
          path: String(r.path || ''),
          thumb: String(r.metadata?.thumbnailPath || r.metadata?.thumbnailUrl || ''),
        } as MediaT));

        // Set results - combine images and videos into single searchResults array
        const allResults = [...mediaItems, ...videoItems];
        setSearchResults(allResults);
        // setVideoSearchResults(videoItems);
        // setVideoHasMore(!!res?.results?.hasMore?.videos);
        // setVideoOffset(videoItems.length);
      } catch (error) {
        console.error('[SEARCH-ERROR]', error);
        // Only clear results if this is still the current search
        if (currentSearchIdRef.current === searchId) {
          setSearchResults([]);
        }
        // setVideoSearchResults([]);
      } finally {
        // Only clear searching state if this is still the current search
        if (alive && currentSearchIdRef.current === searchId) {
          setSearching(false);
        }
      }
    };

    // Clear any existing debounce and start a new one
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      performSearch();
    }, 4000);

    return () => {
      alive = false;
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [q, scope]);

  // Load more video segment results using pagination from unifiedSearch
  // const loadMoreVideos = async () => {
  //   const query = q.trim();
  //   if (!query || !videoHasMore) return;
  //   try {
  //     setSearching(true);
  //     const res: any = await (window.mediaAPI as any).unifiedSearch(query, { limit: 40, offset: videoOffset });
  //     const videos: any[] = Array.isArray(res?.results?.videos) ? res.results.videos : [];
  //     const more: MediaT[] = videos.map((r: any) => ({
  //       id: String(r.id || Math.random().toString(36).slice(2)),
  //       placeId: String(r.sourceId || ''),
  //       type: 'video',
  //       name: String(r.name || 'video'),
  //       path: String(r.path || ''),
  //       thumb: String(r.metadata?.thumbnailPath || r.metadata?.thumbnailUrl || ''),
  //     } as MediaT));
  //     setVideoSearchResults((prev) => [...prev, ...more]);
  //     setVideoOffset((prev) => prev + more.length);
  //     setVideoHasMore(!!res?.results?.hasMore?.videos);
  //   } catch {
  //     // ignore
  //   } finally {
  //     setSearching(false);
  //   }
  // };

  const scopedMedia = useMemo(() => {
    // If search bar is empty, always show library
    // If search bar has text AND results loaded, show search results
    // If search bar has text BUT no results yet, keep showing library (prevents flicker)
    const hasQuery = q.trim().length > 0;
    const base = (hasQuery && searchResults.length > 0) ? searchResults : library;
    let data = base;
    if (scope === 's3') data = data.filter((m) => places.find((p) => p.id === m.placeId)?.kind === 's3');
    if (scope === 'drive') data = data.filter((m) => places.find((p) => p.id === m.placeId)?.kind === 'gdrive');
    if (selectedPlace) data = data.filter((m) => m.placeId === selectedPlace);
    // Do not apply text-based name filtering here; semantic results may not include the literal query in the filename
    return data;
  }, [q, scope, selectedPlace, searchResults, library, places]);

  const grouped = useMemo(
    () => {
      const result = {
        image: scopedMedia.filter((m) => m.type === 'image'),
        video: scopedMedia.filter((m) => m.type === 'video'),
        audio: scopedMedia.filter((m) => m.type === 'audio'),
      };
      
      return result;
    },
    [scopedMedia, q]
  );

  const pinned = useMemo(() => places.filter((p) => p.pinned).slice(0, 3), [places]);

  // Stacks placeholder (empty for now)
  const stacks: string[] = [];

  // Start indexing for a place/source
  const startIndexing = async (placeId: string, forceReindex?: boolean) => {
    try {
      const res = forceReindex 
        ? await window.mediaAPI.forceReindex(placeId)
        : await window.mediaAPI.startIndexing(placeId);
      if (!res.success) console.error(`Failed to start ${forceReindex ? 'force re-indexing' : 'indexing'}: ${res.error || 'Unknown error'}`);
    } catch (e) {
      console.error(`Failed to start ${forceReindex ? 'force re-indexing' : 'indexing'}`, e);
    }
  };

  // Handle item deletion - optimistically remove from UI
  const handleItemDeleted = (itemId: string) => {
    setLibrary(prev => prev.filter(item => item.id !== itemId));
    setSearchResults(prev => prev.filter(item => item.id !== itemId));
    // setVideoSearchResults(prev => prev.filter(item => item.id !== itemId));
  };

  // Handle video item click - open video player
  const handleVideoClick = async (item: MediaT) => {
    console.log('[DRILLER-V2] Opening video player for:', item);
    
    if (item.type !== 'video') {
      console.log('[DRILLER-V2] Item is not a video, ignoring click');
      return;
    }

    try {
      // Determine if this is from a search result (has search query context)
      const isFromSearch = q.trim().length > 0;
      const searchQuery = isFromSearch ? q.trim() : undefined;
      
      // Extract initial timestamp if this is a video segment
      let initialTimestamp: number | undefined;
      if (item.path.includes('#t=')) {
        const timeMatch = item.path.match(/#t=(\d+(?:\.\d+)?)/);
        if (timeMatch) {
          initialTimestamp = parseFloat(timeMatch[1]);
        }
      }
      
      // Get the base video path (remove fragment if present)
      const videoPath = item.path.split('#t=')[0];
      
      await openVideoPlayer({
        videoPath,
        videoName: item.name,
        searchQuery,
        initialTimestamp,
      });
    } catch (error) {
      console.error('[DRILLER-V2] Failed to open video player:', error);
    }
  };

  return (
    <div className="min-h-screen text-neutral-100">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b app-border tokyo-bg backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 py-3 grid grid-cols-3 items-center">
          <div className="flex items-center gap-2">
            <button onClick={() => setConnectOpen(true)} className="inline-flex items-center gap-2 rounded-xl border border-blue-800/50 bg-blue-950/30 px-3 py-2 text-sm text-blue-300 hover:bg-blue-900/40 transition-colors">
              <Icon.Plus /> Connect a place
            </button>
            <button onClick={() => setUploadModalOpen(true)} className="inline-flex items-center gap-2 rounded-xl border border-purple-800/50 bg-purple-950/30 px-3 py-2 text-sm text-purple-300 hover:bg-purple-900/40 transition-colors">
              <Icon.Video /> Upload Media
            </button>
          </div>
          <div className="text-center">
            <div className="text-lg font-semibold tracking-tight">Cinestar</div>
            <div className="text-[11px] text-neutral-400">Media Search</div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button 
              onClick={onOpenIndexing} 
              className={`inline-flex items-center gap-2 rounded-xl border backdrop-blur-sm px-3 py-2 text-sm transition-all ${
                overallProgress >= 0 
                  ? 'border-emerald-500/50 bg-emerald-950/30 text-emerald-200 hover:bg-emerald-900/40 hover:border-emerald-400/70 shadow-lg shadow-emerald-500/20' 
                  : 'border-neutral-600/40 bg-neutral-900/40 hover:bg-neutral-800/50 hover:border-neutral-500/60'
              }`}
              title={overallProgress >= 0 ? "Processing media..." : "View activity"}
            >
              {overallProgress >= 0 && (
                <Icon.Bolt className="w-4 h-4 animate-pulse" />
              )}
              Activity Panel
            </button>
            <button onClick={() => setSettingsOpen(true)} className="rounded-xl border border-neutral-800 bg-neutral-900 p-2 hover:bg-neutral-800 transition-colors">
              <Icon.Settings className="w-4 h-4" />
            </button>
          </div>
        </div>
        {/* Search + pills */}
        <div className="mx-auto max-w-3xl px-4 pb-4">
          <div className="mt-6 flex items-center gap-2 rounded-2xl bg-neutral-900/40 backdrop-blur-sm border border-neutral-800 px-4 py-3 focus-within:border-neutral-700">
            <Icon.Search className="text-neutral-400" />
            <input
              value={q}
              onChange={(e) => {
                console.log('[INPUT-DEBUG] Search input changed:', e.target.value);
                setQ(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  console.log(`[SEARCH-DEBUG] Enter pressed with query "${(e.target as HTMLInputElement).value}"`);
                  // Cancel pending debounce and run search immediately
                  if (debounceRef.current) {
                    clearTimeout(debounceRef.current);
                    debounceRef.current = null;
                  }
                  // Trigger the effect's performSearch by transiently changing scope
                  // Simpler: temporarily setSearching and invoke mediaAPI directly here
                  (async () => {
                    console.log(`[SEARCH-DEBUG] Starting search function with q="${q}", scope="${scope}"`);
                    const query = q.trim();
                    if (!query || scope === 'folders') {
                      console.log(`[SEARCH-DEBUG] Exiting early - query="${query}", scope="${scope}"`);
                      setSearchResults([]);
                      // setVideoSearchResults([]);
                      return;
                    }
                    try {
                      setSearching(true);
                      console.log(`[SEARCH-DEBUG] Calling unifiedSearch with query: "${query}"`);
                      const res: any = await (window.mediaAPI as any).unifiedSearch(query, { limit: 40, offset: 0 });
                      console.log(`[SEARCH-DEBUG] Got response with ${res?.results?.images?.length || 0} images, ${res?.results?.videos?.length || 0} videos`);
                      
                      const images: any[] = Array.isArray(res?.results?.images) ? res.results.images : [];
                      
                      const mediaItems: MediaT[] = images.map((it: any) => {
                        const mime = (it.mimeType || '').toLowerCase();
                        let kind: 'image' | 'video' | 'audio' = 'image';
                        if (mime.startsWith('video/')) kind = 'video';

                        else if (mime.startsWith('audio/')) kind = 'audio';

                        else if (typeof it.type === 'string') {
                          const t = it.type.toLowerCase();
                          if (t.includes('video')) kind = 'video';
                          else if (t.includes('audio')) kind = 'audio';
                          else kind = 'image';
                        } else if (typeof it.name === 'string') {
                          const n = it.name.toLowerCase();
                          if (n.match(/\.(mp4|mov|mkv|webm|avi)$/)) kind = 'video';
                          else if (n.match(/\.(mp3|wav|flac|aac|m4a)$/)) kind = 'audio';
                          else kind = 'image';
                        }
                        return { id: String(it.id), placeId: String(it.sourceId || ''), type: kind, name: it.name || 'item', path: it.path, thumb: it.metadata?.thumbnailPath || undefined } as MediaT;
                      });

                      const videos: any[] = Array.isArray(res?.results?.videos) ? res.results.videos : [];
                      const videoItems: MediaT[] = videos.map((r: any) => ({
                        id: String(r.id || Math.random().toString(36).slice(2)),
                        placeId: String(r.sourceId || ''),
                        type: 'video',
                        name: String(r.name || 'video'),
                        path: String(r.path || ''),
                        thumb: String(r.metadata?.thumbnailPath || r.metadata?.thumbnailUrl || ''),
                      } as MediaT));
                      // Set results - COMBINE images and videos into searchResults
                      const allResults = [...mediaItems, ...videoItems];
                      setSearchResults(allResults);
                      // setVideoSearchResults(videoItems);
                      // setVideoHasMore(!!res?.results?.hasMore?.videos);
                      // setVideoOffset(videoItems.length);
                    } catch {
                      setSearchResults([]);
                      // setVideoSearchResults([]);
                    } finally {
                      setSearching(false);
                    }
                  })();
                }
              }}
              placeholder={scope === 'folders' ? 'Filter folders…' : 'Search your media…'}
              className="w-full bg-transparent outline-none placeholder:text-neutral-500"
            />
            {searching && <span className="text-[11px] text-neutral-500">Searching…</span>}
          </div>

          {/* Media Search Pills */}
          <div className="mt-3 flex items-center justify-center gap-2 flex-wrap">
            {/* pinned places */}
            <Pill
              active={!selectedPlace && scope === 'all'}
              label="All"
              onClick={() => {
                setSelectedPlace(undefined);
                setScope('all');
              }}
            />
              {pinned.map((p) => (
                <Pill
                  key={p.id}
                  active={selectedPlace === p.id}
                  label={p.label}
                  onClick={() => {
                    setSelectedPlace(p.id);
                    setScope('all');
                  }}
                />
              ))}
              {(['s3', 'drive', 'folders'] as const).map((s) => (
                <Pill
                  key={s}
                  active={scope === s}
                  label={s === 's3' ? 'S3' : s === 'drive' ? 'Drive' : 'Folders'}
                  onClick={() => {
                    setScope(s);
                    setSelectedPlace(undefined);
                  }}
                />
              ))}
            </div>
        </div>
      </header>

      {/* Scoped banner */}
      {selectedPlace && (
        <div className="mx-auto max-w-7xl px-4 pt-4">
          <div className="flex items-center gap-2 text-sm text-neutral-400">
            <span>Scope:</span>
            <span className="inline-flex items-center gap-2 rounded-full bg-neutral-900 border border-neutral-800 px-3 py-1">
              <Icon.Folder /> {places.find((p) => p.id === selectedPlace)?.label}
            </span>
            <button onClick={() => setSelectedPlace(undefined)} className="text-neutral-300 hover:text-white">
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Stacks (empty for now) */}
      {!selectedPlace && scope !== 'folders' && stacks.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 pt-4">
          <div className="text-sm text-neutral-400 mb-2">Stacks</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {stacks.map((t) => (
              <StackCard key={t} title={t} />
            ))}
          </div>
        </section>
      )}

      {/* Main */}
      <main className="mx-auto max-w-7xl px-4 py-6 space-y-6">
        {scope === 'folders' ? (
          <PlacesGrid
            places={q.trim() ? places.filter(p => p.label.toLowerCase().includes(q.toLowerCase()) || p.path.toLowerCase().includes(q.toLowerCase())) : places}
            onBrowse={(id) => { setSelectedPlace(id); setScope('all'); }}
            onIndex={startIndexing}
          />
        ) : scope === 's3' ? (
          <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6 text-center text-neutral-400">
            <div className="text-lg mb-1">S3 Integration</div>
            <div className="text-sm">In Development</div>
          </section>
        ) : scope === 'drive' ? (
          <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6 text-center text-neutral-400">
            <div className="text-lg mb-1">Google Drive Integration</div>
            <div className="text-sm">In Development</div>
          </section>
        ) : (
          <>
            {/* Search results header */}
            {q.trim().length > 0 && searchResults.length > 0 && (
              <div className="mb-6 px-1">
                <div className="text-xl text-neutral-300">
                  Search results for: <span className="text-base text-white font-semibold">"{q.trim().split(' ').slice(0, 10).join(' ')}{q.trim().split(' ').length > 10 ? '...' : ''}"</span>
                </div>
              </div>
            )}
            
            <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 220px)' }}>
              {expandedType === null ? (
                <>
                  <MediaGroup
                    title="Images"
                    icon={<Icon.Image />}
                    items={grouped.image}
                    places={places}
                    maxVisible={6}
                    onShowMore={() => setExpandedType('image')}
                    onItemDeleted={handleItemDeleted}
                  />
                  <MediaGroup
                    title="Videos"
                    icon={<Icon.Video />}
                    items={grouped.video}
                    places={places}
                    maxVisible={6}
                    onShowMore={() => setExpandedType('video')}
                    onItemDeleted={handleItemDeleted}
                    onVideoClick={handleVideoClick}
                  />
                  <MediaGroup
                    title="Audio"
                    icon={<Icon.Audio />}
                    items={grouped.audio}
                    places={places}
                    maxVisible={6}
                    onShowMore={() => setExpandedType('audio')}
                    onItemDeleted={handleItemDeleted}
                  />
                </>
              ) : null}
            </div>
            {expandedType && (
              <ExpandedVirtualOverlay
                type={expandedType}
                placeId={selectedPlace}
                onBack={() => setExpandedType(null)}
              />
            )}
          </>
        )}
      </main>

      {/* Drawers */}
      {connectOpen && (
        <ConnectDrawer
          onClose={() => setConnectOpen(false)}
          onPick={async (kind) => {
            if (kind === 'local') {
              try {
                const res = await window.mediaAPI.selectDirectory();
                if (!res.canceled && res.path) {
                  const add = await window.mediaAPI.addSource(res.path.split('/').pop() || 'Folder', 'local', res.path);
                  if (add.success && add.id) {
                    // Auto-start indexing for newly added source
                    const indexResult = await window.mediaAPI.startIndexing(add.id);
                    if (indexResult.success) {
                      console.log(`Started indexing for source ${add.id}`);
                    } else {
                      console.warn(`Failed to start indexing: ${indexResult.error}`);
                    }
                    
                    const sync = await window.mediaAPI.getSources();
                    if (sync.success && sync.sources) {
                      setPlaces(sync.sources.map((s) => ({ id: s.id, kind: 'local', label: s.name, path: s.path || '' })));
                    }
                  }
                }
              } catch (e) {
                console.warn('Failed to add local folder', e);
              }
            } else {
              // Placeholder for S3/Drive/NAS
              console.log(`${kind.toUpperCase()} coming soon`);
            }
            setConnectOpen(false);
          }}
        />
      )}

      {/* Upload Modal */}
      {uploadModalOpen && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={() => setUploadModalOpen(false)} />
          <div className="absolute right-0 top-0 h-full w-full sm:w-[520px] bg-neutral-900 border-l border-neutral-800 shadow-xl flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
              <div className="font-semibold">Upload Media</div>
              <button onClick={() => setUploadModalOpen(false)} className="rounded-lg border border-neutral-700 p-2 hover:bg-neutral-800">
                <Icon.Close />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <MediaUpload 
                onMediaAdded={async () => {
                  // Refresh sources when video is added
                  try {
                    const res = await window.mediaAPI.getSources();
                    if (res.success && Array.isArray(res.sources)) {
                      const mapped: Place[] = res.sources.map((s) => ({
                        id: s.id,
                        kind: 'local',
                        label: s.name,
                        path: s.path || '',
                        pinned: false,
                        count: 0
                      }));
                      setPlaces(mapped);
                    }
                    // Also refresh items so the new video shows up in the Videos group immediately
                    try {
                      const itemsRes = await window.mediaAPI.getRecentItems({ limit: 50, cursor: undefined, orderBy: 'createdAt', orderDirection: 'desc' });
                      if (itemsRes?.success && Array.isArray(itemsRes.items)) {
                        console.log(`[UPLOAD-CALLBACK-DEBUG] Processing ${itemsRes.items.length} items after upload`);
                        
                        // Filter out video segments - same logic as polling
                        const displayableItems = itemsRes.items.filter((it: any) => {
                          const itemType = (it.type || '').toLowerCase();
                          const isVideoSegment = itemType === 'video_segment';
                          if (isVideoSegment) {
                            console.log(`[UPLOAD-CALLBACK-DEBUG] Excluding video segment: ${it.name}`);
                          }
                          return !isVideoSegment;
                        });
                        
                        console.log(`[UPLOAD-CALLBACK-DEBUG] Filtered ${itemsRes.items.length} items down to ${displayableItems.length} displayable items`);
                        
                        const mappedItems: MediaT[] = displayableItems.map((it: any) => {
                          const mime = (it.mimeType || '').toLowerCase();
                          let kind: 'image' | 'video' | 'audio' = 'image';
                          if (mime.startsWith('video/')) kind = 'video';
                          else if (mime.startsWith('audio/')) kind = 'audio';
                          else if (typeof it.type === 'string') {
                            const t = it.type.toLowerCase();
                            if (t === 'video') kind = 'video'; // Only exact 'video' type, not 'video_segment'
                            else if (t.includes('audio')) kind = 'audio';
                          }
                          return { id: String(it.id), placeId: String(it.sourceId || ''), type: kind, name: it.name || 'item', path: it.path, thumb: it.metadata?.thumbnailPath || undefined } as MediaT;
                        });
                        setLibrary(mappedItems);
                        setLibraryCursor(itemsRes.nextCursor);
                        setLibraryHasMore(itemsRes.hasMore || false);
                      }
                    } catch {}
                  } catch (error) {
                    console.error('Failed to refresh sources:', error);
                  }
                  // Close modal after successful upload
                  setUploadModalOpen(false);
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* Video Player Modal */}
      <VideoPlayerModal
        isOpen={playerState.isOpen}
        onClose={closeVideoPlayer}
        videoPath={playerState.videoPath}
        videoName={playerState.videoName}
        segments={playerState.segments}
        initialTimestamp={playerState.initialTimestamp}
        searchQuery={playerState.searchQuery}
      />

      <footer className="fixed bottom-3 right-4 z-10 text-xs text-neutral-500">© Driller — v2 UI</footer>
    </div>
  );
}

function Pill({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-sm border ${active ? 'bg-neutral-200 text-neutral-900 border-neutral-200' : 'border-neutral-800 text-neutral-300 hover:bg-neutral-900'}`}
    >
      {label}
    </button>
  );
}

function StackCard({ title }: { title: string }) {
  return (
    <button className="group rounded-2xl border border-neutral-900 bg-neutral-900/50 p-3 text-left hover:border-neutral-700">
      <div
        className="aspect-[5/3] rounded-xl border border-neutral-900 mb-3"
        style={{ background: `linear-gradient(135deg, hsl(${Math.random() * 360} 85% 55%), hsl(${Math.random() * 360} 85% 55%))` }}
      />
      <div className="text-sm font-medium">{title}</div>
      <div className="text-xs text-neutral-400">Auto‑clustered</div>
    </button>
  );
}


function ExpandedVirtualOverlay({ type, placeId, onBack }: { type: 'image'|'video'|'audio'|null; placeId?: string; onBack: () => void }) {
  const [items, setItems] = useState<MediaT[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const PAGE = 120;
  const PREFETCH_MULT = 1.5;

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!type) return;
      setLoading(true);
      try {
        const res = await (window.mediaAPI as any).getRecentItems({
          sourceIds: placeId ? [placeId] : undefined,
          types: [type],
          limit: PAGE,
          cursor: undefined,
          orderBy: 'createdAt',
          orderDirection: 'desc'
        });
        if (!alive) return;
        if (res?.success && Array.isArray(res.items)) {
          const mapped: MediaT[] = res.items.map((it: any) => {
            const mime = (it.mimeType || '').toLowerCase();
            let kind: 'image'|'video'|'audio' = 'image';
            if (mime.startsWith('video/')) kind = 'video';
            else if (mime.startsWith('audio/')) kind = 'audio';
            else if (typeof it.type === 'string') {
              const t = it.type.toLowerCase();
              if (t.includes('video')) kind = 'video';
              else if (t.includes('audio')) kind = 'audio';
            }
            return { id: String(it.id), placeId: String(it.sourceId || ''), type: kind, name: it.name || 'item', path: it.path, thumb: it.metadata?.thumbnailPath || undefined } as MediaT;
          });
          setItems(mapped);
          setCursor(res.nextCursor);
          setHasMore(res.hasMore || false);
        } else {
          setItems([]);
          setCursor(undefined);
          setHasMore(false);
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [type, placeId]);

  const overlay = (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onBack} />
      <div className="absolute left-1/2 top-[18%] -translate-x-1/2 w-[min(95vw,1280px)]">
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 backdrop-blur-xl shadow-xl p-3">
          <div className="flex items-center justify-between mb-2 px-1">
            <div className="flex items-center gap-2 text-sm text-neutral-300">
              <b>{type === 'image' ? 'Images' : type === 'video' ? 'Videos' : 'Audio'}</b>
              <span className="text-neutral-500">{items.length}{hasMore ? '+' : ''}</span>
            </div>
            <div className="flex items-center gap-2">
              <button className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:border-neutral-700" onClick={onBack}>Back</button>
              <div className="text-xs text-neutral-500">Virtualized</div>
            </div>
          </div>
          <div style={{ height: '66vh' }}>
            <AutoSizer>
              {({ width, height }: { width: number; height: number }) => {
                const gap = 12;
                const minCard = 180;
                const perRow = Math.max(1, Math.floor((width + gap) / (minCard + gap)));
                const cardWidth = (width - gap * (perRow - 1)) / perRow;
                const caption = 56; // approx caption + padding
                const rowHeight = Math.ceil(cardWidth + caption);
                const rowCount = Math.max(1, Math.ceil(items.length / perRow));

                // Infinite scroll: Load more when scrolling near bottom
                const rowsVisible = Math.ceil(height / rowHeight);
                const wantCount = Math.ceil((rowsVisible * PREFETCH_MULT + 2) * perRow);
                if (!loading && hasMore && items.length < wantCount && cursor) {
                  setLoading(true);
                  (window.mediaAPI as any)
                    .getRecentItems({
                      sourceIds: placeId ? [placeId] : undefined,
                      types: type ? [type] : undefined,
                      limit: PAGE,
                      cursor: cursor,
                      orderBy: 'createdAt',
                      orderDirection: 'desc'
                    })
                    .then((res: any) => {
                      if (res?.success && Array.isArray(res.items)) {
                        const mapped: MediaT[] = res.items.map((it: any) => ({
                          id: String(it.id),
                          placeId: String(it.sourceId || ''),
                          type: ((it.mimeType || '').toLowerCase().startsWith('video/')
                            ? 'video'
                            : (it.mimeType || '').toLowerCase().startsWith('audio/')
                            ? 'audio'
                            : 'image'),
                          name: it.name || 'item',
                          path: it.path,
                          thumb: it.metadata?.thumbnailPath || undefined,
                        }));
                        setItems((prev) => [...prev, ...mapped]);
                        setCursor(res.nextCursor);
                        setHasMore(res.hasMore || false);
                      }
                    })
                    .finally(() => setLoading(false));
                }

                const rowRenderer = ({ index, key, style }: { index: number; key: string; style: React.CSSProperties }) => {
                  const start = index * perRow;
                  const end = Math.min(start + perRow, items.length);
                  const rowItems = items.slice(start, end);
                  return (
                    <div key={key} style={style}>
                      <div className="grid" style={{ gridTemplateColumns: `repeat(${perRow}, minmax(0, 1fr))`, gap: `${gap}px` }}>
                        {rowItems.map((m) => (
                          <MediaCard key={m.id} item={m} placeLabel={''} onDeleted={(itemId) => setItems(prev => prev.filter(item => item.id !== itemId))} />
                        ))}
                      </div>
                    </div>
                  );
                };

                return (
                  <List
                    width={width}
                    height={height}
                    rowHeight={rowHeight}
                    rowCount={rowCount}
                    rowRenderer={rowRenderer}
                    overscanRowCount={Math.ceil((height / rowHeight) * (PREFETCH_MULT - 1))}
                  />
                );
              }}
            </AutoSizer>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}

function ConnectDrawer({ onClose, onPick }: { onClose: () => void; onPick: (kind: 'local' | 's3' | 'gdrive' | 'nas') => void }) {
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-full sm:w-[520px] bg-neutral-900 border-l border-neutral-800 shadow-xl flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
          <div className="font-semibold">Connect a place</div>
          <button onClick={onClose} className="rounded-lg border border-neutral-700 p-2 hover:bg-neutral-800">
            <Icon.Close />
          </button>
        </div>
        <div className="p-4 grid grid-cols-2 gap-3">
          <button onClick={() => onPick('local')} className="rounded-xl border border-neutral-800 bg-neutral-900 p-3 text-left hover:border-neutral-700">
            <div className="flex items-center gap-2">
              <Icon.Folder /> Local folder
            </div>
            <div className="text-xs text-neutral-500 mt-1">Pick a folder</div>
          </button>
          <button onClick={() => onPick('s3')} className="rounded-xl border border-neutral-800 bg-neutral-900 p-3 text-left hover:border-neutral-700">
            <div className="flex items-center gap-2">
              <Icon.Server /> AWS S3
            </div>
            <div className="text-xs text-neutral-500 mt-1">Bucket or prefix</div>
          </button>
          <button onClick={() => onPick('gdrive')} className="rounded-xl border border-neutral-800 bg-neutral-900 p-3 text-left hover:border-neutral-700">
            <div className="flex items-center gap-2">
              <Icon.Cloud /> Google Drive
            </div>
            <div className="text-xs text-neutral-500 mt-1">Authorize Drive</div>
          </button>
          <button onClick={() => onPick('nas')} className="rounded-xl border border-neutral-800 bg-neutral-900 p-3 text-left hover:border-neutral-700">
            <div className="flex items-center gap-2">
              <Icon.Server /> Network Share
            </div>
            <div className="text-xs text-neutral-500 mt-1">SMB/NAS mount</div>
          </button>
        </div>
      </div>
    </div>
  );
}
