/**
 * Test script to debug Ollama API calls
 */

async function testOllamaCall() {
  try {
    // Use the same test image that worked with curl
    const base64Image = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    
    const payload = {
      model: "moondream:v2",
      prompt: "Describe this image",
      images: [base64Image],
      stream: false
    };

    console.log('Making request to Ollama...');
    console.log('Payload:', JSON.stringify(payload, null, 2));

    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    console.log('Response status:', response.status);
    console.log('Response headers:', Object.fromEntries(response.headers));

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Error response:', errorText);
      return;
    }

    const data = await response.json();
    console.log('Success! Response:', JSON.stringify(data, null, 2));

  } catch (error) {
    console.error('Error:', error);
  }
}

testOllamaCall();
