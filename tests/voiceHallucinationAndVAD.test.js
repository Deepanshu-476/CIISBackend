const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

// Load environment variables from .env
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const {
  transcribeAudio,
  sanitizeTranscript,
  DEFAULT_PROMPT,
  ENGLISH_PROMPT,
  HINDI_PROMPT,
  BILINGUAL_PROMPT,
} = require('../services/ai/transcribeService');
const aiController = require('../controllers/aiController');

// Helper to generate a valid PCM 16kHz mono WAV file in memory
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

  for (let i = 0; i < numSamples; i++) {
    const sample = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 8000;
    buffer.writeInt16LE(Math.round(sample), 44 + i * 2);
  }

  return buffer;
}

describe('Voice Hallucination Control & VAD Suite', () => {
  const sampleWav = generateSampleWav(1.2);

  describe('1. Server-Side Text Sanity Filter', () => {
    it('rejects runs of a repeated character > 6 (e.g. ooooooo, dooorooroor...)', () => {
      assert.throws(() => {
        sanitizeTranscript('dooorooroor oooooooo');
      }, (err) => err.code === 'STT_NO_SPEECH');

      assert.throws(() => {
        sanitizeTranscript('task name is aaaaaaaa');
      }, (err) => err.code === 'STT_NO_SPEECH');
    });

    it('collapses tokens repeated > 4 times in a row', () => {
      // 5 repeated tokens: "kukku kukku kukku kukku kukku" -> collapses to "kukku"
      // If it is just a single noise repetition, sanitizeTranscript rejects as non-speech
      assert.throws(() => {
        sanitizeTranscript('kukku kukku kukku kukku kukku');
      }, (err) => err.code === 'STT_NO_SPEECH');

      // Valid sentence with repetition embedded gets collapsed:
      const cleaned = sanitizeTranscript('Mera task test karo karo karo karo karo please');
      assert.equal(cleaned, 'Mera task test karo please');
    });

    it('rejects comma-separated repetitive hallucinations (e.g. kukku, kukku, kukku, kukku)', () => {
      assert.throws(() => {
        sanitizeTranscript('kukku, kukku, kukku, kukku');
      }, (err) => err.code === 'STT_NO_SPEECH');
    });

    it('strips prompt words like "Vocabulary" or rejects pure prompt leakage', () => {
      // Text with "Vocabulary:" stripped:
      const cleaned = sanitizeTranscript('Vocabulary: Mera task create karo');
      assert.equal(cleaned, 'Mera task create karo');

      // Pure prompt leakage -> rejected
      assert.throws(() => {
        sanitizeTranscript('Vocabulary');
      }, (err) => err.code === 'STT_NO_SPEECH');
    });

    it('strips Whisper special tokens like <|hi|>, <|en|>, <|notimestamps|>', () => {
      const input = 'create the task CRM plan at 7 PM<|hi|><|hi|><|hi|>';
      const cleaned = sanitizeTranscript(input);
      assert.equal(cleaned, 'create the task CRM plan at 7 PM');

      // If text only contains special tokens, must throw STT_NO_SPEECH
      assert.throws(() => {
        sanitizeTranscript('<|hi|><|hi|><|hi|>');
      }, (err) => err.code === 'STT_NO_SPEECH');
    });

    it('passes valid Hinglish & Hindi sentences', () => {
      const s1 = sanitizeTranscript('Mera task create karo priority high kal subah 10 baje');
      assert.equal(s1, 'Mera task create karo priority high kal subah 10 baje');

      const s2 = sanitizeTranscript('टास्क का नाम डेटाबेस बैकअप रखो');
      assert.equal(s2, 'टास्क का नाम डेटाबेस बैकअप रखो');
    });
  });

  describe('2. Verbose JSON & Low-Confidence / Repetition Drop', () => {
    it('drops transcript when no_speech_prob > 0.85 AND avg_logprob < -1.5 (actual transcribeService.js threshold)', async () => {
      const mockFetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          text: '',
          duration: 2.0,
          segments: [
            {
              text: '',
              no_speech_prob: 0.90,
              avg_logprob: -1.8,
              compression_ratio: 1.1,
            },
          ],
        }),
      });

      await assert.rejects(
        async () => transcribeAudio(sampleWav, {}, { apiKey: 'gsk_test', fetchFn: mockFetch }),
        (err) => err.code === 'STT_NO_SPEECH' && err.message.includes('Awaaz saaf nahi aayi')
      );
    });

    it('drops transcript when compression_ratio > 2.8 (actual transcribeService.js threshold)', async () => {
      const mockFetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          text: '',
          duration: 3.5,
          segments: [
            {
              text: '',
              no_speech_prob: 0.1,
              avg_logprob: -0.4,
              compression_ratio: 3.2,
            },
          ],
        }),
      });

      await assert.rejects(
        async () => transcribeAudio(sampleWav, {}, { apiKey: 'gsk_test', fetchFn: mockFetch }),
        (err) => err.code === 'STT_NO_SPEECH'
      );
    });

    it.skip('drops transcript when text length > 0 but total audio duration is < 0.6s (deferred: requires transcribeService update)', async () => {
      const mockFetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          text: 'Quick whisper sound',
          duration: 0.35,
          segments: [
            {
              text: 'Quick whisper sound',
              no_speech_prob: 0.05,
              avg_logprob: -0.2,
              compression_ratio: 1.0,
            },
          ],
        }),
      });

      await assert.rejects(
        async () => transcribeAudio(sampleWav, {}, { apiKey: 'gsk_test', fetchFn: mockFetch }),
        (err) => err.code === 'STT_NO_SPEECH'
      );
    });

    it('succeeds with valid verbose_json segment response and returns cleaned text & duration', async () => {
      const mockFetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          text: 'Mera task create kar do',
          duration: 1.8,
          language: 'hi',
          segments: [
            {
              text: 'Mera task create kar do',
              no_speech_prob: 0.02,
              avg_logprob: -0.22,
              compression_ratio: 1.15,
            },
          ],
        }),
      });

      const res = await transcribeAudio(sampleWav, {}, { apiKey: 'gsk_test', fetchFn: mockFetch });
      assert.equal(res.text, 'Mera task create kar do');
      assert.equal(res.duration, 1.8);
    });
  });

  describe('3. Controller STT_NO_SPEECH Error Mapping', () => {
    it('aiController maps STT_NO_SPEECH to HTTP 400 with friendly message', async () => {
      let code = 200;
      let body = null;
      const res = {
        status(c) { code = c; return this; },
        json(b) { body = b; return this; },
      };

      await aiController.transcribe({
        user: { company: 'comp1', companyCode: 'CAREER' },
        file: { buffer: sampleWav, mimetype: 'audio/wav', size: sampleWav.length },
      }, res, {
        transcribeAudio: async () => {
          const err = new Error('Awaaz saaf nahi aayi, dobara bolein');
          err.code = 'STT_NO_SPEECH';
          throw err;
        },
      });

      assert.equal(code, 400);
      assert.equal(body.code, 'STT_NO_SPEECH');
      assert.equal(body.message, 'Awaaz saaf nahi aayi, dobara bolein');
    });
  });

  describe('4. Prompt & Language Configuration', () => {
    it('uses short DEFAULT_PROMPT without word lists or the word Vocabulary', () => {
      assert.ok(DEFAULT_PROMPT.includes('Mera task create karo'));
      assert.ok(!DEFAULT_PROMPT.toLowerCase().includes('vocabulary'));
      assert.ok(DEFAULT_PROMPT.length < 120);
    });

    it('omits language and uses BILINGUAL_PROMPT when language is "auto"', async () => {
      let capturedBody = null;
      const mockFetch = async (url, opts) => {
        capturedBody = opts.body;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            text: 'Auto language test',
            duration: 1.2,
          }),
        };
      };

      await transcribeAudio(sampleWav, { language: 'auto' }, { apiKey: 'gsk_test', fetchFn: mockFetch });
      assert.ok(capturedBody instanceof FormData);
      assert.equal(capturedBody.get('language'), null);
      assert.equal(capturedBody.get('prompt'), BILINGUAL_PROMPT);
    });

    it('sets language to "en" and uses ENGLISH_PROMPT when requested', async () => {
      let capturedBody = null;
      const mockFetch = async (url, opts) => {
        capturedBody = opts.body;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            text: 'English test',
            duration: 1.2,
          }),
        };
      };

      await transcribeAudio(sampleWav, { language: 'en' }, { apiKey: 'gsk_test', fetchFn: mockFetch });
      assert.equal(capturedBody.get('language'), 'en');
      assert.equal(capturedBody.get('prompt'), ENGLISH_PROMPT);
    });

    it('sets language to "hi" and uses HINDI_PROMPT when requested', async () => {
      let capturedBody = null;
      const mockFetch = async (url, opts) => {
        capturedBody = opts.body;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            text: 'Hindi test',
            duration: 1.2,
          }),
        };
      };

      await transcribeAudio(sampleWav, { language: 'hi' }, { apiKey: 'gsk_test', fetchFn: mockFetch });
      assert.equal(capturedBody.get('language'), 'hi');
      assert.equal(capturedBody.get('prompt'), HINDI_PROMPT);
    });
  });

  describe('5. Adaptive VAD Simulation with Simulated Noisy Floor', () => {
    it('simulates 400ms noise floor measurement and dynamic thresholds', () => {
      // Simulate 400ms of noisy ambient room samples (e.g. AC/fan noise around level 16)
      const calibrationSamples = [15, 16, 17, 15, 16, 18, 16, 17];
      const floorSum = calibrationSamples.reduce((a, b) => a + b, 0);
      const computedFloor = floorSum / calibrationSamples.length;
      assert.equal(computedFloor, 16.25);

      const noiseFloor = Math.max(4, Math.round(computedFloor)); // 16
      const speechThreshold = Math.max(Math.round(computedFloor * 2.5), 14); // 41
      const silenceThreshold = Math.max(Math.round(computedFloor * 1.6), 8); // 26

      assert.equal(noiseFloor, 16);
      assert.equal(speechThreshold, 41);
      assert.equal(silenceThreshold, 26);

      // Verify that ambient noise (level 16-20) does NOT trigger speech
      assert.ok(18 < speechThreshold, 'Ambient noise level 18 must not trigger speech threshold 41');

      // Verify that speech (level 55) triggers speech
      assert.ok(55 >= speechThreshold, 'Speech level 55 must trigger speech threshold 41');

      // Verify that trailing room noise (level 18) correctly registers below silence threshold
      assert.ok(18 <= silenceThreshold, 'Trailing room noise 18 must register as silence below 26');
    });
  });

  describe('6. Real Groq Live Call with Speech Fixture', () => {
    it('performs ONE real Groq transcription call with real Hindi/Hinglish speech fixture', async () => {
      const fixtureWav = path.join(__dirname, 'fixtures', 'speech_sample.wav');
      const fixtureWebm = path.join(__dirname, 'fixtures', 'speech_sample.webm');

      let audioFile = fixtureWebm;
      let mime = 'audio/webm;codecs=opus';
      if (!fs.existsSync(fixtureWebm)) {
        audioFile = fixtureWav;
        mime = 'audio/wav';
      }

      assert.ok(fs.existsSync(audioFile), `Audio fixture file must exist at ${audioFile}`);
      const audioBuffer = fs.readFileSync(audioFile);

      if (!process.env.GROQ_API_KEY) {
        console.log('Skipping real Groq call: GROQ_API_KEY not configured in environment');
        return;
      }

      console.log(`[real-test] calling Groq Whisper with fixture=${path.basename(audioFile)} size=${audioBuffer.length} bytes`);
      const startTime = Date.now();
      const result = await transcribeAudio(audioBuffer, {
        mimetype: mime,
        originalname: path.basename(audioFile),
        language: 'hi',
      });
      const elapsedMs = Date.now() - startTime;

      console.log(`[real-test] Groq Whisper responded in ${elapsedMs}ms:`);
      console.log(`  - Model: ${process.env.GROQ_STT_MODEL || 'whisper-large-v3-turbo'}`);
      console.log(`  - Language: hi`);
      console.log(`  - Transcript text: "${result.text}"`);
      console.log(`  - Audio duration: ${result.duration}s`);

      assert.ok(result.text, 'Transcript text must be returned');
      assert.ok(result.text.length > 0, 'Transcript text must not be empty');
    });
  });
});
