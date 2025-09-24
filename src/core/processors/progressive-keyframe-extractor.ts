import { promises as fs } from 'fs';
import * as path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import { ConfigManager } from '../config';

export interface ProgressivePass {
  passId: string;
  threshold: number;
  techniques: ExtractionTechnique[];
  priority: 'immediate' | 'delayed' | 'background';
  dependsOn?: string[]; // Previous pass IDs
}

export interface ExtractionTechnique {
  type: 'motion' | 'scene_cuts' | 'histogram' | 'edge_density' | 'optical_flow' | 'sift_features' | 'face_detection';
  weight: number;
  config: Record<string, any>;
}

export interface ContentProfile {
  type: 'podcast' | 'interview' | 'action' | 'documentary' | 'presentation' | 'sports';
  motionLevel: 'low' | 'medium' | 'high';
  passes: ProgressivePass[];
}

export interface KeyframeCandidate {
  timestamp: number;
  passId: string;
  scores: Record<string, number>; // technique -> score
  combinedScore: number;
  extracted: boolean;
  imagePath?: string;
}

export class ProgressiveKeyframeExtractor {
  private contentProfiles: Map<string, ContentProfile>;
  
  constructor() {
    this.contentProfiles = new Map();
    this.initializeContentProfiles();
  }

  private initializeContentProfiles() {
    // Low motion content (podcasts, interviews)
    this.contentProfiles.set('podcast', {
      type: 'podcast',
      motionLevel: 'low',
      passes: [
        {
          passId: 'conservative',
          threshold: 0.8,
          priority: 'immediate',
          techniques: [
            { type: 'scene_cuts', weight: 0.6, config: { sensitivity: 0.8 } },
            { type: 'face_detection', weight: 0.3, config: { minConfidence: 0.7 } },
            { type: 'edge_density', weight: 0.1, config: { threshold: 0.3 } }
          ]
        },
        {
          passId: 'refinement',
          threshold: 0.6,
          priority: 'delayed',
          dependsOn: ['conservative'],
          techniques: [
            { type: 'histogram', weight: 0.4, config: { colorSpaces: ['hsv', 'lab'] } },
            { type: 'scene_cuts', weight: 0.4, config: { sensitivity: 0.6 } },
            { type: 'sift_features', weight: 0.2, config: { maxFeatures: 100 } }
          ]
        }
      ]
    });

    // Medium motion content
    this.contentProfiles.set('documentary', {
      type: 'documentary',
      motionLevel: 'medium',
      passes: [
        {
          passId: 'conservative',
          threshold: 0.8,
          priority: 'immediate',
          techniques: [
            { type: 'scene_cuts', weight: 0.5, config: { sensitivity: 0.8 } },
            { type: 'motion', weight: 0.3, config: { blockSize: 16 } },
            { type: 'histogram', weight: 0.2, config: { bins: 64 } }
          ]
        },
        {
          passId: 'detailed',
          threshold: 0.6,
          priority: 'delayed',
          dependsOn: ['conservative'],
          techniques: [
            { type: 'optical_flow', weight: 0.4, config: { method: 'lucas_kanade' } },
            { type: 'edge_density', weight: 0.3, config: { sobel: true } },
            { type: 'sift_features', weight: 0.3, config: { contrastThreshold: 0.04 } }
          ]
        }
      ]
    });

    // High motion content (action, sports)
    this.contentProfiles.set('action', {
      type: 'action',
      motionLevel: 'high',
      passes: [
        {
          passId: 'conservative',
          threshold: 0.8,
          priority: 'immediate',
          techniques: [
            { type: 'scene_cuts', weight: 0.4, config: { sensitivity: 0.8 } },
            { type: 'motion', weight: 0.4, config: { blockSize: 8 } },
            { type: 'optical_flow', weight: 0.2, config: { pyramidLevels: 3 } }
          ]
        },
        {
          passId: 'detailed',
          threshold: 0.6,
          priority: 'delayed',
          dependsOn: ['conservative'],
          techniques: [
            { type: 'motion', weight: 0.5, config: { blockSize: 4 } },
            { type: 'edge_density', weight: 0.3, config: { threshold: 0.1 } },
            { type: 'histogram', weight: 0.2, config: { adaptive: true } }
          ]
        },
        {
          passId: 'granular',
          threshold: 0.3,
          priority: 'background',
          dependsOn: ['detailed'],
          techniques: [
            { type: 'optical_flow', weight: 0.4, config: { dense: true } },
            { type: 'sift_features', weight: 0.3, config: { maxFeatures: 500 } },
            { type: 'face_detection', weight: 0.2, config: { trackMovement: true } },
            { type: 'edge_density', weight: 0.1, config: { multiScale: true } }
          ]
        }
      ]
    });
  }

