import { useState, useEffect } from 'react';
import { Icon } from './Icons';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface AIServiceConfig {
  transcription: {
    baseUrl: string;
    model: string;
    enabled: boolean;
  };
  captioning: {
    baseUrl: string;
    model: string;
    enabled: boolean;
  };
  sceneReconstruction: {
    baseUrl: string;
    model: string;
    enabled: boolean;
  };
}

const DEFAULT_CONFIG: AIServiceConfig = {
  transcription: {
    baseUrl: 'http://localhost:9001/asr',
    model: 'whisper-base.en',
    enabled: true
  },
  captioning: {
    baseUrl: 'http://localhost:11434',
    model: 'moondream:v2',
    enabled: true
  },
  sceneReconstruction: {
    baseUrl: 'http://localhost:11434',
    model: 'llama3.2:3b',
    enabled: true
  }
};

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [config, setConfig] = useState<AIServiceConfig>(DEFAULT_CONFIG);
  const [hasChanges, setHasChanges] = useState(false);

  // Load config on mount
  useEffect(() => {
    if (isOpen) {
      loadConfig();
    }
  }, [isOpen]);

  const loadConfig = async () => {
    try {
      // @ts-ignore - exposed by preload
      const savedConfig = await window.ipcRenderer?.invoke('config:get');
      if (savedConfig?.aiServices) {
        console.log('[SETTINGS] Loaded config from backend:', savedConfig.aiServices);
        setConfig(savedConfig.aiServices);
      } else {
        console.log('[SETTINGS] No saved config, using defaults');
        setConfig(DEFAULT_CONFIG);
      }
    } catch (error) {
      console.warn('[SETTINGS] Failed to load config, using defaults:', error);
      setConfig(DEFAULT_CONFIG);
    }
  };

  const saveConfig = async () => {
    try {
      // @ts-ignore - exposed by preload
      const result = await window.ipcRenderer?.invoke('config:set', { aiServices: config });
      if (result?.success) {
        setHasChanges(false);
        console.log('[SETTINGS] ✅ Settings saved successfully to backend config');
        alert('Settings saved successfully! Changes will take effect immediately.');
      }
    } catch (error) {
      console.error('[SETTINGS] ❌ Failed to save config:', error);
      alert('Failed to save settings. Please try again.');
    }
  };

  const updateService = (service: keyof AIServiceConfig, field: string, value: string | boolean) => {
    setConfig(prev => ({
      ...prev,
      [service]: {
        ...prev[service],
        [field]: value
      }
    }));
    setHasChanges(true);
  };

  const testConnection = async (service: keyof AIServiceConfig) => {
    const serviceConfig = config[service];
    try {
      console.log(`Testing connection to ${service}: ${serviceConfig.baseUrl}`);
      // Simple health check - try to reach the base URL
      const response = await fetch(`${serviceConfig.baseUrl}/health`, { 
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });
      
      if (response.ok) {
        console.log(`[SETTINGS] ${service} service is reachable`);
      } else {
        console.warn(`[SETTINGS] ${service} service responded with status: ${response.status}`);
      }
    } catch (error) {
      console.error(`[SETTINGS] Failed to connect to ${service} service:`, error instanceof Error ? error.message : 'Unknown error');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-neutral-900 border border-neutral-700 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-hidden mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-neutral-700">
          <h2 className="text-xl font-semibold text-white">Settings</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-neutral-800 rounded-lg transition-colors"
          >
            <Icon.Close className="w-5 h-5 text-neutral-400" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)]">
          <div className="space-y-8">
            
            {/* AI Services Configuration */}
            <div>
              <h3 className="text-lg font-medium text-white mb-4">AI Services Configuration</h3>
              <p className="text-sm text-neutral-400 mb-6">
                Configure the base URLs and models for AI services. You can point these to local instances, 
                vLLM servers, LiteLLM proxies, or other compatible endpoints.
              </p>

              <div className="space-y-6">
                {/* Transcription Service */}
                <div className="bg-neutral-800 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="font-medium text-white">Transcription Service</h4>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => testConnection('transcription')}
                        className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
                      >
                        Test
                      </button>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={config.transcription.enabled}
                          onChange={(e) => updateService('transcription', 'enabled', e.target.checked)}
                          className="rounded"
                        />
                        <span className="text-sm text-neutral-300">Enabled</span>
                      </label>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm text-neutral-300 mb-1">Base URL</label>
                      <input
                        type="url"
                        value={config.transcription.baseUrl}
                        onChange={(e) => updateService('transcription', 'baseUrl', e.target.value)}
                        placeholder="http://localhost:9001"
                        className="w-full px-3 py-2 bg-neutral-700 border border-neutral-600 rounded text-white placeholder-neutral-400 focus:border-blue-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-neutral-300 mb-1">Model</label>
                      <input
                        type="text"
                        value={config.transcription.model}
                        onChange={(e) => updateService('transcription', 'model', e.target.value)}
                        placeholder="whisper-1"
                        className="w-full px-3 py-2 bg-neutral-700 border border-neutral-600 rounded text-white placeholder-neutral-400 focus:border-blue-500 focus:outline-none"
                      />
                    </div>
                  </div>
                </div>

                {/* Captioning Service */}
                <div className="bg-neutral-800 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="font-medium text-white">Captioning Service</h4>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => testConnection('captioning')}
                        className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
                      >
                        Test
                      </button>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={config.captioning.enabled}
                          onChange={(e) => updateService('captioning', 'enabled', e.target.checked)}
                          className="rounded"
                        />
                        <span className="text-sm text-neutral-300">Enabled</span>
                      </label>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm text-neutral-300 mb-1">Base URL</label>
                      <input
                        type="url"
                        value={config.captioning.baseUrl}
                        onChange={(e) => updateService('captioning', 'baseUrl', e.target.value)}
                        placeholder="http://localhost:11434"
                        className="w-full px-3 py-2 bg-neutral-700 border border-neutral-600 rounded text-white placeholder-neutral-400 focus:border-blue-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-neutral-300 mb-1">Model</label>
                      <input
                        type="text"
                        value={config.captioning.model}
                        onChange={(e) => updateService('captioning', 'model', e.target.value)}
                        placeholder="llava:latest"
                        className="w-full px-3 py-2 bg-neutral-700 border border-neutral-600 rounded text-white placeholder-neutral-400 focus:border-blue-500 focus:outline-none"
                      />
                    </div>
                  </div>
                </div>

                {/* Scene Reconstruction Service */}
                <div className="bg-neutral-800 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="font-medium text-white">Scene Reconstruction Service</h4>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => testConnection('sceneReconstruction')}
                        className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
                      >
                        Test
                      </button>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={config.sceneReconstruction.enabled}
                          onChange={(e) => updateService('sceneReconstruction', 'enabled', e.target.checked)}
                          className="rounded"
                        />
                        <span className="text-sm text-neutral-300">Enabled</span>
                      </label>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm text-neutral-300 mb-1">Base URL</label>
                      <input
                        type="url"
                        value={config.sceneReconstruction.baseUrl}
                        onChange={(e) => updateService('sceneReconstruction', 'baseUrl', e.target.value)}
                        placeholder="http://localhost:9001"
                        className="w-full px-3 py-2 bg-neutral-700 border border-neutral-600 rounded text-white placeholder-neutral-400 focus:border-blue-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-neutral-300 mb-1">Model</label>
                      <input
                        type="text"
                        value={config.sceneReconstruction.model}
                        onChange={(e) => updateService('sceneReconstruction', 'model', e.target.value)}
                        placeholder="tinyllama:latest"
                        className="w-full px-3 py-2 bg-neutral-700 border border-neutral-600 rounded text-white placeholder-neutral-400 focus:border-blue-500 focus:outline-none"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Common Endpoints Info */}
            <div className="bg-neutral-800/50 rounded-lg p-4">
              <h4 className="font-medium text-white mb-2">Common Endpoints</h4>
              <div className="text-sm text-neutral-400 space-y-1">
                <div><strong>Ollama:</strong> http://localhost:11434</div>
                <div><strong>vLLM:</strong> http://localhost:8000</div>
                <div><strong>LiteLLM:</strong> http://localhost:4000</div>
                <div><strong>OpenAI API:</strong> https://api.openai.com/v1</div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-neutral-700">
          <div className="text-sm text-neutral-400">
            {hasChanges && '● Unsaved changes'}
          </div>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-neutral-300 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={saveConfig}
              disabled={!hasChanges}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-neutral-700 disabled:text-neutral-400 text-white rounded transition-colors"
            >
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
