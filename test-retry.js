/**
 * Test script for retry mechanism
 */

const { RetryQueue } = require('./dist/core/retry-queue.js');

async function testRetryMechanism() {
  console.log('🧪 Testing Retry Mechanism...\n');
  
  const retryQueue = RetryQueue.getInstance();
  
  // Test 1: Successful operation (no retries needed)
  console.log('Test 1: Successful operation');
  try {
    const result = await retryQueue.addTask(
      async () => {
        console.log('  ✅ Operation succeeded immediately');
        return 'success';
      },
      'test-success'
    );
    console.log(`  Result: ${result}\n`);
  } catch (error) {
    console.error(`  ❌ Unexpected error: ${error.message}\n`);
  }
  
  // Test 2: Operation that fails twice then succeeds
  console.log('Test 2: Operation that fails twice then succeeds');
  let attemptCount = 0;
  try {
    const result = await retryQueue.addTask(
      async () => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error(`Simulated API failure (attempt ${attemptCount})`);
        }
        console.log('  ✅ Operation succeeded after retries');
        return 'success-after-retries';
      },
      'test-retry-success',
      3
    );
    console.log(`  Result: ${result}\n`);
  } catch (error) {
    console.error(`  ❌ Unexpected error: ${error.message}\n`);
  }
  
  // Test 3: Operation that always fails (exceeds max retries)
  console.log('Test 3: Operation that always fails');
  try {
    const result = await retryQueue.addTask(
      async () => {
        throw new Error('Simulated permanent API failure');
      },
      'test-permanent-failure',
      2
    );
    console.log(`  Unexpected success: ${result}\n`);
  } catch (error) {
    console.log(`  ✅ Expected failure after retries: ${error.message}\n`);
  }
  
  // Test 4: Queue status
  console.log('Test 4: Queue status');
  const status = retryQueue.getStatus();
  console.log(`  Queue status: ${JSON.stringify(status)}\n`);
  
  console.log('🎉 Retry mechanism tests completed!');
}

// Run tests
testRetryMechanism().catch(console.error);
