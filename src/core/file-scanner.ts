import * as fs from 'fs';
import * as path from 'path';

// Supported media file extensions
const SUPPORTED_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];

export interface MediaFile {
  path: string;
  name: string;
  extension: string;
  size: number;
  type: 'image' | 'video' | 'audio' | 'document';
  lastModified: Date;
}

/**
 * Scans a directory for media files
 */
export async function scanDirectory(
  dirPath: string, 
  recursive: boolean = true,
  progressCallback?: (scannedCount: number, totalFiles: number) => void
): Promise<MediaFile[]> {
  const mediaFiles: MediaFile[] = [];
  let scannedCount = 0;
  let totalFiles = 0;
  
  // Count total files first for progress reporting
  if (progressCallback) {
    totalFiles = countFiles(dirPath, recursive);
    progressCallback(0, totalFiles);
  }
  
  await scanDir(dirPath);
  return mediaFiles;
  
  async function scanDir(currentPath: string): Promise<void> {
    try {
      const entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);
        
        if (entry.isDirectory() && recursive) {
          await scanDir(fullPath);
        } else if (entry.isFile()) {
          const extension = path.extname(entry.name).toLowerCase();
          
          if (SUPPORTED_IMAGE_EXTENSIONS.includes(extension)) {
            try {
              const stats = await fs.promises.stat(fullPath);
              
              mediaFiles.push({
                path: fullPath,
                name: entry.name,
                extension,
                size: stats.size,
                type: 'image', // Currently only supporting images
                lastModified: stats.mtime
              });
            } catch (err) {
              console.error(`Error getting file stats for ${fullPath}:`, err);
            }
          }
          
          scannedCount++;
          if (progressCallback && scannedCount % 10 === 0) {
            progressCallback(scannedCount, totalFiles);
          }
        }
      }
    } catch (err) {
      console.error(`Error scanning directory ${currentPath}:`, err);
    }
  }
}

/**
 * Count total files in a directory (for progress reporting)
 */
function countFiles(dirPath: string, recursive: boolean = true): number {
  let count = 0;
  
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      
      if (entry.isDirectory() && recursive) {
        count += countFiles(fullPath, recursive);
      } else if (entry.isFile()) {
        count++;
      }
    }
  } catch (err) {
    console.error(`Error counting files in ${dirPath}:`, err);
  }
  
  return count;
}
