/**
 * services/ai/transcribeService.js
 *
 * Groq Whisper STT service (OpenAI-compatible audio transcription endpoint).
 * Model: env GROQ_STT_MODEL (default: whisper-large-v3-turbo)
 * Language: follows client setting ('hi' | 'en' | 'auto')
 * Temperature: 0
 * Short Roman Hinglish prompt hint (no word lists, no "Vocabulary").
 *
 * Rules:
 * - Never log audio buffer or transcribed text.
 * - In-memory only (never saved to disk).
 * - Standardized error classification matching taskExtractor.
 */

const path = require('path');
const GROQ_AUDIO_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const DEFAULT_MODEL = 'whisper-large-v3-turbo';

// Context prompts conditioned on selected language to prevent Whisper hallucination loops
const HINDI_PROMPT = 'CIIS AI task management, deadline, status, high priority, kal, aaj, baje, tarikh.';
const ENGLISH_PROMPT = 'CIIS AI task management, deadline, status, high priority, tomorrow, today, review.';
const BILINGUAL_PROMPT = 'CIIS AI task management, deadline, status, high priority, kal, today.';
const DEFAULT_PROMPT = HINDI_PROMPT;

/**
 * Maps a provider error to a standardized internal code and logs a single sanitized line.
 * Never logs API keys, audio data, or transcribed text.
 */
function classifyAndLogGroqError(err) {
  const status = err?.status || err?.statusCode || err?.response?.status || err?.cause?.status || err?.cause?.statusCode;
  const rawCode = err?.code || err?.cause?.code || '';
  const rawMsg = String(err?.message || err?.cause?.message || '').replace(/gsk_[a-zA-Z0-9_-]+/g, '[REDACTED_KEY]');
  const safeMsg = rawMsg.slice(0, 200);

  let mappedCode = null;

  if (err?.code === 'STT_NO_SPEECH') {
    mappedCode = 'STT_NO_SPEECH';
  } else if (err?.code === 'STT_BAD_AUDIO') {
    mappedCode = 'STT_BAD_AUDIO';
  } else if (status === 401 || status === 403 || /401|403|unauthorized|forbidden|invalid api key/i.test(rawMsg)) {
    mappedCode = 'STT_AUTH';
  } else if (status === 404 || /404|model_not_found|model not found|does not exist/i.test(rawMsg)) {
    mappedCode = 'STT_MODEL';
  } else if (status === 429 || /429|rate_limit|rate limit|too many requests/i.test(rawMsg)) {
    mappedCode = 'STT_RATE_LIMIT';
  } else if (
    status === 400 && (/invalid_media_file|could not process file|unsupported format|corrupt/i.test(rawMsg))
  ) {
    mappedCode = 'STT_FORMAT_ERROR';
  } else if (
    rawCode === 'ECONNRESET' ||
    rawCode === 'ETIMEDOUT' ||
    rawCode === 'ENOTFOUND' ||
    rawCode === 'UND_ERR_CONNECT_TIMEOUT' ||
    err?.name === 'TimeoutError' ||
    /timeout|connect|network|fetch failed|econnrefused/i.test(rawMsg)
  ) {
    mappedCode = 'STT_NETWORK';
  } else if (/bad output|invalid response|empty transcription/i.test(rawMsg)) {
    mappedCode = 'STT_BAD_OUTPUT';
  }

  const logStatus = status || 'none';
  const logCode = mappedCode || rawCode || 'UNKNOWN';
  console.error(`[ai-stt] groq error status=${logStatus} code=${logCode} msg=${safeMsg}`);

  const error = new Error(safeMsg);
  error.code = mappedCode || 'STT_ERROR';
  error.status = status;
  error.cause = err;
  return error;
}

/**
 * Sanity filter to eliminate Whisper hallucination patterns:
 * - Runs of repeated char > 6 (e.g. "ooooooo", "dooorooroor...")
 * - Token repeated > 4 times in a row (e.g. "kukku kukku kukku kukku kukku")
 * - Prompt leakage artifacts ("Vocabulary", etc.)
 *
 * @param {string} rawText
 * @returns {string} cleaned transcript
 * @throws {Error} STT_NO_SPEECH if transcript is pure hallucination or empty
 */
