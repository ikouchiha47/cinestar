import React from 'react';
import { motion } from 'framer-motion';

interface DrillbitLogoImageProps {
  size?: number;
  className?: string;
  animate?: boolean;
}

export const DrillbitLogoImage: React.FC<DrillbitLogoImageProps> = ({ 
  size = 96, 
  className = '',
  animate = false 
}) => {
  const MotionDiv = animate ? motion.div : 'div';
  const MotionImg = animate ? motion.img : 'img';

  return (
    <MotionDiv
      className={`relative ${className}`}
      style={{ width: size, height: size }}
      {...(animate && {
        animate: { 
          scale: [1, 1.05, 1], // Gentle breathing/pulsing effect
        },
        transition: { 
          scale: {
            duration: 2.5,
            repeat: Infinity,
            ease: "easeInOut"
          }
        }
      })}
    >
      <MotionImg
        src="/icons/clipwise-transparent.png"
        alt="Clipwise Logo"
        width={size}
        height={size}
        className="w-full h-full object-contain"
        style={{
          filter: 'drop-shadow(0 0 20px rgba(0, 212, 255, 0.3))'
        }}
        {...(animate && {
          initial: { scale: 0.8, opacity: 0 },
          animate: { 
            scale: [0.8, 1.05, 1],
            opacity: 1,
          },
          transition: { 
            scale: {
              duration: 2,
              repeat: Infinity,
              repeatType: "reverse",
              ease: "easeInOut"
            },
            opacity: {
              duration: 0.8,
              ease: "easeOut"
            }
          }
        })}
      />
      
      {/* Energy glow effect around the logo */}
      {animate && (
        <motion.div
          className="absolute inset-0 rounded-full"
          style={{
            background: 'radial-gradient(circle, rgba(0,212,255,0.3) 0%, rgba(99,102,241,0.2) 50%, transparent 70%)',
            filter: 'blur(8px)',
          }}
          animate={{
            scale: [1, 1.3, 1],
            opacity: [0.3, 0.6, 0.3],
          }}
          transition={{
            duration: 3,
            repeat: Infinity,
            ease: "easeInOut"
          }}
        />
      )}
    </MotionDiv>
  );
};
