import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { ConfigManager } from '../config.js';
import { ImageCompressor } from '../image-compressor';

// Frame analysis results
export interface FrameAnalysis {
  timestamp: number;
  sceneScore?: number;
  motionScore?: number;
  complexity?: number;
  isSceneBoundary?: boolean;
}

export interface FrameHash {
  timestamp: number;
  path: string;
  compressedPath?: string;
  pHash: string;
  dHash: string;
  similarity?: number;
}

// Extensible frame analysis service using FFmpeg
export class FrameAnalysisService {
  private ffmpegPath: string;

  constructor(ffmpegPath: string = 'ffmpeg') {
    this.ffmpegPath = ffmpegPath;
  }

  // Fast frame sampling with basic scene detection
  async analyzeVideoFrames(
    videoPath: string, 
    options: {
      sampleInterval?: number;     // Sample every N frames (default: 30)
      sceneThreshold?: number;     // Scene detection threshold (default: 0.15)
      maxFrames?: number;          // Maximum frames to analyze (default: 50)
    } = {}
  ): Promise<FrameAnalysis[]> {
    const config = ConfigManager.getConfig();
    const {
      sampleInterval = config.video?.frameSelection?.sampleInterval || 30,
      sceneThreshold = config.video?.frameSelection?.sceneThreshold || 0.15,
      maxFrames = config.video?.frameSelection?.maxCandidateFrames || 50
    } = options;

    return new Promise((resolve, reject) => {
      const results: FrameAnalysis[] = [];
      
      // FFmpeg command for lightweight analysis
      const args = [
        '-i', videoPath,
        '-vf', `select='not(mod(n,${sampleInterval}))+gt(scene,${sceneThreshold})',showinfo`,
        '-f', 'null',
        '-'
      ];

      const ffmpeg = spawn(this.ffmpegPath, args, {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stderr = '';
      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ffmpeg.on('close', (code) => {
        console.log(`[FFmpeg Analysis] Process exited with code: ${code}`);
        console.log(`[FFmpeg Analysis] stderr length: ${stderr.length}`);
        
        if (code !== 0) {
          console.error(`[FFmpeg Analysis] FFmpeg failed with stderr:`, stderr.substring(0, 500));
          
          reject(new Error(`FFmpeg analysis failed (exit code ${code}): ${stderr.substring(0, 200)}`));
          return;
        }

        try {
          // Parse using string operations instead of regex
          const lines = stderr.split('\n');
          const showinfoLines = lines.filter(line => 
            line.includes('showinfo') && 
            line.includes('n:') && 
            line.includes('pts_time:')
          );
          
          console.log(`[FFmpeg Analysis] Found ${showinfoLines.length} showinfo frame lines`);
          
          if (showinfoLines.length === 0) {
            console.warn(`[FFmpeg Analysis] No showinfo frame data found. FFmpeg version may be incompatible.`);
            console.warn(`[FFmpeg Analysis] Expected format: 'n: X pts_time: Y'`);
            console.warn(`[FFmpeg Analysis] Sample stderr:`, stderr.substring(0, 500));

            resolve([]); // Return empty array instead of failing
            return;
          }

          for (const line of showinfoLines) {
            try {
              // Parse frame number: look for "n:" followed by number
              const nMatch = line.match(/n:\s*(\d+)/);
              if (!nMatch) continue;
              
              // Parse timestamp: look for "pts_time:" followed by number
              const ptsMatch = line.match(/pts_time:([\d.]+)/);
              if (!ptsMatch) continue;
              
              const frameNumber = parseInt(nMatch[1]);
              const timestamp = parseFloat(ptsMatch[1]);
              
              // Validate parsed values
              if (isNaN(frameNumber) || isNaN(timestamp)) {
                console.warn(`[FFmpeg Analysis] Invalid frame data: n=${frameNumber}, pts_time=${timestamp}`);
                continue;
              }
              
              // Since we're using select filter with scene detection, 
              // frames that pass the filter are scene-relevant
              const estimatedSceneScore = 0.2;

              results.push({
                timestamp,
                sceneScore: estimatedSceneScore,
                isSceneBoundary: true,
                motionScore: estimatedSceneScore
              });

              if (results.length >= maxFrames) break;
            } catch (lineError) {
              console.warn(`[FFmpeg Analysis] Failed to parse line: ${line}`, lineError);
              continue;
            }
          }
          
          console.log(`[FFmpeg Analysis] Successfully parsed ${results.length} frames from ${showinfoLines.length} lines`);
          resolve(results);
          
        } catch (parseError) {
          console.error(`[FFmpeg Analysis] Parsing error:`, parseError);

          const errorMessage = parseError instanceof Error ? parseError.message : String(parseError);
          reject(new Error(`FFmpeg output parsing failed: ${errorMessage}`));
        }
      });

      ffmpeg.on('error', reject);
    });
  }

  // Extract frames at specific timestamps with optional compression
  async extractFrames(
    videoPath: string, 
    timestamps: number[], 
    outputDir: string,
    options: {
      compressForVision?: boolean;
      visionModelDims?: [number, number];
      quality?: number;
    } = {}
  ): Promise<string[]> {
    await fs.mkdir(outputDir, { recursive: true });
    const framePaths: string[] = [];

    for (const timestamp of timestamps) {
      const framePath = path.join(outputDir, `frame_${timestamp.toFixed(3)}.jpg`);
      
      await new Promise<void>((resolve, reject) => {
        const args = [
          '-ss', timestamp.toString(),
          '-i', videoPath,
          '-vframes', '1',
          '-q:v', options.quality?.toString() || '2',
          '-y',
          framePath
        ];

        const ffmpeg = spawn(this.ffmpegPath, args, {
          stdio: ['pipe', 'pipe', 'pipe']
        });

        ffmpeg.on('close', (code) => {
          if (code === 0) {
            framePaths.push(framePath);
            resolve();
          } else {
            reject(new Error(`Frame extraction failed for timestamp ${timestamp}`));
          }
        });

        ffmpeg.on('error', reject);
      });
    }

    return framePaths;
  }

  // Generate perceptual hashes for frames with optional compression
  async generatePerceptualHashes(
    framePaths: string[],
    options: {
      compressForVision?: boolean;
      visionModelDims?: [number, number];
    } = {}
  ): Promise<FrameHash[]> {
    const hashes: FrameHash[] = [];

    for (const framePath of framePaths) {
      try {
        const timestamp = this.extractTimestampFromPath(framePath);
        let processedPath = framePath;
        let compressedPath: string | undefined;
        
        // Compress frame for vision model if requested
        if (options.compressForVision) {
          const frameDir = path.dirname(framePath);
          const compressedDir = path.join(frameDir, 'compressed');
          
          const stats = await fs.stat(framePath);
          const compressionSettings = ImageCompressor.getOptimalSettings(
            framePath, 
            stats.size, 
            options.visionModelDims
          );
          
          const compressionResult = await ImageCompressor.compressImage(
            framePath,
            compressedDir,
            compressionSettings
          );
          
          compressedPath = compressionResult.compressedPath;
          processedPath = compressedPath; // Use compressed version for hashing
        }
        
        const imageBuffer = await fs.readFile(processedPath);
        
        // Generate multiple hash types for robustness
        const pHash = await this.calculatePHash(imageBuffer);
        const dHash = await this.calculateDHash(imageBuffer);

        hashes.push({
          timestamp,
          path: framePath,
          compressedPath,
          pHash,
          dHash
        });
      } catch (error) {
        console.warn(`Failed to hash frame ${framePath}:`, error);
      }
    }

    return hashes;
  }

  // Calculate perceptual hash (pHash) - best for similarity detection
  private async calculatePHash(imageBuffer: Buffer): Promise<string> {
    try {
      const sharp = (await import('sharp')).default;
      
      // Resize to 8x8 grayscale for pHash
      const { data } = await sharp(imageBuffer)
        .resize(8, 8, { fit: 'fill' })
        .greyscale()
        .raw()
        .toBuffer({ resolveWithObject: true });
      
      // Calculate average pixel value
      const pixels = Array.from(data);
      const average = pixels.reduce((sum, pixel) => sum + pixel, 0) / pixels.length;
      
      // Generate hash based on pixels above/below average
      let hash = '';
      for (let i = 0; i < pixels.length; i++) {
        hash += pixels[i] > average ? '1' : '0';
      }
      
      // Convert binary to hex
      return parseInt(hash, 2).toString(16).padStart(16, '0');
    } catch (error) {
      console.warn('pHash calculation failed, using fallback:', error);
      return crypto.createHash('md5').update(imageBuffer).digest('hex').substring(0, 16);
    }
  }

  // Calculate difference hash (dHash) - good for structural changes
  private async calculateDHash(imageBuffer: Buffer): Promise<string> {
    try {
      const sharp = (await import('sharp')).default;
      
      // Resize to 9x8 grayscale for dHash (need 9 width for 8 differences)
      const { data } = await sharp(imageBuffer)
        .resize(9, 8, { fit: 'fill' })
        .greyscale()
        .raw()
        .toBuffer({ resolveWithObject: true });
      
      const pixels = Array.from(data);
      let hash = '';
      
      // Compare adjacent pixels horizontally
      for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
          const leftPixel = pixels[row * 9 + col];
          const rightPixel = pixels[row * 9 + col + 1];
          hash += leftPixel > rightPixel ? '1' : '0';
        }
      }
      
      // Convert binary to hex
      return parseInt(hash, 2).toString(16).padStart(16, '0');
    } catch (error) {
      console.warn('dHash calculation failed, using fallback:', error);
      return crypto.createHash('sha1').update(imageBuffer).digest('hex').substring(0, 16);
    }
  }

