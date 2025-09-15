import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';

export interface CoarseAnalysis {
  candidateRegions: CandidateRegion[];
  globalMotionProfile: number;    // 0-1 scale
  visualComplexity: number;       // histogram entropy average
  sceneChangeFrequency: number;   // changes per minute
  totalDuration: number;
}

export interface CandidateRegion {
  start: number;
  end: number;
  changeIntensity: number;        // 0-1 scale
  type: 'iframe_cluster' | 'motion_spike' | 'histogram_shift';
}

export interface SegmentThresholds {
  sceneThreshold: number;         // for fine scene detection
  motionThreshold: number;        // for motion-weighted sampling
  sharpnessWeight: number;        // weight of sharpness in quality score
  minKeyframes: number;           // guaranteed minimum
  maxKeyframes: number;           // hard cap
}

export enum SegmentType {
  STATIC = 'static',              // motion < 0.1, low variance
  DIALOGUE = 'dialogue',          // motion 0.1-0.3, moderate changes
  ACTION = 'action',              // motion > 0.4, high variance
  TRANSITION = 'transition'       // sharp visual changes detected
}

export interface KeyframeResult {
  segmentId: string;
  start: number;
  end: number;
  type: SegmentType;
  keyframes: string[];
  metadata: {
    motion: number;
    visualChange: number;
    keyframeCount: number;
    thresholds: SegmentThresholds;
  };
}

export class TwoPassKeyframeIndexer {
  private tempDir: string;

  constructor(tempDir: string = path.join(process.cwd(), 'tmp', 'keyframes')) {
    this.tempDir = tempDir;
  }

  /**
   * Main entry point: Index video using two-pass approach
   */
  async indexVideo(videoPath: string, videoId: string): Promise<KeyframeResult[]> {
    await fs.mkdir(this.tempDir, { recursive: true });

    console.log(`[TwoPass] Starting indexing for ${path.basename(videoPath)}`);

    // PASS 1: Fast, coarse detection of candidate regions
    const coarseAnalysis = await this.coarsePass(videoPath);
    console.log(`[TwoPass] Coarse pass found ${coarseAnalysis.candidateRegions.length} candidate regions`);

    // Create segments between candidate regions
    const segments = this.createSegments(coarseAnalysis);
    console.log(`[TwoPass] Created ${segments.length} segments for fine analysis`);

    // PASS 2: Fine-grained, adaptive keyframe extraction per segment
    const results: KeyframeResult[] = [];
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      console.log(`[TwoPass] Fine pass ${i + 1}/${segments.length}: ${segment.start.toFixed(1)}s-${segment.end.toFixed(1)}s`);
      
      const result = await this.finePass(videoPath, videoId, segment, coarseAnalysis);
      results.push(result);
    }

