import React, { useState } from 'react';

// Icon components
const Icon = {
  Close: ({ className }: { className?: string }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  ),
  Folder: ({ className }: { className?: string }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-5l-2-2H5a2 2 0 00-2 2z" />
    </svg>
  ),
  Video: ({ className }: { className?: string }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  ),
  Play: ({ className }: { className?: string }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1m4 0h1m-6 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
};

interface VideoSelectionProps {
  onVideoAdded?: () => void;
}

export const VideoSelection: React.FC<VideoSelectionProps> = ({ onVideoAdded }) => {
  const [formData, setFormData] = useState({
    name: '',
    path: '',
    type: 'file' as 'file' | 'directory'
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      if (formData.type === 'file') {
        // Process single video file
        const result = await window.videoAPI.processVideo(formData.path);
        if (result.success) {
          setSuccess(`Video "${formData.name}" processed successfully!`);
          setFormData({ name: '', path: '', type: 'file' });
          onVideoAdded?.();
        } else {
          setError(result.error || 'Failed to process video');
        }
      } else {
        // Add video directory as source
        const config = {
          recursive: true,
          videoOnly: true
        };

        const result = await window.mediaAPI.addSource(
          formData.name,
          'local',
          formData.path,
          config
        );

        if (result.success) {
          setSuccess(`Video directory "${formData.name}" added successfully!`);
          setFormData({ name: '', path: '', type: 'file' });
          onVideoAdded?.();
        } else {
          setError(result.error || 'Failed to add video directory');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handlePathSelect = async () => {
    try {
      if (formData.type === 'file') {
        // Pick a single video/audio file
        const result = await window.videoAPI.selectVideoFile();
        if (!result.canceled && result.path) {
          setFormData(prev => ({
            ...prev,
            path: result.path!,
            name: prev.name || result.path!.split('/').pop() || 'Video'
          }));
        }
      } else {
        // Pick a directory containing videos
        const result = await window.mediaAPI.selectDirectory();
        if (!result.canceled && result.path) {
          setFormData(prev => ({
            ...prev,
            path: result.path!,
            name: prev.name || result.path!.split('/').pop() || 'Videos'
          }));
        }
      }
    } catch (err) {
      console.error('Error selecting path:', err);
      setError('Failed to select path');
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
        <div className="flex items-center gap-3 mb-6">
          <Icon.Video className="w-6 h-6 text-blue-400" />
          <h2 className="text-xl font-semibold">Add Videos for Processing</h2>
        </div>

        <div className="mb-6 p-4 bg-neutral-800 rounded-lg">
          <p className="text-sm text-neutral-300 mb-2">
            Add videos to your media library for AI-powered search and analysis:
          </p>
          <ul className="text-xs text-neutral-400 space-y-1">
            <li>• For single videos: manually enter the full file path</li>
            <li>• For video directories: use Browse to select folder containing videos</li>
            <li>• Processed videos appear in your unified media search</li>
            <li>• Supports MP4, MOV, MKV, WebM, and AVI formats</li>
          </ul>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">
              Selection Type *
            </label>
            <div className="space-y-2">
              <label className="flex items-center p-3 border border-neutral-700 rounded-lg hover:bg-neutral-800/50 cursor-pointer">
                <input
                  type="radio"
                  name="type"
                  value="file"
                  checked={formData.type === 'file'}
                  onChange={handleInputChange}
                  className="mr-3"
                />
                <div className="flex items-center gap-2">
                  <Icon.Video className="w-5 h-5 text-neutral-400" />
                  <div>
                    <div className="font-medium">Single Video File</div>
                    <div className="text-sm text-neutral-400">Process one video immediately</div>
                  </div>
                </div>
              </label>
              
              <label className="flex items-center p-3 border border-neutral-700 rounded-lg hover:bg-neutral-800/50 cursor-pointer">
                <input
                  type="radio"
                  name="type"
                  value="directory"
                  checked={formData.type === 'directory'}
                  onChange={handleInputChange}
                  className="mr-3"
                />
                <div className="flex items-center gap-2">
                  <Icon.Folder className="w-5 h-5 text-neutral-400" />
                  <div>
                    <div className="font-medium">Video Directory</div>
                    <div className="text-sm text-neutral-400">Add folder containing videos</div>
                  </div>
                </div>
              </label>
            </div>
          </div>

          <div>
            <label htmlFor="name" className="block text-sm font-medium mb-2">
              Name *
            </label>
            <input
              type="text"
              id="name"
              name="name"
              value={formData.name}
              onChange={handleInputChange}
              placeholder={formData.type === 'file' ? 'My Video' : 'My Video Collection'}
              className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-neutral-200 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
              required
            />
          </div>

          <div>
            <label htmlFor="path" className="block text-sm font-medium mb-2">
              {formData.type === 'file' ? 'Video File' : 'Directory Path'} *
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                id="path"
                name="path"
                value={formData.path}
                onChange={handleInputChange}
                placeholder={formData.type === 'file' ? '/Users/john/video.mp4' : '/Users/john/Videos'}
                className="flex-1 px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-neutral-200 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                required
              />
              <button
                type="button"
                onClick={handlePathSelect}
                className="px-3 py-2 border border-neutral-700 rounded-lg hover:bg-neutral-800 flex items-center gap-2"
                title={formData.type === 'file' ? 'Browse for video/audio file' : 'Browse for directory'}
              >
                {formData.type === 'file' ? <Icon.Video className="w-4 h-4" /> : <Icon.Folder className="w-4 h-4" />}
                Browse
              </button>
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-900/50 border border-red-800 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          {success && (
            <div className="p-3 bg-green-900/50 border border-green-800 rounded-lg text-green-400 text-sm">
              {success}
            </div>
          )}

          <div className="pt-4">
            <button 
              type="submit" 
              disabled={loading} 
              className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  {formData.type === 'file' ? 'Processing...' : 'Adding...'}
                </>
              ) : (
                <>
                  <Icon.Play className="w-4 h-4" />
                  {formData.type === 'file' ? 'Process Video' : 'Add Video Directory'}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default VideoSelection;
