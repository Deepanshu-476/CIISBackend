const AiUsage = require('../models/AiUsage');
const Company = require('../models/Company');
const mongoose = require('mongoose');

const getTodayIstDate = (d = new Date()) => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(d);
  const year = parts.find((p) => p.type === 'year').value;
  const month = parts.find((p) => p.type === 'month').value;
  const day = parts.find((p) => p.type === 'day').value;
  return `${year}-${month}-${day}`;
};

const isOwnerOrAdmin = (user) => {
  if (!user) return false;
  const roles = [user.companyRole, user.role, user.jobRole]
    .filter(Boolean)
    .map((r) => String(r).trim().toLowerCase().replace(/[\s_-]+/g, ''));
  return roles.some((r) =>
    ['owner', 'admin', 'companyowner', 'companyadmin', 'superadmin'].includes(r)
  );
};

/**
 * Resolves the dynamic AI limits for a company:
 * - aiDailyTokenLimit: Daily tokens per employee
 * - aiDailyCallLimit: Daily requests per employee
 * - aiDailySttLimit: Daily voice transcriptions per employee
 * - aiExtraTokens: Top-up token pool for company
 */
const getCompanyAiLimits = async (companyRef) => {
  if (companyRef && typeof companyRef === 'object' && companyRef.aiDailyTokenLimit !== undefined) {
    return {
      tokenLimit: companyRef.aiDailyTokenLimit ?? 25000,
      callLimit: companyRef.aiDailyCallLimit ?? 35,
      sttLimit: companyRef.aiDailySttLimit ?? 100,
      extraTokens: companyRef.aiExtraTokens ?? 0,
      isExplicit: true,
    };
  }

  const companyId = companyRef?._id || companyRef;
  if (!companyId || !mongoose.Types.ObjectId.isValid(companyId)) {
    return { tokenLimit: 25000, callLimit: 35, sttLimit: 100, extraTokens: 0, isExplicit: false };
  }

  try {
    const doc = await Company.findById(companyId)
      .select('aiDailyTokenLimit aiDailyCallLimit aiDailySttLimit aiExtraTokens')
      .lean();
    if (doc) {
      return {
        tokenLimit: doc.aiDailyTokenLimit ?? 25000,
        callLimit: doc.aiDailyCallLimit ?? 35,
        sttLimit: doc.aiDailySttLimit ?? 100,
        extraTokens: doc.aiExtraTokens ?? 0,
        isExplicit: true,
      };
    }
  } catch (err) {
    console.error('getCompanyAiLimits error:', err.message);
  }

  return { tokenLimit: 25000, callLimit: 35, sttLimit: 100, extraTokens: 0, isExplicit: false };
};

const getLimit = (user, companyLimits = null) => {
  const isPrivileged = isOwnerOrAdmin(user);
  if (isPrivileged) {
    const adminVal = process.env.AI_TASK_DAILY_LIMIT_ADMIN;
    if (adminVal !== undefined && adminVal !== null && adminVal !== '') {
      const parsed = parseInt(adminVal, 10);
      if (!isNaN(parsed) && parsed >= 0) return parsed;
    }
    return 150;
  }

  if (companyLimits?.isExplicit && typeof companyLimits.callLimit === 'number') {
    return companyLimits.callLimit;
  }

  const defaultVal = process.env.AI_TASK_DAILY_LIMIT;
  if (defaultVal !== undefined && defaultVal !== null && defaultVal !== '') {
    const parsed = parseInt(defaultVal, 10);
    if (!isNaN(parsed) && parsed >= 0) return parsed;
  }

  if (companyLimits && typeof companyLimits.callLimit === 'number') {
    return companyLimits.callLimit;
  }
  return 35;
};

