import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { ConfigManager } from '../config.js';
import { PassThrough } from 'stream';
// FFmpeg/FFprobe paths are configured centrally in electron/main.ts via ffmpeg-bootstrap

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

export interface FluentFrameOptions {
  sampleInterval?: number;
  sceneThreshold?: number;
  maxFrames?: number;
  useHardwareAccel?: boolean;
  inMemoryProcessing?: boolean;
  concurrencyLimit?: number;
  hashPrecision?: 'low' | 'medium' | 'high';
  outputCodec?: 'png' | 'mjpeg';
  computeDHash?: boolean; // default true; set false to compute only pHash
}

// NOTE: This service is NOT used in the main electron app pipeline.
// It's only used in dev/test scenarios and benchmark scripts.
// The main pipeline uses functions in src/core/video-processing.ts instead.
//
// Fluent-ffmpeg based frame analysis service with optimizations
export class FluentFrameAnalysisService {
  constructor() {}

  // Fast scene detection using fluent-ffmpeg
  async analyzeVideoScenes(
    videoPath: string,
    options: FluentFrameOptions = {}
  ): Promise<FrameAnalysis[]> {
    const config = ConfigManager.getConfig();
    const threads = String(config.video?.pipeline?.threadsPerProcess ?? 1);
    const {
      sceneThreshold = config.video?.frameSelection?.sceneThreshold || 0.15,
      maxFrames = config.video?.frameSelection?.maxCandidateFrames || 50,
      sampleInterval = config.video?.frameSelection?.sampleInterval || 30
    } = options;

    return new Promise((resolve, reject) => {
      const results: FrameAnalysis[] = [];
      let stderr = '';

      const command = ffmpeg(videoPath)
        .noAudio()
        .inputOptions(['-sn', '-dn'])
        .videoFilters([
          `select='not(mod(n,${sampleInterval}))+gt(scene,${sceneThreshold})'`,
          'showinfo'
        ])
        .outputOptions(['-f', 'null', '-threads', threads])
        .output('-');

      // Add hardware acceleration if requested
      if (options.useHardwareAccel) {
        this.addHardwareAcceleration(command);
      }

      command.on('stderr', (stderrLine: string) => {
        stderr += stderrLine + '\n';
      });

      

      command.on('end', () => {
        try {
          // Parse showinfo output
          const lines = stderr.split('\n');
          const showinfoLines = lines.filter(line => 
            line.includes('showinfo') && 
            line.includes('n:') && 
            line.includes('pts_time:')
          );

          for (const line of showinfoLines) {
            try {
              const nMatch = line.match(/n:\s*(\d+)/);
              const ptsMatch = line.match(/pts_time:([\d.]+)/);
              
              if (!nMatch || !ptsMatch) continue;
              
              const frameNumber = parseInt(nMatch[1]);
              const timestamp = parseFloat(ptsMatch[1]);
              
              if (isNaN(frameNumber) || isNaN(timestamp)) continue;
              
              // Frames that pass the scene filter are scene boundaries
              results.push({
                timestamp,
                sceneScore: 0.8,
                isSceneBoundary: true,
                motionScore: 0.5
              });

              if (results.length >= maxFrames) break;
            } catch (lineError) {
              console.warn(`Failed to parse line: ${line}`, lineError);
              continue;
            }
          }

          resolve(results);
        } catch (parseError) {
          reject(new Error(`Failed to parse ffmpeg output: ${parseError}`));
        }
      });

      command.on('error', (err) => {
        reject(new Error(`FFmpeg scene analysis failed: ${err.message}`));
      });

      command.run();
    });
  }

