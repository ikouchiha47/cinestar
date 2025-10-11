import { useState } from 'react';
import { motion } from 'framer-motion';

interface FeatureSelectionScreenProps {
  onContinue: (features: { videos: boolean; audio: boolean }) => void;
  onBack: () => void;
}

export function FeatureSelectionScreen({ onContinue, onBack }: FeatureSelectionScreenProps) {
  const [selectedFeatures, setSelectedFeatures] = useState({
    images: true,  // Always enabled
    videos: false,
    audio: false
  });

  const needsDownload = selectedFeatures.videos || selectedFeatures.audio;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gradient-to-br from-neutral-950 via-neutral-900 to-neutral-950">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="max-w-5xl w-full px-8"
      >
        {/* Header */}
        <div className="text-center mb-8">
          <h2 className="text-3xl font-bold text-white mb-2">
            What would you like to organize?
          </h2>
          <p className="text-neutral-400">
            Choose the features you need. You can change this later in settings.
          </p>
        </div>

        {/* Feature Cards */}
        <div className="flex flex-col md:flex-row gap-6 mb-8">
          {/* Images - Always Enabled */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 }}
            className="flex-1 bg-neutral-800/50 border-2 border-green-500/50 rounded-2xl p-12 cursor-default min-h-[320px]"
          >
            <div className="flex flex-col h-full">
              <div className="flex items-start gap-8 mb-8">
                <div className="flex-shrink-0 w-24 h-24 rounded-2xl bg-green-500/10 flex items-center justify-center">
                  <svg className="w-12 h-12 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <div className="flex-1 flex flex-col justify-between h-24">
                  <h3 className="text-2xl font-semibold text-white">Images</h3>
                  <span className="px-2 py-0.5 text-xs font-medium bg-green-500/20 text-green-400 rounded-full whitespace-nowrap self-start">
                    Always Enabled
                  </span>
                </div>
              </div>
              <p className="text-lg text-neutral-400 mb-8">
                Browse, search, and organize your photos with AI-powered descriptions
              </p>
              <div className="mt-auto flex items-center gap-3 text-base text-neutral-500">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                No additional setup required
              </div>
            </div>
          </motion.div>

          {/* Video & Audio - Combined */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
            onClick={() => {
              const newValue = !(selectedFeatures.videos || selectedFeatures.audio);
              setSelectedFeatures(prev => ({
                ...prev,
                videos: newValue,
                audio: newValue
              }));
            }}
            className={`flex-1 border-2 rounded-2xl p-12 cursor-pointer transition-all min-h-[320px] ${
              (selectedFeatures.videos || selectedFeatures.audio)
                ? 'bg-blue-500/10 border-blue-500'
                : 'bg-neutral-800/30 border-neutral-700 hover:border-neutral-600'
            }`}
          >
            <div className="flex flex-col h-full">
              <div className="flex items-start gap-8 mb-8">
                <div className="flex-shrink-0 w-24 h-24 rounded-2xl bg-blue-500/10 flex items-center justify-center">
                  <svg className="w-12 h-12 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </div>
                <div className="flex-1 flex flex-col justify-between h-24">
                  <h3 className="text-2xl font-semibold text-white">Video</h3>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedFeatures(prev => ({
                        ...prev,
                        videos: !prev.audio,
                        audio: !prev.audio
                      }));
                    }}
                    className="flex items-center gap-2 text-xs text-neutral-400 hover:text-neutral-300 transition-colors self-start"
                  >
                    <div className={`w-8 h-4 rounded-full transition-colors ${
                      selectedFeatures.audio && !selectedFeatures.videos
                        ? 'bg-purple-500'
                        : 'bg-neutral-600'
                    } relative`}>
                      <div className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
                        selectedFeatures.audio && !selectedFeatures.videos
                          ? 'translate-x-4'
                          : 'translate-x-0'
                      }`} />
                    </div>
                    <span>Only Audio</span>
                  </button>
                </div>
                <div className="flex-shrink-0">
                  <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${
                    (selectedFeatures.videos || selectedFeatures.audio)
                      ? 'bg-blue-500 border-blue-500'
                      : 'border-neutral-600'
                  }`}>
                    {(selectedFeatures.videos || selectedFeatures.audio) && (
                      <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                </div>
              </div>
              <p className="text-lg text-neutral-400 mb-8">
                AI-powered transcription for videos and audio files. Search through spoken content.
              </p>
              <div className="mt-auto flex items-center gap-3 text-base text-amber-400">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                Requires 140MB Whisper AI model download
              </div>
            </div>
          </motion.div>
        </div>

        {/* Info Box */}
        {needsDownload && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 mb-8"
          >
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="text-sm">
                <div className="font-medium text-amber-400 mb-1">AI Model Download Required</div>
                <div className="text-neutral-400">
                  The Whisper AI model (~140MB) will be downloaded on the next screen. 
                  This enables offline transcription without requiring Docker.
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between">
          <button
            onClick={onBack}
            className="px-6 py-3 text-neutral-400 hover:text-white transition-colors"
          >
            ← Back
          </button>
          <button
            onClick={() => onContinue({ videos: selectedFeatures.videos, audio: selectedFeatures.audio })}
            className="px-8 py-3 bg-gradient-to-r from-blue-500 to-purple-600 text-white font-semibold rounded-xl hover:shadow-2xl hover:shadow-blue-500/50 transition-all duration-300"
          >
            Continue →
          </button>
        </div>
      </motion.div>
    </div>
  );
}
