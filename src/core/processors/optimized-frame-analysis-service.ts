import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { ConfigManager } from '../config.js';
// Removed unused imports to fix compilation errors

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
  path?: string;
  buffer?: Buffer;
  pHash: string;
  dHash: string;
  similarity?: number;
}

export interface OptimizedFrameOptions {
  sampleInterval?: number;
  sceneThreshold?: number;
  maxFrames?: number;
  useHardwareAccel?: boolean;
  inMemoryProcessing?: boolean;
  concurrencyLimit?: number;
  hashPrecision?: 'low' | 'medium' | 'high';
}

// Optimized frame analysis service with batch processing and hardware acceleration
export class OptimizedFrameAnalysisService {
  private ffmpegPath: string;
  private ffprobePath: string;

  constructor(ffmpegPath: string = 'ffmpeg', ffprobePath: string = 'ffprobe') {
    this.ffmpegPath = ffmpegPath;
    this.ffprobePath = ffprobePath;
  }

  // Fast scene detection using ffprobe (no frame rendering)
  async analyzeVideoScenes(
    videoPath: string,
    options: OptimizedFrameOptions = {}
  ): Promise<FrameAnalysis[]> {
    const {
      sceneThreshold = 0.15,
      maxFrames = 50
    } = options;

    return new Promise((resolve, reject) => {
      const args = [
        '-show_frames',
        '-select_streams', 'v:0',
        '-show_entries', 'frame=pkt_pts_time,pict_type',
        '-of', 'csv=print_section=0',
        '-v', 'quiet',
        videoPath
      ];

      const ffprobe = spawn(this.ffprobePath, args, {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      ffprobe.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      ffprobe.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`ffprobe failed with code ${code}`));
          return;
        }

        try {
          const results: FrameAnalysis[] = [];
          const lines = stdout.trim().split('\n');
          
          for (const line of lines) {
            if (!line.trim()) continue;
            
            const [timestamp, pictType] = line.split(',');
            const ts = parseFloat(timestamp);
            
            if (isNaN(ts)) continue;
            
            // I-frames are more likely to be scene boundaries
            const isSceneBoundary = pictType === 'I';
            
            results.push({
              timestamp: ts,
              sceneScore: isSceneBoundary ? 0.8 : 0.2,
              isSceneBoundary,
              motionScore: isSceneBoundary ? 0.5 : 0.1
            });

            if (results.length >= maxFrames) break;
          }

          resolve(results);
        } catch (error) {
          reject(new Error(`Failed to parse ffprobe output: ${error}`));
        }
      });

