import React from 'react';
import { motion } from 'framer-motion';
import { DrillbitLogoImage } from './DrillbitLogoImage';

interface PortalSplashProps {
  visible: boolean;
}

/**
 * Simple loading splash screen
 * - Clean, minimal design
 * - Shows logo and loading text
 */
export const PortalSplash: React.FC<PortalSplashProps> = ({ visible }) => {
  if (!visible) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden"
      style={{
        background: 'linear-gradient(135deg, #000000 0%, #0a0a0a 25%, #111111 50%, #0a0a0a 75%, #000000 100%)'
      }}
    >
      {/* Subtle background glow */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-96 h-96 bg-blue-500/5 rounded-full blur-3xl" />
      </div>

      {/* Logo and loading */}
      <div className="relative z-10 text-center flex flex-col items-center justify-center">
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.5 }}
          className="mb-8"
        >
          <DrillbitLogoImage className="w-48 h-48 mx-auto drop-shadow-2xl" />
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="text-3xl font-bold text-white mb-6 tracking-wide"
        >
          Cinestar
        </motion.h1>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="flex flex-col items-center gap-3"
        >
          {/* Loading spinner */}
          <svg className="w-6 h-6 animate-spin text-blue-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          
          {/* Loading text with animation */}
          <motion.span 
            className="text-sm text-neutral-400"
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          >
            Loading...
          </motion.span>
        </motion.div>
      </div>
    </motion.div>
  );
}

export default PortalSplash;
