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
}

export function MediaGroup({ title, icon, items, places, maxVisible = 6, onShowMore }: MediaGroupProps) {
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
          <MediaCard key={item.id} item={item} places={places} />
        ))}
      </div>
    </section>
  );
}

interface MediaCardProps {
  item: MediaT;
  places?: Place[];
  placeLabel?: string;
}

export function MediaCard({ item, places, placeLabel }: MediaCardProps) {
  const place = places?.find(p => p.id === item.placeId);
  const displayLabel = placeLabel || place?.label || '—';
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  
  // Load thumbnail if available
  useEffect(() => {
    let cancelled = false;
    const loadThumbnail = async () => {
      if (!item.thumb) return;
      
      setLoading(true);
      try {
        const res = await window.mediaAPI.getImageThumbnail(item.thumb);
        if (!cancelled && res.success && res.dataUrl) {
          setThumbUrl(res.dataUrl);
        }
      } catch (error) {
        console.warn('Failed to load thumbnail:', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    
    loadThumbnail();
    return () => { cancelled = true; };
  }, [item.thumb]);
  
  const handleClick = () => {
    // Open media item (could be implemented later)
    console.log('Opening media item:', item);
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

      {/* Type indicator */}
      <div className="absolute top-2 right-2 bg-black/70 rounded-md px-1.5 py-0.5 text-xs text-white">
        {item.type}
      </div>
    </div>
  );
}