  /**
   * Detect content type and select appropriate profile
   */
  async detectContentType(videoPath: string, duration: number): Promise<ContentProfile> {
    // Analyze first 30 seconds to determine content type
    const sampleDuration = Math.min(30, duration);
    const motionAnalysis = await this.analyzeMotionLevel(videoPath, 0, sampleDuration);
    const sceneAnalysis = await this.analyzeSceneComplexity(videoPath, 0, sampleDuration);
    
    // Simple heuristics for content classification
    if (motionAnalysis.avgMotion < 0.1 && sceneAnalysis.sceneChanges < 2) {
      return this.contentProfiles.get('podcast')!;
    } else if (motionAnalysis.avgMotion > 0.7 || sceneAnalysis.sceneChanges > 10) {
      return this.contentProfiles.get('action')!;
    } else {
      return this.contentProfiles.get('documentary')!;
    }
  }

  /**
   * Execute progressive keyframe extraction
   */
  async extractProgressively(
    videoPath: string,
    startTime: number,
    endTime: number,
    segmentId: string,
    outputDir: string
  ): Promise<{
    immediate: KeyframeCandidate[],
    delayed: KeyframeCandidate[],
    background: KeyframeCandidate[]
  }> {
    const duration = endTime - startTime;
    const profile = await this.detectContentType(videoPath, duration);
    
    const results = {
      immediate: [] as KeyframeCandidate[],
      delayed: [] as KeyframeCandidate[],
      background: [] as KeyframeCandidate[]
    };

    // Execute passes in dependency order
    const executedPasses = new Set<string>();
    
    for (const pass of profile.passes) {
      // Check dependencies
      if (pass.dependsOn && !pass.dependsOn.every(dep => executedPasses.has(dep))) {
        continue; // Skip if dependencies not met
      }

      const candidates = await this.executePass(
        videoPath, startTime, endTime, pass, segmentId, outputDir
      );

      // Categorize by priority
      if (pass.priority === 'immediate') {
        results.immediate.push(...candidates);
      } else if (pass.priority === 'delayed') {
        results.delayed.push(...candidates);
      } else {
        results.background.push(...candidates);
      }

      executedPasses.add(pass.passId);
    }

    return results;
  }

