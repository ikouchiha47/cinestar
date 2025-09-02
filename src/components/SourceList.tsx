import React, { useState, useEffect } from 'react';
import { MediaAPI } from '../api/media-api';
import { MediaSource } from '../core/types';

interface SourceListProps {
  onAddSource: () => void;
  refreshTrigger?: number;
}

export const SourceList: React.FC<SourceListProps> = ({ onAddSource, refreshTrigger }) => {
  const [sources, setSources] = useState<MediaSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [indexingJobs, setIndexingJobs] = useState<string[]>([]);

  const loadSources = async () => {
    try {
      const result = await MediaAPI.getSources();
      if (result.success && result.sources) {
        setSources(result.sources);
      } else {
        setError(result.error || 'Failed to load sources');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const loadIndexingStatus = async () => {
    try {
      const result = await MediaAPI.getIndexingStatus();
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
      const result = await MediaAPI.startIndexing(sourceId);
      if (result.success) {
        await loadIndexingStatus();
        // Start polling for progress updates
        startProgressPolling();
      } else {
        alert(`Failed to start indexing: ${result.error}`);
      }
    } catch (err) {
      alert(`Error starting indexing: ${err instanceof Error ? err.message : err}`);
    }
  };

  const startProgressPolling = () => {
    const pollInterval = setInterval(async () => {
      try {
        const statusResult = await MediaAPI.getIndexingStatus();
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
      const result = await MediaAPI.removeSource(sourceId);
      if (result.success) {
        await loadSources();
      } else {
        alert(`Failed to remove source: ${result.error}`);
      }
    } catch (err) {
      alert(`Error removing source: ${err instanceof Error ? err.message : err}`);
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

  const getSourceIcon = (type: string) => {
    return type === 'local' ? '📁' : '🌐';
  };

  if (loading) {
    return (
      <div className="source-list loading">
        <div className="loading-spinner">Loading sources...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="source-list error">
        <div className="error-message">❌ {error}</div>
        <button onClick={loadSources} className="retry-btn">Retry</button>
      </div>
    );
  }

  return (
    <div className="source-list">
      <div className="source-list-header">
        <h2>Media Sources</h2>
        <button onClick={onAddSource} className="add-source-btn">
          ➕ Add Source
        </button>
      </div>

      {sources.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📂</div>
          <h3>No media sources configured</h3>
          <p>Add your first media source to start indexing and searching your files.</p>
          <button onClick={onAddSource} className="add-first-source-btn">
            Add Your First Source
          </button>
        </div>
      ) : (
        <div className="sources-grid">
          {sources.map((source) => (
            <div key={source.id} className="source-card">
              <div className="source-header">
                <div className="source-title">
                  <span className="source-icon">{getSourceIcon(source.type)}</span>
                  <h3>{source.name}</h3>
                </div>
                <div className="source-actions">
                  <button
                    onClick={() => handleStartIndexing(source.id)}
                    className={`index-btn ${indexingJobs.includes(source.id) ? 'indexing' : ''}`}
                    disabled={indexingJobs.includes(source.id)}
                    title={indexingJobs.includes(source.id) ? 'Indexing in progress...' : 'Start indexing this source'}
                  >
                    {indexingJobs.includes(source.id) ? (
                      <span className="indexing-spinner">🔄</span>
                    ) : (
                      '▶️'
                    )}
                  </button>
                  <button
                    onClick={() => handleRemoveSource(source.id, source.name)}
                    className="remove-btn"
                    title="Remove this source"
                  >
                    🗑️
                  </button>
                </div>
              </div>

              <div className="source-details">
                <div className="source-path">
                  <strong>Path:</strong> {source.path}
                </div>
                <div className="source-meta">
                  <span className={`source-status ${source.enabled ? 'enabled' : 'disabled'}`}>
                    {source.enabled ? '✅ Enabled' : '❌ Disabled'}
                  </span>
                  <span className="source-type">{source.type}</span>
                </div>
                <div className="source-indexed">
                  <strong>Last Indexed:</strong> {formatDate(source.lastIndexed)}
                </div>
              </div>

              {source.config && (
                <div className="source-config">
                  <details>
                    <summary>Configuration</summary>
                    <pre>{JSON.stringify(source.config, null, 2)}</pre>
                  </details>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {indexingJobs.length > 0 && (
        <div className="indexing-status">
          <h3>🔄 Active Indexing Jobs</h3>
          <div className="active-jobs">
            {indexingJobs.map((jobId) => (
              <div key={jobId} className="job-item">
                Job: {jobId}
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
};
