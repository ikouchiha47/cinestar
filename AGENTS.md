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

## Root Cause Analysis (RCA) Methodology

### The Systematic Approach

When debugging complex issues, follow this incremental investigation pattern:

#### 1. **Start with the Error Message**
```bash
# Always begin with the exact error from logs
grep -n "ERROR\|Failed\|Exception" logs_file
grep -A5 -B5 "specific_error_message" logs_file
```

#### 2. **Trace Backwards Through the Call Stack**
```typescript
// Example: Job marked as "failed" despite success
// Step 1: Find the failure point
[VIDEO-JOB-PROCESSOR-ERROR] Job job_123 failed: Error: No video segments were created

// Step 2: Find where this validation occurs
grep -n "No video segments were created" src/**/*.ts

// Step 3: Examine the validation logic
const segmentCount = await this.videoDb.getSegmentCount(job.id);  // ← SUSPECT LINE
if (segmentCount === 0) {
  throw new Error(`No video segments were created despite phase completion`);
}
```

#### 3. **Verify Assumptions with Database Queries**
```bash
# Test the assumption: Are there actually segments?
sqlite3 data/database.db "SELECT COUNT(*) FROM video_segments WHERE video_id = 'job_123';"
# Result: 0 (but job_123 is a JOB ID, not VIDEO ID!)

# Test with correct parameter
sqlite3 data/database.db "SELECT COUNT(*) FROM video_segments WHERE video_id = 'video_456';"
# Result: 5 (segments exist!)
```

#### 4. **Identify Parameter Mismatches**
```typescript
// Check function signature vs usage
async getSegmentCount(videoId: string): Promise<number> {  // Expects VIDEO ID
  const stmt = this.db.prepare('SELECT COUNT(*) FROM video_segments WHERE video_id = ?');
  return stmt.get(videoId).count;
}

// But called with JOB ID
const segmentCount = await this.videoDb.getSegmentCount(job.id);  // ❌ WRONG PARAMETER
```

### Git-Based Investigation Techniques

#### 1. **Find When Code Was Last Changed**
```bash
# Find recent changes to problematic function
git log --oneline -p -- src/core/video-job-processor.ts | grep -A10 -B10 "getSegmentCount"

# See who changed what and when
git blame src/core/video-job-processor.ts | grep -n "getSegmentCount"

# Check if recent commits introduced the bug
git log --since="1 week ago" --oneline -- src/core/video-job-processor.ts
```

#### 2. **Compare Working vs Broken States**
```bash
# Find the last known working commit
git log --grep="working\|fix\|success" --oneline

# Compare current state with working version
git diff HEAD~5 -- src/core/video-job-processor.ts

# Check specific function changes
git show HEAD~3:src/core/video-job-processor.ts | grep -A20 "getSegmentCount"
```

#### 3. **Bisect to Find Breaking Commit**
```bash
# Start bisection
git bisect start
git bisect bad HEAD                    # Current state is broken
git bisect good v1.2.0                # Last known working version

# Git will checkout commits for testing
# Test each commit and mark as good/bad
git bisect good    # if this commit works
git bisect bad     # if this commit is broken

# Git will identify the exact breaking commit
git bisect reset   # when done
```

### Manual Testing and Verification

#### 1. **Write Minimal Reproduction Tests**
```typescript
// Create focused test for the bug
async function testSegmentCount() {
  const videoDb = new VideoDatabase();
  
  // Test with job ID (broken)
  const jobId = 'job_1759353095548_gusol8era';
  const countWithJobId = await videoDb.getSegmentCount(jobId);
  console.log(`Count with job ID: ${countWithJobId}`);  // Should be 0
  
  // Test with video ID (correct)
  const videoFile = await videoDb.getVideoFileByPath('/path/to/video.mp4');
  const countWithVideoId = await videoDb.getSegmentCount(videoFile.id);
  console.log(`Count with video ID: ${countWithVideoId}`);  // Should be 5
}
```

