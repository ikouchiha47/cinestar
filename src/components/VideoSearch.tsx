import React, { useState, useEffect, useMemo } from 'react';

// Video search result interface
interface VideoSearchResult {
  segment: {
    id: string;
    videoPath: string;
    startTime: number;
    endTime: number;
    duration: number;
    sceneIndex: number;
    thumbnailPath?: string;
    transcription?: string;
    caption?: string;
    ocrText?: string;
  };
  video: {
    id: string;
    fileName: string;
    filePath: string;
    duration: number;
    width?: number;
    height?: number;
  };
  score: number;
  matchType: 'text' | 'vector' | 'hybrid';
  snippet?: string;
}

interface VideoProcessingJob {
  id: string;
  videoPath: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  error?: string;
  segmentCount?: number;
}

interface VideoSearchProps {
  query: string;
  onResultClick?: (result: VideoSearchResult) => void;
}

const VideoIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2" className={className}>
    <rect x="3" y="5" width="15" height="14" rx="2" />
    <path d="M22 7l-4 2v6l4 2V7z" />
  </svg>
);

const PlayIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" className={className}>
    <polygon points="5,3 19,12 5,21" />
  </svg>
);

const UploadIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2" className={className}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7,10 12,5 17,10" />
    <line x1="12" y1="5" x2="12" y2="15" />
  </svg>
);

const formatTime = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

// Utility function for formatting file sizes (currently unused but may be needed later)
// const formatFileSize = (bytes: number): string => {
//   const units = ['B', 'KB', 'MB', 'GB'];
//   let size = bytes;
//   let unitIndex = 0;
//   
//   while (size >= 1024 && unitIndex < units.length - 1) {
//     size /= 1024;
//     unitIndex++;
//   }
//   
//   return `${size.toFixed(1)} ${units[unitIndex]}`;
// };

