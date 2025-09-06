import React, { useState } from 'react';
import { MediaItem, SearchQuery } from '../core/types';

// Search icon component
const SearchIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
  </svg>
);

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
      console.log('Performing search with query:', searchQuery);
      const response = await window.mediaAPI.search(searchQueryObj);
      console.log('Search response:', response);
      console.log('Response success:', response.success);
      console.log('Response results:', response.results);
      if (response.results) {
        console.log('Results items:', response.results.items);
        console.log('Results items length:', response.results.items?.length);
      }
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
  };

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-2xl mx-auto">
      <div className="relative">
        <SearchIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-neutral-400" />
        <input
          type="text"
          value={query}
          onChange={handleInputChange}
          placeholder="Search your media files..."
          className="w-full pl-10 pr-4 py-3 bg-neutral-800 border border-neutral-700 rounded-xl text-neutral-200 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-600 focus:border-transparent"
          disabled={searching}
        />
        {searching && (
          <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
            <div className="w-5 h-5 border-2 border-neutral-600 border-t-neutral-400 rounded-full animate-spin" />
          </div>
        )}
      </div>
    </form>
  );
};