  // Calculate Hamming distance between two hashes
  calculateHammingDistance(hash1: string, hash2: string): number {
    if (hash1.length !== hash2.length) return 1.0;
    
    let differences = 0;
    for (let i = 0; i < hash1.length; i++) {
      if (hash1[i] !== hash2[i]) differences++;
    }
    
    return differences / hash1.length;
  }

  // Filter similar frames using perceptual hashing with scene boundary priority
  filterSimilarFrames(
    frameHashes: FrameHash[], 
    similarityThreshold: number = 0.15,
    sceneBoundaries: number[] = []
  ): FrameHash[] {
    if (frameHashes.length === 0) return [];
    
    const filtered: FrameHash[] = [frameHashes[0]]; // Always keep first frame
    
    for (let i = 1; i < frameHashes.length; i++) {
      const current = frameHashes[i];
      const previous = filtered[filtered.length - 1];
      
      // Check if frame is near scene boundary (priority frames)
      const isSceneBoundary = sceneBoundaries.some(boundary => 
        Math.abs(current.timestamp - boundary) < 2.0
      );
      
      // Use pHash for primary similarity detection
      const pHashSimilarity = this.calculateHammingDistance(current.pHash, previous.pHash);
      // Use dHash for structural change detection
      const dHashSimilarity = this.calculateHammingDistance(current.dHash, previous.dHash);
      
      // Combined similarity score (weighted average)
      const combinedSimilarity = (pHashSimilarity * 0.7) + (dHashSimilarity * 0.3);
      current.similarity = combinedSimilarity;
      
      // Keep frame if:
      // 1. Sufficiently different (combined similarity)
      // 2. Near scene boundary (always keep)
      // 3. Structural change detected (dHash difference)
      if (combinedSimilarity > similarityThreshold || 
          isSceneBoundary || 
          dHashSimilarity > 0.2) {
        filtered.push(current);
      }
    }
    
    return filtered;
  }

