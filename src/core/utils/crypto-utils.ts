/**
 * Crypto utilities for consistent hashing and ID generation across the application
 */

/**
 * Generate a SHA-256 hash of a file path
 */
export async function hashFilePath(filePath: string): Promise<string> {
  const crypto = await import('crypto');
  return crypto.createHash('sha256').update(filePath).digest('hex');
}

/**
 * Generate a deterministic UUID-like ID from a file path hash
 * Format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 */
export async function generateDeterministicId(filePath: string): Promise<string> {
  const pathHash = await hashFilePath(filePath);
  
  // Create UUID-like format from hash
  return [
    pathHash.substring(0, 8),
    pathHash.substring(8, 12),
    pathHash.substring(12, 16),
    pathHash.substring(16, 20),
    pathHash.substring(20, 32)
  ].join('-');
}

/**
 * Extract short hash prefix for database lookups
 */
export async function getHashPrefix(filePath: string, length: number = 8): Promise<string> {
  const pathHash = await hashFilePath(filePath);
  return pathHash.substring(0, length);
}

/**
 * Constants for hash-based operations
 */
export const HASH_CONSTANTS = {
  ID_SEGMENTS: [8, 12, 16, 20, 32] as const,
  DEFAULT_PREFIX_LENGTH: 8,
  HASH_ALGORITHM: 'sha256' as const
} as const;
