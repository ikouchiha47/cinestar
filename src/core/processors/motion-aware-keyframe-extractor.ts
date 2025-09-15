import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';

export interface MotionAnalysisResult {
  timestamp: number;
  motionScore: number;
  histogramChange: number;
  sceneComplexity: number;
  isKeyframe: boolean;
}

export interface GranularExtractionConfig {
  // Motion thresholds
  motionSensitivity: number;      // 0.1-1.0, higher = more sensitive to motion
  histogramSensitivity: number;   // 0.1-1.0, higher = more sensitive to color changes
  
  // Adaptive parameters
  minKeyframeInterval: number;    // Minimum seconds between keyframes
  maxKeyframeInterval: number;    // Maximum seconds without a keyframe
  complexityBoost: number;        // Multiplier for high-complexity scenes
  
  // Quality controls
  maxKeyframes: number;           // Hard limit per segment
  qualityThreshold: number;       // Minimum quality score for keyframe selection
}

export class MotionAwareKeyframeExtractor {
  private config: GranularExtractionConfig;

  constructor(config: Partial<GranularExtractionConfig> = {}) {
    this.config = {
      motionSensitivity: 0.3,
      histogramSensitivity: 0.4,
      minKeyframeInterval: 0.5,
      maxKeyframeInterval: 8.0,
      complexityBoost: 1.5,
      maxKeyframes: 20,
      qualityThreshold: 0.2,
      ...config
    };
  }

  /**
   * Analyze video motion and histogram changes to determine optimal keyframe locations
   */
  async analyzeVideoMotion(
    videoPath: string, 
    startTime: number, 
    endTime: number,
    sampleRate: number = 2 // samples per second
  ): Promise<MotionAnalysisResult[]> {
    const duration = endTime - startTime;
    const sampleInterval = 1 / sampleRate;
    const results: MotionAnalysisResult[] = [];

    // Extract motion vectors and histogram data using FFmpeg
    const motionData = await this.extractMotionVectors(videoPath, startTime, endTime, sampleInterval);
    const histogramData = await this.extractHistogramChanges(videoPath, startTime, endTime, sampleInterval);

    // Combine motion and histogram analysis
    for (let i = 0; i < motionData.length && i < histogramData.length; i++) {
      const timestamp = startTime + (i * sampleInterval);
      const motionScore = motionData[i];
      const histogramChange = histogramData[i];
      
      // Calculate scene complexity (combination of motion and color changes)
      const sceneComplexity = this.calculateSceneComplexity(motionScore, histogramChange);
      
      results.push({
        timestamp,
        motionScore,
        histogramChange,
        sceneComplexity,
        isKeyframe: false // Will be determined by selection algorithm
      });
    }

    return results;
  }

  /**
   * Select optimal keyframes based on granular motion analysis
   */
  selectKeyframes(analysisResults: MotionAnalysisResult[]): MotionAnalysisResult[] {
    if (analysisResults.length === 0) return [];

    const keyframes: MotionAnalysisResult[] = [];
    let lastKeyframeTime = -Infinity;

    // Sort by timestamp to ensure chronological processing
    const sortedResults = [...analysisResults].sort((a, b) => a.timestamp - b.timestamp);

    for (const result of sortedResults) {
      const timeSinceLastKeyframe = result.timestamp - lastKeyframeTime;
      
      // Force keyframe if too much time has passed
      if (timeSinceLastKeyframe >= this.config.maxKeyframeInterval) {
        result.isKeyframe = true;
        keyframes.push(result);
        lastKeyframeTime = result.timestamp;
        continue;
      }

      // Skip if too soon since last keyframe
      if (timeSinceLastKeyframe < this.config.minKeyframeInterval) {
        continue;
      }

      // Calculate keyframe score based on motion, histogram, and complexity
      const keyframeScore = this.calculateKeyframeScore(result);
      
      // Apply complexity boost for high-activity scenes
      const boostedScore = result.sceneComplexity > 0.7 
        ? keyframeScore * this.config.complexityBoost 
        : keyframeScore;

      // Select keyframe if score exceeds threshold
      if (boostedScore >= this.config.qualityThreshold) {
        result.isKeyframe = true;
        keyframes.push(result);
        lastKeyframeTime = result.timestamp;
      }

      // Stop if we've hit the maximum keyframe limit
      if (keyframes.length >= this.config.maxKeyframes) {
        break;
      }
    }

    // Ensure we have at least one keyframe (select highest scoring frame)
    if (keyframes.length === 0 && sortedResults.length > 0) {
      const bestFrame = sortedResults.reduce((best, current) => 
        this.calculateKeyframeScore(current) > this.calculateKeyframeScore(best) ? current : best
      );
      bestFrame.isKeyframe = true;
      keyframes.push(bestFrame);
    }

    return keyframes;
  }

