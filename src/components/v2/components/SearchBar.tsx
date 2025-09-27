/**
 * SearchBar - Search input with scope filtering and tab navigation
 */

import React from 'react';
import { Scope } from '../types';
import { Icon } from './Icons';

interface SearchBarProps {
  query: string;
  onQueryChange: (query: string) => void;
  activeTab: 'media' | 'videos';
  onTabChange: (tab: 'media' | 'videos') => void;
  scope: Scope;
  onScopeChange: (scope: Scope) => void;
  searching: boolean;
  onConnect: () => void;
  onOpenIndexing: () => void;
  overallProgress?: number;
}

export function SearchBar({
  query,
  onQueryChange,
  activeTab,
  onTabChange,
  scope,
  onScopeChange,
  searching,
  onConnect,
  onOpenIndexing,
  overallProgress = -1
}: SearchBarProps) {
  return (
    <div className="sticky top-0 z-10 bg-neutral-950/80 backdrop-blur-sm border-b border-neutral-800 p-4">
      {/* Search Input */}
      <div className="relative mb-4">
        <Icon.Search className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search your media..."
          className="w-full pl-10 pr-4 py-3 bg-neutral-900 border border-neutral-800 rounded-2xl text-white placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50"
        />
        {searching && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

      {/* Tab Navigation */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex bg-neutral-900 border border-neutral-800 rounded-xl p-1">
          <button
            onClick={() => onTabChange('media')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              activeTab === 'media'
                ? 'bg-blue-600 text-white'
                : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
            }`}
          >
            <Icon.Image className="inline mr-2" />
            Media Search
          </button>
          <button
            onClick={() => onTabChange('videos')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              activeTab === 'videos'
                ? 'bg-purple-600 text-white'
                : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
            }`}
          >
            <Icon.Video className="inline mr-2" />
            Video Search
          </button>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={onConnect}
            className="flex items-center gap-2 px-3 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Icon.Plus />
            Connect
          </button>
          <button
            onClick={onOpenIndexing}
            className={`flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
              overallProgress >= 0
                ? 'bg-orange-600 hover:bg-orange-700 text-white'
                : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300'
            }`}
          >
            <Icon.Bolt />
            {overallProgress >= 0 ? `Indexing ${overallProgress}%` : 'Indexing'}
          </button>
        </div>
      </div>

      {/* Scope Filter */}
      <div className="flex items-center gap-2 text-sm">
        <span className="text-neutral-400">Scope:</span>
        <div className="flex bg-neutral-900 border border-neutral-800 rounded-lg p-1">
          {(['all', 's3', 'drive', 'folders'] as Scope[]).map((s) => (
            <button
              key={s}
              onClick={() => onScopeChange(s)}
              className={`px-3 py-1 rounded-md transition-colors ${
                scope === s
                  ? 'bg-neutral-700 text-white'
                  : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
              }`}
            >
              {s === 'all' ? 'All' : s === 's3' ? 'S3' : s === 'drive' ? 'Drive' : 'Folders'}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
