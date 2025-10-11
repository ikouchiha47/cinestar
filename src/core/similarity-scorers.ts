/**
 * Similarity Scoring Methods for Vector Search
 * 
 * Provides pluggable similarity scoring functions to convert
 * L2 distances to normalized similarity scores (0-1 range).
 */

export type SimilarityScorer = (distance: number) => number;

/**
 * Method 1: Simple Inverse Normalization
 * Assumes typical L2 distance range of 10-25 for 1024D embeddings
 * Formula: max(0, 1 - distance/25)
 * 
 * Pros: Simple, fast
 * Cons: Fixed range assumption, linear decay
 */
export const inverseNormalization: SimilarityScorer = (distance: number): number => {
  const maxDistance = 25; // Typical max for 1024D embeddings
  return Math.max(0, 1 - (distance / maxDistance));
};

/**
 * Method 2: Exponential Decay
 * Uses exponential function for smoother similarity decay
 * Formula: exp(-distance/scale)
 * 
 * Pros: Smooth decay, emphasizes close matches
 * Cons: Requires scale tuning
 */
export const exponentialDecay: SimilarityScorer = (distance: number): number => {
  const scale = 8; // Tuning parameter (lower = steeper decay)
  return Math.exp(-distance / scale);
};

/**
 * Method 3: Gaussian (RBF) Kernel
 * Uses Gaussian/RBF kernel for similarity
 * Formula: exp(-(distance²)/(2*sigma²))
 * 
 * Pros: Very smooth, penalizes distant matches heavily
 * Cons: Computationally more expensive
 */
export const gaussianKernel: SimilarityScorer = (distance: number): number => {
  const sigma = 5; // Bandwidth parameter
  return Math.exp(-(distance * distance) / (2 * sigma * sigma));
};

/**
 * Method 4: Sigmoid Transformation
 * Uses sigmoid function for S-shaped similarity curve
 * Formula: 1 / (1 + exp((distance - midpoint)/steepness))
 * 
 * Pros: Clear cutoff point, smooth transition
 * Cons: Requires midpoint tuning
 */
export const sigmoidTransform: SimilarityScorer = (distance: number): number => {
  const midpoint = 15; // Distance where similarity = 0.5
  const steepness = 2; // How steep the transition is
  return 1 / (1 + Math.exp((distance - midpoint) / steepness));
};

/**
 * Method 5: Piecewise Linear
 * Different slopes for different distance ranges
 * 
 * Pros: Flexible, can match observed data distribution
 * Cons: More complex, requires threshold tuning
 */
export const piecewiseLinear: SimilarityScorer = (distance: number): number => {
  if (distance < 13) {
    // Excellent matches: 13 -> 1.0, 12 -> ~1.0
    return 1.0 - (distance - 12) * 0.05;
  } else if (distance < 15) {
    // Good matches: 13 -> 0.95, 15 -> 0.85
    return 0.95 - (distance - 13) * 0.05;
  } else if (distance < 17) {
    // Fair matches: 15 -> 0.85, 17 -> 0.65
    return 0.85 - (distance - 15) * 0.10;
  } else if (distance < 20) {
    // Weak matches: 17 -> 0.65, 20 -> 0.35
    return 0.65 - (distance - 17) * 0.10;
  } else {
    // Very weak: linear decay to 0
    return Math.max(0, 0.35 - (distance - 20) * 0.05);
  }
};

/**
 * Method 6: Adaptive Normalization
 * Normalizes based on min/max distances in result set
 * Note: Requires passing min/max from result set
 * 
 * Pros: Adapts to actual data distribution
 * Cons: Scores vary between queries
 */
export const adaptiveNormalization = (min: number, max: number): SimilarityScorer => {
  return (distance: number): number => {
    if (max === min) return 1.0;
    return 1 - ((distance - min) / (max - min));
  };
};

/**
 * Scorer Registry
 * Maps scorer names to their implementations
 */
export const SCORERS: Record<string, SimilarityScorer> = {
  'inverse': inverseNormalization,
  'exponential': exponentialDecay,
  'gaussian': gaussianKernel,
  'sigmoid': sigmoidTransform,
  'piecewise': piecewiseLinear,
};

/**
 * Default scorer (can be changed via configuration)
 */
export let currentScorer: SimilarityScorer = piecewiseLinear;

/**
 * Set the active similarity scorer
 */
export function setSimilarityScorer(scorerName: keyof typeof SCORERS | SimilarityScorer): void {
  if (typeof scorerName === 'function') {
    currentScorer = scorerName;
  } else if (SCORERS[scorerName]) {
    currentScorer = SCORERS[scorerName];
  } else {
    console.warn(`[SIMILARITY-SCORER] Unknown scorer: ${scorerName}, using default`);
  }
}

/**
 * Get the current similarity scorer
 */
export function getSimilarityScorer(): SimilarityScorer {
  return currentScorer;
}

/**
 * Convenience function: Calculate similarity from distance using current scorer
 */
export function distanceToSimilarity(distance: number): number {
  return currentScorer(distance);
}