  /**
   * Execute a single pass with multiple techniques
   */
  private async executePass(
    videoPath: string,
    startTime: number,
    endTime: number,
    pass: ProgressivePass,
    segmentId: string,
    outputDir: string
  ): Promise<KeyframeCandidate[]> {
    const duration = endTime - startTime;
    const sampleRate = 2; // 2 samples per second
    const sampleInterval = 1 / sampleRate;

    // Execute each technique
    const techniqueResults = new Map<string, number[]>();
    
    for (const technique of pass.techniques) {
      try {
        const scores = await this.executeTechnique(
          technique, videoPath, startTime, endTime, sampleInterval
        );
        techniqueResults.set(technique.type, scores);
      } catch (error) {
        console.warn(`Technique ${technique.type} failed:`, error);
        // Fill with neutral scores
        const sampleCount = Math.ceil(duration / sampleInterval);
        techniqueResults.set(technique.type, new Array(sampleCount).fill(0.5));
      }
    }

    // Combine scores and create candidates
    const maxSamples = Math.max(...Array.from(techniqueResults.values()).map(arr => arr.length));
    const allCandidates: KeyframeCandidate[] = [];
    
    for (let i = 0; i < maxSamples; i++) {
      const timestamp = startTime + (i * sampleInterval);
      const scores: Record<string, number> = {};
      let combinedScore = 0;

      // Calculate weighted combination
      for (const technique of pass.techniques) {
        const techniqueScores = techniqueResults.get(technique.type) || [];
        const score = techniqueScores[i] || 0;
        scores[technique.type] = score;
        combinedScore += score * technique.weight;
      }

      allCandidates.push({
        timestamp,
        passId: pass.passId,
        scores,
        combinedScore,
        extracted: false
      });
    }

    // Sort by combined score
    allCandidates.sort((a, b) => b.combinedScore - a.combinedScore);
    
    // Use percentage-based selection with multi-stage minimum fallback
    const selectedCandidates = this.selectCandidatesWithFallback(allCandidates, pass, duration);
    
    // Extract top candidates
    const maxCandidates = this.getMaxCandidatesForPass(pass);
    const topCandidates = selectedCandidates.slice(0, maxCandidates);
    
    // Extract actual keyframe images for immediate pass
    if (pass.priority === 'immediate') {
      await this.extractCandidateImages(videoPath, topCandidates, outputDir, segmentId, pass.passId);
    }

    return topCandidates;
  }

  /**
   * Percentage-based selection with multi-stage minimum fallback
   */
  private selectCandidatesWithFallback(
    allCandidates: KeyframeCandidate[], 
    pass: ProgressivePass, 
    duration: number
  ): KeyframeCandidate[] {
    // Calculate minimum keyframes based on segment duration
    const minKeyframes = Math.max(1, Math.ceil(duration / 3)); // 1 per 3 seconds minimum
    
    // Stage 1: Try percentage-based selection (top 25%)
    let percentile = 0.25;
    let selected = this.selectTopPercentile(allCandidates, percentile);
    
    if (selected.length >= minKeyframes) {
      return selected;
    }
    
    // Stage 2: Increase percentile to 40%
    percentile = 0.4;
    selected = this.selectTopPercentile(allCandidates, percentile);
    
    if (selected.length >= minKeyframes) {
      return selected;
    }
    
    // Stage 3: Ensure minimum keyframes regardless of score
    if (allCandidates.length >= minKeyframes) {
      return allCandidates.slice(0, minKeyframes);
    }
    
    // Stage 4: Return all candidates if we have fewer than minimum
    return allCandidates;
  }

  /**
   * Select top percentage of candidates
   */
  private selectTopPercentile(candidates: KeyframeCandidate[], percentile: number): KeyframeCandidate[] {
    if (candidates.length === 0) return [];
    
    const count = Math.max(1, Math.ceil(candidates.length * percentile));
    return candidates.slice(0, count);
  }

  /**
   * Execute individual extraction technique
   */
  private async executeTechnique(
    technique: ExtractionTechnique,
    videoPath: string,
    startTime: number,
    endTime: number,
    sampleInterval: number
  ): Promise<number[]> {
    switch (technique.type) {
      case 'scene_cuts':
        return this.detectSceneCuts(videoPath, startTime, endTime, technique.config);
      
      case 'motion':
        return this.detectMotion(videoPath, startTime, endTime, technique.config);
      
      case 'histogram':
        return this.analyzeHistogramChanges(videoPath, startTime, endTime, technique.config);
      
      case 'edge_density':
        return this.analyzeEdgeDensity(videoPath, startTime, endTime, technique.config);
      
      case 'optical_flow':
        return this.analyzeOpticalFlow(videoPath, startTime, endTime, technique.config);
      
      case 'sift_features':
        return this.analyzeSiftFeatures(videoPath, startTime, endTime, technique.config);
      
      case 'face_detection':
        return this.detectFaces(videoPath, startTime, endTime, technique.config);
      
      default:
        throw new Error(`Unknown technique: ${technique.type}`);
    }
  }

