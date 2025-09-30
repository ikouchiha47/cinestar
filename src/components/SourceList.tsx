import React, { useState, useEffect } from 'react';
import { MediaSource } from '../core/types';

// Icon components
const Icon = {
  Folder: ({ className }: { className?: string }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-5l-2-2H5a2 2 0 00-2 2z" />
    </svg>
  ),
  Play: ({ className }: { className?: string }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1m4 0h1m-6 4h.01M15 14h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  Refresh: ({ className }: { className?: string }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  ),
  Spinner: ({ className }: { className?: string }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
  ),
  Trash: ({ className }: { className?: string }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  ),
  Plus: ({ className }: { className?: string }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
    </svg>
  ),
  Clean: ({ className }: { className?: string }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  )
};

interface SourceListProps {
  onAddSource: () => void;
  refreshTrigger?: number;
  onSelectSource?: (sourceId: string) => void;
  compact?: boolean;
  showFilter?: boolean;
}

export const SourceList: React.FC<SourceListProps> = ({ onAddSource, refreshTrigger, onSelectSource, compact = false, showFilter = false }) => {
  const [sources, setSources] = useState<MediaSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [indexingJobs, setIndexingJobs] = useState<string[]>([]);
  const [filterText, setFilterText] = useState<string>('');

  const loadSources = async () => {
    try {
      console.log('Loading sources...');
      
      const result = await window.mediaAPI.getSources();
      console.log('Sources API result:', result);
      
      if (result.success && result.sources) {
        console.log('Setting sources:', result.sources);
        setSources(result.sources);
      } else {
        console.error('Failed to load sources:', result.error);
        setError(result.error || 'Failed to load sources');
      }
    } catch (err) {
      console.error('Error loading sources:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const loadIndexingStatus = async () => {
    try {
      const result = await window.mediaAPI.getIndexingStatus();
      if (result.success && result.activeJobs) {
        setIndexingJobs(result.activeJobs);
      }
    } catch (err) {
      console.warn('Failed to load indexing status:', err);
    }
  };

  useEffect(() => {
    loadSources();
    loadIndexingStatus();
  }, [refreshTrigger]);

  const handleStartIndexing = async (sourceId: string) => {
    try {
      const result = await window.mediaAPI.startIndexing(sourceId);
      if (result.success) {
        await loadIndexingStatus();
        // Start polling for progress updates
        startProgressPolling();
      } else {
        console.error(`[SOURCE-LIST] Failed to start indexing: ${result.error}`);
      }
    } catch (err) {
      console.error(`[SOURCE-LIST] Error starting indexing:`, err instanceof Error ? err.message : err);
    }
  };

  const handleForceReindex = async (sourceId: string, sourceName: string) => {
    if (!confirm(`Force re-index "${sourceName}"? This will regenerate all captions and embeddings, even for items that were already processed.`)) {
      return;
    }

    try {
      const result = await window.mediaAPI.forceReindex(sourceId);
      if (result.success) {
        await loadIndexingStatus();
        // Start polling for progress updates
        startProgressPolling();
      } else {
        console.error(`[SOURCE-LIST] Failed to start force re-indexing: ${result.error}`);
      }
    } catch (err) {
      console.error(`[SOURCE-LIST] Error starting force re-indexing:`, err instanceof Error ? err.message : err);
    }
  };

  const handleCleanupDuplicates = async () => {
    if (!confirm('Clean up duplicate sources? This will remove duplicate folder entries and keep only the most recent one for each path.')) {
      return;
    }

    try {
      const result = await window.mediaAPI.cleanupDuplicates();
      if (result.success) {
        console.log(`[SOURCE-LIST] Cleanup completed! Removed ${result.removed} duplicates, kept ${result.kept} sources.`);
        await loadSources(); // Refresh the list
      } else {
        console.error(`[SOURCE-LIST] Failed to cleanup duplicates: ${result.error}`);
      }
    } catch (err) {
      console.error(`[SOURCE-LIST] Error cleaning up duplicates:`, err instanceof Error ? err.message : err);
    }
  };

  const startProgressPolling = () => {
    const pollInterval = setInterval(async () => {
      try {
        const statusResult = await window.mediaAPI.getIndexingStatus();
        if (statusResult.success && statusResult.activeJobs) {
          setIndexingJobs(statusResult.activeJobs);
          
          // If no active jobs, stop polling and refresh sources
          if (statusResult.activeJobs.length === 0) {
            clearInterval(pollInterval);
            await loadSources(); // Refresh to show updated lastIndexed
          }
        }
      } catch (err) {
        console.error('Failed to poll indexing status:', err);
        clearInterval(pollInterval);
      }
    }, 1000); // Poll every second

    // Stop polling after 30 seconds to prevent infinite polling
    setTimeout(() => clearInterval(pollInterval), 30000);
  };

  const handleRemoveSource = async (sourceId: string, sourceName: string) => {
    if (!confirm(`Are you sure you want to remove "${sourceName}"? This will delete all indexed media from this source.`)) {
      return;
    }

    try {
      const result = await window.mediaAPI.removeSource(sourceId);
      if (result.success) {
        await loadSources();
      } else {
        console.error(`[SOURCE-LIST] Failed to remove source: ${result.error}`);
      }
    } catch (err) {
      console.error(`[SOURCE-LIST] Error removing source:`, err instanceof Error ? err.message : err);
    }
  };

  const formatDate = (date?: Date) => {
    if (!date) return 'Never';
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(date));
  };


  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex items-center gap-2">
          <Icon.Spinner className="w-5 h-5 animate-spin" />
          <span>Loading sources...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="text-red-400 mb-4">❌ {error}</div>
          <button 
            onClick={loadSources} 
            className="px-4 py-2 bg-neutral-800 border border-neutral-700 rounded-lg hover:bg-neutral-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const filteredSources = sources.filter((s) => {
    if (!filterText.trim()) return true;
    const q = filterText.toLowerCase();
    return s.name.toLowerCase().includes(q) || (s.path || '').toLowerCase().includes(q);
  });

  return (
    <div>
      {showFilter && sources.length > 0 && (
        <div className="mb-3 flex gap-2">
          <input
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Filter sources..."
            className="flex-1 rounded-lg bg-neutral-900 border border-neutral-800 px-3 py-2 text-sm focus:outline-none focus:border-neutral-600"
          />
          <button
            onClick={handleCleanupDuplicates}
            className="px-3 py-2 rounded-lg border border-yellow-700 hover:bg-yellow-900/50 text-yellow-400 hover:text-yellow-300 transition text-sm"
            title="Clean up duplicate sources"
          >
            <Icon.Clean className="w-4 h-4" />
          </button>
        </div>
      )}
      {!showFilter && sources.length > 1 && (
        <div className="mb-3 flex justify-end">
          <button
            onClick={handleCleanupDuplicates}
            className="px-3 py-2 rounded-lg border border-yellow-700 hover:bg-yellow-900/50 text-yellow-400 hover:text-yellow-300 transition text-sm flex items-center gap-2"
            title="Clean up duplicate sources"
          >
            <Icon.Clean className="w-4 h-4" />
            Clean Duplicates
          </button>
        </div>
      )}
      {sources.length === 0 ? (
        <div className="flex items-center justify-center py-16">
          <div className="text-center">
            <div className="text-6xl mb-4">📂</div>
            <h3 className="text-xl font-semibold mb-2">No media sources configured</h3>
            <p className="text-neutral-400 mb-6 max-w-md">
              Add your first media source to start indexing and searching your files.
            </p>
            <button 
              onClick={onAddSource} 
              className="inline-flex items-center gap-2 px-6 py-3 bg-neutral-200 text-neutral-900 rounded-lg hover:bg-neutral-300 font-medium"
            >
              <Icon.Plus className="w-5 h-5" />
              Add Your First Source
            </button>
          </div>
        </div>
      ) : (
        <div className="grid gap-3">
          {filteredSources.map((source) => (
            <div key={source.id}
              className={compact
                ? 'group flex items-center justify-between p-3 rounded-xl border border-neutral-800 bg-neutral-900/40 hover:bg-neutral-900 transition'
                : 'border border-neutral-800 rounded-2xl p-6 bg-neutral-900/50 hover:bg-neutral-900 transition'}>
              <div className={compact ? 'flex items-center gap-3 min-w-0' : 'flex items-start justify-between mb-4 w-full'}>
                <div className="flex items-center gap-3 min-w-0">
                  <Icon.Folder className={compact ? 'w-5 h-5 text-neutral-400' : 'w-6 h-6 text-neutral-400'} />
                  <div className="min-w-0">
                    <h3 className={compact ? 'font-medium text-sm truncate' : 'font-semibold text-lg truncate'} title={source.name}>{source.name}</h3>
                    <p className={compact ? 'text-xs text-neutral-500 font-mono truncate' : 'text-sm text-neutral-400 font-mono truncate'} title={source.path}>{source.path}</p>
                  </div>
                </div>
                {!compact && (
                  <div className="flex items-center gap-2">
                    {onSelectSource && (
                      <button
                        onClick={() => onSelectSource(source.id)}
                        className="p-2 rounded-lg border border-neutral-700 hover:bg-neutral-800 text-neutral-300"
                        title="Browse this source"
                      >
                        <Icon.Folder className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={() => handleStartIndexing(source.id)}
                      disabled={indexingJobs.includes(source.id)}
                      className={`p-2 rounded-lg border transition ${
                        indexingJobs.includes(source.id)
                          ? 'border-blue-700 bg-blue-900/50 text-blue-400'
                          : 'border-neutral-700 hover:bg-neutral-800'
                      }`}
                      title={indexingJobs.includes(source.id) ? 'Indexing in progress...' : 'Start indexing this source'}
                    >
                      {indexingJobs.includes(source.id) ? (
                        <Icon.Spinner className="w-4 h-4 animate-spin" />
                      ) : (
                        <Icon.Play className="w-4 h-4" />
                      )}
                    </button>
                    <button
                      onClick={() => handleForceReindex(source.id, source.name)}
                      disabled={indexingJobs.includes(source.id)}
                      className={`p-2 rounded-lg border transition ${
                        indexingJobs.includes(source.id)
                          ? 'border-neutral-600 bg-neutral-800 text-neutral-500'
                          : 'border-orange-700 hover:bg-orange-900/50 text-orange-400 hover:text-orange-300'
                      }`}
                      title={indexingJobs.includes(source.id) ? 'Cannot force re-index while indexing' : 'Force re-index (regenerate all captions and embeddings)'}
                    >
                      <Icon.Refresh className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleRemoveSource(source.id, source.name)}
                      className="p-2 rounded-lg border border-neutral-700 hover:bg-red-900/50 hover:border-red-700 text-neutral-400 hover:text-red-400 transition"
                      title="Remove this source"
                    >
                      <Icon.Trash className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>

              {compact ? (
                <div className="flex items-center gap-2">
                  {onSelectSource && (
                    <button
                      onClick={() => onSelectSource(source.id)}
                      className="p-1.5 rounded-md border border-neutral-700 hover:bg-neutral-800 text-neutral-300"
                      title="Browse this source"
                    >
                      <Icon.Folder className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={() => handleStartIndexing(source.id)}
                    disabled={indexingJobs.includes(source.id)}
                    className={`p-1.5 rounded-md border transition ${
                      indexingJobs.includes(source.id)
                        ? 'border-blue-700 bg-blue-900/50 text-blue-400'
                        : 'border-neutral-700 hover:bg-neutral-800'
                    }`}
                    title={indexingJobs.includes(source.id) ? 'Indexing in progress...' : 'Start indexing this source'}
                  >
                    {indexingJobs.includes(source.id) ? (
                      <Icon.Spinner className="w-4 h-4 animate-spin" />
                    ) : (
                      <Icon.Play className="w-4 h-4" />
                    )}
                  </button>
                  <button
                    onClick={() => handleForceReindex(source.id, source.name)}
                    disabled={indexingJobs.includes(source.id)}
                    className={`p-1.5 rounded-md border transition ${
                      indexingJobs.includes(source.id)
                        ? 'border-neutral-600 bg-neutral-800 text-neutral-500'
                        : 'border-orange-700 hover:bg-orange-900/50 text-orange-400 hover:text-orange-300'
                    }`}
                    title={indexingJobs.includes(source.id) ? 'Cannot force re-index while indexing' : 'Force re-index (regenerate all captions and embeddings)'}
                  >
                    <Icon.Refresh className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => handleRemoveSource(source.id, source.name)}
                    className="p-1.5 rounded-md border border-neutral-700 hover:bg-red-900/50 hover:border-red-700 text-neutral-400 hover:text-red-400 transition"
                    title="Remove this source"
                  >
                    <Icon.Trash className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm mt-2">
                    <div>
                      <div className="text-neutral-400 mb-1">Status</div>
                      <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
                        source.enabled 
                          ? 'bg-green-900/50 text-green-400 border border-green-800'
                          : 'bg-red-900/50 text-red-400 border border-red-800'
                      }`}>
                        {source.enabled ? '✅ Enabled' : '❌ Disabled'}
                      </div>
                    </div>
                    <div>
                      <div className="text-neutral-400 mb-1">Type</div>
                      <div className="capitalize">{source.type}</div>
                    </div>
                    <div>
                      <div className="text-neutral-400 mb-1">Last Indexed</div>
                      <div>{formatDate(source.lastIndexed)}</div>
                    </div>
                  </div>

                  {source.config && Object.keys(source.config).length > 0 && (
                    <details className="mt-4">
                      <summary className="cursor-pointer text-sm text-neutral-400 hover:text-neutral-200">
                        Configuration
                      </summary>
                      <pre className="mt-2 p-3 bg-neutral-800 rounded-lg text-xs overflow-auto">
                        {JSON.stringify(source.config, null, 2)}
                      </pre>
                    </details>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Active indexing list moved into the global Indexing Center drawer */}
    </div>
  );
};
