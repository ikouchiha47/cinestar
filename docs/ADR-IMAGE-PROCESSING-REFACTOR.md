# ADR: Image Processing Utilities Refactoring

**Date:** 2025-10-10  
**Status:** Proposed  
**Deciders:** Engineering Team

---

## Context

We currently have **two separate image processing implementations** with overlapping functionality:

### 1. `ollama-captioning-service.ts` (Lines 18-52)
**Purpose:** Prepare images for vision model API calls

**Operations:**
- Auto-rotate (EXIF orientation)
- Convert to sRGB colorspace (strips problematic PNG chunks)
- Resize to vision model dimensions
- Flatten alpha channels
- JPEG compression (quality 85%)
- Return in-memory buffer

**Issues:**
- Hardcoded quality (85%)
- No dynamic optimization based on file size
- Duplicates Sharp logic

### 2. `image-compressor.ts`
**Purpose:** Compress images for storage/thumbnails

**Operations:**
- Resize to max dimensions
- Dynamic quality based on file size (`getOptimalSettings()`)
- Multiple format support (JPEG, WebP, PNG)
- Save to disk

**Issues:**
- Missing critical operations (rotate, colorspace, flatten)
- Outputs to file, not buffer
- Not used anywhere in codebase
- Incomplete for current needs

### Problems:

1. **Code duplication** - Sharp processing logic scattered
2. **Inconsistent quality** - Captioning uses fixed 85%, compressor has dynamic logic
3. **Missing optimization** - Large images (10MB+) sent to vision models without aggressive compression
4. **Maintenance burden** - Two places to update Sharp logic
5. **Unused code** - `ImageCompressor` written but never integrated

---

## Decision

Create a **unified `ImageProcessingUtils`** class that:

1. **Consolidates Sharp operations** into reusable methods
2. **Extracts quality optimization logic** from `ImageCompressor`
3. **Supports both use cases** (API buffers + disk thumbnails)
4. **Provides consistent image processing** across the codebase

### Architecture:

```
┌─────────────────────────────────────────────────────────────┐
│ ImageProcessingUtils (New)                                   │
│                                                              │
│ ┌──────────────────────────────────────────────────────┐   │
│ │ Core Operations (Private)                            │   │
│ │ - rotate()                                           │   │
│ │ - toSRGB()                                           │   │
│ │ - flattenAlpha()                                     │   │
│ │ - resize()                                           │   │
│ │ - compress()                                         │   │
│ └──────────────────────────────────────────────────────┘   │
│                                                              │
│ ┌──────────────────────────────────────────────────────┐   │
│ │ Quality Optimization (Extracted from ImageCompressor)│   │
│ │ - getOptimalQuality(fileSize, targetUseCase)        │   │
│ │ - getOptimalDimensions(fileSize, maxDims)           │   │
│ └──────────────────────────────────────────────────────┘   │
│                                                              │
│ ┌──────────────────────────────────────────────────────┐   │
│ │ Public API                                           │   │
│ │ - prepareForVisionModel() → Buffer                  │   │
│ │ - createThumbnail() → saves to disk                 │   │
│ │ - compressImage() → saves to disk                   │   │
│ └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ ImageCompressor (Deprecated)                                 │
│ - Mark as deprecated with comment                           │
│ - Keep for backward compatibility                           │
│ - Will be removed in future version                         │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation

### File: `src/core/image-processing-utils.ts`

```typescript
import sharp from 'sharp';
import { promises as fs } from 'fs';

/**
 * Unified image processing utilities
 * Consolidates Sharp operations for vision models, thumbnails, and compression
 */
export class ImageProcessingUtils {
  
  // ============================================================================
  // Quality Optimization (Extracted from ImageCompressor)
  // ============================================================================
  
