# AI Agent Debugging Guide

## Core Principle
**Never make assumptions about data structure or flow without logging first.** AI agents must see the actual data to debug effectively.

## Essential Logging Strategies

### 1. Data Structure Logging
Always log the actual structure of objects, not just their presence:

```typescript
// ❌ BAD - Only shows existence
console.log(`Has transcription: ${!!segment.transcription}`);

// ✅ GOOD - Shows actual structure and type
console.log(`[DEBUG] Raw transcription object:`, segment.transcription);
console.log(`[DEBUG] Transcription type:`, typeof segment.transcription);
```

### 2. API Call Debugging
For any external API calls, log the complete request/response cycle:

```typescript
try {
  console.log(`[API-DEBUG] Making request to: ${url}`);
  console.log(`[API-DEBUG] Request body:`, requestBody);
  
  const response = await fetch(url, options);
  console.log(`[API-DEBUG] Response status: ${response.status}`);
  
  const data = await response.json();
  console.log(`[API-DEBUG] Response data:`, data);
  
} catch (error) {
  console.error(`[API-ERROR] Request failed:`, error);
  console.error(`[API-ERROR] URL: ${url}`);
  console.error(`[API-ERROR] Request body:`, requestBody);
}
```

### 3. Database Operation Logging
For database insertions, log both input and parameters:

```typescript
// Log the object being prepared
console.log(`[DB-PREP-DEBUG] Preparing object for insertion:`, objectToInsert);

// Log the actual SQL parameters
const params = [id, field1, field2, ...];
console.log(`[DB-INSERT-DEBUG] SQL parameters (${params.length}):`, params);

try {
  stmt.run(...params);
  console.log(`[DB-SUCCESS] Inserted with ID: ${id}`);
} catch (error) {
  console.error(`[DB-ERROR] Insertion failed:`, error);
  console.error(`[DB-ERROR] Expected parameters: 14, Got: ${params.length}`);
  console.error(`[DB-ERROR] Parameters:`, params);
}
```

### 4. Data Flow Debugging
Log data transformations at each step:

```typescript
// Log input
console.log(`[TRANSFORM-INPUT] Original data:`, originalData);

// Log intermediate steps
const extracted = extractData(originalData);
console.log(`[TRANSFORM-STEP] Extracted data:`, extracted);

// Log final output
const final = processData(extracted);
console.log(`[TRANSFORM-OUTPUT] Final data:`, final);
```

### 5. Error Context Logging
When errors occur, log the complete context:

```typescript
catch (error) {
  console.error(`[ERROR-CONTEXT] Function: ${functionName}`);
  console.error(`[ERROR-CONTEXT] Input parameters:`, inputParams);
  console.error(`[ERROR-CONTEXT] Current state:`, currentState);
  console.error(`[ERROR-CONTEXT] Error:`, error);
  console.error(`[ERROR-CONTEXT] Stack trace:`, error.stack);
}
```

## Debugging Patterns by Component

### Video Processing Pipeline
```typescript
// Log segment data structure
console.log(`[PIPELINE-DEBUG] Segment structure:`, {
  id: segment.id,
  hasTranscription: !!segment.transcription,
  transcriptionType: typeof segment.transcription,
  hasCaption: !!segment.caption,
  captionType: typeof segment.caption,
  // ... other fields
});

// Log actual content
console.log(`[PIPELINE-DEBUG] Raw transcription:`, segment.transcription);
console.log(`[PIPELINE-DEBUG] Raw caption:`, segment.caption);
```

### Scene Reconstruction
```typescript
// Log API configuration
console.log(`[SCENE-RECON-DEBUG] API Config:`, {
  baseUrl: this.baseUrl,
  model: this.model,
  temperature: config.temperature,
  maxTokens: config.maxTokens
});

// Log prompt and response
console.log(`[SCENE-RECON-DEBUG] Prompt:`, prompt);
console.log(`[SCENE-RECON-DEBUG] Response:`, response);
```

### Database Operations
```typescript
// Log schema expectations vs actual data
console.log(`[DB-SCHEMA-DEBUG] Expected fields: [id, videoId, videoPath, ...]`);
console.log(`[DB-SCHEMA-DEBUG] Actual object keys:`, Object.keys(objectToInsert));
console.log(`[DB-SCHEMA-DEBUG] Parameter count: ${params.length}`);
```

## Log Levels and Prefixes

Use consistent prefixes for easy filtering:

- `[DEBUG]` - Development debugging information
- `[API-DEBUG]` - API request/response details
- `[DB-DEBUG]` - Database operation details
- `[ERROR]` - Error conditions
- `[WARNING]` - Potential issues
- `[SUCCESS]` - Successful operations
- `[PERFORMANCE]` - Timing and performance metrics

## Environment-Based Logging

```typescript
const DEBUG_MODE = process.env.DEBUG_MODE === 'true' || process.env.NODE_ENV === 'development';

function debugLog(prefix: string, message: string, data?: any) {
  if (DEBUG_MODE) {
    console.log(`[${prefix}] ${message}`, data || '');
  }
}
```

## Common Debugging Scenarios

### 1. "Object is not what I expected"
```typescript
// Always log the actual object structure
console.log(`[OBJECT-DEBUG] Expected string, got:`, typeof data);
console.log(`[OBJECT-DEBUG] Object structure:`, data);
console.log(`[OBJECT-DEBUG] Object keys:`, Object.keys(data));
```

### 2. "API call is failing"
```typescript
// Log the complete request
console.log(`[API-DEBUG] URL:`, url);
console.log(`[API-DEBUG] Method:`, method);
console.log(`[API-DEBUG] Headers:`, headers);
console.log(`[API-DEBUG] Body:`, body);

// Test the endpoint separately
console.log(`[API-TEST] Testing endpoint availability...`);
```

### 3. "Database insertion failing"
```typescript
// Log parameter count and types
params.forEach((param, index) => {
  console.log(`[DB-PARAM-DEBUG] Param ${index}: ${typeof param} = ${param}`);
});
```

### 4. "Data not flowing through pipeline"
```typescript
// Log at each pipeline stage
console.log(`[PIPELINE-STAGE] Entering ${stageName}`);
console.log(`[PIPELINE-STAGE] Input data:`, inputData);
console.log(`[PIPELINE-STAGE] Output data:`, outputData);
console.log(`[PIPELINE-STAGE] Exiting ${stageName}`);
```

## Best Practices

1. **Log before assuming** - Always log the actual data structure before writing code that assumes a particular format
2. **Log the full context** - Include enough information to reproduce the issue
3. **Use structured logging** - Consistent prefixes and formats make logs searchable
4. **Log errors completely** - Include stack traces, input parameters, and system state
5. **Remove sensitive data** - Don't log API keys, passwords, or personal information
6. **Use appropriate log levels** - Debug logs for development, error logs for production issues

## AI Agent Instructions

When debugging issues:

1. **First, add comprehensive logging** to see the actual data
2. **Run the code** and examine the logs
3. **Identify the root cause** from the log output
4. **Fix the issue** based on actual data, not assumptions
5. **Verify the fix** with additional logging if needed

Remember: **Logs are the AI's eyes into the system. Without proper logging, debugging becomes guesswork.**
