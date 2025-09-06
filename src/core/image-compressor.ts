import sharp from 'sharp';
import { promises as fs } from 'fs';
import path from 'path';

export interface CompressionOptions {
  resizeDims?: [number, number]; // [width, height] override for vision models
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  format?: 'jpeg' | 'webp' | 'png';
  preserveOriginal?: boolean;
}

export interface CompressionResult {
  originalPath: string;
  compressedPath: string;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  format: string;
  dimensions: {
    width: number;
    height: number;
  };
}

export class ImageCompressor {
  private static readonly DEFAULT_OPTIONS: CompressionOptions = {
    maxWidth: 1280,
    maxHeight: 720,
    quality: 60,
    format: 'jpeg',
    preserveOriginal: false
  };

  /**
   * Compress an image file using Sharp (libvips)
   */
  static async compressImage(
    inputPath: string,
    outputDir: string,
    options: CompressionOptions = {}
  ): Promise<CompressionResult> {
    const startTime = Date.now();
    const opts = { ...this.DEFAULT_OPTIONS, ...options };
    
    console.log(`🗜️  [COMPRESS] Starting compression: ${path.basename(inputPath)}`);
    console.log(`   Options: ${opts.maxWidth}x${opts.maxHeight}, quality: ${opts.quality}%, format: ${opts.format}`);

    try {
      // Get original file stats
      const originalStats = await fs.stat(inputPath);
      const originalSize = originalStats.size;

      // Create output directory if it doesn't exist
      await fs.mkdir(outputDir, { recursive: true });

      // Generate output filename
      const inputExt = path.extname(inputPath);
      const inputName = path.basename(inputPath, inputExt);
      const outputExt = opts.format === 'jpeg' ? '.jpg' : `.${opts.format}`;
      const outputPath = path.join(outputDir, `${inputName}_compressed${outputExt}`);

      // Load and process the image
      let sharpInstance = sharp(inputPath);

      // Get original metadata
      const metadata = await sharpInstance.metadata();
      console.log(`   Original: ${metadata.width}x${metadata.height}, ${(originalSize / 1024).toFixed(1)}KB`);

      // Resize for vision model if resizeDims provided
      if (opts.resizeDims && opts.resizeDims.length === 2) {
        sharpInstance = sharpInstance.resize(opts.resizeDims[0], opts.resizeDims[1], {
          fit: 'fill',
          withoutEnlargement: false
        });
        console.log(`   Resizing to vision model dims: ${opts.resizeDims[0]}x${opts.resizeDims[1]}`);
      } else if (metadata.width && metadata.height) {
        if (metadata.width > opts.maxWidth! || metadata.height > opts.maxHeight!) {
          sharpInstance = sharpInstance.resize(opts.maxWidth, opts.maxHeight, {
            fit: 'inside',
            withoutEnlargement: true
          });
          console.log(`   Resizing to fit within ${opts.maxWidth}x${opts.maxHeight}`);
        }
      }

      // Apply format and quality settings
      switch (opts.format) {
        case 'jpeg':
          sharpInstance = sharpInstance.jpeg({ 
            quality: opts.quality,
            progressive: false,
            mozjpeg: true
          });
          break;
        case 'webp':
          sharpInstance = sharpInstance.webp({ 
            quality: opts.quality,
            effort: 6
          });
          break;
        case 'png':
          sharpInstance = sharpInstance.png({ 
            compressionLevel: 9,
            progressive: true
          });
          break;
      }

      // Save the compressed image
      const compressStart = Date.now();
      await sharpInstance.toFile(outputPath);
      const compressTime = Date.now() - compressStart;

      // Get compressed file stats
      const compressedStats = await fs.stat(outputPath);
      const compressedSize = compressedStats.size;

      // Get final dimensions
      const finalMetadata = await sharp(outputPath).metadata();
      const compressionRatio = ((originalSize - compressedSize) / originalSize) * 100;

      const totalTime = Date.now() - startTime;
      console.log(`   ✅ Compressed in ${totalTime}ms (processing: ${compressTime}ms)`);
      console.log(`   Result: ${finalMetadata.width}x${finalMetadata.height}, ${(compressedSize / 1024).toFixed(1)}KB`);
      console.log(`   Savings: ${compressionRatio.toFixed(1)}% (${((originalSize - compressedSize) / 1024).toFixed(1)}KB saved)`);

      return {
        originalPath: inputPath,
        compressedPath: outputPath,
        originalSize,
        compressedSize,
        compressionRatio,
        format: opts.format!,
        dimensions: {
          width: finalMetadata.width || 0,
          height: finalMetadata.height || 0
        }
      };

    } catch (error) {
      const errorTime = Date.now() - startTime;
      console.error(`   ❌ Compression failed after ${errorTime}ms:`, error);
      throw new Error(`Image compression failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Check if a file should be compressed based on size and format
   */
  static shouldCompress(filePath: string, fileSize: number): boolean {
    const ext = path.extname(filePath).toLowerCase();
    const supportedFormats = ['.jpg', '.jpeg', '.png', '.tiff', '.tif', '.bmp'];
    
    // Only compress supported formats
    if (!supportedFormats.includes(ext)) {
      return false;
    }

    // Compress files larger than 100KB
    const minSizeForCompression = 100 * 1024; // 100KB
    return fileSize > minSizeForCompression;
  }

  /**
   * Get optimal compression settings based on file size and format
   */
  static getOptimalSettings(_filePath: string, fileSize: number, visionModelDims?: [number, number]): CompressionOptions {
    const sizeMB = fileSize / (1024 * 1024);

    // Base settings - use PNG for maximum compatibility with vision models
    let options: CompressionOptions = {
      resizeDims: visionModelDims, // Use vision model dimensions if provided
      maxWidth: 1920,
      maxHeight: 1080,
      quality: 80,
      format: 'png',
      preserveOriginal: false
    };

    // Adjust based on file size - targeting max 500KB for large files
    if (sizeMB > 10) {
      // Very large files - very aggressive compression
      options.maxWidth = 1024;
      options.maxHeight = 576;
      options.quality = 45;
    } else if (sizeMB > 5) {
      // Large files (5MB+) - aggressive compression to reach ~500KB max
      options.maxWidth = 1280;
      options.maxHeight = 720;
      options.quality = 50;
    } else if (sizeMB > 2) {
      // Medium-large files - moderate compression
      options.maxWidth = 1280;
      options.maxHeight = 720;
      options.quality = 60;
    } else if (sizeMB > 1) {
      // Medium files - light compression
      options.maxWidth = 1280;
      options.maxHeight = 720;
      options.quality = 70;
    } else {
      // Small files - minimal compression, just format optimization
      options.quality = 75;
    }

    // Force PNG format for all files to ensure vision model compatibility
    options.format = 'png';

    return options;
  }
}
