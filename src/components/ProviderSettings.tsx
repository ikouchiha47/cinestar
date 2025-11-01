/**
 * Provider Settings Component
 * 
 * Comprehensive UI for managing LLM providers including:
 * - Provider selection
 * - Model configuration
 * - API key management
 * - Privacy mode indicators
 */

import React, { useState, useEffect } from 'react';
import { providerConfigManager } from '../core/llm/provider-config-manager';
import { ModelSelector } from './ModelSelector';
import { ApiKeyManager } from './ApiKeyManager';
import type { ProviderConfig } from '../core/llm/provider-config.types';
import type { LLMProvider, PrivacyMode } from '../core/llm/types';

interface ProviderSettingsProps {
  activeProviderId?: string;
  providers?: Record<string, LLMProvider>;
  onProviderChange?: (providerId: string) => void;
  onModelChange?: (task: string, modelId: string) => void;
  onApiKeyChange?: (providerId: string, apiKey: string) => void;
}

export const ProviderSettings: React.FC<ProviderSettingsProps> = ({
  activeProviderId,
  providers = {},
  onProviderChange,
  onModelChange,
  onApiKeyChange,
}) => {
  const [selectedProviderId, setSelectedProviderId] = useState(activeProviderId || 'ollama');
  const [selectedModels, setSelectedModels] = useState<Record<string, string>>({});
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['provider']));

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

  const handleApiKeyChange = (apiKey: string) => {
    setApiKeys(prev => ({ ...prev, [selectedProviderId]: apiKey }));
    onApiKeyChange?.(selectedProviderId, apiKey);
  };

  const toggleSection = (section: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  const getPrivacyMode = (): PrivacyMode => {
    if (currentProvider) {
      return currentProvider.privacy;
    }
    // Infer from provider type
    return selectedProviderId === 'ollama' ? 'private' : 'cloud';
  };

  const privacyMode = getPrivacyMode();

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header with Privacy Indicator */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">LLM Provider Settings</h2>
          <p className="text-sm text-gray-500 mt-1">
            Configure your language model providers and privacy preferences
          </p>
        </div>
        <PrivacyIndicator mode={privacyMode} />
      </div>

      {/* Provider Selection Section */}
      <SettingsSection
        title="Provider"
        description="Select your LLM provider"
        isExpanded={expandedSections.has('provider')}
        onToggle={() => toggleSection('provider')}
        icon={
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
          </svg>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {availableConfigs.map(config => (
            <ProviderCard
              key={config.provider}
              config={config}
              isSelected={selectedProviderId === config.provider}
              onSelect={() => handleProviderSelect(config.provider)}
            />
          ))}
        </div>
      </SettingsSection>

      {/* API Key Section */}
      {currentConfig && providerConfigManager.requiresApiKey(selectedProviderId) && (
        <SettingsSection
          title="API Key"
          description={`Configure your ${currentConfig.name} API key`}
          isExpanded={expandedSections.has('apikey')}
          onToggle={() => toggleSection('apikey')}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
          }
        >
          <ApiKeyManager
            providerId={selectedProviderId}
            currentApiKey={apiKeys[selectedProviderId]}
            onApiKeyChange={handleApiKeyChange}
          />
        </SettingsSection>
      )}

      {/* Model Configuration Section */}
      {currentConfig && (
        <SettingsSection
          title="Model Configuration"
          description="Select models for different tasks"
          isExpanded={expandedSections.has('models')}
          onToggle={() => toggleSection('models')}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
            </svg>
          }
        >
          <div className="space-y-6">
            {/* Vision Models */}
            {currentConfig.defaults.vision && (
              <ModelConfigSection
                title="Vision Models"
                description="Models for image understanding and analysis"
                task="vision"
                providerId={selectedProviderId}
                selectedModelId={selectedModels.vision}
                onModelSelect={(modelId) => handleModelSelect('vision', modelId)}
              />
            )}

            {/* Text Models */}
            {currentConfig.defaults.text && (
              <ModelConfigSection
                title="Text Models"
                description="Models for text generation and chat"
                task="text"
                providerId={selectedProviderId}
                selectedModelId={selectedModels.text}
                onModelSelect={(modelId) => handleModelSelect('text', modelId)}
              />
            )}

            {/* Embedding Models */}
            {currentConfig.defaults.embedding && (
              <ModelConfigSection
                title="Embedding Models"
                description="Models for generating text embeddings"
                task="embedding"
                providerId={selectedProviderId}
                selectedModelId={selectedModels.embedding}
                onModelSelect={(modelId) => handleModelSelect('embedding', modelId)}
              />
            )}

            {/* Transcription Models */}
            {currentConfig.defaults.transcription && (
              <ModelConfigSection
                title="Transcription Models"
                description="Models for speech-to-text conversion"
                task="transcription"
                providerId={selectedProviderId}
                selectedModelId={selectedModels.transcription}
                onModelSelect={(modelId) => handleModelSelect('transcription', modelId)}
              />
            )}
          </div>
        </SettingsSection>
      )}

      {/* Privacy Information Section */}
      <SettingsSection
        title="Privacy & Data"
        description="Understand how your data is processed"
        isExpanded={expandedSections.has('privacy')}
        onToggle={() => toggleSection('privacy')}
        icon={
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        }
      >
        <PrivacyInformation mode={privacyMode} providerName={currentConfig?.name} />
      </SettingsSection>
    </div>
  );
};

interface SettingsSectionProps {
  title: string;
  description: string;
  isExpanded: boolean;
  onToggle: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}

