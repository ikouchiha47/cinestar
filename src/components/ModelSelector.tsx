/**
 * Model Selector Component
 * 
 * Displays available models from provider configuration and allows selection.
 * Shows categorized models with descriptions and links to documentation.
 */

import React, { useState, useMemo, useEffect } from 'react';
import { providerConfigManager } from '../core/llm/provider-config-manager';
import type { ModelCapability } from '../core/llm/provider-config.types';
import { ollamaValidator } from '../services/ollama-model-validator';

interface ModelSelectorProps {
  providerId: string;
  selectedModelId?: string;
  onModelSelect: (modelId: string) => void;
  filterByCapability?: string;
  showCategories?: boolean;
  maxModelsPerCategory?: number;
}

export const ModelSelector: React.FC<ModelSelectorProps> = ({
  providerId,
  selectedModelId,
  onModelSelect,
  filterByCapability,
  showCategories = true,
  maxModelsPerCategory = 3,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [modelValidation, setModelValidation] = useState<Record<string, boolean>>({});
  const [isValidating, setIsValidating] = useState(false);

  const config = providerConfigManager.getConfig(providerId);

  // Validate Ollama models on mount
  useEffect(() => {
    if (providerId === 'ollama' && config) {
      const validateOllamaModels = async () => {
        setIsValidating(true);
        const allModels = providerConfigManager.getAllModels(providerId);
        const modelIds = allModels.map(m => m.id);
        
        const results = await ollamaValidator.validateModels(modelIds);
        const validation: Record<string, boolean> = {};
        results.forEach(result => {
          validation[result.modelId] = result.exists;
        });
        
        setModelValidation(validation);
        setIsValidating(false);
      };
      
      validateOllamaModels();
    }
  }, [providerId, config]);

  const filteredModels = useMemo(() => {
    if (!config) return [];

    let models: ModelCapability[] = [];

    if (filterByCapability) {
      models = providerConfigManager.getModelsByCapability(providerId, filterByCapability);
    } else {
      models = providerConfigManager.getAllModels(providerId);
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      models = models.filter(
        model =>
          model.name.toLowerCase().includes(query) ||
          model.description.toLowerCase().includes(query) ||
          model.id.toLowerCase().includes(query)
      );
    }

    return models;
  }, [config, providerId, filterByCapability, searchQuery]);

  const categorizedModels = useMemo(() => {
    if (!config || !showCategories) return null;

    const categories: Record<string, ModelCapability[]> = {};

    for (const [categoryId, category] of Object.entries(config.categories)) {
      let categoryModels = category.models;

      // Apply capability filter
      if (filterByCapability) {
        categoryModels = categoryModels.filter(model =>
          model.capabilities.includes(filterByCapability)
        );
      }

      // Apply search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        categoryModels = categoryModels.filter(
          model =>
            model.name.toLowerCase().includes(query) ||
            model.description.toLowerCase().includes(query) ||
            model.id.toLowerCase().includes(query)
        );
      }

      // Limit models per category
      if (maxModelsPerCategory > 0) {
        categoryModels = categoryModels.slice(0, maxModelsPerCategory);
      }

      if (categoryModels.length > 0) {
        categories[categoryId] = categoryModels;
      }
    }

    return categories;
  }, [config, showCategories, filterByCapability, searchQuery, maxModelsPerCategory]);

  const toggleCategory = (categoryId: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  };

  if (!config) {
    return (
      <div className="text-sm text-neutral-500">
        Provider configuration not found
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with search and docs link */}
      <div className="flex items-center justify-between gap-4">
        <input
          type="text"
          placeholder="Search models..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="flex-1 px-3 py-2 border border-neutral-800 bg-neutral-900 rounded-md text-sm text-white placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
        />
        {config.docsUrl && (
          <a
            href={config.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-blue-400 hover:text-blue-300 whitespace-nowrap"
          >
            View all models →
          </a>
        )}
      </div>

      {/* Categorized view */}
      {showCategories && categorizedModels ? (
        <div className="space-y-3">
          {Object.entries(categorizedModels).map(([categoryId, models]) => {
            const category = config.categories[categoryId];
            const isExpanded = expandedCategories.has(categoryId);

            return (
              <div key={categoryId} className="border border-neutral-800 rounded-md overflow-hidden bg-neutral-900">
                {/* Category header */}
                <button
                  onClick={() => toggleCategory(categoryId)}
                  className="w-full px-4 py-3 bg-neutral-900 hover:bg-neutral-800 flex items-center justify-between text-left transition-colors"
                >
                  <div>
                    <div className="font-medium text-sm">{category.label}</div>
                    <div className="text-xs text-neutral-500 mt-0.5">{category.description}</div>
                  </div>
                  <svg
                    className={`w-5 h-5 text-neutral-500 transition-transform ${
                      isExpanded ? 'transform rotate-180' : ''
                    }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {/* Models list */}
                {isExpanded && (
                  <div className="divide-y divide-neutral-800">
                    {models.map(model => (
                      <ModelItem
                        key={model.id}
                        model={model}
                        isSelected={selectedModelId === model.id}
                        onSelect={() => onModelSelect(model.id)}
                        isValidated={providerId === 'ollama' ? modelValidation[model.id] : undefined}
                        isValidating={isValidating}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* Flat list view */
        <div className="border border-neutral-800 rounded-md divide-y divide-neutral-800 bg-neutral-900">
          {filteredModels.length > 0 ? (
            filteredModels.map(model => (
              <ModelItem
                key={model.id}
                model={model}
                isSelected={selectedModelId === model.id}
                onSelect={() => onModelSelect(model.id)}
                isValidated={providerId === 'ollama' ? modelValidation[model.id] : undefined}
                isValidating={isValidating}
              />
            ))
          ) : (
            <div className="px-4 py-8 text-center text-sm text-neutral-500">
              No models found matching your search
            </div>
          )}
        </div>
      )}
    </div>
  );
};

interface ModelItemProps {
  model: ModelCapability;
  isSelected: boolean;
  onSelect: () => void;
  isValidated?: boolean;
  isValidating?: boolean;
}

const ModelItem: React.FC<ModelItemProps> = ({ model, isSelected, onSelect, isValidated, isValidating }) => {
  return (
    <button
      onClick={onSelect}
      className={`w-full px-4 py-3 text-left transition-colors ${
        isSelected ? 'bg-neutral-800' : 'hover:bg-neutral-800/50'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`font-medium text-sm ${isSelected ? 'text-indigo-300' : 'text-neutral-200'}`}>
              {model.name}
            </span>
            {model.default && (
              <span className="px-2 py-0.5 text-xs font-medium rounded border border-emerald-800 bg-emerald-900/30 text-emerald-300">
                Default
              </span>
            )}
            {isValidating && (
              <span className="px-2 py-0.5 text-xs font-medium rounded border border-neutral-700 bg-neutral-800 text-neutral-400">
                Checking...
              </span>
            )}
            {!isValidating && isValidated === false && (
              <span className="px-2 py-0.5 text-xs font-medium rounded border border-red-800 bg-red-900/30 text-red-300">
                Not Installed
              </span>
            )}
            {!isValidating && isValidated === true && (
              <span className="px-2 py-0.5 text-xs font-medium rounded border border-emerald-800 bg-emerald-900/30 text-emerald-300">
                ✓ Installed
              </span>
            )}
          </div>
          <p className="text-xs text-neutral-500 mt-1 line-clamp-2">{model.description}</p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {model.capabilities.map(cap => (
              <span
                key={cap}
                className="px-2 py-0.5 text-xs rounded border border-neutral-700 bg-neutral-800 text-neutral-300"
              >
                {cap}
              </span>
            ))}
          </div>
          {(model.contextWindow || model.dimensions) && (
            <div className="flex gap-3 mt-2 text-xs text-neutral-500">
              {model.contextWindow && <span>Context: {model.contextWindow.toLocaleString()}</span>}
              {model.dimensions && <span>Dimensions: {model.dimensions}</span>}
            </div>
          )}
        </div>
        {isSelected && (
          <svg className="w-5 h-5 text-indigo-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
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