  // Probe actual pts_time emitted by a select filter for the given timestamps
  async probeSelectedTimestamps(
    videoPath: string,
    timestamps: number[]
  ): Promise<number[]> {
    const config = ConfigManager.getConfig();
    const threads = String(config.video?.pipeline?.threadsPerProcess ?? 1);
    const selectExpressions = timestamps.map(ts => `eq(t,${ts.toFixed(3)})`);
    const selectFilter = `select='${selectExpressions.join('+')}'`;

    return new Promise<number[]>((resolve, reject) => {
      let stderr = '';
      const command = ffmpeg(videoPath)
        .noAudio()
        .inputOptions(['-sn', '-dn'])
        .videoFilters([selectFilter, 'showinfo'])
        .outputOptions(['-f', 'null', '-threads', threads])
        .output('-');

      command.on('stderr', (line: string) => { stderr += line + '\n'; });
      command.on('end', () => {
        try {
          const lines = stderr.split('\n');
          const showinfo = lines.filter(l => l.includes('showinfo') && l.includes('pts_time:'));
          const pts: number[] = [];
          for (const l of showinfo) {
            const m = l.match(/pts_time:([\d.]+)/);
            if (m) {
              const t = parseFloat(m[1]);
              if (!isNaN(t)) pts.push(t);
            }
          }
          resolve(pts);
        } catch (e) {
          reject(e);
        }
      });
      command.on('error', (err) => reject(new Error(`FFmpeg probe failed: ${err.message}`)));
      command.run();
    });
  }

  // Audit frames: extract in-memory, compute hashes + distances, capture actual pts_time
  async auditFrames(
    videoPath: string,
    timestamps: number[],
    options: { codec?: 'png' | 'mjpeg'; computeDHash?: boolean; outPath?: string; hashPrecision?: 'low'|'medium'|'high' }
  ): Promise<{
    requested: number[];
    actual: number[];
    frames: Array<{
      index: number;
      requestedTimestamp: number;
      actualTimestamp: number | null;
      pHash: string;
      dHash: string;
      pDistPrev: number | null;
      dDistPrev: number | null;
      byteLength: number;
      width?: number;
      height?: number;
    }>;
  }> {
    const codec = options.codec === 'png' ? 'png' : 'mjpeg';
    const computeDHash = options.computeDHash === true;

    const frames = await this.extractFramesInMemory(videoPath, timestamps, {
      outputCodec: codec,
      inMemoryProcessing: true,
      computeDHash,
      hashPrecision: options.hashPrecision || 'medium'
    });

    const actual = await this.probeSelectedTimestamps(videoPath, timestamps);

    const results: Array<{
      index: number; requestedTimestamp: number; actualTimestamp: number | null; pHash: string; dHash: string; pDistPrev: number | null; dDistPrev: number | null; byteLength: number; width?: number; height?: number;
    }> = [];

    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      let width: number | undefined;
      let height: number | undefined;
      try {
        const meta = await (await import('sharp')).default(f.buffer!).metadata();
        width = meta.width;
        height = meta.height;
      } catch {}
      const prev = i > 0 ? frames[i - 1] : null;
      const pDistPrev = prev ? this.calculateHammingDistance(f.pHash, prev.pHash) : null;
      const dDistPrev = prev ? (f.dHash && prev.dHash ? this.calculateHammingDistance(f.dHash, prev.dHash) : null) : null;
      results.push({
        index: i,
        requestedTimestamp: timestamps[i] ?? i,
        actualTimestamp: actual[i] ?? null,
        pHash: f.pHash,
        dHash: f.dHash,
        pDistPrev,
        dDistPrev,
        byteLength: f.buffer ? f.buffer.length : 0,
        width,
        height,
      });
    }

