/**
 * Utility functions for the media search engine
 */

import * as path from 'path';
import * as crypto from 'crypto';
import { promises as fs } from 'fs';

/**
 * Get MIME type based on file extension
 */
export function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  
  const mimeTypes: { [key: string]: string } = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.tiff': 'image/tiff',
    '.tif': 'image/tiff',
    '.svg': 'image/svg+xml',
    '.mp4': 'video/mp4',
    '.avi': 'video/x-msvideo',
    '.mov': 'video/quicktime',
    '.wmv': 'video/x-ms-wmv',
    '.flv': 'video/x-flv',
    '.webm': 'video/webm'
  };
  
  return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * Calculate SHA-256 hash of a file
 */
export async function calculateFileHash(filePath: string): Promise<string> {
  try {
    const fileBuffer = await fs.readFile(filePath);
    const hashSum = crypto.createHash('sha256');
    hashSum.update(fileBuffer);
    return hashSum.digest('hex');
  } catch (error) {
    console.error(`Failed to calculate hash for ${filePath}:`, error);
    throw error;
  }
}