function sanitizeTranscript(rawText) {
  let text = String(rawText || '')
    .replace(/<\|[a-zA-Z0-9_\-\.]+\|>/g, '')
    .trim();

  if (!text) {
    const err = new Error('Awaaz saaf nahi aayi, dobara bolein');
    err.code = 'STT_NO_SPEECH';
    err.status = 400;
    throw err;
  }

  // 1. Reject runs of any character repeated > 6 times (e.g. "ooooooo", "rrrrrrr", ".......")
  if (/(.)\1{6,}/i.test(text)) {
    const err = new Error('Awaaz saaf nahi aayi, dobara bolein');
    err.code = 'STT_NO_SPEECH';
    err.status = 400;
    throw err;
  }

  // 2. Remove or strip prompt leakage words (e.g. "Vocabulary:", "Vocabulary", or exact prompt echoes)
  text = text.replace(/\bvocabulary\b[:\s-]*/gi, '').trim();
  if (text.toLowerCase() === HINDI_PROMPT.toLowerCase().trim() ||
      text.toLowerCase() === ENGLISH_PROMPT.toLowerCase().trim() ||
      text.toLowerCase() === BILINGUAL_PROMPT.toLowerCase().trim()) {
    const err = new Error('Awaaz saaf nahi aayi, dobara bolein');
    err.code = 'STT_NO_SPEECH';
    err.status = 400;
    throw err;
  }

  // 3. Collapse tokens repeated > 4 times in a row to 1 occurrence
  const hadLongRepetition = /\b([a-zA-Z0-9_\u0900-\u097F]+)(?:\s+\1){4,}\b/i.test(text);
  text = text.replace(/\b([a-zA-Z0-9_\u0900-\u097F]+)(?:\s+\1){4,}\b/gi, '$1').trim();

  // If the entire transcript was solely composed of that single repetitive token loop, reject
  if (hadLongRepetition && text.split(/\s+/).length <= 1) {
    const err = new Error('Awaaz saaf nahi aayi, dobara bolein');
    err.code = 'STT_NO_SPEECH';
    err.status = 400;
    throw err;
  }

  // Check if text is just comma-separated repetitions like "kukku, kukku, kukku..."
  const commaTokens = text.split(/[,，]\s*/).map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (commaTokens.length >= 4) {
    const unique = new Set(commaTokens);
    if (unique.size <= 2) {
      const err = new Error('Awaaz saaf nahi aayi, dobara bolein');
      err.code = 'STT_NO_SPEECH';
      err.status = 400;
      throw err;
    }
  }

  // If after sanitization nothing meaningful remains, reject
  if (!text || text.length < 2) {
    const err = new Error('Awaaz saaf nahi aayi, dobara bolein');
    err.code = 'STT_NO_SPEECH';
    err.status = 400;
    throw err;
  }

  return text;
}

function detectAudioFormat(buffer, mimetype = '', originalname = '') {
  const hex4 = buffer && buffer.length >= 4 ? buffer.subarray(0, 4).toString('hex').toLowerCase() : '';
  let ext = 'webm';
  let mime = 'audio/webm';

  // Magic byte checks:
  // WebM: 1A 45 DF A3 (1a45dfa3)
  if (hex4 === '1a45dfa3') {
    ext = 'webm';
    mime = 'audio/webm';
  } else if (hex4 === '4f676753') { // Ogg: 4F 67 67 53 ('OggS')
    ext = 'ogg';
    mime = 'audio/ogg';
  } else if (hex4 === '52494646') { // WAV: 'RIFF' (52494646)
    ext = 'wav';
    mime = 'audio/wav';
  } else if (buffer && buffer.length >= 8 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') { // MP4 has 'ftyp' at byte 4
    ext = 'mp4';
    mime = 'audio/mp4';
  } else {
    // Fall back to clean mime without codecs parameters
    const cleanMime = String(mimetype || '').split(';')[0].trim().toLowerCase();
    const cleanExt = path.extname(originalname || '').toLowerCase();
    if (cleanMime.includes('wav') || cleanExt === '.wav') { ext = 'wav'; mime = 'audio/wav'; }
    else if (cleanMime.includes('mp4') || cleanMime.includes('m4a') || cleanExt === '.mp4' || cleanExt === '.m4a') { ext = 'mp4'; mime = 'audio/mp4'; }
    else if (cleanMime.includes('ogg') || cleanExt === '.ogg') { ext = 'ogg'; mime = 'audio/ogg'; }
    else if (cleanMime.includes('mp3') || cleanMime.includes('mpeg') || cleanExt === '.mp3') { ext = 'mp3'; mime = 'audio/mp3'; }
    else { ext = 'webm'; mime = 'audio/webm'; }
  }

  return { ext, mime, hex: hex4 };
}