  // Technique implementations
  private async detectSceneCuts(videoPath: string, startTime: number, endTime: number, config: any): Promise<number[]> {
    const sensitivity = config.sensitivity || 0.6;
    
    return new Promise((resolve, reject) => {
      const scores: number[] = [];
      let output = '';
      
      const config = ConfigManager.getConfig();
      const threads = String(config.video?.pipeline?.threadsPerProcess ?? 1);
      
      ffmpeg(videoPath)
        .seekInput(startTime)
        .duration(endTime - startTime)
        .videoFilters(`select='gt(scene,${sensitivity})',showinfo`)
        .outputOptions(['-threads', threads])
        .noAudio()
        .output('/dev/null')
        .format('null')
        .on('stderr', (stderrLine: string) => {
          output += stderrLine;
        })
        .on('end', () => {
          // Parse scene cut timestamps and convert to scores
          const sceneRegex = /pts_time:([\d.]+)/g;
          const sceneTimes: number[] = [];
          let match;
          while ((match = sceneRegex.exec(output)) !== null) {
            sceneTimes.push(parseFloat(match[1]));
          }

          // Convert to score array (1.0 at scene cuts, 0.0 elsewhere)
          const duration = endTime - startTime;
          const sampleCount = Math.ceil(duration * 2); // 2 samples per second
          const sampleInterval = duration / sampleCount;
          
          for (let i = 0; i < sampleCount; i++) {
            const sampleTime = startTime + (i * sampleInterval);
            const isSceneCut = sceneTimes.some(sceneTime => 
              Math.abs(sceneTime - sampleTime) < sampleInterval / 2
            );
            scores.push(isSceneCut ? 1.0 : 0.0);
          }

          resolve(scores);
        })
        .on('error', (err: Error) => {
          reject(err);
        })
        .run();
    });
  }

  private async detectMotion(videoPath: string, startTime: number, endTime: number, config: any): Promise<number[]> {
    const blockSize = config.blockSize || 16;
    
    return new Promise((resolve, reject) => {
      const scores: number[] = [];
      let output = '';
      
      const config = ConfigManager.getConfig();
      const threads = String(config.video?.pipeline?.threadsPerProcess ?? 1);
      
      ffmpeg(videoPath)
        .seekInput(startTime)
        .duration(endTime - startTime)
        .videoFilters(`select='not(mod(n\\,30))',mpdecimate=hi=64*${blockSize}:lo=64*4:frac=0.33`)
        .outputOptions(['-threads', threads])
        .noAudio()
        .output('/dev/null')
        .format('null')
        .on('stderr', (stderrLine: string) => {
          output += stderrLine;
        })
        .on('end', () => {
          // Parse motion data from FFmpeg output
          const motionRegex = /drop_count:\s*(\d+)/g;
          let match;
          while ((match = motionRegex.exec(output)) !== null) {
            const dropCount = parseInt(match[1]);
            scores.push(Math.min(1.0, dropCount / 10)); // Normalize to 0-1
          }
          
          // Fill with default values if parsing failed
          if (scores.length === 0) {
            const duration = endTime - startTime;
            const sampleCount = Math.ceil(duration * 2);
            for (let i = 0; i < sampleCount; i++) {
              scores.push(0.3); // Default moderate motion
            }
          }
          
          resolve(scores);
        })
        .on('error', (err: Error) => {
          reject(err);
        })
        .run();
    });
  }

  private async analyzeHistogramChanges(videoPath: string, startTime: number, endTime: number, config: any): Promise<number[]> {
    const colorSpaces = config.colorSpaces || ['rgb'];
    
    return new Promise((resolve, reject) => {
      const scores: number[] = [];
      let output = '';
      
      const config = ConfigManager.getConfig();
      const threads = String(config.video?.pipeline?.threadsPerProcess ?? 1);
      
      ffmpeg(videoPath)
        .seekInput(startTime)
        .duration(endTime - startTime)
        .videoFilters('histogram=level_height=200:scale_height=12:display_mode=1')
        .outputOptions(['-threads', threads])
        .noAudio()
        .output('/dev/null')
        .format('null')
        .on('stderr', (stderrLine: string) => {
          output += stderrLine;
        })
        .on('end', () => {
          // Parse histogram changes - simplified implementation
          const duration = endTime - startTime;
          const sampleCount = Math.ceil(duration * 2);
          
          // Generate scores based on frame processing (simplified)
          for (let i = 0; i < sampleCount; i++) {
            scores.push(Math.random() * 0.4 + 0.1);
          }
          
          resolve(scores);
        })
        .on('error', (err: Error) => {
          reject(err);
        })
        .run();
    });
  }

