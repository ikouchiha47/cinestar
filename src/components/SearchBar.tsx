import React, { useState } from 'react';
import { MediaAPI } from '../api/media-api';
import { MediaItem, SearchQuery } from '../core/types';

interface SearchBarProps {
  onResults: (results: MediaItem[], query: string) => void;
}

export const SearchBar: React.FC<SearchBarProps> = ({ onResults }) => {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);

  const handleSearch = async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      onResults([], searchQuery);
      return;
    }

    setSearching(true);
    try {
      const searchQueryObj: SearchQuery = { query: searchQuery };
      const response = await MediaAPI.search(searchQueryObj);
      if (response.success && response.results) {
        onResults(response.results.items, searchQuery);
      } else {
        onResults([], searchQuery);
      }
    } catch (error) {
      console.error('Search error:', error);
      onResults([], searchQuery);
    } finally {
      setSearching(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSearch(query);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newQuery = e.target.value;
    setQuery(newQuery);
    
    // Debounced search
    if (newQuery.trim()) {
      const timeoutId = setTimeout(() => handleSearch(newQuery), 300);
      return () => clearTimeout(timeoutId);
    } else {
      onResults([], '');
    }
  };

  return (
    <div className="search-bar">
      <form onSubmit={handleSubmit} className="search-form">
        <div className="search-input-group">
          <input
            type="text"
            value={query}
            onChange={handleInputChange}
            placeholder="Search your media files..."
            className="search-input"
            disabled={searching}
          />
          <button 
            type="submit" 
            className="search-button"
            disabled={searching || !query.trim()}
          >
            {searching ? '🔍' : '🔎'}
          </button>
        </div>
      </form>
    </div>
  );
};
