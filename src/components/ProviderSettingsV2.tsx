/**
 * Provider Settings V2 - Redesigned
 * 
 * Improvements:
 * - Provider dropdown instead of cards
 * - Privacy section at top
 * - Dark theme with less white
 * - Smooth transitions
 * - Flexible API key configuration for LiteLLM
 */

import React, { useState, useEffect } from 'react';
import { providerConfigManager } from '../core/llm/provider-config-manager';
import { ModelSelector } from './ModelSelector';
import type { LLMProvider, PrivacyMode } from '../core/llm/types';

interface ProviderSettingsV2Props {
  activeProviderId?: string;
  providers?: Record<string, LLMProvider>;
  onProviderChange?: (providerId: string) => void;
  onModelChange?: (task: string, modelId: string) => void;
  onApiKeyChange?: (providerId: string, apiKey: string) => void;
}

interface ApiKeyConfig {
  name: string;
  value: string;
}

export const ProviderSettingsV2: React.FC<ProviderSettingsV2Props> = ({
  activeProviderId,
  providers = {},
  onProviderChange,
  onModelChange,
  onApiKeyChange,
}) => {
  const [selectedProviderId, setSelectedProviderId] = useState(activeProviderId || 'ollama');
  const [selectedModels, setSelectedModels] = useState<Record<string, string>>({});
  const [apiKeyConfigs, setApiKeyConfigs] = useState<ApiKeyConfig[]>([{ name: 'OPENAI_API_KEY', value: '' }]);
  const [apiSectionOpen, setApiSectionOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'vision' | 'text' | 'embedding' | 'transcription'>('vision');

  const availableConfigs = providerConfigManager.getAllConfigs();
  const currentConfig = providerConfigManager.getConfig(selectedProviderId);
  const currentProvider = providers[selectedProviderId];

  useEffect(() => {
    if (activeProviderId) {
      setSelectedProviderId(activeProviderId);
    }
  }, [activeProviderId]);

  useEffect(() => {
    // Initialize selected models with defaults
    if (currentConfig) {
      const defaults: Record<string, string> = {};
      for (const [task, modelId] of Object.entries(currentConfig.defaults)) {
        if (modelId) {
          defaults[task] = modelId;
        }
      }
      setSelectedModels(defaults);
    }
  }, [currentConfig]);

  const handleProviderSelect = (providerId: string) => {
    setSelectedProviderId(providerId);
    onProviderChange?.(providerId);
  };

  const handleModelSelect = (task: string, modelId: string) => {
    setSelectedModels(prev => ({ ...prev, [task]: modelId }));
    onModelChange?.(task, modelId);
  };

  const getPrivacyMode = (): PrivacyMode => {
    if (currentProvider) {
      return currentProvider.privacy;
    }
    return selectedProviderId === 'ollama' ? 'private' : 'cloud';
  };

  const privacyMode = getPrivacyMode();
  const isLocal = privacyMode === 'private';
  const availableTasks = Object.keys(currentConfig?.defaults || {}) as Array<'vision' | 'text' | 'embedding' | 'transcription'>;
  useEffect(() => {
    // Ensure activeTab is valid for current provider
    if (!availableTasks.includes(activeTab) && availableTasks.length > 0) {
      setActiveTab(availableTasks[0]);
    }
  }, [selectedProviderId, currentConfig]);

  return (
    <div className="space-y-6">
      {/* Privacy Indicator - TOP */}
      <div className={`p-4 rounded-xl border transition-all ${
        isLocal ? 'border-emerald-900 bg-neutral-900' : 'border-sky-900 bg-neutral-900'
      }`}>
        <div className="flex items-center gap-3">
          {isLocal ? (
            <svg className="w-6 h-6 text-emerald-300" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
            </svg>
          ) : (
            <svg className="w-6 h-6 text-sky-300" fill="currentColor" viewBox="0 0 20 20">
              <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" />
              <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" />
            </svg>
          )}
          <div className="flex-1">
            <div className={`font-semibold ${isLocal ? 'text-emerald-300' : 'text-sky-300'}`}>
              {isLocal ? '🔒 Private Mode' : '☁️ Cloud Mode'}
            </div>
            <div className="text-sm text-neutral-400 mt-0.5">
              {isLocal 
                ? 'All processing happens locally on your machine. Your data never leaves your device.'
                : 'Using cloud APIs. Your data is sent to external servers for processing.'}
            </div>
          </div>
        </div>
      </div>

      {/* Provider Dropdown */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-neutral-300">
          AI Provider
        </label>
        <select
          value={selectedProviderId}
          onChange={(e) => handleProviderSelect(e.target.value)}
          className="w-full px-4 py-3 rounded-md text-white transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500/40 border border-neutral-800 bg-neutral-900"
        >
          {availableConfigs.map(config => (
            <option key={config.provider} value={config.provider}>
              {config.name} {config.provider === 'ollama' ? '(Local)' : '(Cloud)'}
            </option>
          ))}
        </select>
        <p className="text-xs text-neutral-400">
          {currentConfig?.provider === 'ollama' && 'Runs AI models locally on your machine'}
          {currentConfig?.provider === 'openai' && 'Uses OpenAI\'s cloud API'}
          {currentConfig?.provider === 'litellm' && 'Multi-provider proxy supporting OpenAI, Gemini, Claude, and more'}
        </p>
      </div>

      {/* API Key Configuration (collapsed by default) */}
      {currentConfig && selectedProviderId !== 'ollama' && (
        <div className="rounded-md border border-neutral-800 bg-neutral-900">
          <button
            type="button"
            onClick={() => setApiSectionOpen(!apiSectionOpen)}
            className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-neutral-800 rounded-md"
          >
            <div>
              <div className="text-sm font-medium text-neutral-200">API Configuration</div>
              <div className="text-xs text-neutral-500 mt-0.5">
                {selectedProviderId === 'litellm'
                  ? `${apiKeyConfigs.filter(k => k.value).length} key(s) configured`
                  : 'OpenAI API key'}
              </div>
            </div>
            <svg className={`w-4 h-4 text-neutral-400 transition-transform ${apiSectionOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {apiSectionOpen && (
            <div className="px-4 pb-4 space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-neutral-500">
                  {selectedProviderId === 'litellm' 
                    ? 'Configure API keys for providers you want to use through LiteLLM'
                    : `Enter your ${currentConfig.name} API key`}
                </p>
                {selectedProviderId === 'litellm' && (
                  <button
                    onClick={() => setApiKeyConfigs([...apiKeyConfigs, { name: '', value: '' }])}
                    className="px-3 py-1.5 text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-md transition-colors"
                  >
                    + Add Key
                  </button>
                )}
              </div>

              {selectedProviderId === 'litellm' ? (
                <div className="space-y-3">
                  {apiKeyConfigs.map((config, index) => (
                    <div key={index} className="flex gap-2">
                      <input
                        type="text"
                        value={config.name}
                        onChange={(e) => {
                          const newConfigs = [...apiKeyConfigs];
                          newConfigs[index].name = e.target.value;
                          setApiKeyConfigs(newConfigs);
                        }}
                        placeholder="e.g., OPENAI_API_KEY"
                        className="flex-1 px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-md text-white text-sm placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                      />
                      <input
                        type="password"
                        value={config.value}
                        onChange={(e) => {
                          const newConfigs = [...apiKeyConfigs];
                          newConfigs[index].value = e.target.value;
                          setApiKeyConfigs(newConfigs);
                        }}
                        placeholder="sk-..."
                        className="flex-1 px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-md text-white text-sm placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                      />
                      {apiKeyConfigs.length > 1 && (
                        <button
                          onClick={() => setApiKeyConfigs(apiKeyConfigs.filter((_, i) => i !== index))}
                          className="px-3 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-md transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                  ))}
                  <div className="text-xs text-neutral-500 space-y-1">
                    <p>💡 Example: OPENAI_API_KEY → sk-proj-...</p>
                    <p>📚 <a href="https://docs.litellm.ai/docs/providers" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">View LiteLLM provider docs →</a></p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <input
                    type="password"
                    placeholder="sk-proj-..."
                    className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-md text-white text-sm placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                    onChange={(e) => onApiKeyChange?.(selectedProviderId, e.target.value)}
                  />
                  <p className="text-xs text-neutral-500">
                    Get your API key from <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">OpenAI Dashboard →</a>
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Model Configuration with tabs */}
      {currentConfig && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-neutral-200">Model Selection</h3>
              <p className="text-xs text-neutral-500 mt-1">Choose a model for the active task</p>
            </div>
          </div>

          {/* Tabs */}
          <div className="inline-flex rounded-md border border-neutral-800 bg-neutral-900 p-1">
            {(['vision','text','embedding','transcription'] as const)
              .filter(task => availableTasks.includes(task))
              .map(task => (
                <button
                  key={task}
                  onClick={() => setActiveTab(task)}
                  className={`px-3 py-1.5 text-xs rounded-sm transition-colors ${
                    activeTab === task ? 'bg-neutral-800 text-neutral-200' : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  {task === 'vision' && 'Vision'}
                  {task === 'text' && 'Text'}
                  {task === 'embedding' && 'Embedding'}
                  {task === 'transcription' && 'Transcription'}
                </button>
              ))}
          </div>

          {/* Active panel */}
          {activeTab && (
            <ModelConfigSection
              title={activeTab === 'vision' ? '📹 Vision Models'
                : activeTab === 'text' ? '🤖 Text Models'
                : activeTab === 'embedding' ? '🔍 Embedding Models'
                : '🎤 Transcription Models'}
              description={activeTab === 'vision' ? 'Image understanding and analysis'
                : activeTab === 'text' ? 'Text generation and chat'
                : activeTab === 'embedding' ? 'Semantic search and similarity'
                : 'Speech-to-text conversion'}
              task={activeTab}
              providerId={selectedProviderId}
              selectedModelId={selectedModels[activeTab]}
              onModelSelect={(modelId) => handleModelSelect(activeTab, modelId)}
            />
          )}
        </div>
      )}
    </div>
  );
};

interface ModelConfigSectionProps {
  title: string;
  description: string;
  task: string;
  providerId: string;
  selectedModelId?: string;
  onModelSelect: (modelId: string) => void;
}

const ModelConfigSection: React.FC<ModelConfigSectionProps> = ({
  title,
  description,
  task,
  providerId,
  selectedModelId,
  onModelSelect,
}) => {
  return (
    <div className="p-4 bg-neutral-800/30 rounded-xl border border-neutral-700/50">
      <div className="mb-3">
        <h4 className="text-sm font-medium text-neutral-200">{title}</h4>
        <p className="text-xs text-neutral-500">{description}</p>
      </div>
      <ModelSelector
        providerId={providerId}
        selectedModelId={selectedModelId}
        onModelSelect={onModelSelect}
        filterByCapability={task}
        showCategories={false}
        maxModelsPerCategory={5}
      />
    </div>
  );
};
