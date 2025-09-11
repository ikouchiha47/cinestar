/**
 * Database utilities for consistent error handling and operations
 */

export interface DatabaseOperationResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Wrap database operations with consistent error handling
 */
export async function withDatabaseErrorHandling<T>(
  operation: () => Promise<T> | T,
  operationName: string
): Promise<DatabaseOperationResult<T>> {
  try {
    const result = await operation();
    return { success: true, data: result };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown database error';
    console.error(`[DB ERROR] ${operationName}:`, errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * Status type for media processing
 */
export type ProcessingStatus = 'pending' | 'completed' | 'failed';

/**
 * Media item status interface
 */
export interface MediaItemStatus {
  captionStatus?: ProcessingStatus;
  embeddingStatus?: ProcessingStatus;
  caption?: string | null;
  embedding?: string | null;
  captionGeneratedAt?: string | null;
  embeddingGeneratedAt?: string | null;
}

/**
 * Check if a media item should be skipped based on its status
 */
export function shouldSkipProcessing(
  existing: MediaItemStatus | null,
  processType: 'caption' | 'embedding'
): boolean {
  if (!existing) return false;
  
  const status = processType === 'caption' 
    ? existing.captionStatus 
    : existing.embeddingStatus;
    
  return status === 'completed';
}