const SettingsSection: React.FC<SettingsSectionProps> = ({
  title,
  description,
  isExpanded,
  onToggle,
  icon,
  children,
}) => {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="text-gray-600">{icon}</div>
          <div className="text-left">
            <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
            <p className="text-sm text-gray-500">{description}</p>
          </div>
        </div>
        <svg
          className={`w-5 h-5 text-gray-400 transition-transform ${
            isExpanded ? 'transform rotate-180' : ''
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {isExpanded && <div className="px-6 py-4 border-t border-gray-200">{children}</div>}
    </div>
  );
};

interface ProviderCardProps {
  config: ProviderConfig;
  isSelected: boolean;
  onSelect: () => void;
}

const ProviderCard: React.FC<ProviderCardProps> = ({ config, isSelected, onSelect }) => {
  const isLocal = config.provider === 'ollama';
  
  return (
    <button
      onClick={onSelect}
      className={`p-4 rounded-lg border-2 text-left transition-all ${
        isSelected
          ? 'border-blue-500 bg-blue-50'
          : 'border-gray-200 hover:border-gray-300 bg-white'
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h4 className={`font-semibold ${isSelected ? 'text-blue-900' : 'text-gray-900'}`}>
              {config.name}
            </h4>
            {isLocal && (
              <span className="px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded">
                Local
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-1">
            {isLocal ? 'Private, runs on your machine' : 'Cloud-based API service'}
          </p>
        </div>
        {isSelected && (
          <svg className="w-5 h-5 text-blue-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
              clipRule="evenodd"
            />
          </svg>
        )}
      </div>
    </button>
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
    <div className="space-y-3">
      <div>
        <h4 className="text-sm font-semibold text-gray-900">{title}</h4>
        <p className="text-xs text-gray-500">{description}</p>
      </div>
      <ModelSelector
        providerId={providerId}
        selectedModelId={selectedModelId}
        onModelSelect={onModelSelect}
        filterByCapability={task}
        showCategories={false}
        maxModelsPerCategory={3}
      />
    </div>
  );
};

interface PrivacyIndicatorProps {
  mode: PrivacyMode;
  size?: 'sm' | 'md' | 'lg';
}

export const PrivacyIndicator: React.FC<PrivacyIndicatorProps> = ({ mode, size = 'md' }) => {
  const isPrivate = mode === 'private';
  
  const sizeClasses = {
    sm: 'px-2 py-1 text-xs',
    md: 'px-3 py-1.5 text-sm',
    lg: 'px-4 py-2 text-base',
  };

  const iconSizes = {
    sm: 'w-3 h-3',
    md: 'w-4 h-4',
    lg: 'w-5 h-5',
  };

  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full font-medium ${
        isPrivate
          ? 'bg-green-100 text-green-800'
          : 'bg-orange-100 text-orange-800'
      } ${sizeClasses[size]}`}
    >
      {isPrivate ? (
        <svg className={iconSizes[size]} fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
        </svg>
      ) : (
        <svg className={iconSizes[size]} fill="currentColor" viewBox="0 0 20 20">
          <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" />
          <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" />
        </svg>
      )}
      <span>{isPrivate ? 'Private' : 'Cloud'}</span>
    </div>
  );
};

interface PrivacyInformationProps {
  mode: PrivacyMode;
  providerName?: string;
}

const PrivacyInformation: React.FC<PrivacyInformationProps> = ({ mode, providerName }) => {
  const isPrivate = mode === 'private';

  return (
    <div className="space-y-4">
      <div className={`p-4 rounded-lg ${isPrivate ? 'bg-green-50 border border-green-200' : 'bg-orange-50 border border-orange-200'}`}>
        <div className="flex items-start gap-3">
          {isPrivate ? (
            <svg className="w-6 h-6 text-green-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
          ) : (
            <svg className="w-6 h-6 text-orange-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
          )}
          <div>
            <h4 className={`font-semibold ${isPrivate ? 'text-green-900' : 'text-orange-900'}`}>
              {isPrivate ? 'Private Processing' : 'Cloud Processing'}
            </h4>
            <p className={`text-sm mt-1 ${isPrivate ? 'text-green-700' : 'text-orange-700'}`}>
              {isPrivate
                ? 'Your data is processed locally on your machine and never leaves your device.'
                : `Your data is sent to ${providerName || 'the provider'}'s servers for processing.`}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <h5 className="text-sm font-semibold text-gray-900">What this means:</h5>
        <ul className="space-y-2 text-sm text-gray-600">
          {isPrivate ? (
            <>
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                <span>Complete data privacy - no external servers involved</span>
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                <span>Works offline without internet connection</span>
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                <span>No API costs or usage limits</span>
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                <span>Full control over model versions and updates</span>
              </li>
            </>
          ) : (
            <>
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 9.293 8.707 8.707z" clipRule="evenodd" />
                </svg>
                <span>Data is transmitted to external servers</span>
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 9.293 8.707 8.707z" clipRule="evenodd" />
                </svg>
                <span>Requires internet connection</span>
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                <span>Access to latest and most powerful models</span>
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                <span>No local hardware requirements</span>
              </li>
            </>
          )}
        </ul>
      </div>

      {!isPrivate && (
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-xs text-blue-800">
            <strong>Note:</strong> Review {providerName || 'the provider'}'s privacy policy and terms of service to understand how your data is handled.
          </p>
        </div>
      )}
    </div>
  );
};