#### 2. **Validate Database State Manually**
```bash
# Check table relationships
sqlite3 data/database.db ".schema video_segments"
sqlite3 data/database.db ".schema video_processing_jobs"

# Verify data exists
sqlite3 data/database.db "SELECT id, video_path FROM video_processing_jobs WHERE id = 'job_123';"
sqlite3 data/database.db "SELECT id, file_path FROM video_files WHERE file_path = '/path/from/job';"
sqlite3 data/database.db "SELECT COUNT(*) FROM video_segments WHERE video_id = 'video_id_from_above';"
```

#### 3. **Test the Fix Incrementally**
```typescript
// Step 1: Add logging to see current behavior
console.log(`[DEBUG] Job ID: ${job.id}`);
console.log(`[DEBUG] Video path: ${job.videoPath}`);

// Step 2: Test video file lookup
const videoFile = await this.videoDb.getVideoFileByPath(job.videoPath);
console.log(`[DEBUG] Video file found:`, videoFile);

// Step 3: Test segment count with correct ID
if (videoFile) {
  const segmentCount = await this.videoDb.getSegmentCount(videoFile.id);
  console.log(`[DEBUG] Segment count: ${segmentCount}`);
}
```

### Command-Line Investigation Tools

#### 1. **Log Analysis Commands**
```bash
# Find error patterns
grep -E "(ERROR|FAILED|Exception)" logs_* | head -20

# Track specific job through logs
grep "job_1759353095548_gusol8era" logs_* | grep -E "(Phase|complete|failed)"

# Find successful vs failed patterns
grep -A3 -B3 "Phase.*complete" logs_* | grep -E "(success|fail)"
```

#### 2. **Database Investigation**
```bash
# Check foreign key relationships
sqlite3 data.db "PRAGMA foreign_key_list(video_segments);"

# Find orphaned records
sqlite3 data.db "SELECT vs.id FROM video_segments vs LEFT JOIN video_files vf ON vs.video_id = vf.id WHERE vf.id IS NULL;"

# Verify data consistency
sqlite3 data.db "SELECT j.id as job_id, vf.id as video_id, COUNT(vs.id) as segments FROM video_processing_jobs j LEFT JOIN video_files vf ON j.video_path = vf.file_path LEFT JOIN video_segments vs ON vf.id = vs.video_id GROUP BY j.id;"
```

#### 3. **Code Pattern Analysis**
```bash
# Find all uses of problematic function
grep -r "getSegmentCount" src/ --include="*.ts"

# Check parameter patterns
grep -r "getSegmentCount.*job\." src/ --include="*.ts"  # Wrong usage
grep -r "getSegmentCount.*video\." src/ --include="*.ts"  # Correct usage

# Find similar bugs
grep -r "job\.id.*video" src/ --include="*.ts"
```

### RCA Documentation Template

When documenting your findings:

```markdown
## Bug Report: [Brief Description]

### 1. **Symptom**
- What the user/system experienced
- Error messages observed
- Expected vs actual behavior

### 2. **Investigation Steps**
- Log analysis commands used
- Database queries executed
- Git history examined
- Manual tests performed

### 3. **Root Cause**
- Exact line(s) of code causing the issue
- Parameter mismatch/logic error identified
- Why the bug wasn't caught earlier

### 4. **Fix Applied**
- Code changes made
- Why this approach was chosen
- Verification steps taken

### 5. **Prevention**
- How to catch similar bugs in future
- Additional logging/validation added
- Test cases to prevent regression
```

### Key Debugging Principles

1. **Never assume data structure** - Always log and verify
2. **Follow the data flow** - Trace parameters through the entire call chain
3. **Verify at each step** - Use database queries to confirm assumptions
4. **Use git history** - Understand when and why code changed
5. **Write minimal tests** - Isolate the problem with focused reproduction
6. **Document thoroughly** - Help future debugging efforts

**Remember: The best debugging is systematic, evidence-based, and leaves a clear trail for others to follow.**