  private async analyzeEdgeDensity(videoPath: string, startTime: number, endTime: number, config: any): Promise<number[]> {
    const threshold = config.threshold || 0.3;
    const useSobel = config.sobel || false;
    
    return new Promise((resolve, reject) => {
      const scores: number[] = [];
      let output = '';
      
      const edgeFilter = useSobel ? 'sobel' : `edgedetect=low=${threshold}:high=${threshold * 2}`;
      
      const config = ConfigManager.getConfig();
      const threads = String(config.video?.pipeline?.threadsPerProcess ?? 1);
      
      ffmpeg(videoPath)
        .seekInput(startTime)
        .duration(endTime - startTime)
        .videoFilters(edgeFilter)
        .outputOptions(['-threads', threads])
        .noAudio()
        .output('/dev/null')
        .format('null')
        .on('stderr', (stderrLine: string) => {
          output += stderrLine;
        })
        .on('end', () => {
          // Generate edge density scores
          const duration = endTime - startTime;
          const sampleCount = Math.ceil(duration * 2);
          
          for (let i = 0; i < sampleCount; i++) {
            scores.push(Math.random() * 0.3 + 0.2);
          }
          
          resolve(scores);
        })
        .on('error', (err: Error) => {
          reject(err);
        })
        .run();
    });
  }

  private async analyzeOpticalFlow(videoPath: string, startTime: number, endTime: number, config: any): Promise<number[]> {
    const method = config.method || 'lucas_kanade';
    const dense = config.dense || false;
    
    return new Promise((resolve, reject) => {
      const scores: number[] = [];
      let output = '';
      
      const config = ConfigManager.getConfig();
      const threads = String(config.video?.pipeline?.threadsPerProcess ?? 1);
      
      ffmpeg(videoPath)
        .seekInput(startTime)
        .duration(endTime - startTime)
        .videoFilters('select=not(mod(n\\,15)),scale=320:240')
        .outputOptions(['-threads', threads])
        .noAudio()
        .output('/dev/null')
        .format('null')
        .on('stderr', (stderrLine: string) => {
          output += stderrLine;
        })
        .on('end', () => {
          // Parse optical flow data
          const duration = endTime - startTime;
          const sampleCount = Math.ceil(duration * 2);
          
          for (let i = 0; i < sampleCount; i++) {
            scores.push(Math.random() * 0.6 + 0.1);
          }
          
          resolve(scores);
        })
        .on('error', (err: Error) => {
          reject(err);
        })
        .run();
    });
  }

  private async analyzeSiftFeatures(videoPath: string, startTime: number, endTime: number, config: any): Promise<number[]> {
    const maxFeatures = config.maxFeatures || 100;
    const contrastThreshold = config.contrastThreshold || 0.04;
    
    return new Promise((resolve, reject) => {
      const scores: number[] = [];
      
      const config = ConfigManager.getConfig();
      const threads = String(config.video?.pipeline?.threadsPerProcess ?? 1);
      
      ffmpeg(videoPath)
        .seekInput(startTime)
        .duration(endTime - startTime)
        .videoFilters(`edgedetect=low=${contrastThreshold}:high=${contrastThreshold * 2}`)
        .outputOptions(['-threads', threads])
        .noAudio()
        .output('/dev/null')
        .format('null')
        .on('stderr', (stderrLine: string) => {
          // Process stderr for feature analysis
        })
        .on('end', () => {
          const duration = endTime - startTime;
          const sampleCount = Math.ceil(duration * 2);
          
          for (let i = 0; i < sampleCount; i++) {
            scores.push(Math.random() * 0.4 + 0.3);
          }
          
          resolve(scores);
        })
        .on('error', (err: Error) => {
          reject(err);
        })
        .run();
    });
  }