  /**
   * Get optimal JPEG quality based on file size and use case
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
   */
  static getOptimalDimensions(
    fileSizeBytes: number,
    maxDims: [number, number],
    useCase: 'vision' | 'thumbnail' | 'storage'
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
   * - Auto-rotates based on EXIF
   * - Converts to sRGB (strips problematic PNG chunks)
   * - Resizes to vision model dimensions
   * - Flattens alpha channels
   * - Compresses to JPEG with dynamic quality
   * - Returns in-memory buffer
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
   */
  static shouldCompress(fileSize: number, minSizeBytes: number = 100 * 1024): boolean {
    return fileSize > minSizeBytes;
  }
}
```

---

## Migration Plan

### Phase 1: Create ImageProcessingUtils
- [ ] Create `src/core/image-processing-utils.ts`
- [ ] Implement quality optimization methods
- [ ] Implement `prepareForVisionModel()`
- [ ] Implement `createThumbnail()`
- [ ] Implement `compressImage()`
- [ ] Add unit tests

### Phase 2: Update Captioning Service
- [ ] Replace inline Sharp code in `ollama-captioning-service.ts`
- [ ] Use `ImageProcessingUtils.prepareForVisionModel()`
- [ ] Test with various image sizes
- [ ] Verify quality improvements for large files

**Before:**
```typescript
// ollama-captioning-service.ts (lines 18-52)
let imageBuffer = await fs.readFile(imagePath);
let img = sharp(imageBuffer).rotate().toColorspace('srgb');
// ... 30+ lines of Sharp code
imageBuffer = await img.toBuffer();
```

**After:**
```typescript
// ollama-captioning-service.ts
const imageBuffer = await ImageProcessingUtils.prepareForVisionModel(
  imagePath,
  config.ai.visionModelDims
);
```

### Phase 3: Deprecate ImageCompressor
- [ ] Add deprecation comment to `image-compressor.ts`
- [ ] Update any existing usages (currently none)
- [ ] Plan removal for next major version

### Phase 4: Future Enhancements
- [ ] Integrate with thumbnail caching system
- [ ] Add WebP support for modern browsers
- [ ] Batch processing optimization
- [ ] Progress callbacks for large files

---

## Deprecation Notice for ImageCompressor

Add to top of `src/core/image-compressor.ts`:

```typescript
/**
 * @deprecated This class is deprecated and will be removed in a future version.
 * 
 * Use `ImageProcessingUtils` instead for all image processing needs:
 * - Vision model preparation: `ImageProcessingUtils.prepareForVisionModel()`
 * - Thumbnail generation: `ImageProcessingUtils.createThumbnail()`
 * - General compression: `ImageProcessingUtils.compressImage()`
 * 
 * Reasons for deprecation:
 * 1. Missing critical operations (rotate, colorspace conversion, alpha flattening)
 * 2. Incomplete implementation for current needs
 * 3. Code duplication with captioning service
 * 4. Not integrated into any existing workflows
 * 
 * Migration: See ADR-IMAGE-PROCESSING-REFACTOR.md
 * 
 * @see ImageProcessingUtils
 */
```

---

## Benefits

### 1. Code Consolidation
- **Before:** 2 implementations, ~200 lines duplicated
- **After:** 1 unified utility, ~300 lines total
- **Savings:** ~100 lines, easier maintenance

### 2. Dynamic Quality Optimization
- **Before:** Fixed 85% quality for all images
- **After:** 60-85% based on file size
- **Impact:** 10MB image → 60% quality → ~40% smaller payload to vision model

### 3. Consistent Processing
- All image operations use same Sharp pipeline
- Same quality logic across use cases
- Easier to add new features (WebP, AVIF, etc.)

### 4. Better Performance
- Large images compressed more aggressively
- Smaller API payloads → faster vision model responses
- Reduced memory usage

### 5. Future-Proof
- Easy to add new formats
- Centralized place for optimization tweaks
- Supports both buffer and file outputs

---

## Performance Impact

### Vision Model API Calls

**Before (Fixed 85% quality):**
- 10MB image → Resize to 1024x1024 → ~800KB payload
- 5MB image → Resize to 1024x1024 → ~600KB payload
- 1MB image → Resize to 1024x1024 → ~400KB payload

**After (Dynamic quality):**
- 10MB image → Resize + 60% quality → ~400KB payload (50% reduction)
- 5MB image → Resize + 70% quality → ~500KB payload (17% reduction)
- 1MB image → Resize + 85% quality → ~400KB payload (same)

**API Response Time Improvement:**
- Large images: ~30% faster (smaller upload)
- Medium images: ~15% faster
- Small images: No change

---

## Risks and Mitigations

### Risk 1: Quality Degradation
**Impact:** Lower quality for large images might affect vision model accuracy

**Mitigation:**
- Test with sample images at different qualities
- Monitor vision model confidence scores
- Allow quality override via options
- Start conservative (70% min) and adjust based on results

### Risk 2: Breaking Changes
**Impact:** Changing captioning service might affect existing results

**Mitigation:**
- A/B test with old vs new processing
- Compare vision model outputs
- Gradual rollout with feature flag
- Keep old code path available for rollback

### Risk 3: Performance Regression
**Impact:** Additional quality calculation might slow processing

**Mitigation:**
- Quality calculation is O(1) (simple if/else)
- Negligible overhead (~1ms)
- Overall faster due to smaller files

---

## Testing Strategy

### Unit Tests
```typescript
describe('ImageProcessingUtils', () => {
  describe('getOptimalQuality', () => {
    it('returns 60% for 10MB+ images (vision)', () => {
      expect(ImageProcessingUtils.getOptimalQuality(11 * 1024 * 1024, 'vision')).toBe(60);
    });
    
    it('returns 85% for small images (vision)', () => {
      expect(ImageProcessingUtils.getOptimalQuality(1 * 1024 * 1024, 'vision')).toBe(85);
    });
  });
  
  describe('prepareForVisionModel', () => {
    it('processes image correctly', async () => {
      const buffer = await ImageProcessingUtils.prepareForVisionModel(
        'test-image.jpg',
        [1024, 1024]
      );
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeLessThan(1024 * 1024); // < 1MB
    });
  });
});
```

### Integration Tests
- Process 20 diverse images (different sizes, formats)
- Compare vision model outputs (old vs new)
- Measure processing time
- Verify file sizes

---

## Success Metrics

- **Code reduction:** 30% less image processing code
- **API payload:** 30% smaller for large images
- **Processing time:** No regression (< 5% slower acceptable)
- **Vision model accuracy:** No degradation (> 95% same results)
- **Developer experience:** Easier to add new image features

---

## Open Questions

1. **Should we support quality override in captioning service?**
   - **Recommendation:** Yes, add optional parameter for testing

2. **What minimum quality should we enforce?**
   - **Recommendation:** 60% minimum (even for huge files)

3. **Should we log quality decisions for debugging?**
   - **Recommendation:** Yes, in DEBUG_MODE

4. **When to remove ImageCompressor completely?**
   - **Recommendation:** Next major version (v2.0)

---

## Next Steps

1. Review and approve ADR
2. Implement `ImageProcessingUtils`
3. Add unit tests
4. Update `ollama-captioning-service.ts`
5. Test with sample images
6. Add deprecation notice to `ImageCompressor`
7. Monitor vision model performance
8. Plan ImageCompressor removal

---

## References

- Current captioning: `src/core/processors/ollama-captioning-service.ts:18-52`
- Current compressor: `src/core/image-compressor.ts`
- Sharp documentation: https://sharp.pixelplumbing.com/
- JPEG quality guide: https://www.impulseadventure.com/photo/jpeg-quality.html
