/**
 * Video Processing Module
 * 
 * Refactored video job processing with separated concerns:
 * - VideoJobOrchestrator: Job lifecycle management
 * - BatchManager: Batch processing operations
 * - VideoPersistenceService: Database writes
 * - VideoSearchService: Search indexing
 * - CaptioningCoordinator: Caption generation
 * - EmbeddingCoordinator: Embedding generation
 * - ProgressTracker: Progress tracking
 */

// Export types
export * from './types';

// Export components
export { VideoJobOrchestrator } from './VideoJobOrchestrator';
export { BatchManager } from './BatchManager';
export { VideoPersistenceService } from './VideoPersistenceService';
export { VideoSearchService } from './VideoSearchService';
export { CaptioningCoordinator } from './CaptioningCoordinator';
export { EmbeddingCoordinator } from './EmbeddingCoordinator';
export { ProgressTracker } from './ProgressTracker';