export const VideoSearch: React.FC<VideoSearchProps> = ({ query, onResultClick }) => {
  const [results, setResults] = useState<VideoSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeJobs, setActiveJobs] = useState<VideoProcessingJob[]>([]);
  const [searchType, setSearchType] = useState<'text' | 'vector' | 'hybrid'>('hybrid');

  // Search videos when query changes
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    const searchVideos = async () => {
      setLoading(true);
      try {
        const response = await window.videoAPI.searchVideos({
          query: query.trim(),
          limit: 20,
          searchType,
        });

        if (response.success) {
          setResults(response.results || []);
        } else {
          console.error('Video search failed:', response.error);
          setResults([]);
        }
      } catch (error) {
        console.error('Video search error:', error);
        setResults([]);
      } finally {
        setLoading(false);
      }
    };

    const debounceTimer = setTimeout(searchVideos, 500);
    return () => clearTimeout(debounceTimer);
  }, [query, searchType]);

  // Poll for active jobs
  useEffect(() => {
    const pollJobs = async () => {
      try {
        const jobs = await window.videoAPI.getActiveJobs();
        setActiveJobs(jobs || []);
      } catch (error) {
        console.error('Failed to get active jobs:', error);
      }
    };

    pollJobs();
    const interval = setInterval(pollJobs, 2000);
    return () => clearInterval(interval);
  }, []);

  const handleFileUpload = async () => {
    try {
      const result = await window.videoAPI.selectVideoFile();
      if (!result.canceled && result.path) {
        // Check if it's a video or audio file
        const isVideo = await window.videoAPI.isVideoFile(result.path);
        const isAudio = await window.videoAPI.isAudioFile(result.path);
        
        if (isVideo || isAudio) {
          // Start processing
          const response = isVideo 
            ? await window.videoAPI.processVideo(result.path)
            : await window.videoAPI.processAudio(result.path);
            
          if (response.success) {
            console.log(`Started processing ${isVideo ? 'video' : 'audio'}: ${result.path}`);
          } else {
            alert(`Failed to process file: ${response.error}`);
          }
        } else {
          alert('Please select a valid video or audio file');
        }
      }
    } catch (error) {
      console.error('File upload error:', error);
      alert('Failed to upload file');
    }
  };

  const groupedResults = useMemo(() => {
    const groups: { [videoPath: string]: VideoSearchResult[] } = {};
    results.forEach(result => {
      const path = result.video.filePath;
      if (!groups[path]) {
        groups[path] = [];
      }
      groups[path].push(result);
    });
    return groups;
  }, [results]);

  if (!query.trim()) {
    return (
      <div className="space-y-4">
        {/* Upload section */}
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
          <div className="text-center">
            <VideoIcon className="mx-auto mb-4 text-neutral-400" />
            <h3 className="text-lg font-medium mb-2">Video Search</h3>
            <p className="text-neutral-400 mb-4">
              Upload videos or audio files to enable semantic search through transcriptions and visual content.
            </p>
            <button
              onClick={handleFileUpload}
              className="inline-flex items-center gap-2 rounded-xl border border-neutral-700 bg-neutral-800 px-4 py-2 text-sm hover:bg-neutral-700"
            >
              <UploadIcon />
              Upload Video/Audio
            </button>
          </div>
        </div>

        {/* Active processing jobs */}
        {activeJobs.length > 0 && (
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
            <h4 className="text-sm font-medium mb-3">Processing Videos</h4>
            <div className="space-y-2">
              {activeJobs.map(job => (
                <div key={job.id} className="flex items-center justify-between p-3 rounded-lg bg-neutral-800">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {job.videoPath.split('/').pop()}
                    </div>
                    <div className="text-xs text-neutral-400">
                      {job.status === 'processing' ? `${job.progress}% complete` : job.status}
                    </div>
                  </div>
                  <div className="ml-4">
                    {job.status === 'processing' && (
                      <div className="w-16 h-2 bg-neutral-700 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-blue-500 transition-all duration-300"
                          style={{ width: `${job.progress}%` }}
                        />
                      </div>
                    )}
                    {job.status === 'completed' && (
                      <span className="text-xs text-green-400">✓ Done</span>
                    )}
                    {job.status === 'failed' && (
                      <span className="text-xs text-red-400">✗ Failed</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search controls */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-neutral-300">
          <b>Video Results</b> <span className="text-neutral-500">{results.length}</span>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={searchType}
            onChange={(e) => setSearchType(e.target.value as any)}
            className="text-xs bg-neutral-800 border border-neutral-700 rounded px-2 py-1"
          >
            <option value="hybrid">Hybrid Search</option>
            <option value="text">Text Only</option>
            <option value="vector">Semantic Only</option>
          </select>
        </div>
      </div>

      {loading && (
        <div className="text-center py-8 text-neutral-400">
          Searching videos...
        </div>
      )}

      {!loading && results.length === 0 && (
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6 text-center text-neutral-500">
          No video results found for "{query}"
        </div>
      )}

      {/* Results grouped by video */}
      {Object.entries(groupedResults).map(([videoPath, videoResults]) => {
        const video = videoResults[0].video;
        return (
          <div key={videoPath} className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
            {/* Video header */}
            <div className="flex items-center gap-3 mb-4 pb-3 border-b border-neutral-800">
              <VideoIcon className="text-blue-400" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{video.fileName}</div>
                <div className="text-xs text-neutral-400">
                  {formatTime(video.duration)}
                  {video.width && video.height && ` • ${video.width}×${video.height}`}
                </div>
              </div>
              <div className="text-xs text-neutral-500">
                {videoResults.length} segment{videoResults.length !== 1 ? 's' : ''}
              </div>
            </div>

            {/* Video segments */}
            <div className="space-y-2">
              {videoResults.map((result, index) => (
                <div
                  key={`${result.segment.id}-${index}`}
                  onClick={() => onResultClick?.(result)}
                  className="flex items-start gap-3 p-3 rounded-lg bg-neutral-800 hover:bg-neutral-750 cursor-pointer transition-colors"
                >
                  {/* Thumbnail */}
                  <div className="w-16 h-12 bg-neutral-700 rounded flex items-center justify-center flex-shrink-0">
                    {result.segment.thumbnailPath ? (
                      <img 
                        src={`file://${result.segment.thumbnailPath}`}
                        alt="Thumbnail"
                        className="w-full h-full object-cover rounded"
                      />
                    ) : (
                      <PlayIcon className="text-neutral-400" />
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs text-blue-400">
                        {formatTime(result.segment.startTime)} - {formatTime(result.segment.endTime)}
                      </span>
                      <span className="text-xs text-neutral-500">
                        Scene {result.segment.sceneIndex + 1}
                      </span>
                      <span className="text-xs text-neutral-500">
                        {result.matchType} • {(result.score * 100).toFixed(1)}%
                      </span>
                    </div>

                    {/* Transcription */}
                    {result.segment.transcription && (
                      <div className="text-sm text-neutral-300 mb-1">
                        {result.snippet || result.segment.transcription.slice(0, 150)}
                        {result.segment.transcription.length > 150 && '...'}
                      </div>
                    )}

                    {/* Caption */}
                    {result.segment.caption && (
                      <div className="text-xs text-neutral-400 italic">
                        {result.segment.caption}
                      </div>
                    )}

                    {/* OCR text */}
                    {result.segment.ocrText && (
                      <div className="text-xs text-neutral-500 mt-1">
                        OCR: {result.segment.ocrText.slice(0, 100)}
                        {result.segment.ocrText.length > 100 && '...'}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default VideoSearch;
