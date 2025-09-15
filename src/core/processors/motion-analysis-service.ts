import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';

export interface MotionAnalysis {
  averageMotion: number;      // Overall motion intensity (0-1)
  motionVariance: number;     // Motion consistency (0-1)
  staticPeriods: number[];    // Timestamps of low motion periods
  actionPeriods: number[];    // Timestamps of high motion periods
  motionPeaks: number[];      // Timestamps of motion peaks
}

export interface MotionVector {
  timestamp: number;
  magnitude: number;
  direction: number;
}

export class MotionAnalysisService {
  private static readonly MOTION_THRESHOLD_LOW = 0.1;
  private static readonly MOTION_THRESHOLD_HIGH = 0.6;

  /**
   * Analyze motion characteristics for a video segment
   */
  async analyzeSegmentMotion(videoPath: string, startTime: number, endTime: number): Promise<MotionAnalysis> {
    const tempDir = path.join(process.cwd(), 'tmp', 'motion');
    await fs.mkdir(tempDir, { recursive: true });
    
    const motionFile = path.join(tempDir, `motion_${Date.now()}.txt`);
    
    try {
      // Use FFmpeg to extract motion vectors
      const motionVectors = await this.extractMotionVectors(videoPath, startTime, endTime, motionFile);
      
      // Analyze motion data
      const analysis = this.analyzeMotionData(motionVectors, startTime, endTime);
      
      return analysis;
    } finally {
      // Cleanup temp file
      try {
        await fs.unlink(motionFile);
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Extract motion vectors using FFmpeg
   */
  private async extractMotionVectors(
    videoPath: string, 
    startTime: number, 
    endTime: number, 
    outputFile: string
  ): Promise<MotionVector[]> {
    return new Promise((resolve, reject) => {
      const duration = endTime - startTime;
      
      const ffmpegArgs = [
        '-ss', startTime.toString(),
        '-i', videoPath,
        '-t', duration.toString(),
        '-vf', 'select=gt(scene\\,0.01),showinfo',
        '-f', 'null',
        '-'
      ];

      const ffmpeg = spawn('ffmpeg', ffmpegArgs, {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let motionData = '';
      let errorData = '';

      ffmpeg.stdout?.on('data', (data) => {
        // Motion data comes through stderr with showinfo filter
      });

      ffmpeg.stderr?.on('data', (data) => {
        const output = data.toString();
        motionData += output;
        
        // Also capture any actual errors
        if (output.includes('Error') || output.includes('error')) {
          errorData += output;
        }
      });

      ffmpeg.on('close', (code) => {
        if (code !== 0 && errorData) {
          reject(new Error(`FFmpeg motion analysis failed: ${errorData}`));
          return;
        }

        try {
          const vectors = this.parseMotionOutput(motionData, startTime);
          resolve(vectors);
        } catch (error) {
          reject(error);
        }
      });

      ffmpeg.on('error', (error) => {
        reject(new Error(`FFmpeg spawn error: ${error.message}`));
      });
    });
  }

  /**
   * Parse FFmpeg motion output to extract motion vectors
   */
  private parseMotionOutput(output: string, startOffset: number): MotionVector[] {
    const vectors: MotionVector[] = [];
    const lines = output.split('\n');
    
    for (const line of lines) {
      // Parse showinfo output for frame information
      const ptsMatch = line.match(/pts_time:(\d+\.?\d*)/);
      
      if (ptsMatch) {
        const timestamp = parseFloat(ptsMatch[1]) + startOffset;
        
        // For now, use a simplified motion estimation
        // In a more sophisticated implementation, we'd parse actual motion vectors
        const magnitude = this.estimateMotionFromLine(line);
        
        vectors.push({
          timestamp,
          magnitude,
          direction: 0 // Simplified - would need more complex parsing for direction
        });
      }
    }
    
    return vectors;
  }

  /**
   * Estimate motion magnitude from FFmpeg output line
   */
  private estimateMotionFromLine(line: string): number {
    // This is a simplified approach - in reality we'd need more sophisticated parsing
    // For now, use scene detection score as a proxy for motion
    const sceneMatch = line.match(/scene:(\d+\.?\d*)/);
    if (sceneMatch) {
      return Math.min(parseFloat(sceneMatch[1]), 1.0);
    }
    
    // Default low motion if no scene data
    return 0.1;
  }

  /**
   * Analyze motion vector data to produce motion analysis
   */
  private analyzeMotionData(vectors: MotionVector[], startTime: number, endTime: number): MotionAnalysis {
    if (vectors.length === 0) {
      return {
        averageMotion: 0.1,
        motionVariance: 0,
        staticPeriods: [startTime],
        actionPeriods: [],
        motionPeaks: []
      };
    }

    // Calculate average motion
    const totalMotion = vectors.reduce((sum, v) => sum + v.magnitude, 0);
    const averageMotion = totalMotion / vectors.length;

    // Calculate motion variance
    const variance = vectors.reduce((sum, v) => {
      const diff = v.magnitude - averageMotion;
      return sum + (diff * diff);
    }, 0) / vectors.length;
    const motionVariance = Math.sqrt(variance);

    // Identify static and action periods
    const staticPeriods: number[] = [];
    const actionPeriods: number[] = [];
    const motionPeaks: number[] = [];

    for (const vector of vectors) {
      if (vector.magnitude < MotionAnalysisService.MOTION_THRESHOLD_LOW) {
        staticPeriods.push(vector.timestamp);
      } else if (vector.magnitude > MotionAnalysisService.MOTION_THRESHOLD_HIGH) {
        actionPeriods.push(vector.timestamp);
      }

      // Identify peaks (local maxima)
      if (vector.magnitude > averageMotion + motionVariance) {
        motionPeaks.push(vector.timestamp);
      }
    }

    return {
      averageMotion: Math.min(averageMotion, 1.0),
      motionVariance: Math.min(motionVariance, 1.0),
      staticPeriods,
      actionPeriods,
      motionPeaks
    };
  }

  /**
   * Get adaptive scene detection threshold based on motion analysis
   */
  static getAdaptiveThreshold(motion: MotionAnalysis): number {
    // High action content: use lower threshold to catch more changes
    if (motion.averageMotion > 0.7) {
      return 0.3;
    }
    
    // Medium action content: balanced threshold
    if (motion.averageMotion > 0.4) {
      return 0.4;
    }
    
    // Low action content: higher threshold to avoid noise
    if (motion.averageMotion > 0.2) {
      return 0.5;
    }
    
    // Very static content: highest threshold
    return 0.6;
  }

  /**
   * Determine if segment needs fallback keyframe extraction
   */
  static needsFallback(motion: MotionAnalysis, sceneCuts: number[]): boolean {
    const segmentDuration = 10; // Assume average segment duration
    
    // Need fallback if no scene cuts detected but there's motion
    if (sceneCuts.length === 0 && motion.averageMotion > 0.2) {
      return true;
    }
    
    // Need fallback if very long segment with minimal keyframes
    if (segmentDuration > 15 && sceneCuts.length < 2) {
      return true;
    }
    
    return false;
  }

  /**
   * Get motion-weighted timestamps for fallback keyframe extraction
   */
  static getMotionWeightedTimestamps(
    motion: MotionAnalysis, 
    startTime: number, 
    endTime: number, 
    maxKeyframes: number
  ): number[] {
    const duration = endTime - startTime;
    
    // If we have motion peaks, use those
    if (motion.motionPeaks.length > 0) {
      const validPeaks = motion.motionPeaks
        .filter(peak => peak >= startTime && peak <= endTime)
        .slice(0, maxKeyframes);
      
      if (validPeaks.length > 0) {
        return validPeaks;
      }
    }
    
    // Fallback to interval-based with slight randomization to avoid repetitive frames
    const timestamps: number[] = [];
    const interval = duration / (maxKeyframes + 1);
    
    for (let i = 1; i <= maxKeyframes; i++) {
      const baseTime = startTime + (interval * i);
      // Add small random offset to avoid identical frames
      const offset = (Math.random() - 0.5) * Math.min(1, interval * 0.1);
      timestamps.push(Math.max(startTime, Math.min(endTime, baseTime + offset)));
    }
    
    return timestamps;
  }
}
