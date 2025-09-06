import React, { useState, useEffect } from 'react';
import { PluginRegistry } from '../core/plugin-registry';
import { MediaItem, MediaSource } from '../core/types';

// Custom hook for loading image thumbnails
const useImageThumbnail = (item: MediaItem) => {
  const [imageUrl, setImageUrl] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (item.type !== 'image') {
      setLoading(false);
      return;
    }

    const loadImage = async () => {
      try {
        setLoading(true);
        setError(false);
        const response = await window.mediaAPI.getImageThumbnail(item.path);
        if (response.success && response.dataUrl) {
          setImageUrl(response.dataUrl);
        } else {
          setError(true);
        }
      } catch (err) {
        console.error('Failed to load image thumbnail:', err);
        setError(true);
      } finally {
        setLoading(false);
      }
    };

    loadImage();
  }, [item.path, item.type]);

  return { imageUrl, loading, error };
};

interface GroupedResults {
  [sourceId: string]: {
    source: MediaSource;
    items: MediaItem[];
  };
}

interface SearchResultsProps {
  results: MediaItem[];
  query: string;
  viewMode?: 'grid' | 'list';
  mode?: 'search' | 'browse';
}

export const SearchResults: React.FC<SearchResultsProps> = ({ results, query, viewMode = 'grid', mode = 'search' }) => {
  const [groupedResults, setGroupedResults] = useState<GroupedResults>({});

  console.log('SearchResults component received:', { results, query });
  console.log('Results length:', results.length);

  useEffect(() => {
    const loadSourcesAndGroup = async () => {
      if (results.length === 0) {
        setGroupedResults({});
        return;
      }

      try {
        // Get all sources
        const sourcesResponse = await window.mediaAPI.getSources();
        console.log('Sources response:', sourcesResponse);
        
        if (sourcesResponse.success && sourcesResponse.sources) {
          
          // Group results by source
          const grouped: GroupedResults = {};
          results.forEach(item => {
            console.log('Processing item:', item.name, 'sourceId:', item.sourceId);
            const source = sourcesResponse.sources!.find(s => s.id === item.sourceId);
            console.log('Found source:', source);
            
            if (source) {
              if (!grouped[item.sourceId]) {
                grouped[item.sourceId] = {
                  source,
                  items: []
                };
              }
              grouped[item.sourceId].items.push(item);
            } else {
              console.warn('No source found for item:', item.name, 'sourceId:', item.sourceId);
              // Create a fallback source if none found
              if (!grouped[item.sourceId]) {
                grouped[item.sourceId] = {
                  source: {
                    id: item.sourceId,
                    name: 'Unknown Source',
                    type: 'local' as const,
                    path: '',
                    enabled: true,
                    createdAt: new Date()
                  },
                  items: []
                };
              }
              grouped[item.sourceId].items.push(item);
            }
          });
          
          console.log('Final grouped results:', grouped);
          console.log('Grouped results keys:', Object.keys(grouped));
          setGroupedResults(grouped);
        }
      } catch (error) {
        console.error('Error loading sources:', error);
        // Fallback: create grouped results without source info
        const fallbackGrouped: GroupedResults = {};
        results.forEach(item => {
          if (!fallbackGrouped[item.sourceId]) {
            fallbackGrouped[item.sourceId] = {
              source: {
                id: item.sourceId,
                name: 'Unknown Source',
                type: 'local' as const,
                path: '',
                enabled: true,
                createdAt: new Date()
              },
              items: []
            };
          }
          fallbackGrouped[item.sourceId].items.push(item);
        });
        setGroupedResults(fallbackGrouped);
      }
    };

    loadSourcesAndGroup();
  }, [results]);

  // Component for individual gallery items with async image loading
  const GalleryItem: React.FC<{ item: MediaItem }> = ({ item }) => {
    const { imageUrl, loading, error } = useImageThumbnail(item);

    if (viewMode === 'list') {
      return (
        <div className="grid grid-cols-12 items-center gap-2 py-3 px-4 hover:bg-neutral-800/50 border-b border-neutral-800/50">
          <div className="col-span-1 flex justify-center">
            <div className="w-4 h-4 rounded border border-neutral-600" />
          </div>
          <div className="col-span-1">
            {item.type === 'image' ? (
              <div className="w-8 h-8 rounded overflow-hidden bg-neutral-800">
                {loading ? (
                  <div className="w-full h-full flex items-center justify-center text-xs">...</div>
                ) : error || !imageUrl ? (
                  <div className="w-full h-full flex items-center justify-center">🖼️</div>
                ) : (
                  <img src={imageUrl} alt={item.name} className="w-full h-full object-cover" />
                )}
              </div>
            ) : (
              <div className="w-8 h-8 rounded bg-neutral-800 flex items-center justify-center text-sm">
                {getFileIcon(item.type, item)}
              </div>
            )}
          </div>
          <div className="col-span-6 truncate">
            <div className="font-medium text-sm truncate">{item.name}</div>
          </div>
          <div className="col-span-2 text-xs text-neutral-400">
            {item.type}
          </div>
          <div className="col-span-2 text-xs text-neutral-400 text-right">
            {formatFileSize(item.size)}
          </div>
        </div>
      );
    }

    return (
      <div className="group rounded-2xl border border-neutral-800 overflow-hidden bg-neutral-900 hover:border-neutral-600 transition cursor-pointer">
        <div className="relative aspect-[4/3]">
          {item.type === 'image' ? (
            <div className="absolute inset-0">
              {loading ? (
                <div className="w-full h-full flex items-center justify-center bg-neutral-800 text-neutral-400">
                  Loading...
                </div>
              ) : error || !imageUrl ? (
                <div className="w-full h-full flex items-center justify-center bg-neutral-800 text-4xl">
                  🖼️
                </div>
              ) : (
                <img 
                  src={imageUrl} 
                  alt={item.name}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    target.style.display = 'none';
                    const fallback = target.nextElementSibling as HTMLElement;
                    if (fallback) fallback.style.display = 'flex';
                  }}
                />
              )}
              <div className="w-full h-full flex items-center justify-center bg-neutral-800 text-4xl" style={{ display: 'none' }}>
                🖼️
              </div>
            </div>
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-neutral-800 text-4xl">
              {getFileIcon(item.type, item)}
            </div>
          )}
          
          <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between text-[11px]">
            <span className="inline-flex items-center gap-1 rounded-md bg-neutral-900/70 px-2 py-1 text-neutral-200">
              {getFileIcon(item.type, item)} {item.type}
            </span>
          </div>
        </div>
        
        <div className="p-3">
          <div className="truncate text-sm font-medium" title={item.name}>{item.name}</div>
          <div className="mt-1 flex items-center justify-between text-xs text-neutral-400">
            <span>{formatFileSize(item.size)}</span>
          </div>
          
          {item.description && (
            <div className="mt-2 text-xs text-neutral-500 line-clamp-2" title={item.description}>
              {item.description.substring(0, 80)}{item.description.length > 80 ? '...' : ''}
            </div>
          )}
        </div>
      </div>
    );
  };
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getFileIcon = (type: string, item?: MediaItem): string => {
    // Ask plugin icon providers first
    const providers = PluginRegistry.getIconProviders();
    for (const p of providers) {
      const icon = p.getIcon({ name: item?.name, path: item?.path, mimeType: item?.mimeType, type });
      if (icon) return icon;
    }
    // Fallbacks
    switch (type) {
      case 'image': return '🖼️';
      case 'video': return '🎥';
      case 'audio': return '🎵';
      case 'document': return '📄';
      default: return '📁';
    }
  };

  if (mode === 'search' && !query) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="text-4xl mb-4">🔍</div>
          <h3 className="text-lg font-semibold mb-2">Search Your Media</h3>
          <p className="text-neutral-400">Enter a search term to find your indexed media files</p>
        </div>
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="text-4xl mb-4">🔍</div>
          <h3 className="text-lg font-semibold mb-2">No results found</h3>
          <p className="text-neutral-400 mb-4">No media files match your search for "{query}"</p>
          <div className="text-left">
            <h4 className="text-sm font-medium mb-2">Search tips:</h4>
            <ul className="text-sm text-neutral-400 space-y-1">
              <li>• Try different keywords</li>
              <li>• Check your spelling</li>
              <li>• Make sure your sources are indexed</li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {Object.entries(groupedResults).map(([sourceId, { source, items }]) => (
        <section key={sourceId}>
          <div className="flex items-center justify-between bg-neutral-900 px-4 py-3 rounded-lg mb-4">
            <span className="flex items-center gap-2">
              <span className="text-neutral-400">📁</span>
              <span className="font-medium">{source.name}</span>
              <span className="text-neutral-400">({items.length})</span>
            </span>
          </div>
          
          {viewMode === 'grid' ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4">
              {items.map((item) => (
                <GalleryItem key={item.id} item={item} />
              ))}
            </div>
          ) : (
            <div className="border border-neutral-800 rounded-lg overflow-hidden">
              <div className="grid grid-cols-12 items-center gap-2 py-2 px-4 bg-neutral-900/50 border-b border-neutral-800 text-xs font-medium text-neutral-400">
                <div className="col-span-1"></div>
                <div className="col-span-1"></div>
                <div className="col-span-6">Name</div>
                <div className="col-span-2">Type</div>
                <div className="col-span-2 text-right">Size</div>
              </div>
              {items.map((item) => (
                <GalleryItem key={item.id} item={item} />
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
};
