/**
 * Test with actual image file from Pictures directory
 */

import fs from 'fs';

async function testRealImage() {
  try {
    const imagePath = '/Users/darksied/Pictures/BSOD.png';
    
    console.log('Testing with real image:', imagePath);
    console.log('File exists:', fs.existsSync(imagePath));
    
    if (!fs.existsSync(imagePath)) {
      console.log('Image not found, exiting...');
      return;
    }

    const stats = fs.statSync(imagePath);
    console.log('File size:', stats.size, 'bytes');

    // Read and encode the image
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString('base64');
    
    console.log('Base64 length:', base64Image.length);
    console.log('Base64 preview:', base64Image.substring(0, 100) + '...');

    const payload = {
      model: "moondream:v2",
      prompt: "Describe this image in detail",
      images: [base64Image],
      stream: false
    };

    console.log('Making request to Ollama...');

    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    console.log('Response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Error response:', errorText);
      return;
    }

    const data = await response.json();
    console.log('Success! Response:', data.response);

  } catch (error) {
    console.error('Error:', error.message);
  }
}

testRealImage();
