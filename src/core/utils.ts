/**
 * Utility functions for the media search engine
 */

/**
 * Get MIME type from file extension
 */
export function getMimeType(extension: string): string {
  const ext = extension.toLowerCase().replace(/^\./, '');
  
  const mimeTypes: Record<string, string> = {
    // Images
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'bmp': 'image/bmp',
    'webp': 'image/webp',
    
    // Default
    'default': 'application/octet-stream'
  };
  
  return mimeTypes[ext] || mimeTypes.default;
}
