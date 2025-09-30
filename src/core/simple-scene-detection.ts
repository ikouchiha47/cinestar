import { spawn } from 'child_process';
import { getSceneDetectionConfig } from './scene-detection-config';

/**
 * Simple scene detection using configuration-based approach
 */
export class SimpleSceneDetection {
  
  /**
   * Detect scenes for a specific pass
   */
  async detectScenes(
    videoPath: string,
    passNumber: number,
    videoMetadata?: {
      duration: number;
      contentType?: string;
      motionLevel?: 'low' | 'medium' | 'high';
    }
  ): Promise<number[]> {
    console.log(`[SIMPLE-SCENE-DETECTION] Starting pass ${passNumber} for ${videoPath}`);
    
    // Get configuration for this video
    const config = getSceneDetectionConfig(videoMetadata);
    const passConfig = config.passes[passNumber];
    
    if (!passConfig) {
      throw new Error(`Pass ${passNumber} not configured`);
    }
    
    console.log(`[SIMPLE-SCENE-DETECTION] Pass ${passNumber}: ${passConfig.name} (threshold: ${passConfig.threshold})`);
    console.log(`[SIMPLE-SCENE-DETECTION] Techniques: ${passConfig.techniques.join(', ')}`);
    
    const allCuts: number[] = [];
    
    // Execute each enabled technique
    for (const techniqueName of passConfig.techniques) {
      const techniqueConfig = config.techniques[techniqueName];
      
      if (!techniqueConfig || !techniqueConfig.enabled) {
        console.log(`[SIMPLE-SCENE-DETECTION] Skipping disabled technique: ${techniqueName}`);
        continue;
      }
      
      try {
        console.log(`[SIMPLE-SCENE-DETECTION] Executing: ${techniqueName}`);
        const cuts = await this.executeTechnique(
          videoPath, 
          techniqueName, 
          passConfig.threshold, 
          techniqueConfig.config,
          videoMetadata
        );
        
        console.log(`[SIMPLE-SCENE-DETECTION] ${techniqueName} found ${cuts.length} cuts`);
        allCuts.push(...cuts);
        
      } catch (error) {
        console.error(`[SIMPLE-SCENE-DETECTION] Technique ${techniqueName} failed:`, error);
        // Continue with other techniques
      }
    }
    
    // Remove duplicates and sort
    const uniqueCuts = [...new Set(allCuts)].sort((a, b) => a - b);
    
    // Merge nearby cuts (within 1 second)
    const mergedCuts = this.mergeNearbyCuts(uniqueCuts, 1.0);
    
    console.log(`[SIMPLE-SCENE-DETECTION] Pass ${passNumber} completed: ${mergedCuts.length} scene cuts`);
    return mergedCuts;
  }
  
  /**
   * Execute a specific technique
   */
  private async executeTechnique(
    videoPath: string,
    techniqueName: string,
    threshold: number,
    techniqueConfig: Record<string, any>,
    videoMetadata?: any
  ): Promise<number[]> {
    
    switch (techniqueName) {
      case 'basic_scene':
        return this.executeBasicScene(videoPath, threshold, techniqueConfig);
        
      case 'motion_analysis':
        return this.executeMotionAnalysis(videoPath, threshold, techniqueConfig);
        
      case 'histogram_analysis':
        return this.executeHistogramAnalysis(videoPath, threshold, techniqueConfig);
        
      case 'edge_detection':
        return this.executeEdgeDetection(videoPath, threshold, techniqueConfig);
        
      case 'time_fallback':
        return this.executeTimeFallback(videoPath, techniqueConfig, videoMetadata);
        
      default:
        console.warn(`[SIMPLE-SCENE-DETECTION] Unknown technique: ${techniqueName}`);
        return [];
    }
  }
  
