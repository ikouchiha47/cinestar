import sharp from 'sharp';
import { promises as fs } from 'fs';

/**
 * Unified image processing utilities
 * Consolidates Sharp operations for vision models, thumbnails, and compression
 * 
 * This class replaces scattered image processing logic and provides:
 * - Dynamic quality optimization based on file size
 * - Consistent Sharp pipeline across all use cases
 * - Support for both in-memory buffers and disk output
 * 
 * @see docs/ADR-IMAGE-PROCESSING-REFACTOR.md
 */
export class ImageProcessingUtils {
  
  // ============================================================================
  // Quality Optimization (Extracted from ImageCompressor)
  // ============================================================================
  
  /**
   * Get optimal JPEG quality based on file size and use case
   * 
   * @param fileSizeBytes - Original file size in bytes
   * @param useCase - Target use case (vision, thumbnail, storage)
   * @returns JPEG quality percentage (0-100)
   */
  static getOptimalQuality(fileSizeBytes: number, useCase: 'vision' | 'thumbnail' | 'storage'): number {
    const sizeMB = fileSizeBytes / (1024 * 1024);
    
    // Vision models: Balance quality vs API payload size
    if (useCase === 'vision') {
      if (sizeMB > 10) return 60;      // Very large: aggressive compression
      if (sizeMB > 5) return 70;       // Large: moderate compression
      if (sizeMB > 2) return 80;       // Medium: light compression
      return 85;                        // Small: high quality
    }
    
    // Thumbnails: Prioritize small file size
    if (useCase === 'thumbnail') {
      if (sizeMB > 10) return 45;
      if (sizeMB > 5) return 50;
      if (sizeMB > 2) return 60;
      if (sizeMB > 1) return 70;
      return 75;
    }
    
    // Storage: Balance quality and space
    if (useCase === 'storage') {
      if (sizeMB > 10) return 50;
      if (sizeMB > 5) return 60;
      if (sizeMB > 2) return 70;
      return 80;
    }
    
    return 85; // Default
  }
  
  /**
   * Get optimal dimensions based on file size and constraints
   * Large files get more aggressive dimension reduction
   * 
   * @param fileSizeBytes - Original file size in bytes
   * @param maxDims - Maximum allowed dimensions [width, height]
   * @param _useCase - Target use case (reserved for future use)
   * @returns Optimal dimensions [width, height]
   */
  static getOptimalDimensions(
    fileSizeBytes: number,
    maxDims: [number, number],
    _useCase: 'vision' | 'thumbnail' | 'storage'
  ): [number, number] {
    const sizeMB = fileSizeBytes / (1024 * 1024);
    const [maxWidth, maxHeight] = maxDims;
    
    // Very large files: reduce dimensions aggressively
    if (sizeMB > 10) {
      return [
        Math.min(maxWidth, 1024),
        Math.min(maxHeight, 576)
      ];
    }
    
    // Large files: moderate reduction
    if (sizeMB > 5) {
      return [
        Math.min(maxWidth, 1280),
        Math.min(maxHeight, 720)
      ];
    }
    
    // Use provided max dimensions
    return [maxWidth, maxHeight];
  }
  
  // ============================================================================
  // Vision Model Processing (Replaces ollama-captioning-service logic)
  // ============================================================================
  
  /**
   * Prepare image for vision model API call
   * 
   * This method performs all necessary transformations to ensure compatibility
   * with vision models (Moondream, LLaVA, etc.):
   * - Auto-rotates based on EXIF orientation
   * - Converts to sRGB colorspace (strips problematic PNG chunks like cICP)
   * - Resizes to vision model dimensions with dynamic optimization
   * - Flattens alpha channels (JPEG doesn't support transparency)
   * - Compresses to JPEG with file-size-based quality
   * - Returns in-memory buffer ready for base64 encoding
   * 
   * @param imagePath - Path to source image
   * @param visionModelDims - Target dimensions [width, height] for vision model
   * @param options - Optional overrides
   * @returns Processed image as Buffer
   * 
   * @example
   * const buffer = await ImageProcessingUtils.prepareForVisionModel(
   *   '/path/to/image.jpg',
   *   [1024, 1024]
   * );
   * const base64 = buffer.toString('base64');
   */
  static async prepareForVisionModel(
    imagePath: string,
    visionModelDims: [number, number],
    options: {
      forceQuality?: number;  // Override dynamic quality
      format?: 'jpeg' | 'png';
    } = {}
  ): Promise<Buffer> {
    // Read original file
    const stats = await fs.stat(imagePath);
    const imageBuffer = await fs.readFile(imagePath);
    
    // Start Sharp pipeline
    let img = sharp(imageBuffer)
      .rotate()                          // Auto-rotate based on EXIF
      .toColorspace('srgb');             // Strip problematic PNG chunks
    
    // Get metadata
    const metadata = await img.metadata();
    
    // Validate image
    if (!metadata.width || !metadata.height) {
      throw new Error('Invalid image metadata');
    }
    
    // Get optimal dimensions based on file size
    const [maxWidth, maxHeight] = this.getOptimalDimensions(
      stats.size,
      visionModelDims,
      'vision'
    );
    
    // Resize if needed
    if (metadata.width > maxWidth || metadata.height > maxHeight) {
      img = img.resize(maxWidth, maxHeight, {
        fit: 'inside',
        withoutEnlargement: true
      });
    }
    
    // Flatten alpha channels (JPEG doesn't support alpha)
    img = img.flatten({ background: { r: 0, g: 0, b: 0 } });
    
    // Get optimal quality
    const quality = options.forceQuality ?? this.getOptimalQuality(stats.size, 'vision');
    
    // Compress
    const format = options.format ?? 'jpeg';
    if (format === 'jpeg') {
      img = img.jpeg({
        quality,
        progressive: false,
        mozjpeg: true
      });
    } else {
      img = img.png({
        compressionLevel: 9,
        progressive: true
      });
    }
    
    // Return buffer
    return img.toBuffer();
  }
  
