import { useState, useEffect } from 'react';
import { Icon } from './Icons';
import { ProviderSettingsV2 } from '../../ProviderSettingsV2';
import { llmConfigService } from '../../../services/llm-config-service';
interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export interface UnifiedConfig {
  version: number;
  onboarding: {
    complete: boolean;
    firstLaunchDate: string | null;
  };
  features: {
    images: boolean;
    videos: boolean;
    audio: boolean;
  };
  aiServices: {
    transcription: {
      baseUrl: string;
      model: string;
      enabled: boolean;
      modelDownloaded: boolean;
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
  };
  lastModified: string;
}

const DEFAULT_CONFIG: UnifiedConfig = {
  version: 1,
  onboarding: {
    complete: false,
    firstLaunchDate: null
  },
  features: {
    images: true,
    videos: false,
    audio: false
  },
  aiServices: {
    transcription: {
      baseUrl: 'http://localhost:9001/asr',
      model: 'whisper-base.en',
      enabled: false,
      modelDownloaded: false
    },
    captioning: {
      baseUrl: 'http://localhost:11434',
      model: 'moondream:v2',
      enabled: true
    },
    sceneReconstruction: {
      baseUrl: 'http://localhost:11434',
      model: 'qwen3:4b',
      enabled: true
    }
  },
  lastModified: new Date().toISOString()
};

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [config, setConfig] = useState<UnifiedConfig>(DEFAULT_CONFIG);
  const [hasChanges, setHasChanges] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState<'idle' | 'downloading' | 'success' | 'error'>('idle');
  const [activeTab, setActiveTab] = useState<'general' | 'llm'>('general');

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
      if (savedConfig) {
        console.log('[SETTINGS] Loaded unified config from backend:', savedConfig);
        setConfig(savedConfig);
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
      const result = await window.ipcRenderer?.invoke('config:set', config);
      if (result?.success) {
        setHasChanges(false);
        console.log('[SETTINGS] ✅ Settings saved successfully to unified config');
        onClose(); // Close modal after successful save
      }
    } catch (error) {
      console.error('[SETTINGS] ❌ Failed to save config:', error);
      alert('Failed to save settings. Please try again.');
    }
  };

  const updateService = (service: keyof UnifiedConfig['aiServices'], field: string, value: string | boolean) => {
    setConfig(prev => ({
      ...prev,
      aiServices: {
        ...prev.aiServices,
        [service]: {
          ...prev.aiServices[service],
          [field]: value
        }
      }
    }));
    setHasChanges(true);
  };
  
  const updateFeature = async (feature: keyof UnifiedConfig['features'], value: boolean) => {
    // Create updated config with feature changes
    const updatedConfig = {
      ...config,
      features: {
        ...config.features,
        [feature]: value
      }
    };
    
    setConfig(updatedConfig);
    setHasChanges(true);
    
    // If enabling video/audio and model not downloaded, trigger download
    if ((feature === 'videos' || feature === 'audio') && value && !config.aiServices.transcription.modelDownloaded) {
      console.log('[SETTINGS] Media processing enabled, checking Whisper model...');
      
      // Show download notification
      if (confirm('Whisper model (~140MB) needs to be downloaded for audio transcription. Download now?')) {
        try {
          console.log('[SETTINGS] Starting Whisper model download...');
          // @ts-ignore
          const result = await window.electronAPI?.downloadWhisperModel({ modelName: 'base.en' });
          
          if (result?.success) {
            console.log('[SETTINGS] ✅ Whisper model downloaded successfully');
            
            // Update config with BOTH feature changes AND modelDownloaded
            const finalConfig = {
              ...updatedConfig,
              aiServices: {
                ...updatedConfig.aiServices,
                transcription: {
                  ...updatedConfig.aiServices.transcription,
                  modelDownloaded: true
                }
              }
            };
            
            setConfig(finalConfig);
            
            // Save to disk immediately with ALL changes
            // @ts-ignore
            await window.ipcRenderer?.invoke('config:set', finalConfig);
            console.log('[SETTINGS] ✅ Config saved with features enabled AND modelDownloaded=true');
            console.log('[SETTINGS] 🎉 Whisper model downloaded successfully! You can now process video/audio files.');
          } else {
            console.error('[SETTINGS] ❌ Whisper model download failed:', result?.error);
            console.log(`[SETTINGS] Failed to download Whisper model: ${result?.error || 'Unknown error'}`);
          }
        } catch (error) {
          console.error('[SETTINGS] Error downloading Whisper model:', error);
          alert('Failed to download Whisper model. Please try again.');
        }
      } else {
        // User cancelled download, save the feature changes anyway
        // @ts-ignore
        await window.ipcRenderer?.invoke('config:set', updatedConfig);
        console.log('[SETTINGS] Features updated without model download');
      }
    } else {
      // No download needed, just save feature changes
      // @ts-ignore
      await window.ipcRenderer?.invoke('config:set', updatedConfig);
      console.log('[SETTINGS] Features updated');
    }
  };

  const testConnection = async (service: keyof UnifiedConfig['aiServices']) => {
    const serviceConfig = config.aiServices[service];
    
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

        {/* Tabs */}
        <div className="flex border-b border-neutral-700">
          <button
            onClick={() => setActiveTab('general')}
            className={`px-6 py-3 font-medium transition-colors ${
              activeTab === 'general'
                ? 'text-white border-b-2 border-blue-500'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            General
          </button>
          <button
            onClick={() => setActiveTab('llm')}
            className={`px-6 py-3 font-medium transition-colors ${
              activeTab === 'llm'
                ? 'text-white border-b-2 border-blue-500'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            LLM Providers
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)]">
          {activeTab === 'general' && (
          <div className="space-y-8">
            
            {/* AI Services Configuration */}
            <div>
              <h3 className="text-lg font-medium text-white mb-4">AI Services Configuration</h3>
              <p className="text-sm text-neutral-400 mb-4">
                Configure the base URLs and models for AI services. You can point these to local instances, 
                vLLM servers, LiteLLM proxies, or other compatible endpoints.
              </p>
              
              <div className="space-y-6">
                {/* Media Processing (Whisper Model) */}
                <div className="bg-neutral-800 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h4 className="font-medium text-white">Media Processing (Video & Audio)</h4>
                      <p className="text-xs text-neutral-400 mt-1">
                        Enable video and audio processing with local Whisper model for transcription
                      </p>
                    </div>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={config.features.videos || config.features.audio}
                        onChange={async (e) => {
                          // Update both features together in one config change
                          const updatedConfig = {
                            ...config,
                            features: {
                              ...config.features,
                              videos: e.target.checked,
                              audio: e.target.checked
                            }
                          };
                          
                          setConfig(updatedConfig);
                          setHasChanges(true);
                          
                          // If enabling and model not downloaded, trigger download
                          if (e.target.checked && !config.aiServices.transcription.modelDownloaded) {
                            console.log('[SETTINGS] Media processing enabled, starting Whisper model download...');
                            setDownloadStatus('downloading');
                            setIsDownloading(true);
                            
                            try {
                              // @ts-ignore
                              const result = await window.electronAPI?.downloadWhisperModel({ modelName: 'base.en' });
                              
                              if (result?.success) {
                                console.log('[SETTINGS] ✅ Whisper model downloaded successfully');
                                
                                const finalConfig = {
                                  ...updatedConfig,
                                  aiServices: {
                                    ...updatedConfig.aiServices,
                                    transcription: {
                                      ...updatedConfig.aiServices.transcription,
                                      modelDownloaded: true
                                    }
                                  }
                                };
                                
                                setConfig(finalConfig);
                                setDownloadStatus('success');
                                setIsDownloading(false);
                                
                                // Show success alert
                                alert('✅ Whisper model downloaded successfully! You can now upload and process video/audio files.');
                              } else {
                                console.error('[SETTINGS] ❌ Whisper model download failed:', result?.error);
                                setDownloadStatus('error');
                                setIsDownloading(false);
                                
                                // Show error alert
                                alert(`❌ Failed to download Whisper model: ${result?.error || 'Unknown error'}. Please try again.`);
                              }
                            } catch (error) {
                              console.error('[SETTINGS] Error downloading Whisper model:', error);
                              setDownloadStatus('error');
                              setIsDownloading(false);
                              alert('❌ Failed to download Whisper model. Please try again.');
                            }
                          }
                        }}
                        className="rounded"
                      />
                      <span className="text-sm text-neutral-300">Enabled</span>
                    </label>
                  </div>
                  
                  {downloadStatus === 'downloading' && (
                    <div className="mt-3 p-3 bg-blue-900/20 border border-blue-700/50 rounded">
                      <p className="text-xs text-blue-300">
                        ⏳ Downloading Whisper model (~140MB)... Please wait.
                      </p>
                    </div>
                  )}
                  
                  {downloadStatus === 'idle' && !(config.features.videos || config.features.audio) && (
                    <div className="mt-3 p-3 bg-blue-900/20 border border-blue-700/50 rounded">
                      <p className="text-xs text-blue-300">
                        💡 Enabling this will download the Whisper model (~140MB) for local audio transcription.
                        This enables video scene detection and audio file processing.
                      </p>
                    </div>
                  )}
                  
                  {downloadStatus !== 'downloading' && (config.features.videos || config.features.audio) && (
                    <div className="mt-3 p-3 bg-green-900/20 border border-green-700/50 rounded">
                      <p className="text-xs text-green-300">
                        ✅ Media processing is enabled. You can now upload and process video/audio files.
                      </p>
                    </div>
                  )}
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
                          checked={config.aiServices.captioning.enabled}
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
                        value={config.aiServices.captioning.baseUrl}
                        onChange={(e) => updateService('captioning', 'baseUrl', e.target.value)}
                        placeholder="http://localhost:11434"
                        className="w-full px-3 py-2 bg-neutral-700 border border-neutral-600 rounded text-white placeholder-neutral-400 focus:border-blue-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-neutral-300 mb-1">Model</label>
                      <input
                        type="text"
                        value={config.aiServices.captioning.model}
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
                          checked={config.aiServices.sceneReconstruction.enabled}
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
                        value={config.aiServices.sceneReconstruction.baseUrl}
                        onChange={(e) => updateService('sceneReconstruction', 'baseUrl', e.target.value)}
                        placeholder="http://localhost:9001"
                        className="w-full px-3 py-2 bg-neutral-700 border border-neutral-600 rounded text-white placeholder-neutral-400 focus:border-blue-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-neutral-300 mb-1">Model</label>
                      <input
                        type="text"
                        value={config.aiServices.sceneReconstruction.model}
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
          )}

          {activeTab === 'llm' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-medium text-white mb-2">LLM Provider Configuration</h3>
                <p className="text-sm text-neutral-400 mb-6">
                  Configure your language model providers for vision, text generation, embeddings, and transcription.
                  Choose between local (Ollama) for privacy or cloud providers (OpenAI, LiteLLM) for advanced capabilities.
                </p>
              </div>
              
              <ProviderSettingsV2
                onProviderChange={async (providerId: string) => {
                  console.log('[SETTINGS] Provider changed to:', providerId);
                  // Provider change is handled by llmConfigService internally
                }}
                onModelChange={async (task: string, modelId: string) => {
                  console.log('[SETTINGS] Model changed:', task, modelId);
                  // Model change is handled by llmConfigService internally
                }}
                onApiKeyChange={async (providerId: string, apiKey: string) => {
                  console.log('[SETTINGS] API key updated for:', providerId);
                  // API key change is handled by llmConfigService internally
                }}
              />
            </div>
          )}
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