    console.log(`[TwoPass] Completed indexing: ${results.reduce((sum, r) => sum + r.keyframes.length, 0)} total keyframes`);
    return results;
  }

  /**
   * PASS 1: Fast coarse analysis to find candidate change regions
   */
  private async coarsePass(videoPath: string): Promise<CoarseAnalysis> {
    const analysisFile = path.join(this.tempDir, `coarse_${Date.now()}.csv`);
    
    try {
      // Extract frame info at low resolution for speed
      const frameInfo = await this.extractFrameInfo(videoPath, analysisFile);
      
      // Detect candidate regions using multiple methods
      const iframeCandidates = this.detectIFrameClusters(frameInfo);
      const motionCandidates = await this.detectMotionSpikes(videoPath, frameInfo);
      const histogramCandidates = await this.detectHistogramShifts(videoPath);
      
      // Merge and deduplicate candidates
      const allCandidates = [
        ...iframeCandidates,
        ...motionCandidates,
        ...histogramCandidates
      ].sort((a, b) => a.start - b.start);
      
      const candidateRegions = this.mergeCandidates(allCandidates);
      
      // Calculate global metrics
      const totalDuration = frameInfo.length > 0 ? frameInfo[frameInfo.length - 1].time : 0;
      const globalMotionProfile = motionCandidates.reduce((sum, c) => sum + c.changeIntensity, 0) / Math.max(1, motionCandidates.length);
      const visualComplexity = histogramCandidates.reduce((sum, c) => sum + c.changeIntensity, 0) / Math.max(1, histogramCandidates.length);
      const sceneChangeFrequency = candidateRegions.length / Math.max(1, totalDuration / 60); // per minute
      
      return {
        candidateRegions,
        globalMotionProfile: Math.min(1, globalMotionProfile),
        visualComplexity: Math.min(1, visualComplexity),
        sceneChangeFrequency,
        totalDuration
      };
      
    } finally {
      // Cleanup temp file
      try {
        await fs.unlink(analysisFile);
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Extract basic frame information using FFmpeg
   */
  private async extractFrameInfo(videoPath: string, outputFile: string): Promise<Array<{time: number, type: string}>> {
    return new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-i', videoPath,
        '-vf', 'scale=128:72,fps=2', // Low res, 2 FPS for speed
        '-select_streams', 'v',
        '-show_entries', 'frame=pkt_pts_time,pict_type',
        '-of', 'csv=p=0',
        '-f', 'null',
        '-'
      ], {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let output = '';
      let errorOutput = '';

      ffmpeg.stdout?.on('data', (data) => {
        output += data.toString();
      });

      ffmpeg.stderr?.on('data', (data) => {
        errorOutput += data.toString();
      });

      ffmpeg.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`FFmpeg failed: ${errorOutput}`));
          return;
        }

        try {
          const lines = output.trim().split('\n').filter(line => line.includes(','));
          const frames = lines.map(line => {
            const [time, type] = line.split(',');
            return { time: parseFloat(time), type: type.trim() };
          }).filter(f => !isNaN(f.time));

          resolve(frames);
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  /**
   * Detect I-frame clusters as potential scene cuts
   */
  private detectIFrameClusters(frames: Array<{time: number, type: string}>): CandidateRegion[] {
    const candidates: CandidateRegion[] = [];
    
    for (let i = 1; i < frames.length; i++) {
      const current = frames[i];
      const previous = frames[i - 1];
      
      // Consecutive I-frames often indicate scene cuts
      if (current.type === 'I' && previous.type === 'I') {
        const timeDiff = current.time - previous.time;
        if (timeDiff < 2) { // Within 2 seconds = likely related cut
          candidates.push({
            start: previous.time,
            end: current.time,
            changeIntensity: 0.7, // I-frame clusters are strong indicators
            type: 'iframe_cluster'
          });
        }
      }
    }
    
    return candidates;
  }

  /**
   * Detect motion spikes using simplified analysis
   */
  private async detectMotionSpikes(videoPath: string, frames: Array<{time: number, type: string}>): Promise<CandidateRegion[]> {
    // For now, use a simplified approach based on frame type distribution
    // In a full implementation, this would use motion vector analysis
    const candidates: CandidateRegion[] = [];
    
    // Look for regions with high P-frame density (indicates motion)
    const windowSize = 10; // frames
    for (let i = 0; i < frames.length - windowSize; i++) {
      const window = frames.slice(i, i + windowSize);
      const pFrameRatio = window.filter(f => f.type === 'P').length / windowSize;
      
      if (pFrameRatio > 0.7) { // High motion indicator
        candidates.push({
          start: window[0].time,
          end: window[windowSize - 1].time,
          changeIntensity: pFrameRatio,
          type: 'motion_spike'
        });
      }
    }
    
    return candidates;
  }

  /**
   * Detect histogram shifts (simplified implementation)
   */
  private async detectHistogramShifts(videoPath: string): Promise<CandidateRegion[]> {
    // Placeholder - in full implementation would analyze color histograms
    // For now, return empty array and rely on I-frame and motion detection
    return [];
  }

  /**
   * Merge overlapping candidate regions
   */
  private mergeCandidates(candidates: CandidateRegion[]): CandidateRegion[] {
    if (candidates.length === 0) return [];
    
    const merged: CandidateRegion[] = [];
    let current = candidates[0];
    
    for (let i = 1; i < candidates.length; i++) {
      const next = candidates[i];
      
      // Merge if overlapping or very close (within 1 second)
      if (next.start <= current.end + 1) {
        current = {
          start: current.start,
          end: Math.max(current.end, next.end),
          changeIntensity: Math.max(current.changeIntensity, next.changeIntensity),
          type: current.changeIntensity >= next.changeIntensity ? current.type : next.type
        };
      } else {
        merged.push(current);
        current = next;
      }
    }
    
    merged.push(current);
    return merged;
  }

  /**
   * Create segments between candidate regions
   */
  private createSegments(coarse: CoarseAnalysis): Array<{start: number, end: number, id: string}> {
    const segments: Array<{start: number, end: number, id: string}> = [];
    
    if (coarse.candidateRegions.length === 0) {
      // No candidates found, create one segment for entire video
      return [{
        start: 0,
        end: coarse.totalDuration,
        id: 'seg_0'
      }];
    }
    
    // Create segment from start to first candidate
    if (coarse.candidateRegions[0].start > 1) {
      segments.push({
        start: 0,
        end: coarse.candidateRegions[0].start,
        id: `seg_${segments.length}`
      });
    }
    
    // Create segments between candidates
    for (let i = 0; i < coarse.candidateRegions.length - 1; i++) {
      const current = coarse.candidateRegions[i];
      const next = coarse.candidateRegions[i + 1];
      
      segments.push({
        start: current.end,
        end: next.start,
        id: `seg_${segments.length}`
      });
    }
    
    // Create segment from last candidate to end
    const lastCandidate = coarse.candidateRegions[coarse.candidateRegions.length - 1];
    if (lastCandidate.end < coarse.totalDuration - 1) {
      segments.push({
        start: lastCandidate.end,
        end: coarse.totalDuration,
        id: `seg_${segments.length}`
      });
    }
    
    // Filter out very short segments (< 2 seconds)
    return segments.filter(s => s.end - s.start >= 2);
  }

  /**
   * PASS 2: Fine-grained keyframe extraction for a specific segment
   */
  private async finePass(
    videoPath: string, 
    videoId: string,
    segment: {start: number, end: number, id: string}, 
    coarse: CoarseAnalysis
  ): Promise<KeyframeResult> {
    
    // Derive adaptive thresholds from coarse analysis
    const thresholds = this.deriveThresholds(coarse, segment);
    
    // Classify segment type based on surrounding candidate regions
    const segmentType = this.classifySegment(segment, coarse);
    
    // Determine target keyframe count based on segment type and duration
    const duration = segment.end - segment.start;
    const targetCount = this.calculateTargetKeyframes(segmentType, duration, thresholds);
    
    // Extract keyframes using motion-weighted sampling
    const keyframes = await this.extractMotionWeightedKeyframes(
      videoPath,
      videoId,
      segment,
      targetCount,
      thresholds
    );
    
    return {
      segmentId: segment.id,
      start: segment.start,
      end: segment.end,
      type: segmentType,
      keyframes,
      metadata: {
        motion: coarse.globalMotionProfile,
        visualChange: coarse.visualComplexity,
        keyframeCount: keyframes.length,
        thresholds
      }
    };
  }

  /**
   * Derive fine-pass thresholds from coarse analysis
   */
  private deriveThresholds(coarse: CoarseAnalysis, segment: {start: number, end: number}): SegmentThresholds {
    // Base threshold depends on scene change frequency
    const baseThreshold = coarse.sceneChangeFrequency > 2 ? 0.3 : 0.5;
    
    // Adjust for motion profile
    const motionAdjustment = coarse.globalMotionProfile * 0.2;
    
    // Adjust for visual complexity
    const complexityAdjustment = coarse.visualComplexity > 0.7 ? 0.1 : -0.1;
    
    const duration = segment.end - segment.start;
    
    return {
      sceneThreshold: Math.max(0.2, Math.min(0.7, 
        baseThreshold - motionAdjustment + complexityAdjustment
      )),
      motionThreshold: coarse.globalMotionProfile * 0.8,
      sharpnessWeight: coarse.visualComplexity > 0.5 ? 0.4 : 0.2,
      minKeyframes: 1,
      maxKeyframes: Math.min(5, Math.max(1, Math.ceil(duration / 3))) // Max 1 per 3 seconds
    };
  }

  /**
   * Classify segment type based on surrounding context
   */
  private classifySegment(segment: {start: number, end: number}, coarse: CoarseAnalysis): SegmentType {
    const duration = segment.end - segment.start;
    
    // Check if segment is near candidate regions (indicates transitions)
    const nearCandidates = coarse.candidateRegions.some(c => 
      Math.abs(c.start - segment.start) < 2 || Math.abs(c.end - segment.end) < 2
    );
    
    if (nearCandidates) return SegmentType.TRANSITION;
    
    // Classify based on global characteristics and duration
    if (coarse.globalMotionProfile < 0.1) return SegmentType.STATIC;
    if (coarse.globalMotionProfile > 0.4 && coarse.visualComplexity > 0.3) return SegmentType.ACTION;
    if (duration < 10 && coarse.sceneChangeFrequency < 1) return SegmentType.DIALOGUE;
    
    return SegmentType.DIALOGUE; // Default fallback
  }

  /**
   * Calculate target keyframe count based on segment characteristics
   */
  private calculateTargetKeyframes(type: SegmentType, duration: number, thresholds: SegmentThresholds): number {
    let baseCount: number;
    
    switch (type) {
      case SegmentType.STATIC:
        baseCount = 1;
        break;
      case SegmentType.DIALOGUE:
        baseCount = Math.min(2, Math.ceil(duration / 8));
        break;
      case SegmentType.ACTION:
        baseCount = Math.min(5, Math.ceil(duration / 3));
        break;
      case SegmentType.TRANSITION:
        baseCount = Math.min(3, Math.ceil(duration / 4));
        break;
      default:
        baseCount = 1;
    }
    
    return Math.max(thresholds.minKeyframes, Math.min(thresholds.maxKeyframes, baseCount));
  }

  /**
   * Extract keyframes using motion-weighted sampling
   */
  private async extractMotionWeightedKeyframes(
    videoPath: string,
    videoId: string,
    segment: {start: number, end: number, id: string},
    targetCount: number,
    thresholds: SegmentThresholds
  ): Promise<string[]> {
    
    const keyframes: string[] = [];
    const duration = segment.end - segment.start;
    
    if (targetCount === 1) {
      // Single keyframe: pick middle with slight randomization
      const timestamp = segment.start + (duration / 2) + (Math.random() - 0.5) * Math.min(1, duration * 0.1);
      const keyframePath = path.join(this.tempDir, `${videoId}_${segment.id}_000_${timestamp.toFixed(3)}.webp`);
      
      await this.extractSingleFrame(videoPath, timestamp, keyframePath);
      keyframes.push(keyframePath);
      
    } else {
      // Multiple keyframes: evenly distributed with quality weighting
      const interval = duration / (targetCount + 1);
      
      for (let i = 1; i <= targetCount; i++) {
        const baseTimestamp = segment.start + (interval * i);
        // Add small random offset to avoid identical frames
        const timestamp = baseTimestamp + (Math.random() - 0.5) * Math.min(0.5, interval * 0.1);
        const keyframePath = path.join(this.tempDir, `${videoId}_${segment.id}_${String(i-1).padStart(3,'0')}_${timestamp.toFixed(3)}.webp`);
        
        await this.extractSingleFrame(videoPath, timestamp, keyframePath);
        keyframes.push(keyframePath);
      }
    }
    
    return keyframes;
  }

  /**
   * Extract a single frame as WebP
   */
  private async extractSingleFrame(videoPath: string, timestamp: number, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-ss', timestamp.toString(),
        '-i', videoPath,
        '-vframes', '1',
        '-f', 'webp',
        '-quality', '80',
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
          reject(new Error(`FFmpeg frame extraction failed: ${errorOutput}`));
        } else {
          resolve();
        }
      });
    });
  }
}
