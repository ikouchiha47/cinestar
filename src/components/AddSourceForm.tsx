import React, { useState } from 'react';

interface AddSourceFormProps {
  onSourceAdded: () => void;
  onCancel: () => void;
}

export const AddSourceForm: React.FC<AddSourceFormProps> = ({ onSourceAdded, onCancel }) => {
  const [formData, setFormData] = useState({
    name: '',
    type: 'local' as 'local' | 'remote',
    path: '',
    recursive: true,
    username: '',
    password: '',
    customHeaders: ''
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

      if (formData.type === 'remote') {
        if (formData.username && formData.password) {
          config.auth = {
            username: formData.username,
            password: formData.password
          };
        }

        if (formData.customHeaders) {
          try {
            config.headers = JSON.parse(formData.customHeaders);
          } catch (err) {
            setError('Invalid JSON format for custom headers');
            setLoading(false);
            return;
          }
        }
      }

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
    <div className="add-source-form">
      <div className="form-header">
        <h2>Add Media Source</h2>
        <button onClick={onCancel} className="close-btn">×</button>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="name">Source Name *</label>
          <input
            type="text"
            id="name"
            name="name"
            value={formData.name}
            onChange={handleInputChange}
            placeholder="My Photos"
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="type">Source Type *</label>
          <select
            id="type"
            name="type"
            value={formData.type}
            onChange={handleInputChange}
            required
          >
            <option value="local">Local Folder</option>
            <option value="remote">Remote URL</option>
          </select>
        </div>

        <div className="form-group">
          <label htmlFor="path">
            {formData.type === 'local' ? 'Folder Path *' : 'Remote URL *'}
          </label>
          <div className="path-input-group">
            <input
              type="text"
              id="path"
              name="path"
              value={formData.path}
              onChange={handleInputChange}
              placeholder={
                formData.type === 'local' 
                  ? '/Users/john/Pictures' 
                  : 'https://example.com/gallery/'
              }
              required
            />
            {formData.type === 'local' && (
              <button
                type="button"
                onClick={handlePathSelect}
                className="browse-btn"
                title="Browse for folder"
              >
                📁
              </button>
            )}
          </div>
        </div>

        <div className="form-group checkbox-group">
          <label>
            <input
              type="checkbox"
              name="recursive"
              checked={formData.recursive}
              onChange={handleInputChange}
            />
            Scan subdirectories recursively
          </label>
        </div>

        {formData.type === 'remote' && (
          <>
            <div className="form-section">
              <h3>Authentication (Optional)</h3>
              <div className="form-group">
                <label htmlFor="username">Username</label>
                <input
                  type="text"
                  id="username"
                  name="username"
                  value={formData.username}
                  onChange={handleInputChange}
                  placeholder="username"
                />
              </div>
              <div className="form-group">
                <label htmlFor="password">Password</label>
                <input
                  type="password"
                  id="password"
                  name="password"
                  value={formData.password}
                  onChange={handleInputChange}
                  placeholder="password"
                />
              </div>
            </div>

            <div className="form-section">
              <h3>Custom Headers (Optional)</h3>
              <div className="form-group">
                <label htmlFor="customHeaders">Headers (JSON format)</label>
                <textarea
                  id="customHeaders"
                  name="customHeaders"
                  value={formData.customHeaders}
                  onChange={handleInputChange}
                  placeholder='{"User-Agent": "Driller/1.0", "Authorization": "Bearer token"}'
                  rows={3}
                />
              </div>
            </div>
          </>
        )}

        {error && (
          <div className="error-message">
            ❌ {error}
          </div>
        )}

        <div className="form-actions">
          <button type="button" onClick={onCancel} className="cancel-btn">
            Cancel
          </button>
          <button type="submit" disabled={loading} className="submit-btn">
            {loading ? 'Adding...' : 'Add Source'}
          </button>
        </div>
      </form>

    </div>
  );
};
