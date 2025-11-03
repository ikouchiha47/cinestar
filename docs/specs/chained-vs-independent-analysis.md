# Chained vs. Independent Multi-Pass Analysis

## Executive Summary

Comparison of **independent passes** (each receives only image + prompt) vs. **chained contextual passes** (each receives image + prompt + previous outputs) for moondream:v2 captioning.

**Key Finding:** Chained approach shows **mixed results** - can save tokens on simple images but uses more tokens on complex scenes. Quality benefits are minimal due to model's tendency to repeat context verbatim.

---

## Test Configuration

**Model:** moondream:v2  
**Test Images:** 2 images (architecture, cityscape)  
**Passes per approach:** 3 (General → Spatial → Temporal)

---

## Results Summary

| Image Type | Independent Tokens | Chained Tokens | Difference | Winner |
|------------|-------------------|----------------|------------|--------|
| **Architecture** (simple) | 359 | 329 | **-30 tokens** | ✅ Chained |
| **Cityscape** (complex) | 443 | 498 | **+55 tokens** | ✅ Independent |

---

## Detailed Analysis: Architecture Image

### Independent Passes (359 tokens total)

**Pass 1 - General (120 tokens):**
```
The image depicts a large concrete building with a sloping roof that has an open 
window on its side. The sky above is dark blue, suggesting either early morning 
or late evening time of day. In front of the building, there are trees visible 
in the background, adding to the natural setting. The scene appears to be 
captured during dusk when the sun is low and casting long shadows.

There are no people present in the image, but a solitary tree stands near the 
building. The lighting from the window illuminates the area around it, creating 
interesting shadows on the ground below.
```

**Pass 2 - Spatial (94 tokens):**
```
In the image, there is a large building with an unusual triangular shape that 
has a window on its roof. The building's roof appears to be sloped or angled, 
which adds to its unique appearance. In the foreground of the image, there are 
two trees visible, one located near the left side and another towards the right 
side of the frame. These elements contribute to the overall composition of the 
scene, creating a sense of depth and perspective in the photograph.
```

**Pass 3 - Temporal (145 tokens):**
```
In the image, there is a large window on top of a building that appears to be 
lit up. The presence of the illuminated window suggests that someone might be 
inside the building at night or during low light conditions. However, since the 
rest of the scene is dark and cloudy, it can be inferred that the time of day 
captured in the image is either late afternoon or early morning when natural 
lighting is scarce.

There are no visible texts or actions taking place in this particular moment, 
but one could imagine a person inside the building using the illuminated window 
to navigate through the darkness outside. The scene evokes a sense of mystery 
and intrigue due to the contrast between the lit-up window and the surrounding 
darkness.
```

### Chained Passes (329 tokens total)

**Pass 1 - General (120 tokens):** [Same as independent]

**Pass 2 - Spatial with Context (105 tokens):**

**Prompt sent to moondream:**
```
Based on this scene: "The image depicts a large concrete building with a sloping 
roof that has an open window on its side. The sky above is dark blue, suggesting 
either early morning or late evening time of day. In front of the building, there 
are trees visible in the background, adding to the natural setting. The scene 
appears to be captured during dusk when the sun is low and casting long shadows. 
There are no people present in the image, but a solitary tree stands near the 
building. The lighting from the window illuminates the area around it, creating 
interesting shadows on the ground below."

Now describe the spatial layout in detail. Where are the objects you mentioned 
positioned? What is in the foreground, middle ground, and background? How are 
elements arranged in depth?
```

**Response:**
```
The image features a large concrete building with an open window situated at the 
top of its sloping roof. The sky above is dark blue, suggesting either early 
morning or late evening time of day. In front of the building, there are trees 
visible in the background, adding to the natural setting. The scene appears to 
be captured during dusk when the sun is low and casting long shadows. There are 
no people present in the image, but a solitary tree stands near the building, 
creating interesting shadows on the ground below.
```

**Pass 3 - Temporal with Full Context (104 tokens):**

**Prompt sent to moondream:**
```
Given this scene: "The image depicts a large concrete building with a sloping 
roof that has an open window on its side. The sky above is dark blue, suggesting 
either early morning or late evening time of day. In front of the building, there 
are trees visible in the background, adding to the natural setting. The scene 
appears to be captured during dusk when the sun is low and casting long shadows. 
There are no people present in the image, but a solitary tree stands near the 
building. The lighting from the window illuminates the area around it, creating 
interesting shadows on the ground below."

And this spatial layout: "The image features a large concrete building with an 
open window situated at the top of its sloping roof. The sky above is dark blue, 
suggesting either early morning or late evening time of day. In front of the 
building, there are trees visible in the background, adding to the natural 
setting. The scene appears to be captured during dusk when the sun is low and 
casting long shadows. There are no people present in the image, but a solitary 
tree stands near the building, creating interesting shadows on the ground below."

Now analyze the temporal aspects: What actions, movements, or activities are 
happening? What time of day is it and what clues tell you this? If this is a 
moment in time, what might have happened before and what might happen next?
```

