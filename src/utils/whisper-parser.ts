/**
 * Parse Whisper transcription format with timestamps
 * Format: [HH:MM:SS.mmm --> HH:MM:SS.mmm] Text
 */

export interface WhisperSegment {
  startTime: number; // in seconds
  endTime: number;   // in seconds
  text: string;
}

/**
 * Parse Whisper timestamp to seconds
 * Format: HH:MM:SS.mmm or MM:SS.mmm
 */
function parseWhisperTimestamp(timestamp: string): number {
  const parts = timestamp.split(':');
  if (parts.length === 3) {
    // HH:MM:SS.mmm
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    const seconds = parseFloat(parts[2]);
    return hours * 3600 + minutes * 60 + seconds;
  } else if (parts.length === 2) {
    // MM:SS.mmm
    const minutes = parseInt(parts[0], 10);
    const seconds = parseFloat(parts[1]);
    return minutes * 60 + seconds;
  }
  return 0;
}

/**
 * Parse Whisper transcription into individual segments
 */
export function parseWhisperTranscription(transcription: string): WhisperSegment[] {
  const segments: WhisperSegment[] = [];
  
  // Match pattern: [HH:MM:SS.mmm --> HH:MM:SS.mmm] Text
  const regex = /\[(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})\]\s*(.+?)(?=\[|$)/gs;
  
  let match;
  while ((match = regex.exec(transcription)) !== null) {
    const startTime = parseWhisperTimestamp(match[1]);
    const endTime = parseWhisperTimestamp(match[2]);
    const text = match[3].trim();
    
    if (text) {
      segments.push({
        startTime,
        endTime,
        text
      });
    }
  }
  
  return segments;
}

/**
 * Format seconds to MM:SS or HH:MM:SS
 */
export function formatTimestamp(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}