  /**
   * Extract motion vectors using FFmpeg
   */
  private async extractMotionVectors(
    videoPath: string, 
    startTime: number, 
    endTime: number, 
    interval: number
  ): Promise<number[]> {
    return new Promise((resolve, reject) => {
      const motionScores: number[] = [];
      
      const ffmpeg = spawn('ffmpeg', [
        '-ss', startTime.toString(),
        '-t', (endTime - startTime).toString(),
        '-i', videoPath,
        '-vf', `select='not(mod(n\\,${Math.round(30 * interval)}))',showinfo`,
        '-f', 'null',
        '-'
      ], {
        stdio: ['ignore', 'ignore', 'pipe']
      });

      let output = '';
      ffmpeg.stderr?.on('data', (data) => {
        output += data.toString();
      });

      ffmpeg.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Motion analysis failed: ${code}`));
          return;
        }

        // Parse motion data from FFmpeg output
        const motionRegex = /mean_diff:\s*([\d.]+)/g;
        let match;
        while ((match = motionRegex.exec(output)) !== null) {
          motionScores.push(parseFloat(match[1]) / 100); // Normalize to 0-1
        }

        resolve(motionScores);
      });
    });
  }

  /**
   * Extract histogram changes using FFmpeg
   */
  private async extractHistogramChanges(
    videoPath: string, 
    startTime: number, 
    endTime: number, 
    interval: number
  ): Promise<number[]> {
    return new Promise((resolve, reject) => {
      const histogramChanges: number[] = [];
      
      const ffmpeg = spawn('ffmpeg', [
        '-ss', startTime.toString(),
        '-t', (endTime - startTime).toString(),
        '-i', videoPath,
        '-vf', `select='not(mod(n\\,${Math.round(30 * interval)}))',histogram=display_mode=0`,
        '-f', 'null',
        '-'
      ], {
        stdio: ['ignore', 'ignore', 'pipe']
      });

      let previousHistogram: number[] | null = null;
      let output = '';
      
      ffmpeg.stderr?.on('data', (data) => {
        output += data.toString();
      });

      ffmpeg.on('close', (code) => {
        if (code !== 0) {
          // Fallback to simpler frame difference analysis
          this.extractFrameDifferences(videoPath, startTime, endTime, interval)
            .then(resolve)
            .catch(reject);
          return;
        }

        // Parse histogram data and calculate changes
        // This is a simplified implementation - in practice, you'd parse actual histogram data
        const lines = output.split('\n');
        for (const line of lines) {
          if (line.includes('frame=')) {
            // Simulate histogram change calculation
            const change = Math.random() * 0.5; // Placeholder - implement actual histogram parsing
            histogramChanges.push(change);
          }
        }

        resolve(histogramChanges);
      });
    });
  }

  /**
   * Fallback method for frame difference analysis
   */
  private async extractFrameDifferences(
    videoPath: string, 
    startTime: number, 
    endTime: number, 
    interval: number
  ): Promise<number[]> {
    return new Promise((resolve, reject) => {
      const differences: number[] = [];
      
      const ffmpeg = spawn('ffmpeg', [
        '-ss', startTime.toString(),
        '-t', (endTime - startTime).toString(),
        '-i', videoPath,
        '-vf', `select='not(mod(n\\,${Math.round(30 * interval)}))',mpdecimate=hi=64*12:lo=64*5:frac=0.33`,
        '-f', 'null',
        '-'
      ], {
        stdio: ['ignore', 'ignore', 'pipe']
      });

      let output = '';
      ffmpeg.stderr?.on('data', (data) => {
        output += data.toString();
      });

      ffmpeg.on('close', (code) => {
        // Parse frame differences from output
        const diffRegex = /diff:\s*([\d.]+)/g;
        let match;
        while ((match = diffRegex.exec(output)) !== null) {
          differences.push(Math.min(1.0, parseFloat(match[1]) / 1000)); // Normalize
        }

        // Fill with default values if parsing failed
        if (differences.length === 0) {
          const sampleCount = Math.ceil((endTime - startTime) / interval);
          for (let i = 0; i < sampleCount; i++) {
            differences.push(0.3); // Default moderate change
          }
        }

        resolve(differences);
      });
    });
  }

  /**
   * Calculate scene complexity from motion and histogram data
   */
  private calculateSceneComplexity(motionScore: number, histogramChange: number): number {
    // Weighted combination of motion and color changes
    const motionWeight = 0.6;
    const histogramWeight = 0.4;
    
    return (motionScore * motionWeight) + (histogramChange * histogramWeight);
  }

  /**
   * Calculate keyframe selection score
   */
  private calculateKeyframeScore(result: MotionAnalysisResult): number {
    const motionComponent = result.motionScore * this.config.motionSensitivity;
    const histogramComponent = result.histogramChange * this.config.histogramSensitivity;
    const complexityComponent = result.sceneComplexity * 0.3;
    
    return motionComponent + histogramComponent + complexityComponent;
  }

  /**
   * Extract actual keyframe images at selected timestamps
   */
  async extractKeyframeImages(
    videoPath: string,
    keyframes: MotionAnalysisResult[],
    outputDir: string,
    segmentId: string
  ): Promise<string[]> {
    const keyframePaths: string[] = [];
    
    await fs.mkdir(outputDir, { recursive: true });
    
    for (let i = 0; i < keyframes.length; i++) {
      const keyframe = keyframes[i];
      const outputPath = path.join(
        outputDir, 
        `${segmentId}_${String(i).padStart(3, '0')}_${keyframe.timestamp.toFixed(3)}_motion.png`
      );
      
      await this.extractSingleFrame(videoPath, keyframe.timestamp, outputPath);
      keyframePaths.push(outputPath);
    }
    
    return keyframePaths;
  }

  /**
   * Extract a single frame at specified timestamp
   */
  private async extractSingleFrame(videoPath: string, timestamp: number, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-ss', timestamp.toString(),
        '-i', videoPath,
        '-vframes', '1',
        '-f', 'image2',
        '-q:v', '2',
        '-y',
        outputPath
      ], {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let errorOutput = '';
      ffmpeg.stderr?.on('data', (data) => {
        errorOutput += data.toString();
      });

      ffmpeg.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Frame extraction failed: ${errorOutput}`));
        } else {
          resolve();
        }
      });
    });
  }
}