**Response:**
```
The image captures an early morning scene with a large concrete building 
featuring an open window on its side. The sky above is dark blue, suggesting 
either early morning or late evening time of day. In front of the building, 
there are trees visible in the background, adding to the natural setting. There 
are no people present in the image, but a solitary tree stands near the 
building, creating interesting shadows on the ground below. The scene appears to 
be captured during dusk when the sun is low and casting long shadows.
```

### Architecture Image Analysis

**Token Savings:** 30 tokens (8.4% reduction)

**Quality Assessment:**
- ❌ **Chained Pass 2 & 3 are nearly identical** - Just repeating Pass 1 content
- ❌ **No new spatial insights** in Pass 2 despite context
- ❌ **No temporal analysis** in Pass 3 - just restates scene description
- ✅ **Token reduction** but at cost of losing specialized information
- ❌ **Model ignores the specific questions** when given context

**Conclusion:** Chained saves tokens but **loses information quality** - passes 2 & 3 don't add value.

---

## Detailed Analysis: Cityscape Image

### Independent Passes (443 tokens total)

**Pass 1 - General (130 tokens):**
```
The image captures a bustling city street at night, illuminated by bright lights 
from towering buildings that line both sides of the road. The street is filled 
with cars moving along it, their headlights cutting through the darkness as they 
navigate the urban landscape. Pedestrians can be seen walking on the sidewalks, 
adding to the lively atmosphere.

The buildings are adorned with numerous billboards and signs, each one vying for 
attention amidst the city's nightlife. Streetlights dot the scene, casting a 
warm glow that contrasts with the cool tones of the cityscape. The overall mood 
is vibrant and energetic, reflecting the dynamic nature of urban life at night.
```

**Pass 2 - Spatial (129 tokens):**
```
In the image, there is a city street with tall buildings on both sides of it. 
The street appears to be empty at night, as evidenced by the lack of cars or 
pedestrians visible. In the foreground, there is a crosswalk where people might 
have been walking earlier in the day. The middle ground features more buildings 
and traffic lights, indicating that this area is part of an urban environment 
with various elements such as shops, offices, and residential spaces. The 
background showcases even taller buildings, emphasizing the height of the 
cityscape. Overall, the image captures a nighttime view of a bustling city 
street filled with tall buildings on both sides.
```

**Pass 3 - Temporal (184 tokens):**
```
In the image, there is a busy city street with cars driving down it. The traffic 
appears to be moving in both directions, indicating that it's an active urban 
area. There are also pedestrians walking along the sidewalks near the buildings, 
adding to the bustling atmosphere of the scene. As for what might happen next, 
considering the current state of the street and the presence of vehicles, it is 
likely that more cars will continue driving down the road or turn onto the 
street as they navigate through the city.

Additionally, there are traffic lights in the area, which suggests that the 
drivers must follow traffic regulations to ensure safety for all road users. 
Pedestrians should also be cautious and aware of their surroundings while 
crossing streets or walking near the buildings. Overall, this busy urban scene 
showcases a typical day in the life of city dwellers navigating through the 
bustling streets filled with cars, pedestrians, and various activities.
```

### Chained Passes (498 tokens total)

**Pass 1 - General (130 tokens):** [Same as independent]

**Pass 2 - Spatial with Context (132 tokens):**

**Prompt sent to moondream:**
```
You described this scene: "The image captures a bustling city street at night, 
illuminated by bright lights from towering buildings that line both sides of the 
road. The street is filled with cars moving along it, their headlights cutting 
through the darkness as they navigate the urban landscape. Pedestrians can be 
seen walking on the sidewalks, adding to the lively atmosphere. The buildings 
are adorned with numerous billboards and signs, each one vying for attention 
amidst the city's nightlife. Streetlights dot the scene, casting a warm glow 
that contrasts with the cool tones of the cityscape. The overall mood is vibrant 
and energetic, reflecting the dynamic nature of urban life at night."

Now, focusing on spatial arrangement: Where exactly are the buildings, street, 
cars, and people positioned? Describe the depth from foreground to background.
```

**Response:**
```
In this image, a bustling city street comes alive at night with bright lights 
illuminating the towering buildings lining both sides of the road. The street is 
filled with cars moving along it, their headlights cutting through the darkness 
as they navigate the urban landscape. Pedestrians can be seen walking on the 
sidewalks, adding to the lively atmosphere.

The buildings are adorned with numerous billboards and signs, each one vying for 
attention amidst the city's nightlife. Streetlights dot the scene, casting a 
warm glow that contrasts with the cool tones of the cityscape. The overall mood 
is vibrant and energetic, reflecting the dynamic nature of urban life at night.
```

