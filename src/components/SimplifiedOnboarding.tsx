import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { DrillbitLogoImage } from './DrillbitLogoImage';
import PortalSplash from './PortalSplash';
import { SetupProgress } from './SetupProgress';
import { ModelManager } from '../core/model-manager';

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

export function SimplifiedOnboarding({ onComplete, onCheckOnboarding }: SimplifiedOnboardingProps) {
  const [currentStep, setCurrentStep] = useState<'splash' | 'welcome' | 'features' | 'download' | 'complete'>('splash');
  const [selectedFeatures, setSelectedFeatures] = useState({ videos: false, audio: false });
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
    } catch (error) {
      console.error('[SIMPLIFIED-ONBOARDING] Failed to save preferences:', error);
    }

    // If user selected videos or audio, show download screen
    if (features.videos || features.audio) {
      console.log('[SIMPLIFIED-ONBOARDING] Videos/audio selected - showing download screen');
      setCurrentStep('download');
      startModelDownload();
    } else {
      // Skip download, go straight to app
      console.log('[SIMPLIFIED-ONBOARDING] Only images selected - completing onboarding');
      completeOnboarding();
    }
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
      
      // Small delay to show completion state
      setTimeout(() => {
        completeOnboarding();
      }, 1000);
      
    } catch (error) {
      console.error('[SIMPLIFIED-ONBOARDING] Setup error:', error);
      // Don't block onboarding on errors - user can retry later
      setTimeout(() => {
        completeOnboarding();
      }, 2000);
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
            Welcome to Cinestar
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
