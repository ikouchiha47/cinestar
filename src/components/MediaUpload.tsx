import React, { useState } from 'react';

// Icon components
const Icon = {
  Video: ({ className }: { className?: string }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  ),
  Image: ({ className }: { className?: string }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  ),
  Music: ({ className }: { className?: string }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
    </svg>
  ),
  Upload: ({ className }: { className?: string }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
    </svg>
  ),
  Close: ({ className }: { className?: string }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
};

interface MediaUploadProps {
  onMediaAdded?: () => void;
}

export const MediaUpload: React.FC<MediaUploadProps> = ({ onMediaAdded }) => {
  const [selectedType, setSelectedType] = useState<'video' | 'image' | 'audio' | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleFileSelect = async (type: 'video' | 'image' | 'audio') => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    setSelectedType(type);

    try {
      let result: any;
      
      if (type === 'video') {
        // Use video API for video files
        result = await window.videoAPI.selectVideoFile();
        if (!result.canceled && result.path) {
          console.log(`[MEDIA-UPLOAD] Processing video: ${result.path}`);
          const uploadResult = await window.videoAPI.processVideo(result.path);
          
          if (uploadResult.success) {
            setSuccess(`Video uploaded successfully! Processing with enhanced scene detection...`);
            onMediaAdded?.();
          } else {
            setError(uploadResult.error || 'Failed to upload video');
          }
        }
      } else if (type === 'image') {
        // Use image file selector
        result = await window.videoAPI.selectImageFile();
        if (!result.canceled && result.path) {
          console.log(`[MEDIA-UPLOAD] Processing image: ${result.path}`);
          
          // Add image using addItemForFile (designed for single files)
          const uploadResult = await window.mediaAPI.addItemForFile(
            'single_files', // Use a special sourceId for single file uploads
            result.path,
            `Single image file: ${result.path.split('/').pop()}`,
            { uploadType: 'single_image', originalPath: result.path }
          );
          
          if (uploadResult.success) {
            setSuccess(`Image uploaded successfully! It will be processed and indexed.`);
            onMediaAdded?.();
          } else {
            setError(uploadResult.error || 'Failed to upload image');
          }
        }
      } else if (type === 'audio') {
        // Use audio file selector
        result = await window.videoAPI.selectAudioFile();
        if (!result.canceled && result.path) {
          console.log(`[MEDIA-UPLOAD] Processing audio: ${result.path}`);
          
          // Add audio using addItemForFile (designed for single files)
          const uploadResult = await window.mediaAPI.addItemForFile(
            'single_files', // Use a special sourceId for single file uploads
            result.path,
            `Single audio file: ${result.path.split('/').pop()}`,
            { uploadType: 'single_audio', originalPath: result.path }
          );
          
          if (uploadResult.success) {
            setSuccess(`Audio uploaded successfully! It will be processed and indexed.`);
            onMediaAdded?.();
          } else {
            setError(uploadResult.error || 'Failed to upload audio');
          }
        }
      }
    } catch (err) {
      console.error(`[MEDIA-UPLOAD] Error uploading ${type}:`, err);
      setError(err instanceof Error ? err.message : `Failed to upload ${type}`);
    } finally {
      setLoading(false);
      setSelectedType(null);
    }
  };

  const mediaTypes = [
    {
      type: 'video' as const,
      icon: Icon.Video,
      title: 'Single Video',
      description: 'Upload and process a video file with enhanced scene detection',
      color: 'from-blue-500 to-purple-600'
    },
    {
      type: 'image' as const,
      icon: Icon.Image,
      title: 'Single Image',
      description: 'Upload an image for visual search and analysis',
      color: 'from-green-500 to-teal-600'
    },
    {
      type: 'audio' as const,
      icon: Icon.Music,
      title: 'Single Audio',
      description: 'Upload an audio file for transcription and search',
      color: 'from-orange-500 to-red-600'
    }
  ];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-xl font-semibold mb-2">Upload Media</h2>
        <p className="text-neutral-400 text-sm">
          Choose a media type to upload. For bulk uploads, use "Connect a place" instead.
        </p>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-900/50 border border-red-800 rounded-lg text-red-400 text-sm">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-4 p-3 bg-green-900/50 border border-green-800 rounded-lg text-green-400 text-sm">
          {success}
        </div>
      )}

      <div className="grid gap-4">
        {mediaTypes.map(({ type, icon: IconComponent, title, description, color }) => (
          <button
            key={type}
            onClick={() => handleFileSelect(type)}
            disabled={loading}
            className={`
              group relative overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900/50 p-4 text-left 
              hover:border-neutral-700 hover:bg-neutral-800/50 transition-all duration-200
              disabled:opacity-50 disabled:cursor-not-allowed
              ${selectedType === type ? 'border-blue-600 bg-blue-900/20' : ''}
            `}
          >
            <div className="flex items-start gap-4">
              <div className={`
                flex-shrink-0 w-12 h-12 rounded-lg bg-gradient-to-br ${color} 
                flex items-center justify-center text-white
                ${selectedType === type ? 'animate-pulse' : ''}
              `}>
                {loading && selectedType === type ? (
                  <div className="animate-spin rounded-full h-6 w-6 border-2 border-white border-t-transparent" />
                ) : (
                  <IconComponent className="w-6 h-6" />
                )}
              </div>
              
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-medium text-neutral-200">{title}</h3>
                  <Icon.Upload className="w-4 h-4 text-neutral-500 group-hover:text-neutral-400 transition-colors" />
                </div>
                <p className="text-sm text-neutral-400 leading-relaxed">
                  {description}
                </p>
              </div>
            </div>
            
            {/* Subtle gradient overlay on hover */}
            <div className={`
              absolute inset-0 bg-gradient-to-r ${color} opacity-0 group-hover:opacity-5 transition-opacity duration-200
            `} />
          </button>
        ))}
      </div>

      <div className="mt-6 p-4 bg-neutral-900/30 border border-neutral-800 rounded-lg">
        <div className="flex items-start gap-3">
          <div className="w-5 h-5 rounded-full bg-blue-600/20 flex items-center justify-center flex-shrink-0 mt-0.5">
            <div className="w-2 h-2 rounded-full bg-blue-400" />
          </div>
          <div>
            <p className="text-sm text-neutral-300 font-medium mb-1">
              Need to upload folders or connect cloud storage?
            </p>
            <p className="text-xs text-neutral-500">
              Use "Connect a place" to add local folders, Google Drive, or other sources for bulk processing.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <button
          onClick={async () => {
            try {
              setLoading(true);
              setError(null);
              const result = await (window.mediaAPI as any).indexUnprocessedImages?.();
              if (result?.success) {
                if (result.unindexedCount > 0) {
                  setSuccess(`Found ${result.unindexedCount} unindexed images. Started background processing.`);
                } else {
                  setSuccess('All images are already indexed!');
                }
              } else {
                setError(result?.error || 'Failed to check unindexed images');
              }
            } catch (err) {
              setError('Failed to check unindexed images');
            } finally {
              setLoading(false);
            }
          }}
          disabled={loading}
          className="w-full px-4 py-2 text-sm bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded-lg text-neutral-300 transition-colors disabled:opacity-50"
        >
          {loading ? 'Checking...' : 'Index Previously Failed Images'}
        </button>

        <button
          onClick={async () => {
            try {
              setLoading(true);
              setError(null);
              const result = await (window.mediaAPI as any).startCleanupJob?.();
              if (result?.success) {
                setSuccess('Started background cleanup job. Check logs for progress.');
              } else {
                setError(result?.error || 'Failed to start cleanup job');
              }
            } catch (err) {
              setError('Failed to start cleanup job');
            } finally {
              setLoading(false);
            }
          }}
          disabled={loading}
          className="w-full px-4 py-2 text-sm bg-orange-800 hover:bg-orange-700 border border-orange-700 rounded-lg text-orange-300 transition-colors disabled:opacity-50"
        >
          {loading ? 'Starting...' : 'Clean Up Orphaned Files'}
        </button>
      </div>
    </div>
  );
};

export default MediaUpload;