**Pass 3 - Temporal with Full Context (236 tokens):**

**Prompt sent to moondream:**
```
Scene: "The image captures a bustling city street at night, illuminated by bright 
lights from towering buildings that line both sides of the road. The street is 
filled with cars moving along it, their headlights cutting through the darkness 
as they navigate the urban landscape. Pedestrians can be seen walking on the 
sidewalks, adding to the lively atmosphere. The buildings are adorned with 
numerous billboards and signs, each one vying for attention amidst the city's 
nightlife. Streetlights dot the scene, casting a warm glow that contrasts with 
the cool tones of the cityscape. The overall mood is vibrant and energetic, 
reflecting the dynamic nature of urban life at night."

Spatial layout: "In this image, a bustling city street comes alive at night with 
bright lights illuminating the towering buildings lining both sides of the road. 
The street is filled with cars moving along it, their headlights cutting through 
the darkness as they navigate the urban landscape. Pedestrians can be seen 
walking on the sidewalks, adding to the lively atmosphere. The buildings are 
adorned with numerous billboards and signs, each one vying for attention amidst 
the city's nightlife. Streetlights dot the scene, casting a warm glow that 
contrasts with the cool tones of the cityscape. The overall mood is vibrant and 
energetic, reflecting the dynamic nature of urban life at night."

Given this busy city scene with the spatial arrangement you described, what 
specific actions are the cars and pedestrians doing? What might happen in the 
next few moments?
```

**Response:**
```
In the image, there are several cars driving down the street, their headlights 
illuminating the surroundings as they navigate through the urban landscape. 
Pedestrians can be seen walking on the sidewalks or waiting at crosswalks, 
adding to the lively atmosphere of the city scene. The buildings lining both 
sides of the road are adorned with numerous billboards and signs, each one 
vying for attention amidst the city's nightlife. Streetlights dot the scene, 
casting a warm glow that contrasts with the cool tones of the cityscape. Given 
this busy city scene with the spatial arrangement you described, what specific 
actions might happen in the next few moments?

In the next few minutes or hours, more cars may continue to drive down the 
street, adding to the overall activity and energy of the urban environment. 
Pedestrians may be walking along the sidewalks or waiting at crosswalks for 
their turn to cross the street safely. The city's nightlife might also include 
more businesses opening up for the day, with people coming in to shop, eat, or 
socialize. As a result, the overall atmosphere of the scene could become even 
livelier and busier as the day progresses.
```

### Cityscape Image Analysis

**Token Cost:** +55 tokens (12.4% increase)

**Quality Assessment:**
- ❌ **Chained Pass 2 is nearly identical to Pass 1** - No spatial analysis added
- ⚠️ **Chained Pass 3 includes the prompt in output** - "Given this busy city scene..."
- ✅ **Pass 3 does provide temporal prediction** (what happens next)
- ❌ **Massive token increase** (236 vs 184) due to context repetition
- ⚠️ **Model repeats context verbatim** before answering

**Conclusion:** Chained uses more tokens and **doesn't improve quality** - mostly repetition.

---

## Key Findings

### 1. Context Repetition Problem
**The model tends to repeat the provided context verbatim** before (or instead of) answering the specific question.

- Architecture Pass 2 & 3: Nearly identical to Pass 1
- Cityscape Pass 2: Nearly identical to Pass 1
- Cityscape Pass 3: Includes prompt text in output

### 2. Token Efficiency is Unpredictable
- **Simple images:** Chained can save tokens (-8.4%)
- **Complex images:** Chained costs more tokens (+12.4%)
- **Average:** Minimal difference, unpredictable direction

### 3. Quality Does Not Improve
- Chained passes often **fail to answer the specific question**
- Context causes model to **restate rather than analyze**
- Independent passes provide **more diverse information**

### 4. Information Loss in Chained
- Architecture chained: Lost temporal analysis entirely
- Cityscape chained: Lost explicit spatial depth analysis
- **Specialized questions get ignored** when context is provided

---

## Comparison Table

| Aspect | Independent | Chained | Winner |
|--------|------------|---------|--------|
| **Token Efficiency** | Predictable | Unpredictable | ⚖️ Tie |
| **Information Diversity** | High - each pass adds new perspective | Low - repetition of context | ✅ Independent |
| **Implementation** | Simple, can parallelize | Complex, sequential only | ✅ Independent |
| **Answer Quality** | Focused on specific question | Often ignores question, repeats context | ✅ Independent |
| **Coherence** | Each pass standalone | Narrative flow (when it works) | ⚖️ Tie |
| **Redundancy** | Some overlap | High repetition | ✅ Independent |

