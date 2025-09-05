import React, { useState, useEffect } from 'react';
import { MediaItem, MediaSource } from '../core/types';

interface GroupedResults {
  [sourceId: string]: {
    source: MediaSource;
    items: MediaItem[];
  };
}

interface SearchResultsProps {
  results: MediaItem[];
  query: string;
}

export const SearchResults: React.FC<SearchResultsProps> = ({ results, query }) => {
  const [groupedResults, setGroupedResults] = useState<GroupedResults>({});
  const [sources, setSources] = useState<MediaSource[]>([]);

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
          setSources(sourcesResponse.sources);
          
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

  const getImageThumbnail = (item: MediaItem): string => {
    // For now, use file:// protocol to display local images
    // In production, you'd want a proper thumbnail service
    return `file://${item.path}`;
  };
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getFileIcon = (type: string): string => {
    switch (type) {
      case 'image': return '🖼️';
      case 'video': return '🎥';
      case 'audio': return '🎵';
      case 'document': return '📄';
      default: return '📁';
    }
  };

  if (!query) {
    return (
      <div className="search-results">
        <div className="search-placeholder">
          <div className="search-placeholder-icon">🔍</div>
          <h3>Search Your Media</h3>
          <p>Enter a search term to find your indexed media files</p>
        </div>
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="search-results">
        <div className="no-results">
          <div className="no-results-icon">🔍</div>
          <h3>No results found</h3>
          <p>No media files match your search for "{query}"</p>
          <div className="search-tips">
            <h4>Search tips:</h4>
            <ul>
              <li>Try different keywords</li>
              <li>Check your spelling</li>
              <li>Make sure your sources are indexed</li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="search-results">
      <div className="results-header">
        <h3>🔍 Search Results</h3>
        <span className="results-count">
          {results.length} result{results.length !== 1 ? 's' : ''} for "{query}"
        </span>
      </div>
      
      <div className="results-by-source">
        {Object.entries(groupedResults).map(([sourceId, { source, items }]) => (
          <div key={sourceId} className="source-group">
            <div className="source-header">
              <h4>📁 {source.name}</h4>
              <span className="source-count">{items.length} item{items.length !== 1 ? 's' : ''}</span>
            </div>
            
            <div className="gallery-grid">
              {items.map((item) => (
                <div key={item.id} className="gallery-item">
                  {item.type === 'image' ? (
                    <div className="image-thumbnail">
                      <img 
                        src={getImageThumbnail(item)} 
                        alt={item.name}
                        onError={(e) => {
                          // Fallback to file icon if image fails to load
                          const target = e.target as HTMLImageElement;
                          target.style.display = 'none';
                          const fallback = target.nextElementSibling as HTMLElement;
                          if (fallback) fallback.style.display = 'flex';
                        }}
                      />
                      <div className="image-fallback" style={{ display: 'none' }}>
                        🖼️
                      </div>
                    </div>
                  ) : (
                    <div className="file-thumbnail">
                      <span className="file-icon">{getFileIcon(item.type)}</span>
                    </div>
                  )}
                  
                  <div className="item-info">
                    <h5 className="item-name" title={item.name}>{item.name}</h5>
                    <div className="item-meta">
                      <span className="item-size">{formatFileSize(item.size)}</span>
                    </div>
                    
                    {item.description && (
                      <div className="item-description" title={item.description}>
                        {item.description.substring(0, 100)}{item.description.length > 100 ? '...' : ''}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
