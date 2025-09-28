import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { DrillbitLogoImage } from './DrillbitLogoImage';

interface PortalSplashProps {
  visible: boolean;
  onReveal?: () => void;      // fired mid-way to sync landing reveal
  onComplete?: () => void;    // fired when splash fully exits
  minDurationMs?: number;     // minimum time to show splash
}

/**
 * Cosmic Portal splash overlay (Option B)
 * - Renders as a fixed overlay (does not block mounting of landing page)
 * - Expanding portal rings + subtle logo motion
 * - Calls onReveal midway so landing can animate in sync
 */
export const PortalSplash: React.FC<PortalSplashProps> = ({
  visible,
  onReveal,
  onComplete,
  minDurationMs = 2000
}) => {
  const [open, setOpen] = useState(visible);

  useEffect(() => {
    setOpen(visible);
  }, [visible]);

  // Midpoint reveal event
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      try { onReveal && onReveal(); } catch {}
    }, Math.min(1000, Math.max(600, minDurationMs * 0.45))); // ~45% point
    return () => clearTimeout(t);
  }, [open, onReveal, minDurationMs]);

  // Auto-complete after minDurationMs
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => setOpen(false), minDurationMs);
    return () => clearTimeout(t);
  }, [open, minDurationMs]);

  return (
    <AnimatePresence onExitComplete={onComplete}>
      {open && (
        <motion.div
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6, ease: 'easeInOut' }}
          className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, #000000 0%, #0a0a0a 25%, #111111 50%, #0a0a0a 75%, #000000 100%)'
          }}
        >
          {/* Stars */}
          <div className="absolute inset-0">
            {[...Array(70)].map((_, i) => (
              <motion.div
                key={i}
                className="absolute w-1 h-1 bg-white rounded-full opacity-60"
                style={{ left: `${Math.random() * 100}%`, top: `${Math.random() * 100}%` }}
                animate={{ opacity: [0.3, 1, 0.3], scale: [0.6, 1.2, 0.6] }}
                transition={{ duration: 2 + Math.random() * 3, repeat: Infinity, delay: Math.random() * 2 }}
              />
            ))}
          </div>

          {/* Portal rings */}
          <div className="absolute inset-0 flex items-center justify-center">
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                className="absolute rounded-full border border-blue-400/40"
                style={{ width: 180, height: 180 }}
                initial={{ scale: 0.6, opacity: 0.9 }}
                animate={{ scale: [0.6, 1.4, 2.2], opacity: [0.9, 0.6, 0] }}
                transition={{ duration: 1.8 + i * 0.2, repeat: Infinity, delay: i * 0.2, ease: 'easeOut' }}
              />
            ))}
          </div>

          {/* Logo */}
          <div className="relative z-10 text-center flex flex-col items-center justify-center">
            <motion.div
              initial={{ scale: 0.7, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
              className="mb-8"
            >
              <DrillbitLogoImage size={140} animate className="mx-auto" />
            </motion.div>

            <motion.h1
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.8, ease: 'easeOut', delay: 0.2 }}
              className="text-4xl md:text-5xl font-bold text-white mb-2 tracking-wider"
            >
              <span className="bg-gradient-to-r from-blue-400 via-purple-400 to-blue-400 bg-clip-text text-transparent">Clipwise</span>
            </motion.h1>
            <motion.p
              initial={{ y: 14, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.7, ease: 'easeOut', delay: 0.35 }}
              className="text-blue-200/90"
            >
              AI-Powered Media Search
            </motion.p>
          </div>

          {/* Soft radial glow */}
          <motion.div
            className="absolute inset-0"
            style={{ pointerEvents: 'none', background: 'radial-gradient(ellipse at center, rgba(59,130,246,0.15) 0%, rgba(99,102,241,0.1) 40%, rgba(0,0,0,0) 70%)' }}
            animate={{ opacity: [0.3, 0.5, 0.3] }}
            transition={{ duration: 4, repeat: Infinity }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default PortalSplash;
