const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { transcribeAudio, detectAudioFormat, classifyAndLogGroqError, getFilenameForMime } = require('../services/ai/transcribeService');
const aiController = require('../controllers/aiController');
const aiTaskBudget = require('../middleware/aiTaskBudget');
const { aiSttBudget, consumeSttBudget, getSttLimit } = aiTaskBudget;

// Helper to generate a valid PCM 16kHz mono WAV file in memory
function generateSampleWav(durationSeconds = 1, sampleRate = 16000) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const numSamples = sampleRate * durationSeconds;
  const dataSize = numSamples * blockAlign;
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  // fmt chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);

  // data chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Fill with 440Hz tone
  for (let i = 0; i < numSamples; i++) {
    const sample = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 8000;
    buffer.writeInt16LE(Math.round(sample), 44 + i * 2);
  }

  return buffer;
}

describe('Groq Whisper Transcription Suite', () => {
  const sampleWav = generateSampleWav(0.5);

  it('1. getFilenameForMime returns correct file extensions for formats', () => {
    assert.equal(getFilenameForMime('audio/wav'), 'audio.wav');
    assert.equal(getFilenameForMime('audio/x-wav'), 'audio.wav');
    assert.equal(getFilenameForMime('audio/mp4'), 'audio.mp4');
    assert.equal(getFilenameForMime('audio/ogg'), 'audio.ogg');
    assert.equal(getFilenameForMime('audio/mpeg'), 'audio.mp3');
    assert.equal(getFilenameForMime('audio/webm'), 'audio.webm');
    assert.equal(getFilenameForMime('audio/webm;codecs=opus'), 'audio.webm');
  });

  it('2. error classification maps provider errors correctly without leaking sensitive keys', () => {
    const authErr = classifyAndLogGroqError({ status: 401, message: 'Invalid token gsk_abcdef123456789' });
    assert.equal(authErr.code, 'STT_AUTH');
    assert.ok(!authErr.message.includes('gsk_abcdef123456789'));

    const modelErr = classifyAndLogGroqError({ status: 404, message: 'model_not_found' });
    assert.equal(modelErr.code, 'STT_MODEL');

    const rateErr = classifyAndLogGroqError({ status: 429, message: 'Rate limit reached' });
    assert.equal(rateErr.code, 'STT_RATE_LIMIT');

    const netErr = classifyAndLogGroqError({ message: 'fetch failed', cause: { code: 'ECONNRESET' } });
    assert.equal(netErr.code, 'STT_NETWORK');

    const badErr = classifyAndLogGroqError({ message: 'empty transcription bad output' });
    assert.equal(badErr.code, 'STT_BAD_OUTPUT');
  });

  it('3. transcribeAudio calls Groq endpoint with mock fetch and returns text', async () => {
    let capturedUrl = '';
    let capturedHeaders = {};
    let capturedBody = null;

    const mockFetch = async (url, opts) => {
      capturedUrl = url;
      capturedHeaders = opts.headers;
      capturedBody = opts.body;
      return {
        ok: true,
        status: 200,
        json: async () => ({ text: 'Task kal subah 10 baje tak complete karna hai' }),
      };
    };

    const res = await transcribeAudio(sampleWav, { mimetype: 'audio/wav', originalname: 'test.wav' }, {
      apiKey: 'gsk_test12345',
      fetchFn: mockFetch,
    });

    assert.equal(res.text, 'Task kal subah 10 baje tak complete karna hai');
    assert.equal(capturedUrl, 'https://api.groq.com/openai/v1/audio/transcriptions');
    assert.equal(capturedHeaders.Authorization, 'Bearer gsk_test12345');
    assert.ok(capturedBody instanceof FormData);
  });

  it('4. transcribeAudio rejects empty buffer and missing api key', async () => {
    await assert.rejects(
      async () => transcribeAudio(null),
      (err) => err.code === 'STT_BAD_OUTPUT'
    );

    await assert.rejects(
      async () => transcribeAudio(sampleWav, {}, { apiKey: '' }),
      (err) => err.code === 'STT_AUTH'
    );
  });

  it('5. STT Budget: computes limits (employee=120, admin=300) and enforces daily threshold', async () => {
    const employee = { companyRole: 'employee', role: 'user' };
    const admin = { companyRole: 'admin', role: 'admin' };
    const owner = { companyRole: 'owner', role: 'user' };

    assert.equal(getSttLimit(employee), 120);
    assert.equal(getSttLimit(admin), 300);
    assert.equal(getSttLimit(owner), 300);

    // Test limit threshold enforcement in middleware
    let recordedUsage = 120; // reached limit
    const mockReq = {
      user: { _id: 'emp123', company: 'comp1', companyRole: 'employee' },
      _deps: {
        AiUsage: {
          findOne: async () => ({ count: recordedUsage }),
        },
      },
    };

    let statusCode = 200;
    let resJson = null;
    const mockRes = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        resJson = data;
        return this;
      },
    };

    let nextCalled = false;
    await aiSttBudget(mockReq, mockRes, () => { nextCalled = true; });

    assert.equal(statusCode, 429);
    assert.equal(nextCalled, false);
    assert.equal(resJson.limit, 120);
    assert.equal(resJson.current, 120);

    // Below limit should allow next()
    recordedUsage = 15;
    nextCalled = false;
    await aiSttBudget(mockReq, mockRes, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.equal(mockReq.aiSttUsage.current, 15);
  });

  it('6. consumeSttBudget increments count for feature "stt"', async () => {
    let capturedFilter = null;
    let capturedUpdate = null;

    const mockReq = {
      user: { _id: 'emp123', company: 'comp1' },
      _deps: {
        AiUsage: {
          findOneAndUpdate: async (filter, update) => {
            capturedFilter = filter;
            capturedUpdate = update;
            return { count: 1 };
          },
        },
      },
    };

    await consumeSttBudget(mockReq);
    assert.equal(capturedFilter.feature, 'stt');
    assert.equal(capturedFilter.user, 'emp123');
    assert.equal(capturedUpdate.$inc.count, 1);
  });

  it('7. controller maps transcribe errors and enforces company/file requirements', async () => {
    const makeRes = () => {
      let code = 200;
      let body = null;
      return {
        status(c) { code = c; return this; },
        json(b) { body = b; return this; },
        get code() { return code; },
        get body() { return body; },
      };
    };

    // Missing company
    const res1 = makeRes();
    await aiController.transcribe({ user: {} }, res1);
    assert.equal(res1.code, 403);

    // Missing file
    const res2 = makeRes();
    await aiController.transcribe({ user: { company: 'comp1', companyCode: 'CAREER' } }, res2);
    assert.equal(res2.code, 400);

    // Upstream 429 rate limit mapping
    const res3 = makeRes();
    await aiController.transcribe({
      user: { company: 'comp1', companyCode: 'CAREER' },
      file: { buffer: sampleWav, mimetype: 'audio/wav', size: sampleWav.length },
    }, res3, {
      transcribeAudio: async () => {
        const err = new Error('Rate limit');
        err.code = 'STT_RATE_LIMIT';
        throw err;
      },
    });
    assert.equal(res3.code, 429);
    assert.equal(res3.body.code, 'STT_RATE_LIMIT');

    // Upstream 401/403 key error mapping
    const res4 = makeRes();
    await aiController.transcribe({
      user: { company: 'comp1', companyCode: 'CAREER' },
      file: { buffer: sampleWav, mimetype: 'audio/wav', size: sampleWav.length },
    }, res4, {
      transcribeAudio: async () => {
        const err = new Error('Unauthorized');
        err.code = 'STT_AUTH';
        throw err;
      },
    });
    assert.equal(res4.code, 503);
    assert.equal(res4.body.code, 'STT_AUTH');

    // Upstream Network error mapping
    const res5 = makeRes();
    await aiController.transcribe({
      user: { company: 'comp1', companyCode: 'CAREER' },
      file: { buffer: sampleWav, mimetype: 'audio/wav', size: sampleWav.length },
    }, res5, {
      transcribeAudio: async () => {
        const err = new Error('Network timeout');
        err.code = 'STT_NETWORK';
        throw err;
      },
    });
    assert.equal(res5.code, 502);
    assert.equal(res5.body.code, 'STT_NETWORK');
  });

  it('8. controller succeeds with valid audio and consumes budget', async () => {
    let budgetConsumed = false;
    const res = {
      code: 200,
      body: null,
      status(c) { this.code = c; return this; },
      json(b) { this.body = b; return this; },
    };

    await aiController.transcribe({
      user: { company: 'comp1', companyCode: 'CAREER' },
      file: { buffer: sampleWav, mimetype: 'audio/wav', size: sampleWav.length },
    }, res, {
      transcribeAudio: async () => ({ text: 'Task create karo' }),
      consumeSttBudget: async () => { budgetConsumed = true; },
    });

    assert.equal(res.code, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.text, 'Task create karo');
    assert.equal(budgetConsumed, true);
  });

  it('9. detectAudioFormat detects WebM, Ogg, WAV, and MP4 from magic bytes and handles short audio', () => {
    // WebM magic bytes: 1A 45 DF A3
    const webmBuf = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0x01]);
    const webmDet = detectAudioFormat(webmBuf, 'application/octet-stream', 'blob');
    assert.equal(webmDet.ext, 'webm');
    assert.equal(webmDet.mime, 'audio/webm');
    assert.equal(webmDet.hex, '1a45dfa3');

    // Ogg magic bytes: 4F 67 67 53
    const oggBuf = Buffer.from([0x4f, 0x67, 0x67, 0x53, 0x00, 0x02]);
    const oggDet = detectAudioFormat(oggBuf);
    assert.equal(oggDet.ext, 'ogg');
    assert.equal(oggDet.mime, 'audio/ogg');
    assert.equal(oggDet.hex, '4f676753');

    // WAV magic bytes: 52 49 46 46 (RIFF)
    const wavBuf = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00]);
    const wavDet = detectAudioFormat(wavBuf);
    assert.equal(wavDet.ext, 'wav');
    assert.equal(wavDet.mime, 'audio/wav');
    assert.equal(wavDet.hex, '52494646');

    // MP4: ftyp at bytes 4-7
    const mp4Buf = Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70]);
    const mp4Det = detectAudioFormat(mp4Buf);
    assert.equal(mp4Det.ext, 'mp4');
    assert.equal(mp4Det.mime, 'audio/mp4');
  });

  it('10. real short speech sample fixture transcribes successfully via Groq Whisper', async () => {
    const fixtureWebm = path.join(__dirname, 'fixtures', 'speech_sample.webm');
    if (!fs.existsSync(fixtureWebm)) {
      // If webm not present, check wav fixture
      const fixtureWav = path.join(__dirname, 'fixtures', 'speech_sample.wav');
      assert.ok(fs.existsSync(fixtureWav), 'Audio fixture must exist under tests/fixtures');
      return;
    }

    const audioBuf = fs.readFileSync(fixtureWebm);
    assert.ok(audioBuf.length > 1000, `Expected audio buffer > 1000 bytes, got ${audioBuf.length}`);

    // Call real Groq Whisper if API key is present
    if (process.env.GROQ_API_KEY) {
      const res = await transcribeAudio(audioBuf, {
        mimetype: 'audio/webm;codecs=opus',
        originalname: 'speech_sample.webm',
        language: 'en',
      });
      assert.ok(res.text, 'Transcription text must be non-empty');
      assert.ok(res.text.toLowerCase().includes('voice') || res.text.toLowerCase().includes('task') || res.text.toLowerCase().includes('assistant'),
        `Expected voice/task in transcript, got: "${res.text}"`
      );
    }
  });
});
