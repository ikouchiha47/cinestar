/**
 * Simple scene detection configuration
 * No CLI needed - just import and use
 */

export interface SceneDetectionConfig {
  // Pass configurations
  passes: {
    [passNumber: number]: {
      name: string;
      threshold: number;
      techniques: string[];
      minSegmentDuration: number;
      maxSegmentDuration: number;
    };
  };
  
  // Technique settings
  techniques: {
    [techniqueName: string]: {
      enabled: boolean;
      priority: number;
      config: Record<string, any>;
    };
  };
}

/**
 * Default scene detection configuration
 */
export const DEFAULT_SCENE_DETECTION_CONFIG: SceneDetectionConfig = {
  passes: {
    1: {
      name: 'Coarse Detection',
      threshold: 0.8,
      techniques: ['basic_scene', 'motion_analysis', 'time_fallback'],
      minSegmentDuration: 5,
      maxSegmentDuration: 60
    },
    2: {
      name: 'Medium Refinement', 
      threshold: 0.6,
      techniques: ['basic_scene', 'motion_analysis', 'histogram_analysis'],
      minSegmentDuration: 3,
      maxSegmentDuration: 30
    },
    3: {
      name: 'Fine Refinement',
      threshold: 0.4, 
      techniques: ['motion_analysis', 'histogram_analysis', 'edge_detection', 'time_fallback'],
      minSegmentDuration: 2,
      maxSegmentDuration: 15
    }
  },
  
  techniques: {
    basic_scene: {
      enabled: true,
      priority: 5,
      config: {
        adaptiveThreshold: true
      }
    },
    
    motion_analysis: {
      enabled: true,
      priority: 8,
      config: {
        motionThreshold: 0.3,
        peakDetection: true,
        windowSize: 1.0
      }
    },
    
    histogram_analysis: {
      enabled: true,
      priority: 6,
      config: {
        correlationThreshold: 0.7,
        windowSize: 0.5
      }
    },
    
    edge_detection: {
      enabled: true,
      priority: 7,
      config: {
        edgeThreshold: 50,
        changeThreshold: 0.4
      }
    },
    
    time_fallback: {
      enabled: true,
      priority: 1,
      config: {
        intervalSeconds: 15,
        jitterPercent: 0.1
      }
    }
  }
};

/**
 * Action-optimized configuration for fast-paced videos
 */
export const ACTION_SCENE_DETECTION_CONFIG: SceneDetectionConfig = {
  passes: {
    1: {
      name: 'Motion-First Detection',
      threshold: 0.7,
      techniques: ['motion_analysis', 'edge_detection', 'basic_scene'],
      minSegmentDuration: 2,
      maxSegmentDuration: 20
    },
    2: {
      name: 'Visual Refinement',
      threshold: 0.5,
      techniques: ['histogram_analysis', 'edge_detection', 'motion_analysis'],
      minSegmentDuration: 1,
      maxSegmentDuration: 12
    },
    3: {
      name: 'Fine Action Beats',
      threshold: 0.3,
      techniques: ['motion_analysis', 'histogram_analysis', 'time_fallback'],
      minSegmentDuration: 0.5,
      maxSegmentDuration: 8
    }
  },
  
  techniques: {
    basic_scene: {
      enabled: true,
      priority: 6,
      config: { adaptiveThreshold: true }
    },
    motion_analysis: {
      enabled: true,
      priority: 9, // Higher priority for action content
      config: {
        motionThreshold: 0.2, // More sensitive
        peakDetection: true,
        windowSize: 0.5 // Smaller window for faster detection
      }
    },
    histogram_analysis: {
      enabled: true,
      priority: 7,
      config: {
        correlationThreshold: 0.6, // More sensitive
        windowSize: 0.3
      }
    },
    edge_detection: {
      enabled: true,
      priority: 8,
      config: {
        edgeThreshold: 30, // More sensitive
        changeThreshold: 0.3
      }
    },
    time_fallback: {
      enabled: true,
      priority: 2,
      config: {
        intervalSeconds: 8, // Shorter intervals for action
        jitterPercent: 0.15
      }
    }
  }
};

/**
 * Speed-optimized configuration for fast processing
 */
export const SPEED_SCENE_DETECTION_CONFIG: SceneDetectionConfig = {
  passes: {
    1: {
      name: 'Fast Detection',
      threshold: 0.6,
      techniques: ['basic_scene', 'time_fallback'],
      minSegmentDuration: 10,
      maxSegmentDuration: 30
    }
  },
  
  techniques: {
    basic_scene: {
      enabled: true,
      priority: 5,
      config: { adaptiveThreshold: false } // Disable adaptive for speed
    },
    time_fallback: {
      enabled: true,
      priority: 3,
      config: {
        intervalSeconds: 20,
        jitterPercent: 0.05
      }
    },
    // Disable expensive techniques
    motion_analysis: { enabled: false, priority: 0, config: {} },
    histogram_analysis: { enabled: false, priority: 0, config: {} },
    edge_detection: { enabled: false, priority: 0, config: {} }
  }
};

/**
 * Get scene detection config based on video characteristics
 */
export function getSceneDetectionConfig(videoMetadata?: {
  duration: number;
  contentType?: string;
  motionLevel?: 'low' | 'medium' | 'high';
}): SceneDetectionConfig {
  
  if (!videoMetadata) {
    return DEFAULT_SCENE_DETECTION_CONFIG;
  }
  
  // Use action config for high motion or short videos (likely action clips)
  if (videoMetadata.motionLevel === 'high' || videoMetadata.duration < 120) {
    console.log('[SCENE-CONFIG] Using action-optimized configuration');
    return ACTION_SCENE_DETECTION_CONFIG;
  }
  
  // Use speed config for very long videos
  if (videoMetadata.duration > 1800) { // 30+ minutes
    console.log('[SCENE-CONFIG] Using speed-optimized configuration');
    return SPEED_SCENE_DETECTION_CONFIG;
  }
  
  console.log('[SCENE-CONFIG] Using default configuration');
  return DEFAULT_SCENE_DETECTION_CONFIG;
}