    const report = { requested: timestamps, actual, frames: results };
    if (options.outPath) {
      try {
        const { default: fsp } = await import('fs/promises');
        await fsp.mkdir(path.dirname(options.outPath), { recursive: true });
        await fsp.writeFile(options.outPath, JSON.stringify(report, null, 2));
      } catch (e) {
        console.warn('Failed to write audit report:', e);
      }
    }
    return report;
  }

  // Batch frame extraction with fluent-ffmpeg
  async extractFramesBatch(
    videoPath: string,
    timestamps: number[],
    options: FluentFrameOptions = {}
  ): Promise<FrameHash[]> {
    if (timestamps.length === 0) return [];

    // Prefer in-memory, but fall back to disk if anything looks off
    if (options.inMemoryProcessing !== false) {
      try {
        const results = await this.extractFramesInMemory(videoPath, timestamps, options);
        // If we didn't get at least half the requested frames, fall back to disk for reliability
        if (!Array.isArray(results) || results.length < Math.max(1, Math.floor(timestamps.length / 2))) {
          return await this.extractFramesToDisk(videoPath, timestamps, options);
        }
        return results;
      } catch (e) {
        return await this.extractFramesToDisk(videoPath, timestamps, options);
      }
    } else {
      return this.extractFramesToDisk(videoPath, timestamps, options);
    }
  }

  // In-memory frame extraction using fluent-ffmpeg streams
  private async extractFramesInMemory(
    videoPath: string,
    timestamps: number[],
    options: FluentFrameOptions
  ): Promise<FrameHash[]> {
    const config = ConfigManager.getConfig();
    const threads = String(config.video?.pipeline?.threadsPerProcess ?? 1);
    const { concurrencyLimit = config.video?.pipeline?.concurrencyLimit || 4 } = options;

    // Build select filter for specific timestamps
    const selectExpressions = timestamps.map(ts => `eq(t,${ts.toFixed(3)})`);
    const selectFilter = `select='${selectExpressions.join('+')}'`;

    return new Promise((resolve, reject) => {
      const frameBuffers: Buffer[] = [];
      let currentBuffer = Buffer.alloc(0);
      const outputStream = new PassThrough();

      // Default to MJPEG unless explicitly set to PNG
      const codec = options.outputCodec === 'png' ? 'png' : 'mjpeg';

      const command = ffmpeg(videoPath)
        .noAudio()
        .seekInput(timestamps[0])
        .videoFilters([selectFilter])
        .outputFormat('image2pipe')
        .outputOptions([
          '-vcodec', codec,
          '-frames:v', String(timestamps.length),
          '-vsync', '0',
          '-threads', threads
        ]);

      // Add hardware acceleration if requested
      if (options.useHardwareAccel) {
        this.addHardwareAcceleration(command);
      }

      // Stream to memory
      command.pipe(outputStream, { end: true });

      // Frame boundary detection
      const JPEG_START = Buffer.from([0xFF, 0xD8]);
      const JPEG_END = Buffer.from([0xFF, 0xD9]);
      const PNG_SIG = Buffer.from([0x89, 0x50, 0x4E, 0x47]);
      const PNG_IEND = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82]);

      outputStream.on('data', (chunk: Buffer) => {
        currentBuffer = Buffer.concat([currentBuffer, chunk]);

        if (codec === 'mjpeg') {
          // Extract complete JPEG frames
          let startIdx = 0;
          while (true) {
            const jpegStart = currentBuffer.indexOf(JPEG_START, startIdx);
            if (jpegStart === -1) break;
            const jpegEnd = currentBuffer.indexOf(JPEG_END, jpegStart + 2);
            if (jpegEnd === -1) break;
            const frameBuffer = currentBuffer.slice(jpegStart, jpegEnd + 2);
            frameBuffers.push(frameBuffer);
            startIdx = jpegEnd + 2;
          }
          if (startIdx > 0) currentBuffer = currentBuffer.slice(startIdx);
        } else {
          // Extract complete PNG frames
          let idx = 0;
          while (true) {
            const start = currentBuffer.indexOf(PNG_SIG, idx);
            if (start === -1) break;
            const end = currentBuffer.indexOf(PNG_IEND, start + 8);
            if (end === -1) break;
            const frameBuffer = currentBuffer.slice(start, end + PNG_IEND.length);
            frameBuffers.push(frameBuffer);
            idx = end + PNG_IEND.length;
          }
          if (idx > 0) currentBuffer = currentBuffer.slice(idx);
        }
      });

      outputStream.on('end', async () => {
        try {
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

      command.on('error', (err) => {
        reject(new Error(`FFmpeg frame extraction failed: ${err.message}`));
      });

      command.run();
    });
  }

  // Explicit MJPEG in-memory extraction for testing purposes
  async extractFramesInMemoryMJPEG(
    videoPath: string,
    timestamps: number[],
    options: Omit<FluentFrameOptions, 'outputCodec'> = {}
  ): Promise<FrameHash[]> {
    return this.extractFramesInMemory(videoPath, timestamps, {
      ...options,
      outputCodec: 'mjpeg',
      inMemoryProcessing: true,
    });
  }

  // Batch frame extraction to disk using fluent-ffmpeg
  private async extractFramesToDisk(
    videoPath: string,
    timestamps: number[],
    options: FluentFrameOptions
  ): Promise<FrameHash[]> {
    const tempDir = path.join(process.cwd(), '.temp_frames_fluent');
    await fs.mkdir(tempDir, { recursive: true });

    try {
      const cfg = ConfigManager.getConfig();
      const threads = String(cfg.video?.pipeline?.threadsPerProcess ?? 1);
      // Build select filter for batch extraction
      const selectExpressions = timestamps.map(ts => `eq(t,${ts.toFixed(3)})`);
      const selectFilter = `select='${selectExpressions.join('+')}'`;

      await new Promise<void>((resolve, reject) => {
        const command = ffmpeg(videoPath)
          .noAudio()
          .videoFilters([selectFilter])
          .outputFormat('image2')
          .outputOptions([
            '-vcodec', 'png',
            '-threads', threads
          ])
          .output(`${tempDir}/frame_%03d.png`);

        // Add hardware acceleration if requested
        if (options.useHardwareAccel) {
          this.addHardwareAcceleration(command);
        }

        command.on('end', () => resolve());
        command.on('error', (err: any) => {
          reject(new Error(`Batch frame extraction failed: ${err.message}`));
        });

        command.run();
      });

      // Process extracted frames
      const frameFiles = await fs.readdir(tempDir);
      const framePaths = frameFiles
        .filter(f => f.endsWith('.png'))
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

  // Extract single frame at specific timestamp using fluent-ffmpeg
  async extractSingleFrame(
    videoPath: string,
    timestamp: number,
    outputPath?: string
  ): Promise<string> {
    const finalOutputPath = outputPath || path.join(
      process.cwd(), 
      '.temp_frames', 
      `frame_${timestamp.toFixed(3)}.jpg`
    );

    await fs.mkdir(path.dirname(finalOutputPath), { recursive: true });

    return new Promise((resolve, reject) => {
      const cfg = ConfigManager.getConfig();
      const threads = String(cfg.video?.pipeline?.threadsPerProcess ?? 1);
      const command = ffmpeg(videoPath)
        .seekInput(timestamp)
        .noAudio()
        .frames(1)
        .outputOptions([
          '-vcodec', 'mjpeg',
          '-qscale:v', '2',
          '-pix_fmt', 'yuvj420p',
          '-threads', threads
        ])
        .output(finalOutputPath);

      command.on('end', () => resolve(finalOutputPath));
      command.on('error', (err) => {
        reject(new Error(`Single frame extraction failed: ${err.message}`));
      });

      command.run();
    });
  }

  // Generate thumbnails using fluent-ffmpeg
  async generateThumbnails(
    videoPath: string,
    timestamps: number[],
    outputDir: string,
    options: { width?: number; height?: number; quality?: number } = {}
  ): Promise<string[]> {
    const { width = 320, height = 240, quality = 2 } = options;
    await fs.mkdir(outputDir, { recursive: true });

    const thumbnailPaths: string[] = [];

    for (let i = 0; i < timestamps.length; i++) {
      const timestamp = timestamps[i];
      const outputPath = path.join(outputDir, `thumb_${i.toString().padStart(3, '0')}.jpg`);

      await new Promise<void>((resolve, reject) => {
        const cfg = ConfigManager.getConfig();
        const threads = String(cfg.video?.pipeline?.threadsPerProcess ?? 1);
        const command = ffmpeg(videoPath)
          .seekInput(timestamp)
          .noAudio()
          .frames(1)
          .size(`${width}x${height}`)
          .outputOptions([
            '-vcodec', 'mjpeg',
            '-qscale:v', quality.toString(),
            '-pix_fmt', 'yuvj420p',
            '-threads', threads
          ])
          .output(outputPath);

        command.on('end', () => {
          thumbnailPaths.push(outputPath);
          resolve();
        });

        command.on('error', (err) => {
          reject(new Error(`Thumbnail generation failed: ${err.message}`));
        });

        command.run();
      });
    }

    return thumbnailPaths;
  }

  // Add hardware acceleration to fluent-ffmpeg command
  private addHardwareAcceleration(command: ffmpeg.FfmpegCommand): void {
    const platform = process.platform;
    
    if (platform === 'darwin') {
      // macOS - VideoToolbox
      command.inputOptions(['-hwaccel', 'videotoolbox']);
    } else if (platform === 'linux') {
      // Linux - VAAPI
      command.inputOptions([
        '-hwaccel', 'vaapi',
        '-hwaccel_device', '/dev/dri/renderD128'
      ]);
    } else if (platform === 'win32') {
      // Windows - DXVA2
      command.inputOptions(['-hwaccel', 'dxva2']);
    }
  }

  // Parallel frame buffer processing with concurrency control
  private async processFrameBuffersParallel(
    frameBuffers: Buffer[],
    timestamps: number[],
    options: FluentFrameOptions,
    concurrencyLimit: number
  ): Promise<FrameHash[]> {
    const results: FrameHash[] = [];
    const semaphore = new Array(concurrencyLimit).fill(null);
    
    const processFrame = async (buffer: Buffer, index: number): Promise<FrameHash> => {
      const timestamp = timestamps[index] || index;
      
      const pHash = await this.calculatePHashFromBuffer(buffer, options.hashPrecision);
      const computeD = options.computeDHash === true;
      const dHash = computeD
        ? await this.calculateDHashFromBuffer(buffer, options.hashPrecision)
        : ''.padStart(pHash.length, '0');

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

  private async processFrameFilesParallel(
    framePaths: string[],
    timestamps: number[],
    options: FluentFrameOptions,
    concurrencyLimit: number
  ): Promise<FrameHash[]> {
    const results: FrameHash[] = [];
    const semaphore = new Array(concurrencyLimit).fill(null);
    
    const processFrame = async (framePath: string, index: number): Promise<FrameHash> => {
      const timestamp = timestamps[index] || index;
      const buffer = await fs.readFile(framePath);
      
      const pHash = await this.calculatePHashFromBuffer(buffer, options.hashPrecision);
      const dHash = options.computeDHash === false
        ? ''.padStart(pHash.length, '0')
        : await this.calculateDHashFromBuffer(buffer, options.hashPrecision);

      return {
        timestamp,
        path: framePath,
        buffer,
        pHash,
        dHash
      };
    };

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
      
      const minDistance = Math.min(pHashDistance, dHashDistance);
      
      if (minDistance > similarityThreshold) {
        current.similarity = minDistance;
        filtered.push(current);
      }
    }

    return filtered;
  }

  // pHash-only variant of similarity filtering
  filterSimilarFramesPHash(
    frameHashes: FrameHash[],
    pHashThreshold: number = 5
  ): FrameHash[] {
    if (frameHashes.length <= 1) return frameHashes;

    const filtered: FrameHash[] = [frameHashes[0]];
    for (let i = 1; i < frameHashes.length; i++) {
      const current = frameHashes[i];
      const previous = filtered[filtered.length - 1];
      const pHashDistance = this.calculateHammingDistance(current.pHash, previous.pHash);
      if (pHashDistance > pHashThreshold) {
        current.similarity = pHashDistance;
        filtered.push(current);
      }
    }
    return filtered;
  }
}
