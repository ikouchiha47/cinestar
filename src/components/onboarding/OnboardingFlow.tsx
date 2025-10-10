import { useState, useEffect } from 'react';
import { WelcomeScreen } from './WelcomeScreen';
import { FeatureSelectionScreen } from './FeatureSelectionScreen';
import { ModelDownloadProgress } from '../ModelDownloadProgress';

interface OnboardingFlowProps {
  onComplete: () => void;
}

type OnboardingStep = 'welcome' | 'features' | 'download' | 'complete';

export function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  const [currentStep, setCurrentStep] = useState<OnboardingStep>('welcome');
  const [selectedFeatures, setSelectedFeatures] = useState({ videos: false, audio: false });
  const [downloadProgress, setDownloadProgress] = useState(0);

  const handleGetStarted = () => {
    setCurrentStep('features');
  };

  const handleFeatureSelection = async (features: { videos: boolean; audio: boolean }) => {
    console.log('[ONBOARDING] Feature selection:', features);
    setSelectedFeatures(features);
    
    // Save preferences
    try {
      console.log('[ONBOARDING] Saving feature preferences...');
      await window.electronAPI.saveUserPreferences({
        featuresEnabled: {
          images: true,
          videos: features.videos,
          audio: features.audio
        }
      });
      console.log('[ONBOARDING] Feature preferences saved');
    } catch (error) {
      console.error('[ONBOARDING] Failed to save preferences:', error);
    }

    // If user selected videos or audio, show download screen
    if (features.videos || features.audio) {
      console.log('[ONBOARDING] Videos/audio selected - showing download screen');
      setCurrentStep('download');
      startModelDownload();
    } else {
      // Skip download, go straight to app
      console.log('[ONBOARDING] Only images selected - completing onboarding');
      completeOnboarding();
    }
  };

  const startModelDownload = async () => {
    try {
      // Listen for progress updates
      const unsubscribe = window.electronAPI.onWhisperDownloadProgress((progress: number) => {
        setDownloadProgress(progress);
      });
      
      // Trigger model download via IPC
      const result = await window.electronAPI.downloadWhisperModel({
        modelName: 'base.en'
      });

      // Clean up listener
      unsubscribe();

      if (result.success) {
        // Mark model as downloaded
        await window.electronAPI.saveUserPreferences({
          whisperModelDownloaded: true
        });
        
        setDownloadProgress(100);
      } else {
        console.error('[Onboarding] Model download failed:', result.error);
        // TODO: Show error UI
      }
    } catch (error) {
      console.error('[Onboarding] Download error:', error);
      // TODO: Show error UI
    }
  };

  const completeOnboarding = async () => {
    try {
      console.log('[ONBOARDING] Completing onboarding...');
      await window.electronAPI.saveUserPreferences({
        onboardingComplete: true
      });
      console.log('[ONBOARDING] Onboarding marked complete, calling onComplete callback');
      onComplete();
    } catch (error) {
      console.error('[ONBOARDING] Failed to complete onboarding:', error);
    }
  };

  const handleDownloadComplete = () => {
    completeOnboarding();
  };

  const handleBack = () => {
    if (currentStep === 'features') {
      setCurrentStep('welcome');
    }
  };

  return (
    <>
      {currentStep === 'welcome' && (
        <WelcomeScreen onGetStarted={handleGetStarted} />
      )}
      
      {currentStep === 'features' && (
        <FeatureSelectionScreen 
          onContinue={handleFeatureSelection}
          onBack={handleBack}
        />
      )}
      
      {currentStep === 'download' && (
        <ModelDownloadProgress 
          progress={downloadProgress}
          modelName="base.en"
          onComplete={handleDownloadComplete}
        />
      )}
    </>
  );
}
