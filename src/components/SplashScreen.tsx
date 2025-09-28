import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { DrillbitLogoImage } from './DrillbitLogoImage';

interface SplashScreenProps {
  onComplete: () => void;
  duration?: number;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({ 
  onComplete, 
  duration = 3000 
}) => {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(false);
      // Wait for exit animation to complete before calling onComplete
      setTimeout(onComplete, 800);
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, onComplete]);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.8, ease: "easeInOut" }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 overflow-hidden"
        >
          {/* Animated Background Stars */}
          <div className="absolute inset-0">
            {[...Array(50)].map((_, i) => (
              <motion.div
                key={i}
                className="absolute w-1 h-1 bg-white rounded-full opacity-60"
                style={{
                  left: `${Math.random() * 100}%`,
                  top: `${Math.random() * 100}%`,
                }}
                animate={{
                  opacity: [0.3, 1, 0.3],
                  scale: [0.5, 1.2, 0.5],
                }}
                transition={{
                  duration: 2 + Math.random() * 3,
                  repeat: Infinity,
                  delay: Math.random() * 2,
                }}
              />
            ))}
          </div>

          {/* Cosmic Particles */}
          <div className="absolute inset-0">
            {[...Array(20)].map((_, i) => (
              <motion.div
                key={`particle-${i}`}
                className="absolute w-2 h-2 bg-blue-400 rounded-full opacity-40"
                style={{
                  left: `${Math.random() * 100}%`,
                  top: `${Math.random() * 100}%`,
                }}
                animate={{
                  x: [0, Math.random() * 200 - 100],
                  y: [0, Math.random() * 200 - 100],
                  opacity: [0, 0.6, 0],
                }}
                transition={{
                  duration: 4 + Math.random() * 2,
                  repeat: Infinity,
                  delay: Math.random() * 3,
                }}
              />
            ))}
          </div>

          {/* Main Content */}
          <div className="relative z-10 text-center">
            {/* Logo Container */}
            <motion.div
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ 
                duration: 1.2, 
                ease: "easeOut",
                delay: 0.2 
              }}
              className="mb-8 relative"
            >
              {/* Drillbit Logo */}
              <DrillbitLogoImage 
                size={120} 
                animate={true}
                className="mx-auto"
              />

              {/* Glow Effect */}
              <motion.div
                className="absolute inset-0 bg-blue-400 rounded-full blur-xl opacity-20"
                animate={{
                  scale: [1, 1.5, 1],
                  opacity: [0.2, 0.4, 0.2],
                }}
                transition={{
                  duration: 2.5,
                  repeat: Infinity,
                }}
              />
            </motion.div>

            {/* App Name */}
            <motion.h1
              initial={{ y: 30, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ 
                duration: 1, 
                ease: "easeOut",
                delay: 0.8 
              }}
              className="text-5xl font-bold text-white mb-4 tracking-wider"
            >
              <span className="bg-gradient-to-r from-blue-400 via-purple-400 to-blue-400 bg-clip-text text-transparent">
                Clipwise
              </span>
            </motion.h1>

            {/* Tagline */}
            <motion.p
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ 
                duration: 0.8, 
                ease: "easeOut",
                delay: 1.2 
              }}
              className="text-xl text-blue-200 font-light tracking-wide"
            >
              AI-Powered Media Search
            </motion.p>

            {/* Loading Animation */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.8 }}
              className="mt-12"
            >
              <div className="flex justify-center space-x-2">
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    className="w-3 h-3 bg-blue-400 rounded-full"
                    animate={{
                      scale: [1, 1.5, 1],
                      opacity: [0.5, 1, 0.5],
                    }}
                    transition={{
                      duration: 1.5,
                      repeat: Infinity,
                      delay: i * 0.2,
                    }}
                  />
                ))}
              </div>
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 2.2 }}
                className="text-blue-300 text-sm mt-4 font-light"
              >
                Initializing AI services...
              </motion.p>
            </motion.div>
          </div>

          {/* Cosmic Nebula Effect */}
          <motion.div
            className="absolute inset-0 bg-gradient-radial from-purple-500/10 via-transparent to-transparent"
            animate={{
              scale: [1, 1.2, 1],
              opacity: [0.1, 0.3, 0.1],
            }}
            transition={{
              duration: 6,
              repeat: Infinity,
            }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
};
