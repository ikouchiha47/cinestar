import { VideoSegment } from './video-database';

export interface TemporalSearchResult {
  segment: VideoSegment;
  video: {
    id: string;
    fileName: string;
    filePath: string;
    duration: number;
  };
  score: number;
  matchType: 'text' | 'vector' | 'hybrid';
  snippet?: string;
}

export interface MergedResult {
  videoPath: string;
  startTime: number;
  endTime: number;
  duration: number;
  segments: TemporalSearchResult[];
  combinedScore: number;
  combinedTranscription: string;
  combinedCaption: string;
  combinedOcrText: string;
  thumbnailPath?: string;
}

export class TemporalMerger {
  private overlapThreshold: number;
  private maxGapDuration: number;
  private minMergedDuration: number;

  constructor(
    overlapThreshold = 0.3, // 30% overlap threshold
    maxGapDuration = 5.0,   // Maximum 5 second gap to merge
    minMergedDuration = 2.0  // Minimum 2 second merged duration
  ) {
    this.overlapThreshold = overlapThreshold;
    this.maxGapDuration = maxGapDuration;
    this.minMergedDuration = minMergedDuration;
  }

  /**
   * Merge overlapping or nearby video segments into consolidated results
   */
  mergeResults(results: TemporalSearchResult[]): MergedResult[] {
    if (results.length === 0) return [];

    // Group results by video
    const videoGroups = this.groupByVideo(results);
    const mergedResults: MergedResult[] = [];

    for (const [videoPath, videoResults] of videoGroups.entries()) {
      // Sort segments by start time
      const sortedResults = videoResults.sort((a, b) => a.segment.startTime - b.segment.startTime);
      
      // Merge overlapping segments
      const merged = this.mergeVideoSegments(videoPath, sortedResults);
      mergedResults.push(...merged);
    }

    // Sort final results by combined score
    return mergedResults.sort((a, b) => b.combinedScore - a.combinedScore);
  }

  private groupByVideo(results: TemporalSearchResult[]): Map<string, TemporalSearchResult[]> {
    const groups = new Map<string, TemporalSearchResult[]>();
    
    for (const result of results) {
      const videoPath = result.video.filePath;
      if (!groups.has(videoPath)) {
        groups.set(videoPath, []);
      }
      groups.get(videoPath)!.push(result);
    }
    
    return groups;
  }

  private mergeVideoSegments(videoPath: string, results: TemporalSearchResult[]): MergedResult[] {
    if (results.length === 0) return [];

    const merged: MergedResult[] = [];
    let currentGroup: TemporalSearchResult[] = [results[0]];

    for (let i = 1; i < results.length; i++) {
      const current = results[i];
      const lastInGroup = currentGroup[currentGroup.length - 1];

      if (this.shouldMerge(lastInGroup.segment, current.segment)) {
        currentGroup.push(current);
      } else {
        // Finalize current group and start new one
        const mergedResult = this.createMergedResult(videoPath, currentGroup);
        if (mergedResult.duration >= this.minMergedDuration) {
          merged.push(mergedResult);
        }
        currentGroup = [current];
      }
    }

    // Don't forget the last group
    const finalMergedResult = this.createMergedResult(videoPath, currentGroup);
    if (finalMergedResult.duration >= this.minMergedDuration) {
      merged.push(finalMergedResult);
    }

    return merged;
  }

  private shouldMerge(segment1: VideoSegment, segment2: VideoSegment): boolean {
    // Check for overlap
    const overlap = this.calculateOverlap(segment1, segment2);
    if (overlap > this.overlapThreshold) {
      return true;
    }

    // Check for proximity (small gap)
    const gap = segment2.startTime - segment1.endTime;
    if (gap >= 0 && gap <= this.maxGapDuration) {
      return true;
    }

    return false;
  }

  private calculateOverlap(segment1: VideoSegment, segment2: VideoSegment): number {
    const start1 = segment1.startTime;
    const end1 = segment1.endTime;
    const start2 = segment2.startTime;
    const end2 = segment2.endTime;

    const overlapStart = Math.max(start1, start2);
    const overlapEnd = Math.min(end1, end2);
    
    if (overlapStart >= overlapEnd) {
      return 0; // No overlap
    }

    const overlapDuration = overlapEnd - overlapStart;
    const totalDuration = Math.max(end1, end2) - Math.min(start1, start2);
    
    return overlapDuration / totalDuration;
  }

  private createMergedResult(videoPath: string, segments: TemporalSearchResult[]): MergedResult {
    if (segments.length === 0) {
      throw new Error('Cannot create merged result from empty segments');
    }

    // Calculate time bounds
    const startTime = Math.min(...segments.map(s => s.segment.startTime));
    const endTime = Math.max(...segments.map(s => s.segment.endTime));
    const duration = endTime - startTime;

    // Combine scores using weighted average
    const totalScore = segments.reduce((sum, s) => sum + s.score, 0);
    const combinedScore = totalScore / segments.length;

    // Combine text content
    const transcriptions = segments
      .map(s => s.segment.transcription)
      .filter(Boolean)
      .join(' ');

    const captions = segments
      .map(s => s.segment.caption)
      .filter(Boolean)
      .join(' ');

    const ocrTexts = segments
      .map(s => s.segment.ocrText)
      .filter(Boolean)
      .join(' ');

    // Use thumbnail from highest scoring segment
    const bestSegment = segments.reduce((best, current) => 
      current.score > best.score ? current : best
    );

    return {
      videoPath,
      startTime,
      endTime,
      duration,
      segments,
      combinedScore,
      combinedTranscription: transcriptions,
      combinedCaption: captions,
      combinedOcrText: ocrTexts,
      thumbnailPath: bestSegment.segment.thumbnailPath,
    };
  }

  /**
   * Merge results with custom scoring strategy
   */
  mergeWithCustomScoring(
    results: TemporalSearchResult[],
    scoringFn: (segments: TemporalSearchResult[]) => number
  ): MergedResult[] {
    const basicMerged = this.mergeResults(results);
    
    // Recalculate scores using custom function
    return basicMerged.map(merged => ({
      ...merged,
      combinedScore: scoringFn(merged.segments),
    })).sort((a, b) => b.combinedScore - a.combinedScore);
  }

  /**
   * Get configuration for temporal merging
   */
  getConfig(): { overlapThreshold: number; maxGapDuration: number; minMergedDuration: number } {
    return {
      overlapThreshold: this.overlapThreshold,
      maxGapDuration: this.maxGapDuration,
      minMergedDuration: this.minMergedDuration,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<{ overlapThreshold: number; maxGapDuration: number; minMergedDuration: number }>): void {
    if (config.overlapThreshold !== undefined) {
      this.overlapThreshold = Math.max(0, Math.min(1, config.overlapThreshold));
    }
    if (config.maxGapDuration !== undefined) {
      this.maxGapDuration = Math.max(0, config.maxGapDuration);
    }
    if (config.minMergedDuration !== undefined) {
      this.minMergedDuration = Math.max(0, config.minMergedDuration);
    }
  }
}
