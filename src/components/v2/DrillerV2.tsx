import React, { useMemo, useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AutoSizer, List } from 'react-virtualized';
import VideoSelection from '../VideoSelection';

// Minimal inline icons
const Icon = {
  Search: (p: any) => (
    <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" fill="none" strokeWidth="2" className={p.className}>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  Plus: (p: any) => (
    <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" fill="none" strokeWidth="2" className={p.className}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
  Bolt: (p: any) => (
    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2" className={p.className}>
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  ),
  Image: (p: any) => (
    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2" className={p.className}>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </svg>
  ),
  Browse: (p: any) => (
    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2" className={p.className}>
      <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-5l-2-2H5a2 2 0 00-2 2z" />
    </svg>
  ),
  Index: (p: any) => (
    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2" className={p.className}>
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  ),
  Refresh: (p: any) => (
    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2" className={p.className}>
      <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  ),
  Pin: (p: any) => (
    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2" className={p.className}>
      <path d="M9 9l3-3 3 3" />
      <path d="M12 6v12" />
      <path d="M21 21l-6-6" />
    </svg>
  ),
  Video: (p: any) => (
    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2" className={p.className}>
      <rect x="3" y="5" width="15" height="14" rx="2" />
      <path d="M22 7l-4 2v6l4 2V7z" />
    </svg>
  ),
  Audio: (p: any) => (
    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2" className={p.className}>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  ),
  Folder: (p: any) => (
    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2" className={p.className}>
      <path d="M3 7h6l2 2h10v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  ),
  Server: (p: any) => (
    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2" className={p.className}>
      <rect x="3" y="4" width="18" height="8" rx="2" />
      <rect x="3" y="12" width="18" height="8" rx="2" />
      <circle cx="7" cy="8" r="1" />
      <circle cx="7" cy="16" r="1" />
    </svg>
  ),
  Cloud: (p: any) => (
    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2" className={p.className}>
      <path d="M20 17.58A5 5 0 0 0 18 8h-1.26A8 8 0 1 0 4 16.25" />
    </svg>
  ),
  Close: (p: any) => (
    <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" strokeWidth="2" className={p.className}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
};

export type Scope = 'all' | 's3' | 'drive' | 'folders';

type Place = { id: string; kind: 'local' | 's3' | 'gdrive'; label: string; path: string; count?: number; pinned?: boolean };

type MediaT = { id: string; placeId: string; type: 'image' | 'video' | 'audio'; name: string; path: string; thumb?: string };

// Early-defined Folders grid to ensure availability during render
function PlacesGrid({ places, onBrowse, onIndex }: { places: Place[]; onBrowse: (placeId: string) => void; onIndex?: (placeId: string, forceReindex?: boolean) => void }) {
  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm text-neutral-300">
          <b>Folders & places</b> <span className="text-neutral-500">{places.length}</span>
        </div>
        <div className="text-xs text-neutral-500">Sorted by recent use</div>
      </div>
      {places.length === 0 ? (
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6 text-center text-neutral-500">
          No folders match the current filter.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {places.map((p) => (
            <div key={p.id} className="rounded-2xl border border-neutral-800 bg-neutral-900 p-3 hover:border-neutral-700">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {p.kind === 'local' ? <Icon.Folder /> : p.kind === 's3' ? <Icon.Server /> : <Icon.Cloud />}
                  <div className="text-sm font-medium">{p.label}</div>
                </div>
                {p.pinned && <span className="text-[10px] rounded-md bg-neutral-800 px-2 py-0.5">Pinned</span>}
              </div>
              <div className="mt-1 text-xs text-neutral-500 truncate">{p.path}</div>
              <div className="mt-3 flex items-center justify-between text-xs text-neutral-400">
                <span>{p.count ? p.count.toLocaleString() : '—'} items</span>
                <div className="flex gap-1">
                  <button className="rounded-md border border-neutral-700 p-1.5 hover:bg-neutral-800" onClick={() => onBrowse(p.id)} title="Browse">
                    <Icon.Browse />
                  </button>
                  {onIndex && (
                    <button className="rounded-md border border-neutral-700 p-1.5 hover:bg-neutral-800" onClick={() => onIndex(p.id)} title="Index">
                      <Icon.Index />
                    </button>
                  )}
                  {onIndex && (
                    <button className="rounded-md border border-orange-700 p-1.5 hover:bg-orange-900/50 text-orange-400 hover:text-orange-300" onClick={() => onIndex(p.id, true)} title="Force Re-index">
                      <Icon.Refresh />
                    </button>
                  )}
                  <button className="rounded-md border border-neutral-700 p-1.5 hover:bg-neutral-800" title="Pin">
                    <Icon.Pin />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default function DrillerV2(props: { overallProgress?: number; onOpenIndexing: () => void }) {
  const { overallProgress = -1, onOpenIndexing } = props;

  const [q, setQ] = useState('');
  const [activeTab, setActiveTab] = useState<'media' | 'videos'>('media');
  const [scope, setScope] = useState<Scope>('all');
  const [selectedPlace, setSelectedPlace] = useState<string | undefined>();
  const [connectOpen, setConnectOpen] = useState(false);
  const [places, setPlaces] = useState<Place[]>([]);
  const [searchResults, setSearchResults] = useState<MediaT[]>([]);
  const [library, setLibrary] = useState<MediaT[]>([]);
  const [searching, setSearching] = useState(false);
  const [expandedType, setExpandedType] = useState<'image' | 'video' | 'audio' | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load places from real sources, fall back to demo
  useEffect(() => {
    (async () => {
      try {
        const res = await window.mediaAPI.getSources();
        if (res.success && Array.isArray(res.sources)) {
          const mapped: Place[] = res.sources.map((s) => ({
            id: s.id,
            kind: 'local',
            label: s.name,
            path: s.path || '',
            pinned: false,
          }));
          setPlaces(mapped);
        } else {
          setPlaces([]);
        }
      } catch {
        setPlaces([]);
      }
    })();
  }, []);

  // Remove demo media; show results only when searching
  // Initial library load for start page (newest first)
  useEffect(() => {
    (async () => {
      try {
        const res = await window.mediaAPI.getItems();
        if (res?.success && Array.isArray(res.items)) {
          const items: any[] = res.items;
          const mapped: MediaT[] = items.map((it: any) => {
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
            } as MediaT;
          });
          // Sort by recency (modifiedAt or createdAt)
          const withDate = (it: any) => new Date(it.modifiedAt || it.lastModified || it.createdAt || 0).getTime();
          mapped.sort((a: any, b: any) => withDate(b) - withDate(a));
          setLibrary(mapped);
        } else {
          setLibrary([]);
        }
      } catch (e) {
        setLibrary([]);
      }
    })();
  }, []);

  // Refresh library when selected place changes
  useEffect(() => {
    (async () => {
      try {
        const res = await window.mediaAPI.getItems();
        if (res?.success && Array.isArray(res.items)) {
          const items: any[] = res.items;
          const mapped: MediaT[] = items.map((it: any) => {
            const mime = (it.mimeType || '').toLowerCase();
            let kind: 'image' | 'video' | 'audio' = 'image';
            if (mime.startsWith('video/')) kind = 'video';
            else if (mime.startsWith('audio/')) kind = 'audio';
            else if (typeof it.type === 'string') {
              const t = it.type.toLowerCase();
              if (t.includes('video')) kind = 'video';
              else if (t.includes('audio')) kind = 'audio';
            }
            return { id: String(it.id), placeId: String(it.sourceId || ''), type: kind, name: it.name || 'item', path: it.path } as MediaT;
          });
          const withDate = (it: any) => new Date(it.modifiedAt || it.lastModified || it.createdAt || 0).getTime();
          mapped.sort((a: any, b: any) => withDate(b) - withDate(a));
          setLibrary(mapped);
        }
      } catch {}
    })();
  }, [selectedPlace]);

  // Poll indexing status; when jobs finish, refresh places and library
  useEffect(() => {
    let mounted = true;
    let prevActive = false;
    const tick = async () => {
      try {
        const st = await window.mediaAPI.getIndexingStatus();
        const active = !!(st?.success && Array.isArray(st.activeJobs) && st.activeJobs.length > 0);
        if (!active && prevActive && mounted) {
          // Jobs just finished — refresh sources and items
          try {
            const res = await window.mediaAPI.getSources();
            if (res.success && Array.isArray(res.sources)) {
              const mapped: Place[] = res.sources.map((s) => ({ id: s.id, kind: 'local', label: s.name, path: s.path || '', pinned: false }));
              setPlaces(mapped);
            }
          } catch {}
          try {
            const itemsRes = await window.mediaAPI.getItems();
            if (itemsRes?.success && Array.isArray(itemsRes.items)) {
              const items: any[] = itemsRes.items;
              const mapped: MediaT[] = items.map((it: any) => {
                const mime = (it.mimeType || '').toLowerCase();
                let kind: 'image' | 'video' | 'audio' = 'image';
                if (mime.startsWith('video/')) kind = 'video';
                else if (mime.startsWith('audio/')) kind = 'audio';
                else if (typeof it.type === 'string') {
                  const t = it.type.toLowerCase();
                  if (t.includes('video')) kind = 'video';
                  else if (t.includes('audio')) kind = 'audio';
                }
                return { id: String(it.id), placeId: String(it.sourceId || ''), type: kind, name: it.name || 'item', path: it.path } as MediaT;
              });
              const withDate = (it: any) => new Date(it.modifiedAt || it.lastModified || it.createdAt || 0).getTime();
              mapped.sort((a: any, b: any) => withDate(b) - withDate(a));
              setLibrary(mapped);
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
        if (alive) setSearchResults([]);
        return;
      }
      try {
        setSearching(true);
        const res = await window.mediaAPI.searchText(query, 60);
        if (!alive) return;
        if (res.success && res.results && Array.isArray((res as any).results.items)) {
          const items: any[] = (res as any).results.items;
          const m: MediaT[] = items.map((it) => {
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
            return { id: String(it.id), placeId: String(it.sourceId || ''), type: kind, name: it.name || 'item', path: it.path } as MediaT;
          });
          setSearchResults(m);
        } else {
          setSearchResults([]);
        }
      } catch {
        setSearchResults([]);
      } finally {
        if (alive) setSearching(false);
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

  const scopedMedia = useMemo(() => {
    const base = q.trim() ? searchResults : library;
    let data = base;
    if (scope === 's3') data = data.filter((m) => places.find((p) => p.id === m.placeId)?.kind === 's3');
    if (scope === 'drive') data = data.filter((m) => places.find((p) => p.id === m.placeId)?.kind === 'gdrive');
    if (selectedPlace) data = data.filter((m) => m.placeId === selectedPlace);
    // Do not apply text-based name filtering here; semantic results may not include the literal query in the filename
    return data;
  }, [q, scope, selectedPlace, searchResults, library, places]);

  const grouped = useMemo(
    () => ({
      image: scopedMedia.filter((m) => m.type === 'image'),
      video: scopedMedia.filter((m) => m.type === 'video'),
      audio: scopedMedia.filter((m) => m.type === 'audio'),
    }),
    [scopedMedia]
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
      if (!res.success) alert(`Failed to start ${forceReindex ? 'force re-indexing' : 'indexing'}: ${res.error || 'Unknown error'}`);
    } catch (e) {
      alert(`Failed to start ${forceReindex ? 'force re-indexing' : 'indexing'}`);
    }
  };

  return (
    <div className="min-h-screen tokyo-bg text-neutral-100">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b app-border tokyo-bg backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 py-3 grid grid-cols-3 items-center">
          <div className="flex items-center gap-2">
            <button onClick={() => setConnectOpen(true)} className="inline-flex items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm hover:bg-neutral-800">
              <Icon.Plus /> Connect a place
            </button>
          </div>
          <div className="text-center">
            <div className="text-lg font-semibold tracking-tight">Distillery</div>
            <div className="text-[11px] text-neutral-400">Media Search</div>
          </div>
          <div className="flex items-center justify-end gap-2">
            {overallProgress >= 0 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs">
                <Icon.Bolt className="text-emerald-400" /> Indexing {Math.round(overallProgress)}%
              </span>
            )}
            <button onClick={onOpenIndexing} className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm hover:bg-neutral-800">
              Open Indexing
            </button>
          </div>
        </div>
        {/* Search + pills */}
        <div className="mx-auto max-w-3xl px-4 pb-4">
          <div className="mt-6 flex items-center gap-2 rounded-2xl bg-neutral-900/40 backdrop-blur-sm border border-neutral-800 px-4 py-3 focus-within:border-neutral-700">
            <Icon.Search className="text-neutral-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  // Cancel pending debounce and run search immediately
                  if (debounceRef.current) {
                    clearTimeout(debounceRef.current);
                    debounceRef.current = null;
                  }
                  // Trigger the effect's performSearch by transiently changing scope
                  // Simpler: temporarily setSearching and invoke mediaAPI directly here
                  (async () => {
                    const query = q.trim();
                    if (!query || scope === 'folders') {
                      setSearchResults([]);
                      return;
                    }
                    try {
                      setSearching(true);
                      const res = await window.mediaAPI.searchText(query, 60);
                      if (res.success && res.results && Array.isArray((res as any).results.items)) {
                        const items: any[] = (res as any).results.items;
                        const m: MediaT[] = items.map((it) => {
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
                          return { id: String(it.id), placeId: String(it.sourceId || ''), type: kind, name: it.name || 'item', path: it.path } as MediaT;
                        });
                        setSearchResults(m);
                      } else {
                        setSearchResults([]);
                      }
                    } catch {
                      setSearchResults([]);
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
          {/* Tab Navigation */}
          <div className="mt-3 flex items-center justify-center gap-2 mb-4">
            <button
              onClick={() => setActiveTab('media')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === 'media'
                  ? 'bg-blue-600 text-white'
                  : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
              }`}
            >
              Media Search
            </button>
            <button
              onClick={() => setActiveTab('videos')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === 'videos'
                  ? 'bg-blue-600 text-white'
                  : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
              }`}
            >
              Add Videos
            </button>
          </div>

          {/* Media Search Pills - only show for media tab */}
          {activeTab === 'media' && (
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
          )}
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
        {activeTab === 'videos' ? (
          <VideoSelection 
            onVideoAdded={async () => {
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
                  const itemsRes = await window.mediaAPI.getItems();
                  if (itemsRes?.success && Array.isArray(itemsRes.items)) {
                    const items: any[] = itemsRes.items;
                    const mappedItems: MediaT[] = items.map((it: any) => {
                      const mime = (it.mimeType || '').toLowerCase();
                      let kind: 'image' | 'video' | 'audio' = 'image';
                      if (mime.startsWith('video/')) kind = 'video';
                      else if (mime.startsWith('audio/')) kind = 'audio';
                      else if (typeof it.type === 'string') {
                        const t = it.type.toLowerCase();
                        if (t.includes('video')) kind = 'video';
                        else if (t.includes('audio')) kind = 'audio';
                      }
                      return { id: String(it.id), placeId: String(it.sourceId || ''), type: kind, name: it.name || 'item', path: it.path } as MediaT;
                    });
                    const withDate = (it: any) => new Date(it.modifiedAt || it.lastModified || it.createdAt || 0).getTime();
                    mappedItems.sort((a: any, b: any) => withDate(b) - withDate(a));
                    setLibrary(mappedItems);
                  }
                } catch {}
              } catch (error) {
                console.error('Failed to refresh sources:', error);
              }
            }}
          />
        ) : scope === 'folders' ? (
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
                  />
                  <MediaGroup
                    title="Videos"
                    icon={<Icon.Video />}
                    items={grouped.video}
                    places={places}
                    maxVisible={6}
                    onShowMore={() => setExpandedType('video')}
                  />
                  <MediaGroup
                    title="Audio"
                    icon={<Icon.Audio />}
                    items={grouped.audio}
                    places={places}
                    maxVisible={6}
                    onShowMore={() => setExpandedType('audio')}
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
              alert(`${kind.toUpperCase()} coming soon`);
            }
            setConnectOpen(false);
          }}
        />
      )}

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

function MediaGroup({
  title,
  icon,
  items,
  places,
  maxVisible,
  onShowMore,
  expanded,
  onBack,
}: {
  title: string;
  icon: React.ReactNode;
  items: MediaT[];
  places: Place[];
  maxVisible?: number;
  onShowMore?: () => void;
  expanded?: boolean;
  onBack?: () => void;
}) {
  if (items.length === 0) return null;
  const cap = expanded ? items.length : Math.min(items.length, maxVisible ?? items.length);
  const visible = items.slice(0, cap);
  const hasMore = !expanded && items.length > cap;
  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-sm text-neutral-300">
          <span className="inline-flex items-center justify-center w-6 h-6 rounded-md border border-neutral-800 bg-neutral-900">{icon}</span>
          <b>{title}</b>
          <span className="text-neutral-500">{items.length}</span>
        </div>
        <div className="flex items-center gap-2">
          {expanded && onBack && (
            <button className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:border-neutral-700" onClick={onBack}>
              Back
            </button>
          )}
          <div className="text-xs text-neutral-500">Grid • Newest first</div>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {visible.map((m) => (
          <MediaCard key={m.id} item={m} placeLabel={places.find((p) => p.id === m.placeId)?.label || '—'} />
        ))}
        {hasMore && onShowMore && (
          <div className="rounded-xl overflow-hidden border border-dashed border-neutral-800 hover:border-neutral-700 bg-neutral-900/30">
            <button onClick={onShowMore} className="w-full">
              <div className="aspect-square flex items-center justify-center text-sm text-neutral-400">
                <div className="flex flex-col items-center gap-1">
                  <Icon.Plus />
                  <span>Show more</span>
                </div>
              </div>
              <div className="p-2">
                <div className="text-[11px] text-neutral-500 text-center">Expand to see more</div>
              </div>
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function MediaCard({ item, placeLabel }: { item: MediaT; placeLabel: string }) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(item.thumb || null);
  const [loading, setLoading] = useState<boolean>(item.type === 'image');

  useEffect(() => {
    let cancelled = false;
    if (item.type !== 'image') return;
    (async () => {
      try {
        setLoading(true);
        const res = await window.mediaAPI.getImageThumbnail(item.path);
        if (!cancelled && res.success && res.dataUrl) setThumbUrl(res.dataUrl);
      } catch {}
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [item.path, item.type]);

  return (
    <div className="rounded-xl overflow-hidden border border-neutral-900 hover:border-neutral-700 bg-neutral-900/40">
      <div className="aspect-square bg-neutral-900/50 flex items-center justify-center">
        {item.type === 'image' ? (
          thumbUrl ? (
            <img src={thumbUrl} alt={item.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-neutral-900/60 flex items-center justify-center text-xs text-neutral-500">
              {loading ? 'Loading…' : '—'}
            </div>
          )
        ) : (
          <div className="text-2xl opacity-70">{item.type === 'video' ? '🎥' : '🎵'}</div>
        )}
      </div>
      <div className="p-2">
        <div className="truncate text-[13px]" title={item.name}>{item.name}</div>
        <div className="text-[11px] text-neutral-500">
          {item.type} • {placeLabel}
        </div>
      </div>
    </div>
  );
}

function ExpandedVirtualOverlay({ type, placeId, onBack }: { type: 'image'|'video'|'audio'|null; placeId?: string; onBack: () => void }) {
  const [items, setItems] = useState<MediaT[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [offset, setOffset] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const PAGE = 120;
  const PREFETCH_MULT = 1.5;

  useEffect(() => {
    let alive = true;
    async function loadInitial() {
      if (!type) return;
      setLoading(true);
      try {
        const res = await window.mediaAPI.getRecentItems({ types: [type], sourceIds: placeId ? [placeId] : undefined, limit: PAGE, offset: 0 });
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
            return { id: String(it.id), placeId: String(it.sourceId || ''), type: kind, name: it.name || 'item', path: it.path } as MediaT;
          });
          setItems(mapped);
          setOffset(mapped.length);
          setTotal(res.total || mapped.length);
        } else {
          setItems([]);
          setOffset(0);
          setTotal(0);
        }
      } finally {
        if (alive) setLoading(false);
      }
    }
    setItems([]); setTotal(0); setOffset(0);
    loadInitial();
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
              <span className="text-neutral-500">{total}</span>
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
                const totalCount = total || items.length;
                const rowCount = Math.max(1, Math.ceil(totalCount / perRow));

                // Prefetch logic based on visible rows
                const rowsVisible = Math.ceil(height / rowHeight);
                const wantCount = Math.ceil((rowsVisible * PREFETCH_MULT + 2) * perRow);
                if (!loading && items.length < totalCount && items.length < wantCount) {
                  setLoading(true);
                  const nextLimit = Math.floor(PAGE * PREFETCH_MULT);
                  window.mediaAPI
                    .getRecentItems({ types: type ? [type] : undefined, sourceIds: placeId ? [placeId] : undefined, limit: nextLimit, offset })
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
                        }));
                        setItems((prev) => [...prev, ...mapped]);
                        setOffset((prev) => prev + mapped.length);
                        setTotal(res.total || offset + mapped.length);
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
                          <MediaCard key={m.id} item={m} placeLabel={''} />
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