      ffprobe.on('error', reject);
    });
  }

  // Batch frame extraction with single FFmpeg call and optional in-memory processing
  async extractFramesBatch(
    videoPath: string,
    timestamps: number[],
    options: OptimizedFrameOptions = {}
  ): Promise<FrameHash[]> {
    const {
      useHardwareAccel = false,
      inMemoryProcessing = true,
      hashPrecision = 'medium'
    } = options;

    if (timestamps.length === 0) return [];

    if (inMemoryProcessing) {
      return this.extractFramesInMemory(videoPath, timestamps, options);
    } else {
      return this.extractFramesToDisk(videoPath, timestamps, options);
    }
  }

  // In-memory frame processing (recommended for performance)
  private async extractFramesInMemory(
    videoPath: string,
    timestamps: number[],
    options: OptimizedFrameOptions
  ): Promise<FrameHash[]> {
    const { useHardwareAccel = false, concurrencyLimit = 4 } = options;

    // Build select filter for specific timestamps
    const selectExpressions = timestamps.map((ts) => `eq(t,${ts.toFixed(3)})`);
    const selectFilter = `select='${selectExpressions.join('+')}',showinfo`;

    const cfg = ConfigManager.getConfig();
    const threads = String(cfg.video?.pipeline?.threadsPerProcess ?? 1);
    const args = [
      ...(useHardwareAccel ? this.getHardwareAccelArgs() : []),
      '-i', videoPath,
      '-an', '-sn', '-dn', // Disable audio, subtitles, data streams
      '-vf', selectFilter,
      '-f', 'image2pipe',
      '-vcodec', 'mjpeg',
      '-q:v', '2',
      '-threads', threads,
      'pipe:1'
    ];

    return new Promise((resolve, reject) => {
      const ffmpeg = spawn(this.ffmpegPath, args, {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      const frameBuffers: Buffer[] = [];
      let currentBuffer = Buffer.alloc(0);
      let stderr = '';

      // JPEG marker detection for frame boundaries
      const JPEG_START = Buffer.from([0xFF, 0xD8]);
      const JPEG_END = Buffer.from([0xFF, 0xD9]);

      ffmpeg.stdout.on('data', (chunk: Buffer) => {
        currentBuffer = Buffer.concat([currentBuffer, chunk]);
        
        // Extract complete JPEG frames
        let startIdx = 0;
        while (true) {
          const jpegStart = currentBuffer.indexOf(JPEG_START, startIdx);
          if (jpegStart === -1) break;
          
          const jpegEnd = currentBuffer.indexOf(JPEG_END, jpegStart + 2);
          if (jpegEnd === -1) break;
          
          // Extract complete JPEG frame
          const frameBuffer = currentBuffer.slice(jpegStart, jpegEnd + 2);
          frameBuffers.push(frameBuffer);
          
          startIdx = jpegEnd + 2;
        }
        
        // Keep remaining incomplete data
        if (startIdx > 0) {
          currentBuffer = currentBuffer.slice(startIdx);
        }
      });

      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ffmpeg.on('close', async (code) => {
        if (code !== 0) {
          reject(new Error(`FFmpeg failed: ${stderr}`));
          return;
        }

        try {
          // Process frames in parallel with concurrency limit
          const results = await this.processFrameBuffersParallel(
            frameBuffers, 
            timestamps, 
            options,
            concurrencyLimit
          );
          resolve(results);
        } catch (error) {
          reject(error);
        }
      });

      ffmpeg.on('error', reject);
    });
  }

  // Parallel frame buffer processing with concurrency control
  private async processFrameBuffersParallel(
    frameBuffers: Buffer[],
    timestamps: number[],
    options: OptimizedFrameOptions,
    concurrencyLimit: number
  ): Promise<FrameHash[]> {
    const results: FrameHash[] = [];
    const semaphore = new Array(concurrencyLimit).fill(null);
    
    const processFrame = async (buffer: Buffer, index: number): Promise<FrameHash> => {
      const timestamp = timestamps[index] || index;
      
      const [pHash, dHash] = await Promise.all([
        this.calculatePHashFromBuffer(buffer, options.hashPrecision),
        this.calculateDHashFromBuffer(buffer, options.hashPrecision)
      ]);

      return {
        timestamp,
        buffer,
        pHash,
        dHash
      };
    };

    // Process frames with concurrency limit
    const promises: Promise<void>[] = [];
    
    for (let i = 0; i < frameBuffers.length; i++) {
      const promise = (async () => {
        // Wait for available slot
        await new Promise(resolve => {
          const checkSlot = () => {
            const slotIndex = semaphore.findIndex(slot => slot === null);
            if (slotIndex !== -1) {
              semaphore[slotIndex] = true;
              resolve(slotIndex);
            } else {
              setTimeout(checkSlot, 10);
            }
          };
          checkSlot();
        }).then(async (slotIndex: any) => {
          try {
            const result = await processFrame(frameBuffers[i], i);
            results[i] = result;
          } finally {
            semaphore[slotIndex] = null;
          }
        });
      })();
      
      promises.push(promise);
    }

    await Promise.all(promises);
    return results.filter(Boolean);
  }

  // Hardware acceleration arguments
  private getHardwareAccelArgs(): string[] {
    const platform = process.platform;
    
    if (platform === 'darwin') {
      // macOS - VideoToolbox
      return ['-hwaccel', 'videotoolbox'];
    } else if (platform === 'linux') {
      // Linux - try VAAPI first, fallback to software
      return ['-hwaccel', 'vaapi', '-hwaccel_device', '/dev/dri/renderD128'];
    } else if (platform === 'win32') {
      // Windows - try DXVA2
      return ['-hwaccel', 'dxva2'];
    }
    
    return [];
  }

  // Optimized pHash calculation with configurable precision
  private async calculatePHashFromBuffer(
    imageBuffer: Buffer, 
    precision: 'low' | 'medium' | 'high' = 'medium'
  ): Promise<string> {
    try {
      const sharp = (await import('sharp')).default;
      
      const size = precision === 'low' ? 6 : precision === 'medium' ? 8 : 12;
      
      const { data } = await sharp(imageBuffer)
        .resize(size, size, { fit: 'fill' })
        .greyscale()
        .raw()
        .toBuffer({ resolveWithObject: true });
      
      const pixels = Array.from(data);
      const average = pixels.reduce((sum, pixel) => sum + pixel, 0) / pixels.length;
      
      let hash = '';
      for (let i = 0; i < pixels.length; i++) {
        hash += pixels[i] > average ? '1' : '0';
      }
      
      return parseInt(hash, 2).toString(16).padStart(Math.ceil(hash.length / 4), '0');
    } catch (error) {
      console.warn('pHash calculation failed, using fallback:', error);
      return crypto.createHash('md5').update(imageBuffer).digest('hex').substring(0, 16);
    }
  }

  // Optimized dHash calculation with configurable precision
  private async calculateDHashFromBuffer(
    imageBuffer: Buffer,
    precision: 'low' | 'medium' | 'high' = 'medium'
  ): Promise<string> {
    try {
      const sharp = (await import('sharp')).default;
      
      const size = precision === 'low' ? 6 : precision === 'medium' ? 8 : 12;
      
      const { data } = await sharp(imageBuffer)
        .resize(size + 1, size, { fit: 'fill' })
        .greyscale()
        .raw()
        .toBuffer({ resolveWithObject: true });
      
      const pixels = Array.from(data);
      let hash = '';
      
      for (let row = 0; row < size; row++) {
        for (let col = 0; col < size; col++) {
          const current = pixels[row * (size + 1) + col];
          const next = pixels[row * (size + 1) + col + 1];
          hash += current > next ? '1' : '0';
        }
      }
      
      return parseInt(hash, 2).toString(16).padStart(Math.ceil(hash.length / 4), '0');
    } catch (error) {
      console.warn('dHash calculation failed, using fallback:', error);
      return crypto.createHash('md5').update(imageBuffer).digest('hex').substring(0, 16);
    }
  }

  // Fallback: Extract frames to disk (for compatibility)
  private async extractFramesToDisk(
    videoPath: string,
    timestamps: number[],
    options: OptimizedFrameOptions
  ): Promise<FrameHash[]> {
    const tempDir = path.join(process.cwd(), '.temp_frames_batch');
    await fs.mkdir(tempDir, { recursive: true });

    try {
      // Build select filter for batch extraction
      const selectExpressions = timestamps.map(ts => `eq(t,${ts.toFixed(3)})`);
      const selectFilter = `select='${selectExpressions.join('+')}'`;

      const cfg2 = ConfigManager.getConfig();
      const threads2 = String(cfg2.video?.pipeline?.threadsPerProcess ?? 1);
      const args = [
        ...(options.useHardwareAccel ? this.getHardwareAccelArgs() : []),
        '-i', videoPath,
        '-an', '-sn', '-dn',
        '-vf', selectFilter,
        '-vsync', 'vfr',
        '-q:v', '2',
        '-threads', threads2,
        path.join(tempDir, 'frame_%04d.jpg')
      ];

      await new Promise<void>((resolve, reject) => {
        const ffmpeg = spawn(this.ffmpegPath, args, {
          stdio: ['pipe', 'pipe', 'pipe']
        });

        ffmpeg.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`Batch frame extraction failed with code ${code}`));
        });

        ffmpeg.on('error', reject);
      });

      // Read and hash extracted frames
      const frameFiles = await fs.readdir(tempDir);
      const framePaths = frameFiles
        .filter(f => f.endsWith('.jpg'))
        .sort()
        .map(f => path.join(tempDir, f));

      const results = await this.processFrameFilesParallel(
        framePaths,
        timestamps,
        options,
        options.concurrencyLimit || 4
      );

      return results;
    } finally {
      // Cleanup temp directory
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch (error) {
        console.warn('Failed to cleanup temp directory:', error);
      }
    }
  }

  private async processFrameFilesParallel(
    framePaths: string[],
    timestamps: number[],
    options: OptimizedFrameOptions,
    concurrencyLimit: number
  ): Promise<FrameHash[]> {
    const results: FrameHash[] = [];
    const semaphore = new Array(concurrencyLimit).fill(null);
    
    const processFrame = async (framePath: string, index: number): Promise<FrameHash> => {
      const timestamp = timestamps[index] || index;
      const buffer = await fs.readFile(framePath);
      
      const [pHash, dHash] = await Promise.all([
        this.calculatePHashFromBuffer(buffer, options.hashPrecision),
        this.calculateDHashFromBuffer(buffer, options.hashPrecision)
      ]);

      return {
        timestamp,
        path: framePath,
        buffer,
        pHash,
        dHash
      };
    };

    // Process with concurrency control (same pattern as in-memory version)
    const promises: Promise<void>[] = [];
    
    for (let i = 0; i < framePaths.length; i++) {
      const promise = (async () => {
        await new Promise(resolve => {
          const checkSlot = () => {
            const slotIndex = semaphore.findIndex(slot => slot === null);
            if (slotIndex !== -1) {
              semaphore[slotIndex] = true;
              resolve(slotIndex);
            } else {
              setTimeout(checkSlot, 10);
            }
          };
          checkSlot();
        }).then(async (slotIndex: any) => {
          try {
            const result = await processFrame(framePaths[i], i);
            results[i] = result;
          } finally {
            semaphore[slotIndex] = null;
          }
        });
      })();
      
      promises.push(promise);
    }

    await Promise.all(promises);
    return results.filter(Boolean);
  }

  // Calculate Hamming distance between hashes for similarity
  calculateHammingDistance(hash1: string, hash2: string): number {
    if (hash1.length !== hash2.length) return Infinity;
    
    let distance = 0;
    for (let i = 0; i < hash1.length; i++) {
      if (hash1[i] !== hash2[i]) distance++;
    }
    return distance;
  }

  // Filter similar frames using hash comparison
  filterSimilarFrames(
    frameHashes: FrameHash[],
    similarityThreshold: number = 5
  ): FrameHash[] {
    if (frameHashes.length <= 1) return frameHashes;

    const filtered: FrameHash[] = [frameHashes[0]];
    
    for (let i = 1; i < frameHashes.length; i++) {
      const current = frameHashes[i];
      const previous = filtered[filtered.length - 1];
      
      const pHashDistance = this.calculateHammingDistance(current.pHash, previous.pHash);
      const dHashDistance = this.calculateHammingDistance(current.dHash, previous.dHash);
      
      // Use minimum distance for better similarity detection
      const minDistance = Math.min(pHashDistance, dHashDistance);
      
      if (minDistance > similarityThreshold) {
        current.similarity = minDistance;
        filtered.push(current);
      }
    }

    return filtered;
  }
}