  /**
   * Basic scene detection using FFmpeg
   */
  private async executeBasicScene(
    videoPath: string,
    threshold: number,
    _config: Record<string, any> // Unused but kept for interface compatibility
  ): Promise<number[]> {
    return new Promise((resolve, reject) => {
      const cuts: number[] = [];
      // ALWAYS use the passed threshold - no hardcoded bullshit!
      const adjustedThreshold = threshold;
      
      const ffmpegArgs = [
        '-i', videoPath,
        '-vf', `select='gt(scene,${adjustedThreshold})',showinfo`,
        '-f', 'null', '-'
      ];
      
      const proc = spawn('ffmpeg', ffmpegArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
      
      proc.stderr.on('data', (data) => {
        const str = data.toString();
        const matches = str.match(/pts_time:([0-9.]+)/g) || [];
        
        for (const match of matches) {
          const time = parseFloat(match.split(':')[1]);
          if (!isNaN(time)) {
            cuts.push(time);
          }
        }
      });
      
      proc.on('close', (code) => {
        if (code === 0) {
          resolve(cuts);
        } else {
          reject(new Error(`Basic scene detection failed with code ${code}`));
        }
      });
      
      proc.on('error', reject);
    });
  }
  
  /**
   * Motion analysis (simplified - uses scene detection as proxy)
   */
  private async executeMotionAnalysis(
    videoPath: string,
    threshold: number,
    _config: Record<string, any> // Unused but kept for interface compatibility
  ): Promise<number[]> {
    // Use a more sensitive scene detection as motion proxy
    const motionThreshold = threshold * 0.7; // More sensitive
    return this.executeBasicScene(videoPath, motionThreshold, { adaptiveThreshold: true });
  }
  
  /**
   * Histogram analysis (simplified - uses PSNR as proxy)
   */
  private async executeHistogramAnalysis(
    videoPath: string,
    threshold: number,
    _config: Record<string, any> // Unused but kept for interface compatibility
  ): Promise<number[]> {
    // NOTE: The previous approach attempted to use `select='lt(psnr,...)'` which is invalid.
    // PSNR/SSIM require two inputs and are not exposed as scalar variables in a single-stream
    // select expression. To keep this technique useful and stable, fall back to ffmpeg's
    // built-in scene change detector but with a different sensitivity curve so that the
    // histogram technique behaves distinctly from basic_scene.
    console.warn('[SIMPLE-SCENE-DETECTION] histogram_analysis uses fallback to scene metric');
    // Make this pass a bit more sensitive than basic_scene by scaling threshold down.
    const adjusted = Math.max(0.05, threshold * 0.75);
    return this.executeBasicScene(videoPath, adjusted, { adaptiveThreshold: true });
  }
  
  /**
   * Edge detection (simplified - uses scene detection with lower threshold)
   */
  private async executeEdgeDetection(
    videoPath: string,
    threshold: number,
    _config: Record<string, any> // Unused but kept for interface compatibility
  ): Promise<number[]> {
    const edgeThreshold = threshold * 0.8; // Slightly more sensitive
    return this.executeBasicScene(videoPath, edgeThreshold, { adaptiveThreshold: true });
  }
  
  /**
   * Time-based fallback segmentation
   */
  private async executeTimeFallback(
    _videoPath: string, // Unused but kept for interface compatibility
    config: Record<string, any>,
    videoMetadata?: any
  ): Promise<number[]> {
    const intervalSeconds = config.intervalSeconds || 15;
    const jitterPercent = config.jitterPercent || 0.1;
    const duration = videoMetadata?.duration || 60;
    
    const cuts: number[] = [];
    let currentTime = intervalSeconds;
    
    while (currentTime < duration) {
      // Add jitter to avoid repetitive cuts
      const jitter = (Math.random() - 0.5) * 2 * (intervalSeconds * jitterPercent);
      const adjustedTime = Math.max(0, Math.min(duration, currentTime + jitter));
      cuts.push(adjustedTime);
      currentTime += intervalSeconds;
    }
    
    return cuts;
  }
  
  /**
   * Merge nearby cuts to avoid too many similar timestamps
   */
  private mergeNearbyCuts(cuts: number[], mergeWindow: number): number[] {
    if (cuts.length === 0) return cuts;
    
    const merged: number[] = [cuts[0]];
    
    for (let i = 1; i < cuts.length; i++) {
      const lastMerged = merged[merged.length - 1];
      const current = cuts[i];
      
      if (current - lastMerged > mergeWindow) {
        merged.push(current);
      }
      // Skip cuts that are too close to the last merged cut
    }
    
    return merged;
  }
}

// Export singleton instance
export const simpleSceneDetection = new SimpleSceneDetection();
