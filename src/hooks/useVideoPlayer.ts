import { useState, useCallback } from 'react';

interface VideoSegment {
  id: string;
  startTime: number;
  endTime: number;
  transcription: string;
  caption: string;
  reconstructedScene: string;
  relevanceScore?: number;
}

interface VideoPlayerState {
  isOpen: boolean;
  videoPath: string;
  videoName: string;
  segments: VideoSegment[];
  initialTimestamp?: number;
  searchQuery?: string;
  isLoading: boolean;
  error: string | null;
}

interface UseVideoPlayerReturn {
  playerState: VideoPlayerState;
  openVideoPlayer: (options: {
    videoPath: string;
    videoName: string;
    searchQuery?: string;
    initialTimestamp?: number;
  }) => Promise<void>;
  closeVideoPlayer: () => void;
}

export const useVideoPlayer = (): UseVideoPlayerReturn => {
  const [playerState, setPlayerState] = useState<VideoPlayerState>({
    isOpen: false,
    videoPath: '',
    videoName: '',
    segments: [],
    initialTimestamp: undefined,
    searchQuery: undefined,
    isLoading: false,
    error: null,
  });

  const openVideoPlayer = useCallback(async (options: {
    videoPath: string;
    videoName: string;
    searchQuery?: string;
    initialTimestamp?: number;
  }) => {
    console.log('[VIDEO-PLAYER-HOOK] Opening video player:', options);
    
    setPlayerState(prev => ({
      ...prev,
      isOpen: true,
      videoPath: options.videoPath,
      videoName: options.videoName,
      searchQuery: options.searchQuery,
      initialTimestamp: options.initialTimestamp,
      isLoading: true,
      error: null,
      segments: [], // Clear previous segments
    }));

    try {
      // Load video segments if this is from a search result
      if (options.searchQuery) {
        console.log('[VIDEO-PLAYER-HOOK] Loading segments for search query:', options.searchQuery);
        
        const segmentsResult = await window.videoAPI.getSegmentsForPlayer(
          options.videoPath,
          options.searchQuery
        );

        if (segmentsResult.success && segmentsResult.segments) {
          console.log('[VIDEO-PLAYER-HOOK] Loaded segments:', segmentsResult.segments.length);
          
          setPlayerState(prev => ({
            ...prev,
            segments: segmentsResult.segments || [],
            isLoading: false,
          }));
        } else {
          console.warn('[VIDEO-PLAYER-HOOK] Failed to load segments:', segmentsResult.error);
          setPlayerState(prev => ({
            ...prev,
            segments: [],
            isLoading: false,
            error: segmentsResult.error || 'Failed to load video segments',
          }));
        }
      } else {
        // No search query, just open the video player without segments
        console.log('[VIDEO-PLAYER-HOOK] Opening video player without segments');
        setPlayerState(prev => ({
          ...prev,
          segments: [],
          isLoading: false,
        }));
      }
    } catch (error) {
      console.error('[VIDEO-PLAYER-HOOK] Error loading video player data:', error);
      setPlayerState(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to load video data',
      }));
    }
  }, []);

  const closeVideoPlayer = useCallback(() => {
    console.log('[VIDEO-PLAYER-HOOK] Closing video player');
    setPlayerState({
      isOpen: false,
      videoPath: '',
      videoName: '',
      segments: [],
      initialTimestamp: undefined,
      searchQuery: undefined,
      isLoading: false,
      error: null,
    });
  }, []);

  return {
    playerState,
    openVideoPlayer,
    closeVideoPlayer,
  };
};