  // Extract timestamp from frame filename
  private extractTimestampFromPath(framePath: string): number {
    const match = framePath.match(/frame_([\d.]+)\.jpg$/);
    return match ? parseFloat(match[1]) : 0;
  }

  // Unified frame selection algorithm combining all filtering methods
  async selectOptimalFrames(
    videoPath: string,
    options: {
      maxFrames?: number;
      sampleInterval?: number;
      sceneThreshold?: number;
      similarityThreshold?: number;
      compressForVision?: boolean;
      visionModelDims?: [number, number];
    } = {}
  ): Promise<FrameHash[]> {
    const config = ConfigManager.getConfig();
    const {
      maxFrames = config.video?.frameSelection?.maxFinalFrames || 20,
      sampleInterval = config.video?.frameSelection?.sampleInterval || 30,
      sceneThreshold = config.video?.frameSelection?.sceneThreshold || 0.15,
      similarityThreshold = config.video?.frameSelection?.similarityThreshold || 0.15,
      compressForVision = true,
      visionModelDims
    } = options;

    console.log(`[Frame Selection] Starting optimal frame selection for: ${path.basename(videoPath)}`);
    console.log(`[Frame Selection] Options:`, { maxFrames, sampleInterval, sceneThreshold, similarityThreshold });

    // Stage 1: FFmpeg Motion Analysis
    const frameAnalysis = await this.analyzeVideoFrames(videoPath, {
      sampleInterval,
      sceneThreshold,
      maxFrames: maxFrames * 3 // Analyze more candidates
    });
    console.log(`[Frame Selection] Stage 1: Analyzed ${frameAnalysis.length} candidate frames`);

    if (frameAnalysis.length === 0) {
      console.warn(`[Frame Selection] No frames analyzed from video, returning empty result`);
      return [];
    }

    // Stage 2: Extract Scene Boundaries
    const sceneBoundaries = frameAnalysis
      .filter(f => f.isSceneBoundary)
      .map(f => f.timestamp);
    console.log(`[Frame Selection] Stage 2: Found ${sceneBoundaries.length} scene boundaries`);

    // Stage 3: Extract Frames
    const outputDir = path.join(path.dirname(videoPath), '.temp_frames');
    const timestamps = frameAnalysis.map(f => f.timestamp);
    const extractedFrames = await this.extractFrames(videoPath, timestamps, outputDir);
    console.log(`[Frame Selection] Stage 3: Extracted ${extractedFrames.length} frames to ${outputDir}`);

    if (extractedFrames.length === 0) {
      console.warn(`[Frame Selection] No frames extracted, returning empty result`);
      return [];
    }

    // Stage 4: Generate Perceptual Hashes
    const frameHashes = await this.generatePerceptualHashes(extractedFrames, {
      compressForVision,
      visionModelDims
    });
    console.log(`[Frame Selection] Stage 4: Generated hashes for ${frameHashes.length} frames`);

    if (frameHashes.length === 0) {
      console.warn(`[Frame Selection] No frame hashes generated, returning empty result`);
      return [];
    }

    // Stage 5: Apply Combined Filtering
    const filteredFrames = this.filterSimilarFrames(
      frameHashes,
      similarityThreshold,
      sceneBoundaries
    );
    console.log(`[Frame Selection] Stage 5: Filtered to ${filteredFrames.length} unique frames`);

    // Stage 6: Priority Selection (scene boundaries + temporal distribution)
    const finalFrames = this.selectFinalFrames(filteredFrames, maxFrames, sceneBoundaries);
    console.log(`[Frame Selection] Stage 6: Selected ${finalFrames.length} final frames`);

    // Don't cleanup temp directory - captioning processor needs the files
    // Cleanup will be handled by the pipeline or system temp cleanup
    console.log(`[Frame Selection] Keeping frames in ${outputDir} for downstream processors`);

    return finalFrames;
  }

