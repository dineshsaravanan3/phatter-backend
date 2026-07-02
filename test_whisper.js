const fs = require('fs');
const dotenv = require('dotenv');

dotenv.config();

const osmApiKey = process.env.OSM_API_KEY;
console.log('Using API Key:', osmApiKey ? osmApiKey.substring(0, 10) + '...' : 'Not found');

async function test() {
  const formData = new FormData();
  // Create a 1-second silence or mock wav file buffer
  const mockBuffer = Buffer.alloc(1000);
  const blob = new Blob([mockBuffer], { type: 'audio/wav' });
  formData.append('file', blob, 'recording.wav');
  formData.append('model', 'gpt-4o-transcribe');
  formData.append('response_format', 'text');

  try {
    const response = await fetch('https://api.osmapi.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${osmApiKey}`,
      },
      body: formData,
    });

    console.log('Status:', response.status);
    console.log('Headers:', Object.fromEntries(response.headers.entries()));
    const text = await response.text();
    console.log('Response body:', text);
  } catch (error) {
    console.error('Fetch error:', error);
  }
}

test();
