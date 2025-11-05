import React, { useState, useEffect } from 'react';
import { AutoSizer, List } from 'react-virtualized';
import { MediaCard } from './MediaGrid';
import { MediaT } from '../types';

interface ExpandedFullPageViewProps {
  type: 'image' | 'video' | 'audio' | null;
  placeId?: string;
  onBack: () => void;
  onVideoClick?: (item: MediaT) => void;
  onImageClick?: (item: MediaT) => void;
}

export function ExpandedFullPageView({ type, placeId, onBack, onVideoClick, onImageClick }: ExpandedFullPageViewProps) {
  const [items, setItems] = useState<MediaT[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const PAGE = 120;
  const PREFETCH_MULT = 1.5;

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!type) {
        console.log('[ExpandedFullPageView] No type provided, skipping load');
        return;
      }
      console.log('[ExpandedFullPageView] Loading items:', { type, placeId, PAGE });
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
        console.log('[ExpandedFullPageView] API response:', { success: res?.success, itemCount: res?.items?.length, hasMore: res?.hasMore });
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
          console.log('[ExpandedFullPageView] Mapped items:', mapped.length);
          setItems(mapped);
          setCursor(res.nextCursor);
          setHasMore(res.hasMore || false);
        } else {
          console.warn('[ExpandedFullPageView] No items or failed response:', res);
          setItems([]);
          setCursor(undefined);
          setHasMore(false);
        }
      } catch (error) {
        console.error('[ExpandedFullPageView] Error loading items:', error);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [type, placeId]);

  return (
    <div className="flex flex-col" style={{ height: '100%' }}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800 flex-shrink-0">
        <div className="flex items-center gap-2 text-sm text-neutral-300">
          <b>{type === 'image' ? 'Images' : type === 'video' ? 'Videos' : 'Audio'}</b>
          <span className="text-neutral-500">{items.length}{hasMore ? '+' : ''}</span>
        </div>
        <div className="flex items-center gap-2">
          <button className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:border-neutral-700" onClick={onBack}>← Back</button>
          <div className="text-xs text-neutral-500">Virtualized</div>
        </div>
      </div>
      <div className="flex-1 overflow-hidden px-4 py-3">
        {loading && items.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-neutral-500">Loading...</div>
          </div>
        ) : items.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-neutral-500">No items found</div>
          </div>
        ) : (
          <div style={{ height: '100%' }}>
            <AutoSizer>
              {({ width, height }: { width: number; height: number }) => {
                console.log('[ExpandedFullPageView] AutoSizer dimensions:', { width, height, itemsLength: items.length });
                const gap = 12;
                const minCard = 180;
                const perRow = Math.max(1, Math.floor((width + gap) / (minCard + gap)));
                const cardWidth = (width - gap * (perRow - 1)) / perRow;
                const caption = 56; // approx caption + padding
                const rowHeight = Math.ceil(cardWidth + caption);
                const rowCount = Math.max(1, Math.ceil(items.length / perRow));
                console.log('[ExpandedFullPageView] Grid calc:', { perRow, rowHeight, rowCount });

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
                          <MediaCard 
                            key={m.id} 
                            item={m} 
                            placeLabel={''} 
                            onDeleted={(itemId) => setItems(prev => prev.filter(item => item.id !== itemId))}
                            onVideoClick={onVideoClick}
                            onImageClick={onImageClick}
                          />
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
                    overscanRowCount={5}
                  />
                );
              }}
            </AutoSizer>
          </div>
        )}
      </div>
    </div>
  );
}
