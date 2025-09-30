import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Play, Pause, Volume2, VolumeX, Maximize, SkipBack, SkipForward } from 'lucide-react';

interface VideoSegment {
  id: string;
  startTime: number;
  endTime: number;
  transcription: string;
  caption: string;
  reconstructedScene: string;
  relevanceScore?: number;
}

interface VideoPlayerModalProps {
  isOpen: boolean;
  onClose: () => void;
  videoPath: string;
  videoName: string;
  segments?: VideoSegment[];
  initialTimestamp?: number;
  searchQuery?: string;
}

export const VideoPlayerModal: React.FC<VideoPlayerModalProps> = ({
  isOpen,
  onClose,
  videoPath,
  videoName,
  segments,
  initialTimestamp,
  searchQuery
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const controlsTimeoutRef = useRef<NodeJS.Timeout>();

  // Auto-hide controls after 3 seconds of inactivity
  const resetControlsTimeout = () => {
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    setShowControls(true);
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying) setShowControls(false);
    }, 3000);
  };

  // Initialize video and seek to initial timestamp
  useEffect(() => {
    if (isOpen && videoRef.current && initialTimestamp) {
      videoRef.current.currentTime = initialTimestamp;
    }
  }, [isOpen, initialTimestamp]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (!isOpen) return;

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          togglePlayPause();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          seekBackward();
          break;
        case 'ArrowRight':
          e.preventDefault();
          seekForward();
          break;
        case 'ArrowUp':
          e.preventDefault();
          adjustVolume(0.1);
          break;
        case 'ArrowDown':
          e.preventDefault();
          adjustVolume(-0.1);
          break;
        case 'KeyM':
          e.preventDefault();
          toggleMute();
          break;
        case 'KeyF':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'Escape':
          if (isFullscreen) {
            exitFullscreen();
          } else {
            onClose();
          }
          break;
      }
    };

    document.addEventListener('keydown', handleKeyPress);
    return () => document.removeEventListener('keydown', handleKeyPress);
  }, [isOpen, isPlaying, isFullscreen]);

  const togglePlayPause = () => {
    if (!videoRef.current) return;
    
    if (isPlaying) {
      videoRef.current.pause();
    } else {
      videoRef.current.play();
    }
  };

  const seekBackward = () => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 10);
  };

  const seekForward = () => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = Math.min(duration, videoRef.current.currentTime + 10);
  };

  const adjustVolume = (delta: number) => {
    if (!videoRef.current) return;
    const newVolume = Math.max(0, Math.min(1, volume + delta));
    setVolume(newVolume);
    videoRef.current.volume = newVolume;
    if (newVolume > 0 && isMuted) {
      setIsMuted(false);
    }
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    videoRef.current.muted = newMuted;
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  const exitFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    setCurrentTime(videoRef.current.currentTime);
  };

  const handleLoadedMetadata = () => {
    if (!videoRef.current) return;
    setDuration(videoRef.current.duration);
    setIsLoading(false);
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!videoRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    videoRef.current.currentTime = pos * duration;
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const seekToTimestamp = (timestamp: number) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = timestamp;
    if (!isPlaying) {
      videoRef.current.play();
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          className={`relative w-full max-w-6xl mx-4 bg-black/20 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden ${
            isFullscreen ? 'max-w-none mx-0 rounded-none h-screen' : 'max-h-[90vh]'
          }`}
          onMouseMove={resetControlsTimeout}
        >
          {/* Close Button */}
          {!isFullscreen && (
            <button
              onClick={onClose}
              className="absolute top-4 right-4 z-10 p-2 bg-black/50 backdrop-blur-sm rounded-full border border-white/20 text-white hover:bg-black/70 transition-colors"
            >
              <X size={20} />
            </button>
          )}

          {/* Video Container */}
          <div className="relative aspect-video bg-black">
            {isLoading && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
              </div>
            )}

            {error && (
              <div className="absolute inset-0 flex items-center justify-center text-white">
                <div className="text-center">
                  <p className="text-lg mb-2">Failed to load video</p>
                  <p className="text-sm text-gray-400">{error}</p>
                </div>
              </div>
            )}

            <video
              ref={videoRef}
              src={`file://${videoPath}`}
              className="w-full h-full object-contain"
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onTimeUpdate={handleTimeUpdate}
              onLoadedMetadata={handleLoadedMetadata}
              onError={(e) => setError('Video format not supported or file not found')}
              onLoadStart={() => setIsLoading(true)}
              onCanPlay={() => setIsLoading(false)}
            />

            {/* Video Controls Overlay */}
            <AnimatePresence>
              {showControls && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/30"
                >
                  {/* Title */}
                  <div className="absolute top-4 left-4 right-16">
                    <h2 className="text-white text-lg font-semibold truncate">
                      {videoName}
                    </h2>
                  </div>

                  {/* Center Play Button */}
                  {!isPlaying && !isLoading && (
                    <button
                      onClick={togglePlayPause}
                      className="absolute inset-0 flex items-center justify-center"
                    >
                      <div className="p-4 bg-black/50 backdrop-blur-sm rounded-full border border-white/20 hover:bg-black/70 transition-colors">
                        <Play size={48} className="text-white ml-1" />
                      </div>
                    </button>
                  )}

                  {/* Bottom Controls */}
                  <div className="absolute bottom-0 left-0 right-0 p-4">
                    {/* Progress Bar */}
                    <div
                      className="w-full h-2 bg-white/20 rounded-full cursor-pointer mb-4 group"
                      onClick={handleSeek}
                    >
                      <div
                        className="h-full bg-blue-500 rounded-full relative group-hover:bg-blue-400 transition-colors"
                        style={{ width: `${(currentTime / duration) * 100}%` }}
                      >
                        <div className="absolute right-0 top-1/2 transform translate-x-1/2 -translate-y-1/2 w-4 h-4 bg-blue-500 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"></div>
                      </div>
                    </div>

                    {/* Control Buttons */}
                    <div className="flex items-center justify-between text-white">
                      <div className="flex items-center space-x-4">
                        <button
                          onClick={togglePlayPause}
                          className="p-2 hover:bg-white/20 rounded-full transition-colors"
                        >
                          {isPlaying ? <Pause size={24} /> : <Play size={24} />}
                        </button>
                        
                        <button
                          onClick={seekBackward}
                          className="p-2 hover:bg-white/20 rounded-full transition-colors"
                        >
                          <SkipBack size={20} />
                        </button>
                        
                        <button
                          onClick={seekForward}
                          className="p-2 hover:bg-white/20 rounded-full transition-colors"
                        >
                          <SkipForward size={20} />
                        </button>

                        <div className="flex items-center space-x-2">
                          <button
                            onClick={toggleMute}
                            className="p-2 hover:bg-white/20 rounded-full transition-colors"
                          >
                            {isMuted || volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
                          </button>
                          <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.1"
                            value={isMuted ? 0 : volume}
                            onChange={(e) => adjustVolume(parseFloat(e.target.value) - volume)}
                            className="w-20 h-1 bg-white/20 rounded-lg appearance-none cursor-pointer"
                          />
                        </div>
                      </div>

                      <div className="flex items-center space-x-4">
                        <span className="text-sm">
                          {formatTime(currentTime)} / {formatTime(duration)}
                        </span>
                        
                        <button
                          onClick={toggleFullscreen}
                          className="p-2 hover:bg-white/20 rounded-full transition-colors"
                        >
                          <Maximize size={20} />
                        </button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Segment Navigation Panel */}
          {segments && segments.length > 0 && !isFullscreen && (
            <div className="max-h-80 overflow-y-auto bg-black/10 backdrop-blur-sm border-t border-white/10">
              <div className="p-4">
                <h3 className="text-white text-lg font-semibold mb-4">
                  Matching Segments ({segments.length})
                </h3>
                <div className="space-y-2">
                  {segments.map((segment) => (
                    <button
                      key={segment.id}
                      onClick={() => seekToTimestamp(segment.startTime)}
                      className="w-full text-left p-3 bg-white/5 hover:bg-white/10 rounded-lg border border-white/10 transition-colors group"
                    >
                      <div className="flex items-start space-x-3">
                        <div className="flex-shrink-0">
                          <span className="inline-block px-2 py-1 bg-blue-500/20 text-blue-300 text-xs rounded font-mono">
                            {formatTime(segment.startTime)}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-white text-sm line-clamp-2 group-hover:text-blue-200 transition-colors">
                            {segment.transcription || segment.caption || segment.reconstructedScene}
                          </p>
                          {segment.relevanceScore && (
                            <div className="mt-1">
                              <div className="w-full bg-white/10 rounded-full h-1">
                                <div
                                  className="bg-blue-500 h-1 rounded-full"
                                  style={{ width: `${segment.relevanceScore * 100}%` }}
                                ></div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
