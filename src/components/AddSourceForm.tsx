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
};

interface AddSourceFormProps {
  onSourceAdded: () => void;
  onCancel: () => void;
}

export const AddSourceForm: React.FC<AddSourceFormProps> = ({ onSourceAdded, onCancel }) => {
  const [formData, setFormData] = useState({
    name: '',
    type: 'local' as 'local',
    path: '',
    recursive: true
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      // Build config object
      const config: Record<string, unknown> = {
        recursive: formData.recursive
      };

      const result = await window.mediaAPI.addSource(
        formData.name,
        formData.type,
        formData.path,
        config
      );

      if (result.success) {
        onSourceAdded();
      } else {
        setError(result.error || 'Failed to add source');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value
    }));
  };

  const handlePathSelect = async () => {
    if (formData.type === 'local') {
      try {
        const result = await window.mediaAPI.selectDirectory();
        if (!result.canceled && result.path) {
          setFormData(prev => ({ ...prev, path: result.path! }));
        }
      } catch (err) {
        console.error('Error selecting directory:', err);
      }
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold">Add Media Source</h2>
        <button 
          onClick={onCancel} 
          className="rounded-lg border border-neutral-700 p-2 hover:bg-neutral-800"
        >
          <Icon.Close className="w-4 h-4" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="name" className="block text-sm font-medium mb-2">
            Source Name *
          </label>
          <input
            type="text"
            id="name"
            name="name"
            value={formData.name}
            onChange={handleInputChange}
            placeholder="My Photos"
            className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-neutral-200 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-600 focus:border-transparent"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">
            Source Type *
          </label>
          <div className="space-y-2">
            <label className="flex items-center p-3 border border-neutral-700 rounded-lg hover:bg-neutral-800/50 cursor-pointer">
              <input
                type="radio"
                name="type"
                value="local"
                checked={formData.type === 'local'}
                onChange={handleInputChange}
                className="mr-3"
              />
              <div className="flex items-center gap-2">
                <Icon.Folder className="w-5 h-5 text-neutral-400" />
                <div>
                  <div className="font-medium">Local Folder</div>
                  <div className="text-sm text-neutral-400">Index files from your computer</div>
                </div>
              </div>
            </label>
            
            <label className="flex items-center p-3 border border-neutral-700 rounded-lg opacity-50 cursor-not-allowed">
              <input
                type="radio"
                name="type"
                value="s3"
                disabled
                className="mr-3"
              />
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 bg-neutral-600 rounded text-xs flex items-center justify-center">S3</div>
                <div>
                  <div className="font-medium">Amazon S3</div>
                  <div className="text-sm text-neutral-400">Coming soon</div>
                </div>
              </div>
            </label>
            
            <label className="flex items-center p-3 border border-neutral-700 rounded-lg opacity-50 cursor-not-allowed">
              <input
                type="radio"
                name="type"
                value="gdrive"
                disabled
                className="mr-3"
              />
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 bg-neutral-600 rounded text-xs flex items-center justify-center">GD</div>
                <div>
                  <div className="font-medium">Google Drive</div>
                  <div className="text-sm text-neutral-400">Coming soon</div>
                </div>
              </div>
            </label>
          </div>
        </div>

        <div>
          <label htmlFor="path" className="block text-sm font-medium mb-2">
            Folder Path *
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              id="path"
              name="path"
              value={formData.path}
              onChange={handleInputChange}
              placeholder="/Users/john/Pictures"
              className="flex-1 px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-neutral-200 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-600 focus:border-transparent"
              required
            />
            <button
              type="button"
              onClick={handlePathSelect}
              className="px-3 py-2 border border-neutral-700 rounded-lg hover:bg-neutral-800 flex items-center gap-2"
              title="Browse for folder"
            >
              <Icon.Folder className="w-4 h-4" />
              Browse
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="recursive"
            name="recursive"
            checked={formData.recursive}
            onChange={handleInputChange}
            className="rounded"
          />
          <label htmlFor="recursive" className="text-sm">
            Scan subdirectories recursively
          </label>
        </div>

        {error && (
          <div className="p-3 bg-red-900/50 border border-red-800 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}

        <div className="flex gap-3 pt-4">
          <button 
            type="button" 
            onClick={onCancel} 
            className="flex-1 px-4 py-2 border border-neutral-700 rounded-lg hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button 
            type="submit" 
            disabled={loading} 
            className="flex-1 px-4 py-2 bg-neutral-200 text-neutral-900 rounded-lg hover:bg-neutral-300 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Adding...' : 'Add Source'}
          </button>
        </div>
      </form>
    </div>
  );
};