function getFilenameForMime(mime = '') {
  const m = String(mime).toLowerCase();
  if (m.includes('wav')) return 'audio.wav';
  if (m.includes('mp4') || m.includes('m4a')) return 'audio.mp4';
  if (m.includes('ogg')) return 'audio.ogg';
  if (m.includes('mpeg') || m.includes('mp3')) return 'audio.mp3';
  return 'audio.webm';
}

function getSafeFilename(originalname = '', mime = '') {
  const ext = path.extname(originalname || '').toLowerCase();
  const validExts = ['.webm', '.ogg', '.mp4', '.wav', '.mp3', '.mpeg', '.m4a'];
  if (ext && validExts.includes(ext)) {
    return originalname;
  }
  return getFilenameForMime(mime);
}

/**
 * Transcribe an audio buffer using Groq's Whisper API with verbose_json and hallucination safeguards.
 *
 * @param {Buffer} audioBuffer - Raw audio file in memory
 * @param {Object} options - { mimetype, originalname, size, language }
 * @param {Object} deps - Optional dependency overrides for testing ({ fetchFn, apiKey, model, prompt })
 * @returns {Promise<{ text: string, duration?: number, language?: string }>}
 */
async function transcribeAudio(audioBuffer, options = {}, deps = {}) {
  if (!audioBuffer || !Buffer.isBuffer(audioBuffer) || audioBuffer.length === 0) {
    const err = new Error('Audio buffer is required');
    err.code = 'STT_BAD_OUTPUT';
    throw err;
  }

  if (audioBuffer.length < 100) {
    const err = new Error('Awaaz record theek se nahi hui, dobara bolein');
    err.code = 'STT_BAD_AUDIO';
    err.status = 400;
    throw err;
  }

  const detected = detectAudioFormat(audioBuffer, options.mimetype, options.originalname);
  const filename = `recording.${detected.ext}`;
  const contentType = detected.mime;

  // Log ONLY technical audio header metadata (never log audio content or transcript)
  console.log(`[ai-stt] audio check mimetype=${options.mimetype || 'none'} originalname=${options.originalname || 'none'} size=${audioBuffer.length} magic=${detected.hex} sentFile=${filename} sentType=${contentType}`);

  // Discard headerless WebM cluster slice (magic 43c38100) before reaching external STT
  if (detected.hex === '43c38100') {
    const err = new Error('Awaaz record theek se nahi hui, dobara bolein');
    err.code = 'STT_BAD_AUDIO';
    err.status = 400;
    throw classifyAndLogGroqError(err);
  }

  const apiKey = deps.apiKey || process.env.GROQ_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    const err = new Error('GROQ_API_KEY is not configured');
    err.code = 'STT_AUTH';
    err.status = 401;
    throw classifyAndLogGroqError(err);
  }

  const model = deps.model || process.env.GROQ_STT_MODEL || DEFAULT_MODEL;

  // Resolve language:
  // 'auto' = omit language from Groq request
  // 'hi' / 'hi-IN' = 'hi'
  // 'en' / 'en-IN' = 'en'
  const envLang = (process.env.GROQ_STT_LANGUAGE || '').toLowerCase().trim();
  let resolvedLang = null;
  if (envLang === 'auto') {
    resolvedLang = null;
  } else if (envLang === 'en' || envLang === 'hi') {
    resolvedLang = envLang;
  } else {
    const clientLang = (options.language || '').toLowerCase().trim();
    if (clientLang === 'auto' || clientLang === 'none') {
      resolvedLang = null;
    } else if (clientLang.startsWith('en')) {
      resolvedLang = 'en';
    } else {
      resolvedLang = 'hi';
    }
  }

  // Resolve language-appropriate prompt to prevent decoder language conflict hallucinations
  let resolvedPrompt = deps.prompt || process.env.GROQ_STT_PROMPT;
  if (!resolvedPrompt) {
    if (resolvedLang === 'en') {
      resolvedPrompt = ENGLISH_PROMPT;
    } else if (resolvedLang === 'hi') {
      resolvedPrompt = HINDI_PROMPT;
    } else {
      resolvedPrompt = BILINGUAL_PROMPT;
    }
  }

  const fetchFn = deps.fetchFn || globalThis.fetch;

  try {
    const formData = new FormData();
    const blob = new Blob([audioBuffer], { type: contentType });
    formData.append('file', blob, filename);
    formData.append('model', model);
    if (resolvedLang) {
      formData.append('language', resolvedLang);
    }
    formData.append('temperature', '0');
    formData.append('prompt', resolvedPrompt);
    formData.append('response_format', 'verbose_json');

    const response = await fetchFn(GROQ_AUDIO_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
      },
      body: formData,
    });

    if (!response.ok) {
      let errorBody = '';
      try {
        errorBody = await response.text();
      } catch {
        errorBody = '';
      }
      const err = new Error(`Groq STT HTTP ${response.status}: ${errorBody}`);
      err.status = response.status;
      throw err;
    }

    const data = await response.json();
    if (!data || typeof data.text !== 'string') {
      const err = new Error('Groq STT returned invalid response without text field');
      err.code = 'STT_BAD_OUTPUT';
      throw err;
    }

    const rawText = data.text.trim();
    const audioDuration = Number(data.duration) || 0;

    // Reject only if audio has zero length or no words returned at all
    if (!rawText) {
      const err = new Error('Awaaz saaf nahi aayi, dobara bolein');
      err.code = 'STT_NO_SPEECH';
      err.status = 400;
      throw err;
    }

    // Filter segments: keep segments that contain valid speech and drop trailing/leading silence
    const segments = Array.isArray(data.segments) ? data.segments : [];
    let effectiveText = rawText;

    if (segments.length > 0) {
      const speechSegments = segments.filter((seg) => {
        const segText = String(seg.text || '').trim();
        if (!segText) return false;
        const noSpeechProb = Number(seg.no_speech_prob) || 0;
        const avgLogprob = Number(seg.avg_logprob) || 0;
        const compressionRatio = Number(seg.compression_ratio) || 0;

        // Skip degenerate repetitive loops or purely silent chunks
        if (compressionRatio > 2.8) return false;
        const hasRealWords = /[a-zA-Z0-9\u0900-\u097F]{2,}/.test(segText);
        if (!hasRealWords && noSpeechProb > 0.85 && avgLogprob < -1.5) return false;
        return true;
      });

      if (speechSegments.length > 0) {
        effectiveText = speechSegments.map((s) => s.text).join(' ').trim();
      } else if (rawText.length < 2) {
        const err = new Error('Awaaz saaf nahi aayi, dobara bolein');
        err.code = 'STT_NO_SPEECH';
        err.status = 400;
        throw err;
      }
    }

    // Check: Text sanity filter (repeated chars > 6, token repetition > 4, prompt leaks)
    const sanitizedText = sanitizeTranscript(effectiveText || rawText);

    return {
      text: sanitizedText,
      duration: audioDuration,
      language: data.language,
    };
  } catch (err) {
    throw classifyAndLogGroqError(err);
  }
}

module.exports = {
  transcribeAudio,
  sanitizeTranscript,
  detectAudioFormat,
  classifyAndLogGroqError,
  getFilenameForMime,
  getSafeFilename,
  DEFAULT_MODEL,
  DEFAULT_PROMPT,
  HINDI_PROMPT,
  ENGLISH_PROMPT,
  BILINGUAL_PROMPT,
  VOCABULARY_PROMPT: DEFAULT_PROMPT, // Backwards compatibility alias
};
