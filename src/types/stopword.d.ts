declare module 'stopword' {
  export function removeStopwords(words: string[], stopwords: string[]): string[];
  export const eng: string[];
  export const spa: string[];
  export const fra: string[];
  export const deu: string[];
  // Add more language codes as needed
}
