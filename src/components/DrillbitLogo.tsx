import React from 'react';
import { motion } from 'framer-motion';

interface DrillbitLogoProps {
  size?: number;
  className?: string;
  animate?: boolean;
}

export const DrillbitLogo: React.FC<DrillbitLogoProps> = ({ 
  size = 96, 
  className = '',
  animate = false 
}) => {
  const MotionSvg = animate ? motion.svg : 'svg';
  const MotionPath = animate ? motion.path : 'path';
  const MotionCircle = animate ? motion.circle : 'circle';

  return (
    <MotionSvg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={className}
      {...(animate && {
        animate: { rotate: [0, 360] },
        transition: { duration: 8, repeat: Infinity, ease: "linear" }
      })}
    >
      {/* Outer energy ring */}
      <MotionCircle
        cx="50"
        cy="50"
        r="45"
        fill="none"
        stroke="url(#outerGradient)"
        strokeWidth="2"
        opacity="0.6"
        {...(animate && {
          animate: {
            scale: [1, 1.05, 1],
            opacity: [0.6, 0.9, 0.6],
          },
          transition: { duration: 2, repeat: Infinity }
        })}
      />
      
      {/* Main drill bit body */}
      <MotionPath
        d="M50 15 L60 25 L55 35 L65 45 L55 55 L65 65 L55 75 L60 85 L50 95 L40 85 L45 75 L35 65 L45 55 L35 45 L45 35 L40 25 Z"
        fill="url(#drillGradient)"
        stroke="url(#drillStroke)"
        strokeWidth="1"
        {...(animate && {
          animate: {
            scale: [1, 1.02, 1],
          },
          transition: { duration: 1.5, repeat: Infinity }
        })}
      />
      
      {/* Inner core */}
      <MotionCircle
        cx="50"
        cy="50"
        r="8"
        fill="url(#coreGradient)"
        {...(animate && {
          animate: {
            scale: [0.8, 1.2, 0.8],
          },
          transition: { duration: 1.5, repeat: Infinity }
        })}
      />
      
      {/* Spiral grooves */}
      <MotionPath
        d="M45 25 Q50 30 55 35 Q50 40 45 45 Q50 50 55 55 Q50 60 45 65 Q50 70 55 75"
        fill="none"
        stroke="rgba(255,255,255,0.3)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      
      {/* Energy particles */}
      {[...Array(6)].map((_, i) => (
        <MotionCircle
          key={i}
          cx={50 + Math.cos((i * 60) * Math.PI / 180) * 35}
          cy={50 + Math.sin((i * 60) * Math.PI / 180) * 35}
          r="2"
          fill="#00D4FF"
          opacity="0.7"
          {...(animate && {
            animate: {
              scale: [0.5, 1.5, 0.5],
              opacity: [0.3, 0.9, 0.3],
            },
            transition: { 
              duration: 2, 
              repeat: Infinity, 
              delay: i * 0.3 
            }
          })}
        />
      ))}

      {/* Gradients */}
      <defs>
        <linearGradient id="drillGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#00D4FF" />
          <stop offset="50%" stopColor="#6366F1" />
          <stop offset="100%" stopColor="#0B1426" />
        </linearGradient>
        
        <linearGradient id="drillStroke" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#00D4FF" />
          <stop offset="100%" stopColor="#6366F1" />
        </linearGradient>
        
        <radialGradient id="coreGradient" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#00D4FF" />
        </radialGradient>
        
        <linearGradient id="outerGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#6366F1" />
          <stop offset="50%" stopColor="#00D4FF" />
          <stop offset="100%" stopColor="#6366F1" />
        </linearGradient>
      </defs>
    </MotionSvg>
  );
};
