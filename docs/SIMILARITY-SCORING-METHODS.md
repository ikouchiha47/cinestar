# Similarity Scoring Methods for Vector Search

## Overview

Implemented pluggable similarity scoring system to convert L2 distances to normalized similarity scores (0-1 range).

## Architecture

### Soft-Link Pattern (Strategy Pattern)
```typescript
// Current scorer can be swapped at runtime
let currentScorer: SimilarityScorer = piecewiseLinear;

// Change scorer
setSimilarityScorer('exponential');  // By name
setSimilarityScorer(customFunction);  // Custom function
```

## Available Scoring Methods

### 1. **Inverse Normalization** (`inverse`)
```typescript
similarity = max(0, 1 - distance/25)
```
- **Pros**: Simple, fast
- **Cons**: Fixed range assumption, linear decay
- **Best for**: Quick prototyping

### 2. **Exponential Decay** (`exponential`)
```typescript
similarity = exp(-distance/8)
```
- **Pros**: Smooth decay, emphasizes close matches
- **Cons**: Requires scale tuning
- **Best for**: When you want to heavily favor close matches

### 3. **Gaussian/RBF Kernel** (`gaussian`)
```typescript
similarity = exp(-(distance²)/(2*5²))
```
- **Pros**: Very smooth, penalizes distant matches heavily
- **Cons**: Computationally more expensive
- **Best for**: High-precision applications

### 4. **Sigmoid Transform** (`sigmoid`)
```typescript
similarity = 1 / (1 + exp((distance - 15)/2))
```
- **Pros**: Clear cutoff point, smooth transition
- **Cons**: Requires midpoint tuning
- **Best for**: When you have a known quality threshold

### 5. **Piecewise Linear** (`piecewise`) ⭐ **DEFAULT**
```typescript
if (distance < 13)  → similarity = 1.0 - (distance - 12) * 0.05
if (distance < 15)  → similarity = 0.95 - (distance - 13) * 0.05
if (distance < 17)  → similarity = 0.85 - (distance - 15) * 0.10
if (distance < 20)  → similarity = 0.65 - (distance - 17) * 0.10
else                → similarity = max(0, 0.35 - (distance - 20) * 0.05)
```
- **Pros**: Flexible, matches observed data distribution
- **Cons**: More complex, requires threshold tuning
- **Best for**: Production use with known distance distribution

### 6. **Adaptive Normalization** (`adaptive`)
```typescript
similarity = 1 - ((distance - min) / (max - min))
```
- **Pros**: Adapts to actual data distribution
- **Cons**: Scores vary between queries
- **Best for**: Comparing results within a single query

## Research Findings

### From Zilliz Blog on Vector Similarity:

**L2 (Euclidean) Distance:**
- Measures absolute distance in vector space
- Sensitive to magnitude and scale
- Formula: `√Σ(aᵢ - bᵢ)²`
- **Use when**: Vector magnitudes matter, not trained with specific loss function

**Cosine Similarity:**
- Measures angle between vectors (direction, not magnitude)
- Range: -1 to 1 (1 = same direction, 0 = orthogonal, -1 = opposite)
- **Use when**: Working with NLP, semantic search, normalized vectors

**Key Insight**: For L2 distance, Milvus skips square root since ranking order is preserved, improving performance.

## Usage

### Basic Usage
```typescript
import { distanceToSimilarity } from './similarity-scorers';

const distance = 14.5;
const similarity = distanceToSimilarity(distance);
console.log(similarity); // 0.8750 (using piecewise default)
```

### Changing Scorer
```typescript
import { setSimilarityScorer, SCORERS } from './similarity-scorers';

// Use exponential decay
setSimilarityScorer('exponential');

// Use custom function
const customScorer = (distance: number) => 1 / (1 + distance);
setSimilarityScorer(customScorer);
```

### In Search Results
```typescript
// Automatically applied in sqlite-vec-database.ts
rows.forEach((row: any) => {
  const similarity = distanceToSimilarity(row.distance);
  console.log(`${row.name}: distance=${row.distance}, similarity=${similarity}`);
});
```

## Distance Thresholds (Based on "sunset" Search Analysis)

### Observed Distribution:
- **12.68 - 14.80**: Excellent matches (explicit sunset)
- **15.20 - 15.79**: Borderline (mentions sunset or similar atmosphere)
- **15.86 - 17.05**: Weak matches (false positives start)
- **17.16+**: Very weak (mostly irrelevant)

### Recommended Cutoffs:
- **Strict** (`distance < 15.0`): Top 3 results, ~100% precision
- **Moderate** (`distance < 16.0`): Top 8-10 results, ~60-70% precision
- **Loose** (`distance < 17.0`): Top 20-24 results, ~30-40% precision

### Similarity Equivalents (using piecewise):
- **distance 12.68** → similarity **0.9900** (excellent)
- **distance 14.80** → similarity **0.8600** (good)
- **distance 15.50** → similarity **0.8150** (borderline)
- **distance 17.00** → similarity **0.6500** (weak)

## Configuration

### Current Default
```typescript
export let currentScorer: SimilarityScorer = piecewiseLinear;
```

### To Change Default
Edit `src/core/similarity-scorers.ts`:
```typescript
export let currentScorer: SimilarityScorer = exponentialDecay; // or any other
```

## Future Enhancements

1. **Configurable via UI**: Add scorer selection to settings panel
2. **Per-Query Scoring**: Different scorers for different query types
3. **Machine Learning**: Learn optimal scoring function from user feedback
4. **Adaptive Thresholds**: Automatically adjust based on result distribution

## References

- [Zilliz: Similarity Metrics for Vector Search](https://zilliz.com/blog/similarity-metrics-for-vector-search)
- [Elastic: Vector Similarity Techniques](https://www.elastic.co/search-labs/blog/vector-similarity-techniques-and-scoring)
- [Stack Overflow: L2 Normalization](https://stackoverflow.com/questions/51290969/is-there-any-reason-to-not-l2-normalize-vectors-before-using-cosine-similarity)

## Tags
#vector-search #similarity #scoring #l2-distance #embeddings #search-quality