---

## Recommendations

### ✅ Use INDEPENDENT Passes

**Reasons:**
1. **More reliable** - Each pass answers its specific question
2. **Better information diversity** - Less repetition, more perspectives
3. **Predictable token usage** - No context bloat
4. **Can parallelize** - All passes can run simultaneously
5. **Simpler implementation** - No context management needed

**Best for:**
- Multi-dimensional analysis (spatial + temporal + contextual)
- When you need distinct perspectives on the same image
- Parallel processing for speed
- Predictable token budgets

### ❌ Avoid CHAINED Passes

**Reasons:**
1. **Unreliable** - Model often ignores specific questions
2. **Context repetition** - Wastes tokens restating previous outputs
3. **Information loss** - Specialized analysis gets lost
4. **Unpredictable tokens** - Can cost more or less, no pattern
5. **Sequential only** - Cannot parallelize

**Exception:**
- Might work for very specific use cases where you want the model to build on previous analysis
- Requires careful prompt engineering to prevent repetition
- Not recommended for general use

---

## Alternative: Hybrid Approach

Instead of chaining outputs, consider **chaining prompts with explicit instructions**:

### Independent with Focused Prompts

**Pass 1 - Comprehensive:**
```
What do you see in this image? Describe everything including the setting, 
objects, people, activities, colors, lighting, and mood.
```

**Pass 2 - Spatial (focused, no context):**
```
Describe ONLY the spatial layout: foreground, middle ground, background. 
Where is each element positioned?
```

**Pass 3 - Temporal (focused, no context):**
```
Describe ONLY the temporal aspects: time of day, motion, what might happen 
next. Focus on actions and dynamics.
```

This approach:
- ✅ Keeps passes independent (can parallelize)
- ✅ Uses focused prompts to avoid overlap
- ✅ Predictable token usage
- ✅ Each pass provides distinct information
- ✅ No context repetition

---

## Implementation Recommendation

```typescript
// ✅ RECOMMENDED: Independent passes with focused prompts
async function analyzeImage(imagePath: string) {
  // All passes can run in parallel
  const [general, spatial, temporal] = await Promise.all([
    caption(imagePath, {
      prompt: "What do you see in this image? Describe everything including the setting, objects, people, activities, colors, lighting, and mood."
    }),
    caption(imagePath, {
      prompt: "Describe ONLY the spatial layout: foreground, middle ground, background. Where is each element positioned?"
    }),
    caption(imagePath, {
      prompt: "Describe ONLY the temporal aspects: time of day, motion, what might happen next."
    })
  ]);
  
  return {
    general: general.caption,
    spatial: spatial.caption,
    temporal: temporal.caption,
    totalTokens: general.metadata.tokens + spatial.metadata.tokens + temporal.metadata.tokens
  };
}

// ❌ NOT RECOMMENDED: Chained contextual passes
async function analyzeImageChained(imagePath: string) {
  // Must run sequentially
  const general = await caption(imagePath, {
    prompt: "What do you see in this image? Describe everything..."
  });
  
  const spatial = await caption(imagePath, {
    prompt: `Based on this scene: "${general.caption}"\n\nNow describe the spatial layout...`
  });
  
  const temporal = await caption(imagePath, {
    prompt: `Scene: "${general.caption}"\nLayout: "${spatial.caption}"\n\nNow analyze temporal aspects...`
  });
  
  // Unpredictable tokens, likely repetition, sequential only
  return { general, spatial, temporal };
}
```

---

## Conclusion

**Independent passes are superior** for multi-pass image analysis with moondream:v2:

1. ✅ **More reliable** - Answers specific questions consistently
2. ✅ **Better information diversity** - Each pass adds unique perspective
3. ✅ **Predictable performance** - Consistent token usage
4. ✅ **Faster** - Can parallelize all passes
5. ✅ **Simpler** - No context management complexity

**Chained contextual passes** suffer from:
- ❌ Context repetition (wastes tokens)
- ❌ Ignores specific questions
- ❌ Unpredictable token usage
- ❌ Must run sequentially
- ❌ Information loss

**Recommendation:** Use **independent passes with focused prompts** for multi-dimensional image analysis.

---

**Test Scripts:**
- `/tmp/test_chained_vs_independent.sh` - Architecture image test
- `/tmp/test_chained_cityscape.sh` - Cityscape image test

**Results:**
- `/tmp/chained_vs_independent_results.md` - Detailed architecture results
- `/tmp/chained_cityscape_details.txt` - Detailed cityscape results

**Generated:** October 25, 2025
