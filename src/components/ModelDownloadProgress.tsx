import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

interface ModelDownloadProgressProps {
  progress: number;
  modelName?: string;
  onComplete?: () => void;
}

export function ModelDownloadProgress({ progress, modelName = 'base.en', onComplete }: ModelDownloadProgressProps) {
  const [dots, setDots] = useState('');
  const [downloadSpeed, setDownloadSpeed] = useState('');

  useEffect(() => {
    const interval = setInterval(() => {
      setDots(prev => prev.length >= 3 ? '' : prev + '.');
    }, 500);
    
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    // Simulate download speed calculation
    if (progress > 0 && progress < 100) {
      const speeds = ['2.5 MB/s', '3.1 MB/s', '2.8 MB/s', '3.4 MB/s'];
      setDownloadSpeed(speeds[Math.floor(Math.random() * speeds.length)]);
    }
  }, [progress]);

  useEffect(() => {
    if (progress >= 100 && onComplete) {
      setTimeout(onComplete, 1000);
    }
  }, [progress, onComplete]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="bg-neutral-900 border border-neutral-700 rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl">
        <div className="text-center">
          {/* Icon */}
          <div className="mb-6 flex justify-center">
            <div className="w-16 h-16 rounded-full bg-blue-500/10 flex items-center justify-center">
              <svg className="w-8 h-8 text-blue-500 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
              </svg>
            </div>
          </div>

          {/* Title */}
          <motion.h3
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-xl font-semibold text-white mb-2"
          >
            {progress >= 100 ? 'Download Complete!' : 'Downloading AI Model'}
          </motion.h3>
          
          {/* Description */}
          <p className="text-neutral-400 text-sm mb-6">
            {progress >= 100 ? (
              'Setting up transcription service...'
            ) : (
              <>
                Downloading {modelName} model (~140MB)
                <br />
                This only happens once{dots}
              </>
            )}
          </p>

          {/* Progress Bar */}
          <div className="mb-4">
            <div className="w-full bg-neutral-800 rounded-full h-2 overflow-hidden">
              <motion.div 
                className="bg-blue-500 h-full"
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-sm">
              <span className="text-neutral-500">
                {progress > 0 ? `${Math.round(progress)}%` : 'Initializing...'}
              </span>
              {downloadSpeed && progress < 100 && (
                <span className="text-neutral-600">{downloadSpeed}</span>
              )}
            </div>
          </div>

          {/* Info */}
          <div className="text-xs text-neutral-600 bg-neutral-800/50 rounded-lg p-3">
            💡 This model enables offline video transcription without requiring Docker
          </div>
        </div>
      </div>
    </div>
  );
}
