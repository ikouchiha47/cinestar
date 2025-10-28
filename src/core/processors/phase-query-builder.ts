import { ExtractedElements } from './llm-extraction-service.js';

/**
 * Analysis phases for multi-pass captioning
 */
export enum AnalysisPhase {
  SPATIAL = 'spatial',
  TEMPORAL = 'temporal',
  SEGMENTATION_CHECK = 'segmentation_check'
}

/**
 * Builds targeted prompts for each analysis phase using extracted elements
 */
export class PhaseQueryBuilder {
  
  /**
   * Build spatial analysis prompt
   */
  buildSpatialPrompt(elements: ExtractedElements): string {
    const objectsList = elements.objects.join(', ');
    const peopleList = elements.people.length > 0 
      ? elements.people.join(', ') 
      : 'none';
    
    return `Given these elements in the image:
Objects: ${objectsList}
People: ${peopleList}
Setting: ${elements.setting}

Describe their spatial arrangement. Where is each positioned? What is in the foreground, middle ground, and background? How are elements arranged in depth?`;
  }

  /**
   * Build temporal analysis prompt
   */
  buildTemporalPrompt(elements: ExtractedElements): string {
    const objectsList = elements.objects.join(', ');
    const peopleList = elements.people.length > 0 
      ? elements.people.join(', ') 
      : 'none';
    
    return `Given this scene:
Time: ${elements.time}
Lighting: ${elements.lighting}
Objects: ${objectsList}
People: ${peopleList}

What actions or movements are happening? What might happen next in this scene? Describe any sense of motion or dynamic elements.`;
  }

  /**
   * Build segmentation check prompt for video timeline analysis
   */
  buildSegmentationCheckPrompt(
    timeline: Array<{ timestamp: number; elements: ExtractedElements }>
  ): string {
    const timelineStr = timeline
      .map(t => {
        const peopleStr = t.elements.people.length > 0 
          ? t.elements.people.join(', ') 
          : 'none';
        return `[t=${t.timestamp}s] Objects: ${t.elements.objects.join(', ')}, People: ${peopleStr}, Setting: ${t.elements.setting}`;
      })
      .join('\n');
    
    return `Analyze this video timeline:

${timelineStr}

Are there rapid changes, multiple distinct actions, or scene transitions that require more detailed frame sampling between these keyframes?

Consider:
- Sudden object/people changes
- Action transitions (e.g., person sitting → standing → walking)
- Scene cuts or camera angle changes
- Fast-moving objects

Return ONLY: YES or NO, followed by a brief reason.

Example: "YES - Person transitions from sitting to standing between t=5s and t=10s, need intermediate frames."
Example: "NO - Scene is static with minimal changes, existing keyframes are sufficient."`;
  }
}
