import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { DrillbitLogoImage } from './DrillbitLogoImage';
import { BrandingManager } from '../core/branding';
import PortalSplash from './PortalSplash';
import { SetupProgress } from './SetupProgress';
import { ModelManager } from '../core/model-manager';
import { ProviderSettingsV2 } from './ProviderSettingsV2';

interface SimplifiedOnboardingProps {
  onComplete: () => void;
  onCheckOnboarding: () => Promise<boolean>;
}

interface SetupTask {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  progress?: number;
  message?: string;
  size?: string;
}

export const SimplifiedOnboarding: React.FC<SimplifiedOnboardingProps> = ({ onComplete, onCheckOnboarding }) => {
  const [currentStep, setCurrentStep] = useState<'splash' | 'welcome' | 'features' | 'provider' | 'download' | 'complete'>('splash');
  const branding = BrandingManager.getBranding();
  const [selectedFeatures, setSelectedFeatures] = useState({ videos: false, audio: false });
  const [selectedProvider, setSelectedProvider] = useState<'ollama' | 'openai' | 'litellm'>('ollama');
  const [setupTasks, setSetupTasks] = useState<SetupTask[]>([]);

  console.log('[SIMPLIFIED-ONBOARDING] Component mounted, currentStep:', currentStep);
  console.log('[SIMPLIFIED-ONBOARDING] Viewport dimensions:', {
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    clientWidth: document.documentElement.clientWidth,
    clientHeight: document.documentElement.clientHeight
  });

  // Check if onboarding is needed - ONLY RUN ONCE ON MOUNT
  useEffect(() => {
    console.log('[SIMPLIFIED-ONBOARDING] useEffect running (ONCE on mount)');
    const checkOnboardingStatus = async () => {
      try {
        console.log('[SIMPLIFIED-ONBOARDING] Calling onCheckOnboarding');
        const needsOnboarding = await onCheckOnboarding();
        console.log('[SIMPLIFIED-ONBOARDING] onCheckOnboarding returned:', needsOnboarding);
        
        if (needsOnboarding) {
          console.log('[SIMPLIFIED-ONBOARDING] Onboarding needed, will show welcome screen');
          // Move from splash to welcome after a brief delay
          setTimeout(() => {
            console.log('[SIMPLIFIED-ONBOARDING] Setting currentStep to welcome');
            setCurrentStep('welcome');
          }, 1000);
        } else {
          console.log('[SIMPLIFIED-ONBOARDING] No onboarding needed, calling onComplete');
          setCurrentStep('complete');
          onComplete();
        }
      } catch (error) {
        console.error('[SIMPLIFIED-ONBOARDING] Failed to check onboarding status:', error);
        // Default to showing onboarding on error
        setTimeout(() => {
          console.log('[SIMPLIFIED-ONBOARDING] Error case, setting currentStep to welcome');
          setCurrentStep('welcome');
        }, 1000);
      }
    };
    
    checkOnboardingStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty dependency array = run only once on mount

  const handleGetStarted = () => {
    setCurrentStep('features');
  };

  const handleFeatureSelection = async (features: { videos: boolean; audio: boolean }) => {
    console.log('[SIMPLIFIED-ONBOARDING] Feature selection:', features);
    setSelectedFeatures(features);
    
    // Save feature preferences to config.json
    try {
      console.log('[SIMPLIFIED-ONBOARDING] Saving feature preferences...');
      const config = await window.ipcRenderer.invoke('config:get');
      const updatedConfig = {
        ...config,
        features: {
          images: true,
          videos: features.videos,
          audio: features.audio
        },
        lastModified: new Date().toISOString()
      };
      await window.ipcRenderer.invoke('config:set', updatedConfig);
      console.log('[SIMPLIFIED-ONBOARDING] Feature preferences saved');
      
      // Reload MediaAPI configuration to apply feature changes
      console.log('[SIMPLIFIED-ONBOARDING] Reloading MediaAPI configuration...');
      const reloadResult = await window.ipcRenderer.invoke('config:reload');
      if (reloadResult.success) {
        console.log('[SIMPLIFIED-ONBOARDING] MediaAPI configuration reloaded successfully');
      } else {
        console.error('[SIMPLIFIED-ONBOARDING] Failed to reload MediaAPI configuration:', reloadResult.error);
      }
    } catch (error) {
      console.error('[SIMPLIFIED-ONBOARDING] Failed to save preferences:', error);
    }

    // If user selected videos or audio, show provider selection
    if (features.videos || features.audio) {
      console.log('[SIMPLIFIED-ONBOARDING] Videos/audio selected - showing provider selection');
      setCurrentStep('provider');
    } else {
      // Skip provider selection and download, go straight to app
      console.log('[SIMPLIFIED-ONBOARDING] Only images selected - completing onboarding');
      completeOnboarding();
    }
  };

  const handleProviderComplete = async () => {
    console.log('[SIMPLIFIED-ONBOARDING] Provider configuration complete');
    
    // Always show download screen to setup whisper (needed for all providers)
    setCurrentStep('download');
    startModelDownload();
  };

  const updateTask = (id: string, updates: Partial<SetupTask>) => {
    setSetupTasks(prev => prev.map(task => 
      task.id === id ? { ...task, ...updates } : task
    ));
  };

  const startModelDownload = async () => {
    try {
      console.log('[SIMPLIFIED-ONBOARDING] Starting comprehensive setup...');
      
      // Initialize ModelManager
      const modelManager = new ModelManager();
      
      // Check which models are missing
      const { missing: missingModels } = await modelManager.checkRequiredModels();
      console.log(`[SIMPLIFIED-ONBOARDING] Found ${missingModels.length} missing Ollama models`);
      
      // Initialize setup tasks
      const tasks: SetupTask[] = [
        {
          id: 'whisper-check',
          name: 'Checking Whisper installation',
          status: 'pending',
          size: '~140MB'
        },
        ...missingModels.map(model => ({
          id: `ollama-${model.name}`,
          name: `Downloading ${model.name.split('/').pop()}`,
          status: 'pending' as const,
          size: model.size,
          message: model.purpose
        }))
      ];
      
      setSetupTasks(tasks);
      
      // Run Whisper setup and Ollama downloads in parallel
      const setupPromises: Promise<void>[] = [];
      
      // 1. Whisper Setup (runs in parallel)
      setupPromises.push((async () => {
        try {
          updateTask('whisper-check', { status: 'running', message: 'Checking installation...' });
          
          // Listen for setup progress
          const offProgress = window.electronAPI.onWhisperSetupProgress((progress: number) => {
            updateTask('whisper-check', { 
              status: 'running', 
              progress,
              message: progress < 50 ? 'Downloading model...' : 'Building Whisper...'
            });
          });
          
          // Listen for setup status
          const offSignal = window.electronAPI.onWhisperSetupSignal((data: { status: string; error?: string }) => {
            if (data.status === 'completed') {
              updateTask('whisper-check', { 
                status: 'completed', 
                progress: 100,
                message: 'Ready for transcription'
              });
            } else if (data.status === 'failed') {
              updateTask('whisper-check', { 
                status: 'error',
                message: data.error || 'Setup failed'
              });
            }
          });
          
          // Trigger setup
          const result = await window.electronAPI.setupWhisper({ modelName: 'base.en' });
          
          // Clean up listeners
          offProgress();
          offSignal();
          
          if (!result.success) {
            throw new Error(result.error || 'Whisper setup failed');
          }
          
          // After successful setup, ensure transcription is enabled in config
          try {
            const config = await window.ipcRenderer.invoke('config:get');
            const updatedConfig = {
              ...config,
              aiServices: {
                ...config.aiServices,
                transcription: {
                  ...config.aiServices.transcription,
                  enabled: true,
                  modelDownloaded: true
                }
              },
              resources: {
                ...config.resources,
                whisper: {
                  downloaded: true,
                  model: 'base.en',
                  lastChecked: new Date().toISOString()
                }
              }
            };
            await window.ipcRenderer.invoke('config:set', updatedConfig);
            console.log('[SIMPLIFIED-ONBOARDING] Transcription enabled after Whisper setup success');
          } catch (e) {
            console.warn('[SIMPLIFIED-ONBOARDING] Failed to update config after Whisper setup:', e);
          }
          
          updateTask('whisper-check', { 
            status: 'completed',
            progress: 100,
            message: 'Ready for transcription'
          });
        } catch (error) {
          console.error('[SIMPLIFIED-ONBOARDING] Whisper setup error:', error);
          updateTask('whisper-check', { 
            status: 'error',
            message: error instanceof Error ? error.message : 'Setup failed'
          });
          throw error;
        }
      })());
      
      // 2. Ollama Model Downloads (sequential, but parallel with Whisper)
      setupPromises.push((async () => {
        for (const model of missingModels) {
          const taskId = `ollama-${model.name}`;
          
          try {
            updateTask(taskId, { 
              status: 'running',
              progress: 0,
              message: 'Starting download...'
            });
            
            await modelManager.pullModel(model.name, (progress) => {
              const percentage = progress.percentage || 0;
              updateTask(taskId, {
                status: 'running',
                progress: percentage,
                message: progress.status
              });
            });
            
            updateTask(taskId, {
              status: 'completed',
              progress: 100,
              message: 'Downloaded successfully'
            });
          } catch (error) {
            console.error(`[SIMPLIFIED-ONBOARDING] Failed to download ${model.name}:`, error);
            updateTask(taskId, {
              status: 'error',
              message: error instanceof Error ? error.message : 'Download failed'
            });
            throw error;
          }
        }
      })());
      
      // Wait for all setups to complete
      await Promise.all(setupPromises);
      
      console.log('[SIMPLIFIED-ONBOARDING] All setup tasks completed successfully');
      
      // Verify all required resources are present before completing
      const allCompleted = setupTasks.every(task => task.status === 'completed');
      if (!allCompleted) {
        const failedTasks = setupTasks.filter(t => t.status === 'error').map(t => t.name);
        console.error('[SIMPLIFIED-ONBOARDING] Some tasks failed:', failedTasks);
        // Don't complete onboarding - user must retry or fix issues
        return;
      }
      
      console.log('[SIMPLIFIED-ONBOARDING] All required resources downloaded, completing onboarding');
      
      // Small delay to show completion state
      setTimeout(() => {
        completeOnboarding();
      }, 1000);
      
    } catch (error) {
      console.error('[SIMPLIFIED-ONBOARDING] Setup error:', error);
      // Show error state - user must retry or fix the issue
      // Don't complete onboarding on failure - keep them on download screen
      // The error state is already shown in setupTasks
    }
  };

  const completeOnboarding = async () => {
    try {
      console.log('[SIMPLIFIED-ONBOARDING] Completing onboarding...');
      const config = await window.ipcRenderer.invoke('config:get');
      const updatedConfig = {
        ...config,
        onboarding: {
          ...config.onboarding,
          complete: true,
          firstLaunchDate: config.onboarding.firstLaunchDate || new Date().toISOString()
        },
        lastModified: new Date().toISOString()
      };
      await window.ipcRenderer.invoke('config:set', updatedConfig);
      console.log('[SIMPLIFIED-ONBOARDING] Onboarding marked complete');
      setCurrentStep('complete');
      onComplete();
    } catch (error) {
      console.error('[SIMPLIFIED-ONBOARDING] Failed to complete onboarding:', error);
    }
  };

  const handleBack = () => {
    if (currentStep === 'features') {
      setCurrentStep('welcome');
    }
  };

  console.log('[SIMPLIFIED-ONBOARDING] Rendering step:', currentStep);
  
  // Render splash screen
  if (currentStep === 'splash') {
    console.log('[SIMPLIFIED-ONBOARDING] Rendering splash screen');
    return <PortalSplash visible={true} />;
  }

  // Render welcome screen
  if (currentStep === 'welcome') {
    console.log('[SIMPLIFIED-ONBOARDING] Rendering welcome screen');
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-neutral-950 via-neutral-900 to-neutral-950 p-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center max-w-2xl w-full"
        >
          {/* Logo */}
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.2, duration: 0.5 }}
            className="mb-8 flex justify-center"
          >
            <DrillbitLogoImage className="w-24 h-24" />
          </motion.div>

          {/* Title */}
          <motion.h1
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3, duration: 0.5 }}
            className="text-5xl font-bold text-white mb-4"
          >
            Welcome to {branding.appName}
          </motion.h1>

          {/* Subtitle */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4, duration: 0.5 }}
            className="text-xl text-neutral-400 mb-12"
          >
            Your AI-powered media library
          </motion.p>

          {/* Features */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5, duration: 0.5 }}
            className="grid grid-cols-3 gap-6 mb-12"
          >
            <div className="text-center">
              <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-blue-500/10 flex items-center justify-center">
                <svg className="w-6 h-6 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <div className="text-sm font-medium text-white">Smart Search</div>
              <div className="text-xs text-neutral-500 mt-1">Find anything instantly</div>
            </div>

            <div className="text-center">
              <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-purple-500/10 flex items-center justify-center">
                <svg className="w-6 h-6 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </div>
              <div className="text-sm font-medium text-white">AI Transcription</div>
              <div className="text-xs text-neutral-500 mt-1">Search video content</div>
            </div>

            <div className="text-center">
              <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-green-500/10 flex items-center justify-center">
                <svg className="w-6 h-6 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 002 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
                </svg>
              </div>
              <div className="text-sm font-medium text-white">Offline First</div>
              <div className="text-xs text-neutral-500 mt-1">No cloud required</div>
            </div>
          </motion.div>

          {/* CTA Button */}
          <motion.button
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6, duration: 0.5 }}
            onClick={handleGetStarted}
            className="px-8 py-4 bg-gradient-to-r from-blue-500 to-purple-600 text-white font-semibold rounded-xl hover:shadow-2xl hover:shadow-blue-500/50 transition-all duration-300 transform hover:scale-105"
          >
            Get Started →
          </motion.button>

          {/* Footer */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.7, duration: 0.5 }}
            className="mt-8 text-xs text-neutral-600"
          >
            Free • Open Source • Privacy First
          </motion.p>
        </motion.div>
      </div>
    );
  }

  // Render feature selection screen
  if (currentStep === 'features') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-neutral-950 via-neutral-900 to-neutral-950 p-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center max-w-4xl w-full"
        >
          {/* Back button */}
          <div className="flex justify-start mb-6">
            <button 
              onClick={handleBack}
              className="flex items-center gap-2 text-neutral-400 hover:text-white transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back
            </button>
          </div>

          {/* Header */}
          <motion.h1
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1, duration: 0.5 }}
            className="text-4xl font-bold text-white mb-4"
          >
            Choose Your Features
          </motion.h1>
          
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2, duration: 0.5 }}
            className="text-lg text-neutral-400 mb-12 max-w-2xl mx-auto"
          >
            Select which media types you want to process. You can enable additional features later in Settings.
          </motion.p>

          {/* Feature cards */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3, duration: 0.5 }}
            className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12 max-w-4xl mx-auto"
          >
            {/* Images - Always enabled */}
            <div className="flex flex-col h-full">
              <div className="flex-1 border-2 rounded-2xl p-8 bg-neutral-800/30 border-green-500/50 flex flex-col"
              >
                <div className="flex items-start gap-4 mb-6">
                  <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-green-500/10 flex items-center justify-center">
                    <svg className="w-6 h-6 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div className="text-left">
                    <h3 className="text-xl font-bold text-white mb-1">Images</h3>
                    <p className="text-sm text-neutral-400">Photos & illustrations</p>
                  </div>
                </div>
                
                <ul className="text-left space-y-3 mb-6 flex-1">
                  <li className="flex items-start gap-2 text-sm text-neutral-300">
                    <svg className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span>AI-powered captioning</span>
                  </li>
                  <li className="flex items-start gap-2 text-sm text-neutral-300">
                    <svg className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span>Smart search & organization</span>
                  </li>
                  <li className="flex items-start gap-2 text-sm text-neutral-300">
                    <svg className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span>No additional download required</span>
                  </li>
                </ul>
                
                <div className="mt-auto pt-4 border-t border-neutral-700">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-green-400">Always Enabled</span>
                    <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center">
                      <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Videos */}
            <div className="flex flex-col h-full">
              <div className={`flex-1 border-2 rounded-2xl p-8 cursor-pointer transition-all flex flex-col ${
                selectedFeatures.videos 
                  ? 'bg-blue-500/10 border-blue-500' 
                  : 'bg-neutral-800/30 border-neutral-700 hover:border-neutral-600'
              }`} 
              onClick={() => setSelectedFeatures((prev: { videos: boolean; audio: boolean }) => ({ ...prev, videos: !prev.videos }))}
              >
                <div className="flex items-start gap-4 mb-6">
                  <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center">
                    <svg className="w-6 h-6 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div className="text-left">
                    <h3 className="text-xl font-bold text-white mb-1">Videos</h3>
                    <p className="text-sm text-neutral-400">Movies & recordings</p>
                  </div>
                </div>
                
                <ul className="text-left space-y-3 mb-6 flex-1">
                  <li className="flex items-start gap-2 text-sm text-neutral-300">
                    <svg className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span>AI-powered transcription</span>
                  </li>
                  <li className="flex items-start gap-2 text-sm text-neutral-300">
                    <svg className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span>Search video content</span>
                  </li>
                  <li className="flex items-start gap-2 text-sm text-neutral-300">
                    <svg className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span>Scene detection & keyframes</span>
                  </li>
                </ul>
                
                <div className="mt-auto pt-4 border-t border-neutral-700">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-blue-400">📦 140 MB download</span>
                    <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${
                      selectedFeatures.videos 
                        ? 'bg-blue-500 border-blue-500' 
                        : 'border-neutral-600'
                    }`}>
                      {selectedFeatures.videos && (
                        <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Audio - DISABLED */}
            {/* <div className="flex flex-col h-full">
              <div className={`flex-1 border-2 rounded-2xl p-8 cursor-pointer transition-all flex flex-col ${
                selectedFeatures.audio 
                  ? 'bg-purple-500/10 border-purple-500' 
                  : 'bg-neutral-800/30 border-neutral-700 hover:border-neutral-600'
              }`} 
              onClick={() => setSelectedFeatures((prev: { videos: boolean; audio: boolean }) => ({ ...prev, audio: !prev.audio }))}
              >
                <div className="flex items-start gap-4 mb-6">
                  <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-purple-500/10 flex items-center justify-center">
                    <svg className="w-6 h-6 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                    </svg>
                  </div>
                  <div className="text-left">
                    <h3 className="text-xl font-bold text-white mb-1">Audio</h3>
                    <p className="text-sm text-neutral-400">Podcasts & music</p>
                  </div>
                </div>
                
                <ul className="text-left space-y-3 mb-6 flex-1">
                  <li className="flex items-start gap-2 text-sm text-neutral-300">
                    <svg className="w-5 h-5 text-purple-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span>Transcribe podcasts & recordings</span>
                  </li>
                  <li className="flex items-start gap-2 text-sm text-neutral-300">
                    <svg className="w-5 h-5 text-purple-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span>Search by spoken content</span>
                  </li>
                  <li className="flex items-start gap-2 text-sm text-neutral-300">
                    <svg className="w-5 h-5 text-purple-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span>Uses same model as videos</span>
                  </li>
                </ul>
                
                <div className="mt-auto pt-4 border-t border-neutral-700">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-purple-400">📦 140 MB download</span>
                    <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${
                      selectedFeatures.audio 
                        ? 'bg-purple-500 border-purple-500' 
                        : 'border-neutral-600'
                    }`}>
                      {selectedFeatures.audio && (
                        <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div> */}
          </motion.div>

          {/* Info box */}
          {(selectedFeatures.videos || selectedFeatures.audio) && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4 mb-8 max-w-2xl mx-auto"
            >
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="text-left">
                  <p className="text-sm text-blue-300 font-medium mb-1">AI Model Download Required</p>
                  <p className="text-xs text-blue-400">
                    Enabling videos/audio requires downloading a 140MB AI model for offline transcription. 
                    This only happens once and enables powerful search capabilities.
                  </p>
                </div>
              </div>
            </motion.div>
          )}

          {/* Continue button */}
          <motion.button
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.5 }}
            onClick={() => handleFeatureSelection(selectedFeatures)}
            className="px-8 py-3 bg-gradient-to-r from-blue-500 to-purple-600 text-white font-semibold rounded-xl hover:shadow-2xl hover:shadow-blue-500/50 transition-all duration-300"
          >
            Continue →
          </motion.button>
        </motion.div>
      </div>
    );
  }

  // Render provider selection screen
  if (currentStep === 'provider') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-neutral-950 via-neutral-900 to-neutral-950 p-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="w-full max-w-5xl mx-auto px-4"
        >
          {/* Logo */}
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.5 }}
            className="mb-8 text-center"
          >
            <DrillbitLogoImage className="w-16 h-16 mx-auto mb-4" />
          </motion.div>

          {/* Title */}
          <motion.h1
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.5 }}
            className="text-3xl font-bold mb-3 text-center bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent"
          >
            Configure AI Models
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.5 }}
            className="text-neutral-400 mb-12 max-w-2xl mx-auto text-center"
          >
            Choose your AI provider and models for video processing. You can change these later in Settings.
          </motion.p>

          {/* Provider Settings Component */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.5 }}
            className="mb-8"
          >
            <ProviderSettingsV2
              onProviderChange={async (providerId: string) => {
                console.log('[ONBOARDING] Provider changed to:', providerId);
              }}
              onModelChange={async (task: string, modelId: string) => {
                console.log('[ONBOARDING] Model changed:', task, modelId);
              }}
              onApiKeyChange={async (providerId: string, apiKey: string) => {
                console.log('[ONBOARDING] API key updated for:', providerId);
              }}
            />
          </motion.div>

          {/* Continue button */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.5 }}
            className="text-center"
          >
            <button
              onClick={handleProviderComplete}
              className="px-8 py-3 bg-gradient-to-r from-blue-500 to-purple-600 text-white font-semibold rounded-xl hover:shadow-2xl hover:shadow-blue-500/50 transition-all duration-300"
            >
              Continue →
            </button>
          </motion.div>
        </motion.div>
      </div>
    );
  }

  // OLD PROVIDER CARDS - DELETE THIS ENTIRE SECTION
  if (false) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-neutral-950 via-neutral-900 to-neutral-950 p-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="w-full max-w-5xl mx-auto text-center"
        >
          {/* Feature-based Configuration */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.5 }}
            className="space-y-6 mb-8 text-left"
          >
            {/* Ollama - Local */}
            <div 
              className={`border-2 rounded-2xl p-6 cursor-pointer transition-all ${
                selectedProvider === 'ollama'
                  ? 'bg-green-500/10 border-green-500'
                  : 'bg-neutral-800/30 border-neutral-700 hover:border-neutral-600'
              }`}
              onClick={() => setSelectedProvider('ollama')}
            >
              <div className="flex items-center justify-between mb-4">
                <div className="w-12 h-12 rounded-xl bg-green-500/10 flex items-center justify-center">
                  <svg className="w-6 h-6 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                  </svg>
                </div>
                {selectedProvider === 'ollama' && (
                  <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center">
                    <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                )}
              </div>
              <h3 className="text-xl font-bold text-white mb-2 text-left">Ollama (Local)</h3>
              <p className="text-sm text-neutral-400 mb-4 text-left">
                Run AI models on your machine. Complete privacy, no internet required.
              </p>
              <div className="space-y-2 text-left">
                <div className="flex items-center gap-2 text-xs text-green-400">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  <span>100% Private</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-green-400">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  <span>Works Offline</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-green-400">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  <span>No API Costs</span>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-neutral-700 text-left">
                <span className="text-xs font-medium text-neutral-400">📦 ~2GB download</span>
              </div>
            </div>

            {/* OpenAI */}
            <div 
              className={`border-2 rounded-2xl p-6 cursor-pointer transition-all ${
                selectedProvider === 'openai'
                  ? 'bg-blue-500/10 border-blue-500'
                  : 'bg-neutral-800/30 border-neutral-700 hover:border-neutral-600'
              }`}
              onClick={() => setSelectedProvider('openai')}
            >
              <div className="flex items-center justify-between mb-4">
                <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center">
                  <svg className="w-6 h-6 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" />
                    <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" />
                  </svg>
                </div>
                {selectedProvider === 'openai' && (
                  <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center">
                    <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                )}
              </div>
              <h3 className="text-xl font-bold text-white mb-2 text-left">OpenAI</h3>
              <p className="text-sm text-neutral-400 mb-4 text-left">
                Use GPT-4 and other advanced models. Requires API key.
              </p>
              <div className="space-y-2 text-left">
                <div className="flex items-center gap-2 text-xs text-blue-400">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  <span>Most Advanced</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-blue-400">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  <span>No Local Setup</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-blue-400">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  <span>Fast Processing</span>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-neutral-700 text-left">
                <span className="text-xs font-medium text-neutral-400">💳 Pay per use</span>
              </div>
            </div>

            {/* LiteLLM */}
            <div 
              className={`border-2 rounded-2xl p-6 cursor-pointer transition-all ${
                selectedProvider === 'litellm'
                  ? 'bg-purple-500/10 border-purple-500'
                  : 'bg-neutral-800/30 border-neutral-700 hover:border-neutral-600'
              }`}
              onClick={() => setSelectedProvider('litellm')}
            >
              <div className="flex items-center justify-between mb-4">
                <div className="w-12 h-12 rounded-xl bg-purple-500/10 flex items-center justify-center">
                  <svg className="w-6 h-6 text-purple-500" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />
                  </svg>
                </div>
                {selectedProvider === 'litellm' && (
                  <div className="w-6 h-6 rounded-full bg-purple-500 flex items-center justify-center">
                    <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                )}
              </div>
              <h3 className="text-xl font-bold text-white mb-2 text-left">LiteLLM Proxy</h3>
              <p className="text-sm text-neutral-400 mb-4 text-left">
                Access Gemini, Claude, and more through a unified proxy.
              </p>
              <div className="space-y-2 text-left">
                <div className="flex items-center gap-2 text-xs text-purple-400">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  <span>Multi-Provider</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-purple-400">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  <span>Flexible</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-purple-400">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  <span>Cost Effective</span>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-neutral-700 text-left">
                <span className="text-xs font-medium text-neutral-400">🔧 Requires setup</span>
              </div>
            </div>
          </motion.div>

          {/* Info box */}
          {selectedProvider !== 'ollama' && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-orange-500/10 border border-orange-500/30 rounded-xl p-4 mb-8 max-w-2xl mx-auto"
            >
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-orange-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div className="text-left">
                  <p className="text-sm text-orange-300 font-medium mb-1">Cloud Provider Selected</p>
                  <p className="text-xs text-orange-400">
                    Your media will be sent to {selectedProvider === 'openai' ? 'OpenAI' : 'LiteLLM proxy'} for processing. 
                    You can configure API keys in Settings after setup.
                  </p>
                </div>
              </div>
            </motion.div>
          )}

          {/* Continue button */}
          <motion.button
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.5 }}
            onClick={() => handleProviderSelection(selectedProvider)}
            className="px-8 py-3 bg-gradient-to-r from-blue-500 to-purple-600 text-white font-semibold rounded-xl hover:shadow-2xl hover:shadow-blue-500/50 transition-all duration-300"
          >
            {selectedProvider === 'ollama' ? 'Download Models →' : 'Complete Setup →'}
          </motion.button>
        </motion.div>
      </div>
    );
  }

  // Render download progress screen
  if (currentStep === 'download') {
    // Calculate overall progress
    const completedTasks = setupTasks.filter(t => t.status === 'completed').length;
    const totalTasks = setupTasks.length;
    const overallProgress = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-neutral-950 via-neutral-900 to-neutral-950 p-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="w-full"
        >
          {/* Logo */}
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.2, duration: 0.5 }}
            className="mb-12 flex justify-center"
          >
            <div className="relative">
              <DrillbitLogoImage className="w-20 h-20 mx-auto" />
              <div className="absolute inset-0 bg-blue-500/20 rounded-full blur-xl animate-pulse" />
            </div>
          </motion.div>

          {/* Setup Progress Component */}
          <SetupProgress 
            tasks={setupTasks}
            overallProgress={overallProgress}
          />
        </motion.div>
      </div>
    );
  }

  // Default fallback (should never reach here)
  return null;
}
