# Search Intent Redesign

## Problem
The previous LLM prompts were generating keywords without understanding **search intent**. For a query like "cold", the system couldn't differentiate between:
- Visual intent: cold weather scenes (snow, ice, winter)
- Action intent: someone feeling cold (shivering, reacting)
- Audio intent: talking about cold (speech content)

## Root Cause
The prompts asked "what keywords relate to this word?" instead of "what is the user trying to FIND?"

## Solution: Intent-First Approach

### Meta-Questions Framework
The new prompts guide the LLM to ask meta-questions:

1. **What is the user looking for?**
   - Visual appearance? (SPATIAL)
   - Activities/events? (ACTION)
   - Speech/sounds? (AUDIO)
   - Time position? (TEMPORAL)

2. **What modality matches the intent?**
   - "cold" → Most likely SPATIAL (user wants to see cold-looking scenes)
   - "someone feeling cold" → ACTION (user wants to see the activity)
   - "talking about cold" → AUDIO (user wants to hear the discussion)

3. **What keywords serve that intent?**
   - SPATIAL intent for "cold" → ["cold", "snow", "ice", "winter", "frozen"]
   - ACTION intent for "cold" → ["shivering", "cold", "freezing", "bundling up"]
   - AUDIO intent for "cold" → ["cold", "temperature", "weather", "discussing cold"]

## Changes Made

### 1. Static Prompt Templates
**New Structure**: Prompts moved to static constants at top of file
- `QUERY_CLASSIFICATION_PROMPT`: Template for query classification
- `MULTIMODAL_TRANSFORMATION_PROMPT`: Template for multi-modal transformation
- `CLASSIFICATION_EXAMPLES`: Structured examples for each query type
- `TRANSFORMATION_EXAMPLES`: Detailed examples with intent and output

**Benefits**:
- Cleaner code organization
- Easier to maintain and update examples
- Better formatting and readability
- Examples separated from logic

### 2. Classification Prompt (`classifyQueryType`)
**Before**: Simple keyword matching
**After**: Intent analysis with meta-questions + structured examples

Key improvements:
- Asks "what is the user LOOKING FOR?"
- Provides clear distinctions between types
- Uses intent-based examples from `CLASSIFICATION_EXAMPLES`
- Examples formatted dynamically into prompt

### 3. Transformation Prompt (`transformMultiModalQuery`)
**Before**: Generic keyword expansion
**After**: Intent-driven keyword generation + detailed examples

Key improvements:
- 3-step process: Understand Intent → Determine Primary Intent → Extract Keywords
- Modality-specific keyword generation based on intent
- Clear rules for each search type
- Examples from `TRANSFORMATION_EXAMPLES` showing full input/output

## Example: "cold"

### Old Approach
```
Query: "cold"
Keywords: ["cold", "temperature", "weather"]
Problem: Generic, doesn't help differentiate visual vs audio vs action
```

### New Approach
```
Query: "cold"
Step 1: Understand Intent
  - Could be visual (snowy scenes)
  - Could be action (shivering)
  - Could be audio (talking about cold)

Step 2: Determine Primary Intent
  - Single word, no action verbs → SPATIAL (visual)
  - User wants to SEE cold-looking content

Step 3: Extract Keywords
  - Visual: ["cold", "snow", "ice", "winter", "frozen", "icy"]
  - Action: [] (not action intent)
  - Audio: [] (not audio intent)
```

## Benefits

1. **Better Disambiguation**: System understands WHY user is searching
2. **Modality-Specific**: Keywords match the search intent
3. **Spatial/Temporal/Action Clarity**: Clear distinction between scene, time, and activity
4. **Improved Ranking**: Visual keywords help find visually cold scenes, not just text mentions

## Testing Recommendations

Test with ambiguous queries:
- "cold" → Should prioritize snowy/icy visual scenes
- "dancing" → Should find dance activities (action)
- "talking about technology" → Should find speech content (audio)
- "beginning" → Should find start of videos (temporal)
- "mountains at sunset" → Should find visual scenes (spatial)


## Code Structure

### Static Constants (Top of File)

```typescript
// Classification examples by type
const CLASSIFICATION_EXAMPLES = {
  spatial: [
    { query: 'cold', reason: 'Visual: user wants to see cold-looking scenes' },
    { query: 'mountains', reason: 'Visual: user wants to see mountain scenery' },
    // ... more examples
  ],
  action: [...],
  audio: [...],
  temporal: [...],
  mixed: [...]
};

// Transformation examples with full input/output
const TRANSFORMATION_EXAMPLES = {
  spatial: {
    query: 'cold',
    intent: 'User wants to SEE cold-looking visual content',
    output: {
      transformed: 'cold',
      searchKeywords: {
        visual: ['cold', 'snow', 'ice', 'winter', 'frozen', 'icy', 'frost'],
        // ... complete output structure
      }
    }
  },
  action: {...},
  audio: {...}
};

// Prompt templates with placeholders
const QUERY_CLASSIFICATION_PROMPT = `...{query}...{examples}...`;
const MULTIMODAL_TRANSFORMATION_PROMPT = `...{query}...{queryType}...{examples}...`;
```

### Usage in Methods

```typescript
async classifyQueryType(question: string) {
  // Format examples
  const examplesList = Object.entries(CLASSIFICATION_EXAMPLES)
    .map(([type, examples]) => /* format examples */)
    .join('\n\n');
  
  // Inject into template
  const prompt = QUERY_CLASSIFICATION_PROMPT
    .replace('{query}', question)
    .replace('{examples}', examplesList);
  
  // Use prompt...
}
```

This approach keeps prompts maintainable and examples easy to update.
