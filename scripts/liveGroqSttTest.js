require('dotenv').config();
const { transcribeAudio } = require('../services/ai/transcribeService');

function generateSampleWav(durationSeconds = 1, sampleRate = 16000) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const numSamples = sampleRate * durationSeconds;
  const dataSize = numSamples * blockAlign;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);

  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Fill with silent PCM (all zeros)
  buffer.fill(0, 44);

  return buffer;
}

async function runLiveTest() {
  console.log('--- STARTING LIVE GROQ WHISPER STT TEST ---');
  const sampleWav = generateSampleWav(1); // 1 second silent wav
  console.log(`Generated synthetic sample WAV: ${sampleWav.length} bytes`);

  try {
    const result = await transcribeAudio(sampleWav, {
      mimetype: 'audio/wav',
      originalname: 'sample_synthetic_tone.wav',
    });
    console.log('Real Groq Whisper transcription result:', JSON.stringify(result));
    console.log('--- LIVE GROQ WHISPER TEST COMPLETED SUCCESSFULLY ---');
  } catch (err) {
    console.error('Live Groq Whisper test error:', err.message || err);
    process.exitCode = 1;
  }
}

runLiveTest();
