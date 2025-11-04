/**
 * MediaGrid - Components for displaying media items in grid layout
 */

import React, { useState, useEffect } from 'react';
import { Icon } from './Icons';
import { MediaT, Place } from '../types';

interface MediaGroupProps {
  title: string;
  icon: React.ReactNode;
  items: MediaT[];
  places: Place[];
  maxVisible?: number;
  onShowMore?: () => void;
  onItemDeleted?: (itemId: string) => void;
  onVideoClick?: (item: MediaT) => void;
}

export function MediaGroup({ title, icon, items, places, maxVisible = 6, onShowMore, onItemDeleted, onVideoClick }: MediaGroupProps) {
  const visibleItems = maxVisible ? items.slice(0, maxVisible) : items;
  const hasMore = maxVisible && items.length > maxVisible;

  if (items.length === 0) return null;

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 text-sm text-neutral-300">
          {icon}
          <b>{title}</b>
          <span className="text-neutral-500">({items.length})</span>
        </div>
        {hasMore && onShowMore && (
          <button
            onClick={onShowMore}
            className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
          >
            Show all {items.length}
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {visibleItems.map((item) => (
          <MediaCard key={item.id} item={item} places={places} onDeleted={onItemDeleted} onVideoClick={onVideoClick} />
        ))}
      </div>
    </section>
  );
}

interface MediaCardProps {
  item: MediaT;
  places?: Place[];
  placeLabel?: string;
  onDeleted?: (itemId: string) => void;
  onVideoClick?: (item: MediaT) => void;
}

export function MediaCard({ item, places, placeLabel, onDeleted, onVideoClick }: MediaCardProps) {
  const place = places?.find(p => p.id === item.placeId);
  const displayLabel = placeLabel || place?.label || '—';
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [deleting, setDeleting] = useState<boolean>(false);
  
  // Load thumbnail if available
  useEffect(() => {
    let cancelled = false;
    const loadThumbnail = async () => {
      // For images, use the image file itself as thumbnail if no thumb is set
      // Check for empty string explicitly (videos may have thumb='')
      const thumbnailPath = (item.thumb && item.thumb.trim()) || (item.type === 'image' ? item.path : null);
      console.log(`[MediaCard] Loading thumbnail for ${item.type}:`, { 
        itemThumb: item.thumb, 
        itemPath: item.path, 
        thumbnailPath 
      });
      if (!thumbnailPath) return;
      
      setLoading(true);
      try {
        console.log(`[MediaCard] Calling getImageThumbnail for: ${thumbnailPath}`);
        const res = await window.mediaAPI.getImageThumbnail(thumbnailPath);
        console.log(`[MediaCard] getImageThumbnail response:`, { success: res.success, hasDataUrl: !!res.dataUrl, error: res.error });
        if (!cancelled && res.success && res.dataUrl) {
          setThumbUrl(res.dataUrl);
          console.log(`[MediaCard] Thumbnail loaded successfully, dataUrl length: ${res.dataUrl.length}`);
        } else if (!cancelled) {
          console.warn(`[MediaCard] Thumbnail load failed:`, res.error || 'No dataUrl returned');
        }
      } catch (error) {
        console.error('[MediaCard] Exception loading thumbnail:', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    
    loadThumbnail();
    return () => { cancelled = true; };
  }, [item.thumb]);
  
  const handleClick = () => {
    if (item.type === 'video' && onVideoClick) {
      onVideoClick(item);
    } else {
      // For non-video items, just log for now
      console.log('Opening media item:', item);
    }
  };

  const handleDelete = async () => {
    if (deleting) return;
    
    if (!confirm(`Remove "${item.name}" from library?`)) {
      return;
    }
    
    setDeleting(true);
    
    try {
      const result = await (window.mediaAPI as any).deleteMediaItem?.(item.id);
      if (result?.success) {
        console.log(`✅ Removed media item from library: ${item.name}`);
        // Notify parent to remove from UI immediately
        onDeleted?.(item.id);
        // Also trigger a library refresh to ensure consistency
        // The parent's polling will pick this up, but we can force it sooner
        setTimeout(() => {
          console.log('[MEDIA-GRID] Triggering library refresh after deletion');
        }, 100);
      } else {
        console.error('[MEDIA-GRID] ❌ Failed to remove media item:', result?.error);
        alert(`Failed to delete: ${result?.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('[MEDIA-GRID] ❌ Error removing media item:', error);
      alert(`Error deleting item: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setDeleting(false);
    }
  };

  const getMediaIcon = () => {
    switch (item.type) {
      case 'video': return <Icon.Video className="w-4 h-4" />;
      case 'audio': return <Icon.Audio className="w-4 h-4" />;
      default: return <Icon.Image className="w-4 h-4" />;
    }
  };

  return (
    <div 
      className="group relative rounded-xl border border-neutral-800 bg-neutral-900 overflow-hidden hover:border-neutral-700 cursor-pointer transition-colors"
      onClick={handleClick}
    >
      {/* Thumbnail/Preview */}
      <div className="aspect-square bg-neutral-800 flex items-center justify-center">
        {thumbUrl ? (
          <img 
            src={thumbUrl} 
            alt={item.name}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : loading ? (
          <div className="text-neutral-500 text-xs">Loading...</div>
        ) : (
          <div className="text-neutral-600">
            {getMediaIcon()}
          </div>
        )}
      </div>

      {/* Overlay with info */}
      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-3">
        <div className="text-xs text-white font-medium truncate mb-1">
          {item.name}
        </div>
        {displayLabel !== '—' && (
          <div className="text-xs text-neutral-300 truncate flex items-center gap-1">
            <Icon.Folder className="w-3 h-3" />
            {displayLabel}
          </div>
        )}
      </div>

      {/* Type indicator - only show for video/audio */}
      {(item.type === 'video' || item.type === 'audio') && (
        <div className="absolute top-2 right-2 bg-black/70 rounded-md px-1.5 py-0.5 text-xs text-white capitalize">
          {item.type}
        </div>
      )}

      {/* Delete button */}
      <div className="absolute top-2 left-2">
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleDelete();
          }}
          disabled={deleting}
          className="bg-black/70 hover:bg-red-600/70 rounded-full p-1.5 text-white transition-colors disabled:opacity-50"
          title="Remove from library"
        >
          {deleting ? (
            <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <Icon.Trash className="w-3 h-3" />
          )}
        </button>
      </div>
    </div>
  );
}
