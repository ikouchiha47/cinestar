# ADR: Thumbnail Generation and Caching System

**Date:** 2025-10-10  
**Status:** Proposed  
**Deciders:** Engineering Team

---

## Context

Currently, the application loads full-resolution images for display in the UI:

```typescript
// Current implementation in main-media-api.ts
static async getImageThumbnail(imagePath: string) {
  const data = await fs.readFile(imagePath);  // ❌ Reads FULL 5MB image
  const base64 = data.toString('base64');      // ❌ Converts to ~6.6MB base64
  return { dataUrl: `data:image/jpeg;base64,${base64}` };
}
```

### Problems:

1. **Memory inefficient** - A 5MB image becomes ~6.6MB in base64
2. **Slow loading** - Large images take time to read, encode, and transfer
3. **Poor UX** - Grid view loads dozens of full-res images simultaneously
4. **IPC overhead** - Large payloads sent between main/renderer processes
5. **No caching** - Same image re-processed on every view

### Example Impact:

- **Single 4000x3000px photo (5MB):**
  - Read time: ~50ms
  - Base64 encode: ~100ms
  - IPC transfer: ~200ms
  - **Total: ~350ms per image**

- **Grid with 50 images:**
  - **Total load time: 17.5 seconds**
  - **Memory usage: ~330MB in base64 strings**

---

## Decision

Implement a **thumbnail generation and caching system** using the existing `ImageCompressor` class.

### Architecture:

```
┌─────────────────────────────────────────────────────────────┐
│ UI Request: getImageThumbnail(imagePath)                    │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Check Cache: ~/.cinestar/thumbnails/<hash>.jpg              │
│   - Hash = MD5(imagePath + mtime)                           │
│   - If exists → return cached thumbnail                     │
└─────────────────────────────────────────────────────────────┘
                          ↓ (cache miss)
┌─────────────────────────────────────────────────────────────┐
│ Generate Thumbnail:                                          │
│   - Resize to 400x300px (or smaller)                        │
│   - JPEG quality 75%                                         │
│   - Save to cache directory                                 │
│   - Return base64 data URL                                  │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Plan

### Phase 1: Basic Thumbnail Generation

**File:** `src/core/thumbnail-service.ts`

```typescript
export class ThumbnailService {
  private static cacheDir = path.join(app.getPath('userData'), 'thumbnails');
  
  // Thumbnail sizes for different use cases
  private static readonly SIZES = {
    grid: { width: 400, height: 300, quality: 75 },
    list: { width: 200, height: 150, quality: 70 },
    preview: { width: 1200, height: 900, quality: 85 }
  };

  static async getThumbnail(
    imagePath: string, 
    size: 'grid' | 'list' | 'preview' = 'grid'
  ): Promise<{ success: boolean; dataUrl?: string; error?: string }> {
    // 1. Generate cache key
    const cacheKey = await this.getCacheKey(imagePath, size);
    const cachePath = path.join(this.cacheDir, `${cacheKey}.jpg`);
    
    // 2. Check cache
    if (await this.cacheExists(cachePath, imagePath)) {
      return this.loadFromCache(cachePath);
    }
    
    // 3. Generate thumbnail
    const opts = this.SIZES[size];
    const result = await ImageCompressor.compressImage(imagePath, this.cacheDir, {
      maxWidth: opts.width,
      maxHeight: opts.height,
      quality: opts.quality,
      format: 'jpeg'
    });
    
    // 4. Return as data URL
    return this.loadFromCache(result.compressedPath);
  }
  
  private static async getCacheKey(imagePath: string, size: string): Promise<string> {
    const stats = await fs.stat(imagePath);
    const key = `${imagePath}-${stats.mtimeMs}-${size}`;
    return crypto.createHash('md5').update(key).digest('hex');
  }
  
  private static async cacheExists(cachePath: string, originalPath: string): Promise<boolean> {
    try {
      const [cacheStats, originalStats] = await Promise.all([
        fs.stat(cachePath),
        fs.stat(originalPath)
      ]);
      // Cache valid if thumbnail is newer than original
      return cacheStats.mtimeMs >= originalStats.mtimeMs;
    } catch {
      return false;
    }
  }
  
  private static async loadFromCache(cachePath: string): Promise<{ success: boolean; dataUrl?: string }> {
    const data = await fs.readFile(cachePath);
    const base64 = data.toString('base64');
    return { success: true, dataUrl: `data:image/jpeg;base64,${base64}` };
  }
}
```

**Update:** `src/api/main-media-api.ts`

```typescript
static async getImageThumbnail(imagePath: string): Promise<{ success: boolean; dataUrl?: string; error?: string }> {
  return ThumbnailService.getThumbnail(imagePath, 'grid');
}
```

### Phase 2: Cache Management

**Features:**
- **Auto-cleanup** - Remove thumbnails for deleted images
- **Size limits** - Max 500MB cache, LRU eviction
- **Batch generation** - Pre-generate thumbnails during indexing
- **Cache warming** - Generate thumbnails in background after folder scan

**File:** `src/core/thumbnail-cache-manager.ts`

```typescript
export class ThumbnailCacheManager {
  static async cleanup(): Promise<void> {
    // Remove orphaned thumbnails (original image deleted)
    // Enforce size limits
    // LRU eviction if needed
  }
  
  static async warmCache(imagePaths: string[]): Promise<void> {
    // Background thumbnail generation
    // Process in batches of 10
    // Low priority to not block UI
  }
  
  static async clearCache(): Promise<void> {
    // User-triggered cache clear
  }
  
