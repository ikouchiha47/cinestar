/**
 * FTS Query Processor
 * Lightweight implementation using stemmer library
 */

import { removeStopwords, eng } from 'stopword';
import { stemmer } from 'stemmer';

/**
 * Process a query for FTS search
 * - Tokenizes properly
 * - Removes stopwords
 * - Applies Porter stemming
 * - Normalizes text
 */
export function processFTSQuery(query: string, options: {
  useStemming?: boolean;
  minWordLength?: number;
} = {}): string {
  const {
    useStemming = true,
    minWordLength = 2
  } = options;

  if (!query || query.trim().length === 0) {
    return '';
  }

  console.log(`[FTS-PROCESSOR] 📝 Input query: "${query}"`);

  // Normalize: lowercase and clean
  const normalized = query.toLowerCase().trim();
  console.log(`[FTS-PROCESSOR] 🔄 Normalized: "${normalized}"`);
  
  // Simple tokenization: split on whitespace and punctuation
  const tokens = normalized.split(/[\s,;.!?]+/).filter(t => t.length > 0);
  console.log(`[FTS-PROCESSOR] 🔪 Tokens (${tokens.length}):`, tokens);

  // Remove stopwords
  const withoutStopwords = removeStopwords(tokens, eng);
  console.log(`[FTS-PROCESSOR] 🚫 After stopwords (${withoutStopwords.length}):`, withoutStopwords);

  // Filter by minimum word length
  const filtered = withoutStopwords.filter(w => w.length >= minWordLength);
  console.log(`[FTS-PROCESSOR] 📏 After min-length filter (${filtered.length}):`, filtered);

  // Apply Porter stemming if enabled
  let finalWords = filtered;
  if (useStemming) {
    finalWords = filtered.map(word => {
      const stemmed = stemmer(word);
      if (stemmed !== word) {
        console.log(`[FTS-PROCESSOR] 🌱 Stemmed: "${word}" → "${stemmed}"`);
      }
      return stemmed;
    });
  }

  // If all words were filtered out, return original query
  if (finalWords.length === 0) {
    console.log(`[FTS-PROCESSOR] ⚠️  All words filtered, using original: "${normalized}"`);
    return normalized;
  }

  const result = finalWords.join(' ');
  console.log(`[FTS-PROCESSOR] ✅ Final processed: "${result}"`);
  return result;
}

/**
 * Convert processed query to FTS5 MATCH syntax
 * Supports: OR matching, prefix matching (*)
 */
export function toFTS5Syntax(processedQuery: string, options: {
  usePrefixMatch?: boolean;
} = {}): string {
  const { usePrefixMatch = true } = options;

  if (!processedQuery || processedQuery.trim().length === 0) {
    return '';
  }

  console.log(`[FTS-SYNTAX] 📥 Input: "${processedQuery}"`);

  const terms = processedQuery.split(/\s+/).filter(t => t.length > 0);
  const ftsTerms: string[] = [];
  
  for (const term of terms) {
    // Exact match
    ftsTerms.push(term);
    
    // Prefix match for autocomplete-like behavior
    if (usePrefixMatch && term.length >= 3) {
      ftsTerms.push(`${term}*`);
      console.log(`[FTS-SYNTAX] ➕ Added prefix match: "${term}*"`);
    }
  }
  
  // Join all terms with OR for broad matching
  const result = ftsTerms.join(' OR ');
  console.log(`[FTS-SYNTAX] 📤 FTS5 query: "${result}"`);
  return result;
}

/**
 * Generate n-grams for fuzzy matching
 */
export function generateNGrams(text: string, n: number = 3): string[] {
  if (text.length < n) return [text];
  
  const ngrams: string[] = [];
  for (let i = 0; i <= text.length - n; i++) {
    ngrams.push(text.slice(i, i + n));
  }
  return ngrams;
}

/**
 * Complete FTS query processing pipeline
 * Takes raw user query and returns FTS5-ready query
 */
export function prepareFTSQuery(rawQuery: string, options: {
  useStemming?: boolean;
  minWordLength?: number;
  usePrefixMatch?: boolean;
} = {}): string {
  const processed = processFTSQuery(rawQuery, {
    useStemming: options.useStemming,
    minWordLength: options.minWordLength
  });
  
  return toFTS5Syntax(processed, {
    usePrefixMatch: options.usePrefixMatch
  });
}