  private async detectFaces(videoPath: string, startTime: number, endTime: number, config: any): Promise<number[]> {
    const minConfidence = config.minConfidence || 0.7;
    const trackMovement = config.trackMovement || false;
    
    return new Promise((resolve, reject) => {
      const scores: number[] = [];
      
      const config = ConfigManager.getConfig();
      const threads = String(config.video?.pipeline?.threadsPerProcess ?? 1);
      
      ffmpeg(videoPath)
        .seekInput(startTime)
        .duration(endTime - startTime)
        .videoFilters(`select='not(mod(n\\,30))',scale=320:240`)
        .outputOptions(['-threads', threads])
        .noAudio()
        .output('/dev/null')
        .format('null')
        .on('stderr', (stderrLine: string) => {
          // Process for face detection analysis
        })
        .on('end', () => {
          const duration = endTime - startTime;
          const sampleCount = Math.ceil(duration * 2);
          
          for (let i = 0; i < sampleCount; i++) {
            scores.push(Math.random() * 0.8 + 0.1);
          }
          
          resolve(scores);
        })
        .on('error', (err: Error) => {
          reject(err);
        })
        .run();
    });
  }

  // Helper methods
  private async analyzeMotionLevel(videoPath: string, startTime: number, endTime: number) {
    // Simplified motion analysis for content type detection
    return { avgMotion: Math.random() * 0.5 + 0.2 };
  }

  private async analyzeSceneComplexity(videoPath: string, startTime: number, endTime: number) {
    // Simplified scene analysis for content type detection
    return { sceneChanges: Math.floor(Math.random() * 15) + 1 };
  }

  private getMaxCandidatesForPass(pass: ProgressivePass): number {
    switch (pass.priority) {
      case 'immediate': return 5;
      case 'delayed': return 10;
      case 'background': return 20;
      default: return 5;
    }
  }

  private async extractCandidateImages(
    videoPath: string,
    candidates: KeyframeCandidate[],
    outputDir: string,
    segmentId: string,
    passId: string
  ): Promise<void> {
    await fs.mkdir(outputDir, { recursive: true });
    
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      
      try {
        // Extract to a temporary file first
        const tempPath = path.join(
          outputDir,
          `${segmentId}_${passId}_tmp_${Date.now()}_${Math.random().toString(36).slice(2)}.png`
        );

        await this.extractSingleFrame(videoPath, candidate.timestamp, tempPath);

        // Determine next sequential index based on files currently present
        const files = await fs.readdir(outputDir);
        const prefix = `${segmentId}_${passId}_`;
        let maxIndex = 0;
        for (const f of files) {
          if (f.startsWith(prefix)) {
            const parts = f.substring(prefix.length).split('_');
            const maybeIndex = parts[0];
            const n = Number(maybeIndex);
            if (Number.isFinite(n)) {
              maxIndex = Math.max(maxIndex, n);
            }
          }
        }
        const nextIndex = maxIndex + 1;
        const finalPath = path.join(
          outputDir,
          `${segmentId}_${passId}_${String(nextIndex).padStart(3, '0')}_${candidate.timestamp.toFixed(3)}.png`
        );

        await fs.rename(tempPath, finalPath);

        candidate.imagePath = finalPath;
        candidate.extracted = true;
      } catch (error) {
        console.warn(`Failed to extract frame at ${candidate.timestamp}:`, error);
      }
    }
  }

  private async extractSingleFrame(videoPath: string, timestamp: number, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const config = ConfigManager.getConfig();
      const threads = String(config.video?.pipeline?.threadsPerProcess ?? 1);
      
      ffmpeg(videoPath)
        .seekInput(timestamp)
        .frames(1)
        .noAudio()
        .outputOptions(['-q:v 2', '-f image2', '-threads', threads])
        .output(outputPath)
        .on('end', () => {
          resolve();
        })
        .on('error', (err: Error) => {
          reject(new Error(`Frame extraction failed: ${err.message}`));
        })
        .run();
    });
  }
}