  // Select final frames with scene boundary priority and temporal distribution
  private selectFinalFrames(
    frameHashes: FrameHash[],
    maxFrames: number,
    sceneBoundaries: number[]
  ): FrameHash[] {
    if (frameHashes.length <= maxFrames) {
      return frameHashes;
    }

    // Priority 1: Frames near scene boundaries
    const boundaryFrames = frameHashes.filter(frame =>
      sceneBoundaries.some(boundary => Math.abs(frame.timestamp - boundary) < 2.0)
    );

    // Priority 2: Remaining frames with good temporal distribution
    const remainingFrames = frameHashes.filter(frame =>
      !sceneBoundaries.some(boundary => Math.abs(frame.timestamp - boundary) < 2.0)
    );

    const selected: FrameHash[] = [];
    
    // Add boundary frames first (up to half of maxFrames)
    const maxBoundaryFrames = Math.min(boundaryFrames.length, Math.floor(maxFrames / 2));
    selected.push(...boundaryFrames.slice(0, maxBoundaryFrames));

    // Fill remaining slots with evenly distributed frames
    const remainingSlots = maxFrames - selected.length;
    if (remainingSlots > 0 && remainingFrames.length > 0) {
      const step = Math.max(1, Math.floor(remainingFrames.length / remainingSlots));
      for (let i = 0; i < remainingFrames.length && selected.length < maxFrames; i += step) {
        selected.push(remainingFrames[i]);
      }
    }

    // Sort by timestamp for consistent ordering
    return selected.sort((a, b) => a.timestamp - b.timestamp);
  }

  // Extensible analysis pipeline - ready for histogram integration
  async analyzeFrameContent(
    framePath: string,
    analysisTypes: ('histogram' | 'complexity' | 'faces' | 'objects')[] = []
  ): Promise<Record<string, any>> {
    const results: Record<string, any> = {};

    // Placeholder for future analysis types
    for (const analysisType of analysisTypes) {
      switch (analysisType) {
        case 'histogram':
          // Future: FFmpeg histogram analysis
          results.histogram = await this.analyzeHistogram(framePath);
          break;
        case 'complexity':
          // Future: Visual complexity scoring
          results.complexity = await this.analyzeComplexity(framePath);
          break;
        case 'faces':
          // Future: Face detection
          results.faces = await this.detectFaces(framePath);
          break;
        case 'objects':
          // Future: Object detection
          results.objects = await this.detectObjects(framePath);
          break;
      }
    }

    return results;
  }

  // Placeholder methods for future extensibility
  private async analyzeHistogram(_framePath: string): Promise<any> {
    // TODO: Implement FFmpeg histogram analysis
    return null;
  }

  private async analyzeComplexity(_framePath: string): Promise<number> {
    // TODO: Implement visual complexity scoring
    return 0;
  }

  private async detectFaces(_framePath: string): Promise<any[]> {
    // TODO: Implement face detection
    return [];
  }

  private async detectObjects(_framePath: string): Promise<any[]> {
    // TODO: Implement object detection
    return [];
  }
}
