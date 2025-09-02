import React from 'react';
import { MediaItem } from '../core/types';

interface SearchResultsProps {
  results: MediaItem[];
  query: string;
}

export const SearchResults: React.FC<SearchResultsProps> = ({ results, query }) => {
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
        <h3>Search Results</h3>
        <span className="results-count">
          {results.length} result{results.length !== 1 ? 's' : ''} for "{query}"
        </span>
      </div>
      
      <div className="results-grid">
        {results.map((item) => (
          <div key={item.id} className="result-card">
            <div className="result-header">
              <span className="file-icon">{getFileIcon(item.type)}</span>
              <div className="file-info">
                <h4 className="file-name" title={item.name}>
                  {item.name}
                </h4>
                <div className="file-meta">
                  <span className="file-type">{item.type}</span>
                  <span className="file-size">{formatFileSize(item.size)}</span>
                </div>
              </div>
            </div>
            
            <div className="file-path" title={item.path}>
              📁 {item.path}
            </div>
            
            {item.description && (
              <div className="file-description">
                {item.description}
              </div>
            )}
            
            <div className="file-dates">
              <div className="date-item">
                <strong>Modified:</strong> {new Date(item.modifiedAt).toLocaleDateString()}
              </div>
              {item.indexedAt && (
                <div className="date-item">
                  <strong>Indexed:</strong> {new Date(item.indexedAt).toLocaleDateString()}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