const getSttLimit = (user, companyLimits = null) => {
  const isPrivileged = isOwnerOrAdmin(user);
  if (isPrivileged) {
    const adminVal = process.env.AI_STT_DAILY_LIMIT_ADMIN;
    if (adminVal !== undefined && adminVal !== null && adminVal !== '') {
      const parsed = parseInt(adminVal, 10);
      if (!isNaN(parsed) && parsed >= 0) return parsed;
    }
    return 300;
  }

  if (companyLimits?.isExplicit && typeof companyLimits.sttLimit === 'number') {
    return companyLimits.sttLimit;
  }

  const defaultVal = process.env.AI_STT_DAILY_LIMIT;
  if (defaultVal !== undefined && defaultVal !== null && defaultVal !== '') {
    const parsed = parseInt(defaultVal, 10);
    if (!isNaN(parsed) && parsed >= 0) return parsed;
  }

  if (companyLimits && typeof companyLimits.sttLimit === 'number') {
    return companyLimits.sttLimit;
  }
  return 100;
};

/**
 * Middleware: Checks whether user has remaining budget for today without incrementing.
 * Action-based turns and skip turns do not consume budget.
 */
const aiTaskBudget = async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) {
      return res.status(403).json({
        success: false,
        message: 'Company missing. Please login again.',
      });
    }

    const userId = req.user._id || req.user.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User authentication missing. Please login again.',
      });
    }

    const companyId = req.user.company?._id || req.user.company;
    const todayIst = getTodayIstDate();
    const limits = await getCompanyAiLimits(req.user.company);
    const callLimit = getLimit(req.user, limits);
    const totalAllowedTokens = limits.tokenLimit + (limits.extraTokens || 0);

    // Multi-tenant isolation: every query MUST include { company: companyId }
    const filter = {
      company: companyId,
      user: userId,
      date: todayIst,
      feature: 'task_agent',
    };

    const AiUsageModel = req?._deps?.AiUsage || AiUsage;
    const record = await AiUsageModel.findOne
      ? await AiUsageModel.findOne(filter)
      : (await AiUsageModel.findOneAndUpdate(filter, { $setOnInsert: filter }, { upsert: true, new: true }));

    const currentCount = record ? record.count || 0 : 0;
    const currentTokens = record ? record.tokensUsed || 0 : 0;

    // Action-based turns, cancel, confirm, and deterministic button clicks should NOT be blocked by budget check
    const isActionOrDeterministic = Boolean(
      req.body?.action ||
      req.body?.pick ||
      req.body?.pickProject ||
      (req.body?.message && /^(?:create\s+(?:personal\s+)?task|create\s+task\s+in\s+project|assign\s+task\s+to\s+someone|view\s+tasks|skip|cancel|edit)$/i.test(String(req.body.message).trim()))
    );

    if (!isActionOrDeterministic) {
      // 1. Check token budget (Primary)
      if (currentTokens >= totalAllowedTokens) {
        return res.status(429).json({
          success: false,
          code: 'AI_TOKEN_LIMIT_REACHED',
          message: `Aaj ka daily AI token limit (${totalAllowedTokens.toLocaleString()} tokens) exceed ho gaya hai. Kripya kal dobara koshish karein ya extra tokens ke liye company admin se sampark karein.`,
          limit: totalAllowedTokens,
          current: currentTokens,
          tokensUsed: currentTokens,
        });
      }

      // 2. Check call budget (RPM/Spam Guard)
      if (currentCount >= callLimit) {
        return res.status(429).json({
          success: false,
          code: 'AI_CALL_LIMIT_REACHED',
          message: `Aaj ka daily AI request budget (${callLimit} requests) pura ho chuka hai. Kripya kal dobara koshish karein.`,
          limit: callLimit,
          current: currentCount,
        });
      }
    }

    req.aiTaskUsage = {
      limit: callLimit,
      tokenLimit: totalAllowedTokens,
      current: currentCount,
      tokensUsed: currentTokens,
      todayIst,
    };

    return next();
  } catch (error) {
    console.error('aiTaskBudget middleware error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error checking task agent budget',
    });
  }
};

/**
 * Exported helper: Increments the daily budget counter when and ONLY when
 * an actual LLM call is made.
 */