  static async getCacheStats(): Promise<{ size: number; count: number }> {
    // For settings UI
  }
}
```

### Phase 3: Progressive Loading

**UI Enhancement:**
- Show blurred placeholder while loading
- Load thumbnails in viewport first (lazy loading)
- Use Intersection Observer for scroll-based loading

---

## Performance Impact

### Before (Current):
- **5MB image:** 350ms load time, 6.6MB memory
- **50 images:** 17.5s total, 330MB memory
- **No caching:** Same cost on every view

### After (With Thumbnails):
- **First load:** 
  - Generate: 150ms (one-time)
  - 400x300 JPEG: ~30KB
  - Load: 10ms
  - **Total: 160ms** (53% faster)
  
- **Cached load:**
  - Read cache: 5ms
  - Base64 encode: 2ms
  - **Total: 7ms** (98% faster)

- **50 images (cached):**
  - **Total: 350ms** (50x faster)
  - **Memory: 1.5MB** (220x less)

---

## Alternatives Considered

### 1. File Protocol URLs
**Approach:** Use `file://` URLs instead of base64

**Pros:**
- No base64 encoding overhead
- Browser handles caching
- Smaller IPC payloads

**Cons:**
- Security concerns (file access from renderer)
- Doesn't solve thumbnail generation
- Still loads full-resolution images

**Decision:** Rejected - doesn't solve core problem

### 2. WebP Format
**Approach:** Use WebP instead of JPEG for thumbnails

**Pros:**
- 25-35% smaller file size
- Better quality at same size

**Cons:**
- Slightly slower encoding
- Older systems may have issues

**Decision:** Consider for Phase 2

### 3. Database Storage
**Approach:** Store thumbnails as BLOBs in SQLite

**Pros:**
- Single file for all thumbnails
- Atomic operations
- Easy backup

**Cons:**
- Database bloat
- Slower than filesystem
- Harder to debug/inspect

**Decision:** Rejected - filesystem is simpler

---

## Migration Strategy

### Step 1: Add Thumbnail Service (Non-breaking)
- Create `ThumbnailService` class
- Add cache directory initialization
- No changes to existing code

### Step 2: Update getImageThumbnail (Transparent)
- Switch to `ThumbnailService.getThumbnail()`
- UI code unchanged
- Automatic performance improvement

### Step 3: Add Cache Management (Optional)
- Settings UI for cache control
- Background cache warming
- Auto-cleanup on startup

### Step 4: Progressive Enhancement (UI)
- Lazy loading
- Blur placeholders
- Viewport-based loading

---

## Risks and Mitigations

### Risk 1: Disk Space Usage
**Impact:** Thumbnails consume disk space

**Mitigation:**
- 500MB cache limit (configurable)
- LRU eviction
- User-visible cache stats in settings
- Clear cache option

### Risk 2: Cache Invalidation
**Impact:** Stale thumbnails if image modified

**Mitigation:**
- Include `mtime` in cache key
- Validate cache on load
- Regenerate if original is newer

### Risk 3: Slow Initial Load
**Impact:** First view generates all thumbnails

**Mitigation:**
- Background generation during indexing
- Batch processing (10 at a time)
- Progress indicator in UI
- Prioritize viewport images

### Risk 4: Sharp/libvips Dependency
**Impact:** Native dependency may fail on some systems

**Mitigation:**
- Graceful fallback to original image
- Log errors for debugging
- Include pre-built binaries for common platforms

---

## Success Metrics

- **Load time:** < 50ms per thumbnail (cached)
- **Memory usage:** < 50KB per thumbnail
- **Cache hit rate:** > 90% after initial load
- **Disk usage:** < 500MB cache size
- **User experience:** Grid loads in < 1 second (50 images)

---

## Open Questions

1. **Should we generate thumbnails during indexing or on-demand?**
   - **Proposal:** Hybrid - on-demand with background warming

2. **What thumbnail sizes do we need?**
   - **Proposal:** grid (400x300), list (200x150), preview (1200x900)

3. **Should we support multiple formats (JPEG, WebP, PNG)?**
   - **Proposal:** Start with JPEG, add WebP in Phase 2

4. **How to handle very large images (> 50MB)?**
   - **Proposal:** Aggressive compression, lower quality for huge files

5. **Should thumbnails be included in backups?**
   - **Proposal:** No - regenerate on new machine (cache is ephemeral)

---

## Implementation Checklist

### Phase 1: Core Functionality
- [ ] Create `ThumbnailService` class
- [ ] Implement cache key generation (MD5 hash)
- [ ] Implement cache validation (mtime check)
- [ ] Integrate `ImageCompressor` for generation
- [ ] Update `getImageThumbnail()` to use service
- [ ] Add cache directory initialization
- [ ] Test with various image sizes/formats
- [ ] Performance benchmarking

### Phase 2: Cache Management
- [ ] Implement cache size tracking
- [ ] Add LRU eviction logic
- [ ] Background cache warming
- [ ] Orphaned thumbnail cleanup
- [ ] Settings UI for cache control
- [ ] Cache statistics API

### Phase 3: UI Enhancement
- [ ] Lazy loading with Intersection Observer
- [ ] Blur placeholder component
- [ ] Viewport prioritization
- [ ] Loading states
- [ ] Error handling UI

---

## References

- Existing `ImageCompressor` class: `src/core/image-compressor.ts`
- Current implementation: `src/api/main-media-api.ts:2066`
- UI usage: `src/components/SearchResults.tsx:21`
- Sharp documentation: https://sharp.pixelplumbing.com/

---

**Next Steps:**
1. Review and approve this ADR
2. Create implementation tasks
3. Start with Phase 1 (core functionality)
4. Measure performance improvements
5. Iterate based on metrics