  // ============================================================================
  // Thumbnail Generation (For UI display)
  // ============================================================================
  
  /**
   * Create thumbnail and save to disk
   * Used for caching UI thumbnails
   * 
   * @param imagePath - Source image path
   * @param outputPath - Destination path for thumbnail
   * @param options - Thumbnail options
   * @returns Metadata about created thumbnail
   * 
   * @example
   * const info = await ImageProcessingUtils.createThumbnail(
   *   '/path/to/image.jpg',
   *   '/cache/thumbnails/abc123.jpg',
   *   { maxWidth: 400, maxHeight: 300 }
   * );
   * console.log(`Created ${info.width}x${info.height} thumbnail (${info.size} bytes)`);
   */
  static async createThumbnail(
    imagePath: string,
    outputPath: string,
    options: {
      maxWidth?: number;
      maxHeight?: number;
      quality?: number;
      format?: 'jpeg' | 'webp' | 'png';
    } = {}
  ): Promise<{
    width: number;
    height: number;
    size: number;
    format: string;
  }> {
    const {
      maxWidth = 400,
      maxHeight = 300,
      quality,
      format = 'jpeg'
    } = options;
    
    // Get file size for quality optimization
    const stats = await fs.stat(imagePath);
    const optimalQuality = quality ?? this.getOptimalQuality(stats.size, 'thumbnail');
    
    // Process image
    let img = sharp(imagePath)
      .rotate()
      .resize(maxWidth, maxHeight, {
        fit: 'inside',
        withoutEnlargement: true
      });
    
    // Apply format
    switch (format) {
      case 'jpeg':
        img = img.jpeg({ quality: optimalQuality, mozjpeg: true });
        break;
      case 'webp':
        img = img.webp({ quality: optimalQuality, effort: 6 });
        break;
      case 'png':
        img = img.png({ compressionLevel: 9 });
        break;
    }
    
    // Save to disk
    const info = await img.toFile(outputPath);
    
    return {
      width: info.width,
      height: info.height,
      size: info.size,
      format: info.format
    };
  }
  
  // ============================================================================
  // General Compression (For storage optimization)
  // ============================================================================
  
  /**
   * Compress image for storage
   * Similar to ImageCompressor but with unified logic
   * 
   * @param inputPath - Source image path
   * @param outputPath - Destination path
   * @param options - Compression options
   * @returns Compression statistics
   * 
   * @example
   * const result = await ImageProcessingUtils.compressImage(
   *   '/path/to/large-image.jpg',
   *   '/path/to/compressed.jpg'
   * );
   * console.log(`Saved ${result.compressionRatio.toFixed(1)}%`);
   */
  static async compressImage(
    inputPath: string,
    outputPath: string,
    options: {
      maxWidth?: number;
      maxHeight?: number;
      quality?: number;
      format?: 'jpeg' | 'webp' | 'png';
    } = {}
  ): Promise<{
    originalSize: number;
    compressedSize: number;
    compressionRatio: number;
    dimensions: { width: number; height: number };
  }> {
    const stats = await fs.stat(inputPath);
    const originalSize = stats.size;
    
    const {
      maxWidth = 1920,
      maxHeight = 1080,
      format = 'jpeg'
    } = options;
    
    // Get optimal quality if not provided
    const quality = options.quality ?? this.getOptimalQuality(originalSize, 'storage');
    
    // Process
    let img = sharp(inputPath)
      .rotate()
      .toColorspace('srgb')
      .resize(maxWidth, maxHeight, {
        fit: 'inside',
        withoutEnlargement: true
      });
    
    // Flatten if JPEG
    if (format === 'jpeg') {
      img = img.flatten({ background: { r: 0, g: 0, b: 0 } });
    }
    
    // Apply format
    switch (format) {
      case 'jpeg':
        img = img.jpeg({ quality, mozjpeg: true });
        break;
      case 'webp':
        img = img.webp({ quality, effort: 6 });
        break;
      case 'png':
        img = img.png({ compressionLevel: 9 });
        break;
    }
    
    // Save
    const info = await img.toFile(outputPath);
    const compressedSize = info.size;
    
    return {
      originalSize,
      compressedSize,
      compressionRatio: ((originalSize - compressedSize) / originalSize) * 100,
      dimensions: {
        width: info.width,
        height: info.height
      }
    };
  }
  
  // ============================================================================
  // Utility Methods
  // ============================================================================
  
  /**
   * Get image metadata without loading full image
   * Fast metadata extraction using Sharp
   * 
   * @param imagePath - Path to image
   * @returns Image metadata
   */
  static async getMetadata(imagePath: string): Promise<{
    width: number;
    height: number;
    format: string;
    size: number;
  }> {
    const [metadata, stats] = await Promise.all([
      sharp(imagePath).metadata(),
      fs.stat(imagePath)
    ]);
    
    return {
      width: metadata.width || 0,
      height: metadata.height || 0,
      format: metadata.format || 'unknown',
      size: stats.size
    };
  }
  
  /**
   * Check if image needs compression
   * 
   * @param fileSize - File size in bytes
   * @param minSizeBytes - Minimum size threshold (default 100KB)
   * @returns True if file should be compressed
   */
  static shouldCompress(fileSize: number, minSizeBytes: number = 100 * 1024): boolean {
    return fileSize > minSizeBytes;
  }
}
