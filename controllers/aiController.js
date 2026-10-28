const { parseRequestSchema } = require('../services/ai/aiSchemas');
const { parseTaskRequest } = require('../services/ai/taskAgentService');
const { hasLLM } = require('../services/ai/llm');
const { transcribeAudio } = require('../services/ai/transcribeService');
const { consumeSttBudget } = require('../middleware/aiTaskBudget');


exports.parseTask = async (req, res, deps = {}) => {
  try {
    const companyCode = req.user?.companyCode || req.user?.company?.companyCode;
    if (!companyCode) {
      return res.status(403).json({
        success: false,
        error: 'Company code missing. Please login again.'
      });
    }

    const validation = parseRequestSchema.safeParse(req.body);
    if (!validation.success) {
      console.warn('[aiController.parseTask] Validation failed:', JSON.stringify(validation.error.issues, null, 2));
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: validation.error.issues.map(issue => ({
          field: issue.path.join('.'),
          message: issue.message
        }))
      });
    }

    const { message, language, draft, pick, action } = validation.data;

    // Verify LLM provider is configured if free-text message extraction is needed
    if (!action && message) {
      hasLLM();
    }

    const activeDeps = req?._deps || deps;
    const result = await parseTaskRequest({
      req,
      message,
      language,
      draft,
      pick,
      action,
    }, activeDeps);

    return res.status(200).json(result);
  } catch (error) {
    if (error?.code === 'LLM_NOT_CONFIGURED') {
      return res.status(503).json({
        success: false,
        code: 'LLM_NOT_CONFIGURED',
        message: 'AI Task Agent is currently not configured on this server.'
      });
    }

    if (error?.code === 'LLM_AUTH') {
      return res.status(503).json({
        success: false,
        code: 'LLM_AUTH',
        message: 'AI service key is invalid'
      });
    }

    if (error?.code === 'LLM_MODEL') {
      return res.status(503).json({
        success: false,
        code: 'LLM_MODEL',
        message: 'AI model not available'
      });
    }

    if (error?.code === 'LLM_RATE_LIMIT') {
      return res.status(429).json({
        success: false,
        code: 'LLM_RATE_LIMIT',
        message: 'AI busy, try again in a minute'
      });
    }

    if (error?.code === 'LLM_NETWORK') {
      return res.status(502).json({
        success: false,
        code: 'LLM_NETWORK',
        message: 'AI service is unreachable. Please try again.'
      });
    }

    if (error?.code === 'LLM_BAD_OUTPUT') {
      return res.status(502).json({
        success: false,
        code: 'LLM_BAD_OUTPUT',
        message: 'Samajh nahi paaya, kripya dobara bolein'
      });
    }

    console.error('❌ AI task agent error:', error);
    return res.status(502).json({
      success: false,
      message: 'AI processing service is temporarily unavailable. Please try again.'
    });
  }
};

exports.transcribe = async (req, res, deps = {}) => {
  try {
    const companyCode = req.user?.companyCode || req.user?.company?.companyCode;
    if (!companyCode) {
      return res.status(403).json({
        success: false,
        error: 'Company code missing. Please login again.'
      });
    }

    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        success: false,
        error: "Audio file is required in 'audio' field."
      });
    }

    const transcribeFn = (req?._deps && req._deps.transcribeAudio) || (deps && deps.transcribeAudio) || transcribeAudio;
    const consumeBudgetFn = (req?._deps && req._deps.consumeSttBudget) || (deps && deps.consumeSttBudget) || consumeSttBudget;

    const result = await transcribeFn(req.file.buffer, {
      mimetype: req.file.mimetype,
      originalname: req.file.originalname,
      size: req.file.size,
      language: req.body?.language || 'hi',
    });

    try {
      await consumeBudgetFn(req);
    } catch (budgetErr) {
      console.error('consumeSttBudget error:', budgetErr?.message || budgetErr);
    }

    return res.status(200).json({
      success: true,
      text: result.text || '',
      duration: result.duration,
      language: result.language,
    });
  } catch (error) {
    if (error?.code === 'STT_NO_SPEECH') {
      return res.status(400).json({
        success: false,
        code: 'STT_NO_SPEECH',
        message: error.message || 'Awaaz saaf nahi aayi, dobara bolein'
      });
    }
    if (error?.code === 'STT_BAD_AUDIO') {
      return res.status(400).json({
        success: false,
        code: 'STT_BAD_AUDIO',
        message: 'Awaaz record theek se nahi hui, dobara bolein'
      });
    }
    if (error?.code === 'STT_FORMAT_ERROR' || error?.code === 'STT_INVALID_FORMAT') {
      return res.status(400).json({
        success: false,
        code: 'STT_FORMAT_ERROR',
        message: 'Mic ki awaaz format support nahi hua'
      });
    }
    if (error?.code === 'STT_AUTH' || error?.code === 'LLM_AUTH') {
      return res.status(503).json({
        success: false,
        code: 'STT_AUTH',
        message: 'AI key problem. Admin se contact karein.'
      });
    }
    if (error?.code === 'STT_MODEL' || error?.code === 'LLM_MODEL') {
      return res.status(503).json({
        success: false,
        code: 'STT_MODEL',
        message: 'AI transcription model not available'
      });
    }
    if (error?.code === 'STT_RATE_LIMIT' || error?.code === 'LLM_RATE_LIMIT' || error?.status === 429) {
      return res.status(429).json({
        success: false,
        code: 'STT_RATE_LIMIT',
        message: 'Voice transcription limit exceed ho gayi hai. Thodi der baad try karein.'
      });
    }
    if (error?.code === 'STT_NETWORK' || error?.code === 'LLM_NETWORK') {
      return res.status(502).json({
        success: false,
        code: 'STT_NETWORK',
        message: 'AI service is unreachable. Please try again.'
      });
    }
    if (error?.code === 'STT_BAD_OUTPUT' || error?.code === 'LLM_BAD_OUTPUT') {
      return res.status(502).json({
        success: false,
        code: 'STT_BAD_OUTPUT',
        message: 'Samajh nahi paaya, kripya dobara bolein'
      });
    }

    console.error('❌ AI transcription error:', error?.code || error?.message || 'UNKNOWN');
    return res.status(502).json({
      success: false,
      code: error?.code || 'STT_ERROR',
      message: 'AI transcription service is temporarily unavailable. Please try again.'
    });
  }
};