const consumeTaskBudget = async (req, tokensUsed = 780) => {
  if (mongoose.connection.readyState !== 1 && !req?._deps?.AiUsage) return null;
  if (!req?.user || !req.user.company) return null;
  const userId = req.user._id || req.user.id;
  if (!userId) return null;

  const actualTokens = Number.isFinite(tokensUsed) && tokensUsed > 0 ? Math.round(tokensUsed) : 780;
  const companyId = req.user.company?._id || req.user.company;
  const todayIst = getTodayIstDate();
  const filter = {
    company: companyId,
    user: userId,
    date: todayIst,
    feature: 'task_agent',
  };

  const update = {
    $inc: { count: 1, tokensUsed: actualTokens },
    $setOnInsert: {
      company: companyId,
      user: userId,
      date: todayIst,
      feature: 'task_agent',
    },
  };

  const options = {
    new: true,
    upsert: true,
  };

  const AiUsageModel = req?._deps?.AiUsage || AiUsage;
  const updatedDoc = await AiUsageModel.findOneAndUpdate(filter, update, options);

  // If company has extra top-up tokens and user exceeded plan limit, deduct from extra tokens
  try {
    const limits = await getCompanyAiLimits(req.user.company);
    if (limits.extraTokens > 0 && updatedDoc && updatedDoc.tokensUsed > limits.tokenLimit) {
      const deduction = Math.min(limits.extraTokens, actualTokens);
      if (deduction > 0) {
        await Company.findByIdAndUpdate(companyId, { $inc: { aiExtraTokens: -deduction } });
      }
    }
  } catch (e) {
    // Non-fatal
  }

  return updatedDoc;
};

const aiSttBudget = async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) {
      return res.status(403).json({
        success: false,
        message: 'Company missing. Please login again.',
      });
    }

    const userId = req.user._id || req.user.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User authentication missing. Please login again.',
      });
    }

    const companyId = req.user.company?._id || req.user.company;
    const todayIst = getTodayIstDate();
    const limits = await getCompanyAiLimits(req.user.company);
    const limit = getSttLimit(req.user, limits);

    const filter = {
      company: companyId,
      user: userId,
      date: todayIst,
      feature: 'stt',
    };

    const AiUsageModel = req?._deps?.AiUsage || AiUsage;
    const record = await AiUsageModel.findOne
      ? await AiUsageModel.findOne(filter)
      : (await AiUsageModel.findOneAndUpdate(filter, { $setOnInsert: filter }, { upsert: true, new: true }));

    const currentCount = record ? record.count || 0 : 0;

    if (currentCount >= limit) {
      return res.status(429).json({
        success: false,
        code: 'STT_RATE_LIMIT',
        message: 'Voice limit khatam, text se continue karein.',
        limit,
        current: currentCount,
      });
    }

    req.aiSttUsage = {
      limit,
      current: currentCount,
      todayIst,
    };

    return next();
  } catch (error) {
    console.error('aiSttBudget middleware error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error checking STT budget',
    });
  }
};

const consumeSttBudget = async (req) => {
  if (!req?.user || !req.user.company) return null;
  const userId = req.user._id || req.user.id;
  if (!userId) return null;

  const companyId = req.user.company?._id || req.user.company;
  const todayIst = getTodayIstDate();
  const filter = {
    company: companyId,
    user: userId,
    date: todayIst,
    feature: 'stt',
  };

  const update = {
    $inc: { count: 1 },
    $setOnInsert: {
      company: companyId,
      user: userId,
      date: todayIst,
      feature: 'stt',
    },
  };

  const options = {
    new: true,
    upsert: true,
  };

  const AiUsageModel = req?._deps?.AiUsage || AiUsage;
  return await AiUsageModel.findOneAndUpdate(filter, update, options);
};

aiTaskBudget.getTodayIstDate = getTodayIstDate;
aiTaskBudget.isOwnerOrAdmin = isOwnerOrAdmin;
aiTaskBudget.getCompanyAiLimits = getCompanyAiLimits;
aiTaskBudget.getLimit = getLimit;
aiTaskBudget.consumeTaskBudget = consumeTaskBudget;
aiTaskBudget.getSttLimit = getSttLimit;
aiTaskBudget.aiSttBudget = aiSttBudget;
aiTaskBudget.consumeSttBudget = consumeSttBudget;

module.exports = aiTaskBudget;
