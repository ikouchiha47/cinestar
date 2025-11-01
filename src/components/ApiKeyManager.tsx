/**
 * API Key Manager Component
 * 
 * Manages API keys for LLM providers with secure input and validation.
 */

import React, { useState } from 'react';
import { providerConfigManager } from '../core/llm/provider-config-manager';

interface ApiKeyManagerProps {
  providerId: string;
  currentApiKey?: string;
  onApiKeyChange: (apiKey: string) => void;
  onValidate?: (apiKey: string) => Promise<boolean>;
}

export const ApiKeyManager: React.FC<ApiKeyManagerProps> = ({
  providerId,
  currentApiKey = '',
  onApiKeyChange,
  onValidate,
}) => {
  const [apiKey, setApiKey] = useState(currentApiKey);
  const [isVisible, setIsVisible] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [validationStatus, setValidationStatus] = useState<'idle' | 'valid' | 'invalid'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const apiKeyConfig = providerConfigManager.getApiKeyConfig(providerId);

  if (!apiKeyConfig) {
    return null;
  }

  // If API key is not required, don't show the component
  if (!apiKeyConfig.required) {
    return (
      <div className="text-sm text-gray-500">
        No API key required for this provider
      </div>
    );
  }

  // If API key is not editable, show read-only view
  if (!apiKeyConfig.editable) {
    return (
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">
          {apiKeyConfig.label}
        </label>
        <div className="px-3 py-2 bg-gray-50 border border-gray-300 rounded-md text-sm text-gray-500">
          API key is managed by system configuration
        </div>
        {apiKeyConfig.envVar && (
          <p className="text-xs text-gray-500">
            Set via environment variable: <code className="px-1 py-0.5 bg-gray-100 rounded">{apiKeyConfig.envVar}</code>
          </p>
        )}
      </div>
    );
  }

  const handleApiKeyChange = (value: string) => {
    setApiKey(value);
    setValidationStatus('idle');
    setErrorMessage('');
  };

  const handleSave = async () => {
    if (!apiKey.trim()) {
      setErrorMessage('API key cannot be empty');
      return;
    }

    // Validate if validation function is provided
    if (onValidate) {
      setIsValidating(true);
      setValidationStatus('idle');
      setErrorMessage('');

      try {
        const isValid = await onValidate(apiKey);
        if (isValid) {
          setValidationStatus('valid');
          onApiKeyChange(apiKey);
        } else {
          setValidationStatus('invalid');
          setErrorMessage('Invalid API key. Please check and try again.');
        }
      } catch (error) {
        setValidationStatus('invalid');
        setErrorMessage(error instanceof Error ? error.message : 'Validation failed');
      } finally {
        setIsValidating(false);
      }
    } else {
      // No validation, just save
      onApiKeyChange(apiKey);
      setValidationStatus('valid');
    }
  };

  const handleClear = () => {
    setApiKey('');
    setValidationStatus('idle');
    setErrorMessage('');
    onApiKeyChange('');
  };

  const hasChanged = apiKey !== currentApiKey;

  return (
    <div className="space-y-3">
      {/* Label */}
      <label className="block text-sm font-medium text-gray-700">
        {apiKeyConfig.label}
        {apiKeyConfig.required && <span className="text-red-500 ml-1">*</span>}
      </label>

      {/* Input field */}
      <div className="relative">
        <input
          type={isVisible ? 'text' : 'password'}
          value={apiKey}
          onChange={e => handleApiKeyChange(e.target.value)}
          placeholder={apiKeyConfig.placeholder}
          className={`w-full px-3 py-2 pr-10 border rounded-md text-sm focus:outline-none focus:ring-2 ${
            validationStatus === 'valid'
              ? 'border-green-500 focus:ring-green-500'
              : validationStatus === 'invalid'
              ? 'border-red-500 focus:ring-red-500'
              : 'border-gray-300 focus:ring-blue-500'
          }`}
          disabled={isValidating}
        />
        
        {/* Toggle visibility button */}
        <button
          type="button"
          onClick={() => setIsVisible(!isVisible)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          title={isVisible ? 'Hide API key' : 'Show API key'}
        >
          {isVisible ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          )}
        </button>
      </div>

      {/* Validation status */}
      {validationStatus === 'valid' && (
        <div className="flex items-center gap-2 text-sm text-green-600">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
          <span>API key is valid</span>
        </div>
      )}

      {validationStatus === 'invalid' && errorMessage && (
        <div className="flex items-center gap-2 text-sm text-red-600">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
          </svg>
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Help text */}
      {apiKeyConfig.envVar && (
        <p className="text-xs text-gray-500">
          You can also set this via environment variable: <code className="px-1 py-0.5 bg-gray-100 rounded">{apiKeyConfig.envVar}</code>
        </p>
      )}

      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={!hasChanged || isValidating || !apiKey.trim()}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isValidating ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Validating...
            </span>
          ) : (
            'Save API Key'
          )}
        </button>

        {apiKey && (
          <button
            onClick={handleClear}
            disabled={isValidating}
            className="px-4 py-2 bg-gray-200 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Clear
          </button>
        )}
      </div>

      {/* Security notice */}
      <div className="flex items-start gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
        <svg className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
        </svg>
        <div className="text-xs text-yellow-800">
          <strong>Security:</strong> Your API key is stored locally and never shared. Keep it secure and don't share it with others.
        </div>
      </div>
    </div>
  );
};
