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
  if (companyRef && typeof companyRef === 'object') {
    const plan = companyRef.selectedPlan;
    const planTokenLimit = (plan && typeof plan === 'object' && plan.aiDailyTokenLimit !== undefined) ? Number(plan.aiDailyTokenLimit) : 0;
    const planCallLimit = (plan && typeof plan === 'object' && plan.aiDailyCallLimit !== undefined) ? Number(plan.aiDailyCallLimit) : 0;
    const planSttLimit = (plan && typeof plan === 'object' && plan.aiDailySttLimit !== undefined) ? Number(plan.aiDailySttLimit) : 0;

    const tokenLimit = (companyRef.aiDailyTokenLimit !== undefined && companyRef.aiDailyTokenLimit !== null)
      ? Number(companyRef.aiDailyTokenLimit)
      : planTokenLimit;
    const callLimit = (companyRef.aiDailyCallLimit !== undefined && companyRef.aiDailyCallLimit !== null)
      ? Number(companyRef.aiDailyCallLimit)
      : planCallLimit;
    const sttLimit = (companyRef.aiDailySttLimit !== undefined && companyRef.aiDailySttLimit !== null)
      ? Number(companyRef.aiDailySttLimit)
      : planSttLimit;

    return {
      aiApiKeySource: companyRef.aiApiKeySource || (plan && plan.aiApiKeySource) || 'platform',
      tokenLimit,
      callLimit,
      sttLimit,
      extraTokens: Number(companyRef.aiExtraTokens || 0),
      extraCalls: Number(companyRef.aiExtraCalls || 0),
      extraStt: Number(companyRef.aiExtraStt || 0),
      byokDefaultEmployeeDailyTokens: companyRef.byokDefaultEmployeeDailyTokens ?? 10000,
      byokDefaultEmployeeDailyCalls: companyRef.byokDefaultEmployeeDailyCalls ?? 30,
      isExplicit: true,
    };
  }

  const companyId = companyRef?._id || companyRef;
  if (!companyId) {
    return {
      aiApiKeySource: 'platform',
      tokenLimit: 0,
      callLimit: 0,
      sttLimit: 0,
      extraTokens: 0,
      extraCalls: 0,
      extraStt: 0,
      byokDefaultEmployeeDailyTokens: 10000,
      byokDefaultEmployeeDailyCalls: 30,
      isExplicit: false,
    };
  }

  // In offline mock unit tests where no MongoDB connection is open
  if (mongoose.connection.readyState !== 1 && !mongoose.Types.ObjectId.isValid(companyId)) {
    return {
      aiApiKeySource: 'platform',
      tokenLimit: 25000,
      callLimit: 35,
      sttLimit: 100,
      extraTokens: 0,
      extraCalls: 0,
      extraStt: 0,
      byokDefaultEmployeeDailyTokens: 10000,
      byokDefaultEmployeeDailyCalls: 30,
      isExplicit: false,
    };
  }

  try {
    const doc = await Company.findById(companyId)
      .select('aiApiKeySource aiDailyTokenLimit aiDailyCallLimit aiDailySttLimit aiExtraTokens aiExtraCalls aiExtraStt byokDefaultEmployeeDailyTokens byokDefaultEmployeeDailyCalls selectedPlan')
      .populate('selectedPlan', 'name aiDailyTokenLimit aiDailyCallLimit aiDailySttLimit aiApiKeySource')
      .lean();
    if (doc) {
      const plan = doc.selectedPlan;
      const planTokenLimit = (plan && typeof plan === 'object' && plan.aiDailyTokenLimit !== undefined) ? Number(plan.aiDailyTokenLimit) : 0;
      const planCallLimit = (plan && typeof plan === 'object' && plan.aiDailyCallLimit !== undefined) ? Number(plan.aiDailyCallLimit) : 0;
      const planSttLimit = (plan && typeof plan === 'object' && plan.aiDailySttLimit !== undefined) ? Number(plan.aiDailySttLimit) : 0;

      const tokenLimit = (doc.aiDailyTokenLimit !== undefined && doc.aiDailyTokenLimit !== null)
        ? Number(doc.aiDailyTokenLimit)
        : planTokenLimit;
      const callLimit = (doc.aiDailyCallLimit !== undefined && doc.aiDailyCallLimit !== null)
        ? Number(doc.aiDailyCallLimit)
        : planCallLimit;
      const sttLimit = (doc.aiDailySttLimit !== undefined && doc.aiDailySttLimit !== null)
        ? Number(doc.aiDailySttLimit)
        : planSttLimit;

      return {
        aiApiKeySource: doc.aiApiKeySource || (plan && plan.aiApiKeySource) || 'platform',
        tokenLimit,
        callLimit,
        sttLimit,
        extraTokens: Number(doc.aiExtraTokens || 0),
        extraCalls: Number(doc.aiExtraCalls || 0),
        extraStt: Number(doc.aiExtraStt || 0),
        byokDefaultEmployeeDailyTokens: doc.byokDefaultEmployeeDailyTokens ?? 10000,
        byokDefaultEmployeeDailyCalls: doc.byokDefaultEmployeeDailyCalls ?? 30,
        isExplicit: true,
      };
    }
  } catch (err) {
    console.error('getCompanyAiLimits error:', err.message);
  }

  return {
    aiApiKeySource: 'platform',
    tokenLimit: 0,
    callLimit: 0,
    sttLimit: 0,
    extraTokens: 0,
    extraCalls: 0,
    extraStt: 0,
    byokDefaultEmployeeDailyTokens: 10000,
    byokDefaultEmployeeDailyCalls: 30,
    isExplicit: false,
  };
};

const getLimit = (user, companyLimits = null) => {
  const isPrivileged = isOwnerOrAdmin(user);
  if (isPrivileged) {
    if (companyLimits && companyLimits.tokenLimit <= 0 && (!companyLimits.extraTokens || companyLimits.extraTokens <= 0) && companyLimits.aiApiKeySource !== 'client') {
      return 0;
    }
    const adminVal = process.env.AI_TASK_DAILY_LIMIT_ADMIN;
    if (adminVal !== undefined && adminVal !== null && adminVal !== '') {
      const parsed = parseInt(adminVal, 10);
      if (!isNaN(parsed) && parsed >= 0) return parsed;
    }
    return companyLimits && typeof companyLimits.callLimit === 'number' && companyLimits.callLimit > 0
      ? companyLimits.callLimit
      : 150;
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
  return 0;
};

const getSttLimit = (user, companyLimits = null) => {
  const isPrivileged = isOwnerOrAdmin(user);
  if (isPrivileged) {
    if (companyLimits && companyLimits.tokenLimit <= 0 && (!companyLimits.extraTokens || companyLimits.extraTokens <= 0) && companyLimits.aiApiKeySource !== 'client') {
      return 0;
    }
    const adminVal = process.env.AI_STT_DAILY_LIMIT_ADMIN;
    if (adminVal !== undefined && adminVal !== null && adminVal !== '') {
      const parsed = parseInt(adminVal, 10);
      if (!isNaN(parsed) && parsed >= 0) return parsed;
    }
    return companyLimits && typeof companyLimits.sttLimit === 'number' && companyLimits.sttLimit > 0
      ? companyLimits.sttLimit
      : 300;
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
  return 0;
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

    const isOwnerAdmin = isOwnerOrAdmin(req.user);
    const aiConfig = req.user.aiConfig;

    // Access explicitly disabled by company admin for this employee (enforce across ALL modes)
    if (!isOwnerAdmin && aiConfig && aiConfig.enabled === false) {
      return res.status(403).json({
        success: false,
        code: 'AI_ACCESS_DISABLED_BY_ADMIN',
        message: "You don't have access to use CIIS AI. Please contact your company administrator.",
      });
    }

    if (limits.aiApiKeySource === 'client') {
      // Owner/Admin or explicitly marked isUnlimited gets unmetered access
      if (isOwnerAdmin || (aiConfig && aiConfig.isUnlimited)) {
        req.aiTaskUsage = {
          isClientApiKey: true,
          limit: Infinity,
          tokenLimit: Infinity,
          current: 0,
          tokensUsed: 0,
          todayIst,
        };
        return next();
      }

      // Regular employee in BYOK mode: enforce company admin's allocated limits
      const userTokenLimit = aiConfig?.customDailyTokenLimit ?? limits.byokDefaultEmployeeDailyTokens ?? 10000;
      const userCallLimit = aiConfig?.customDailyCallLimit ?? limits.byokDefaultEmployeeDailyCalls ?? 30;

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

      const isActionOrDeterministic = Boolean(
        req.body?.action ||
        req.body?.pick ||
        req.body?.pickProject ||
        (req.body?.message && /^(?:create\s+(?:personal\s+)?task|create\s+task\s+in\s+project|assign\s+task\s+to\s+someone|view\s+tasks|skip|cancel|edit)$/i.test(String(req.body.message).trim()))
      );

      if (!isActionOrDeterministic) {
        if (currentTokens >= userTokenLimit) {
          return res.status(429).json({
            success: false,
            code: 'EMPLOYEE_TOKEN_LIMIT_REACHED',
            message: `Aapka daily AI token quota (${userTokenLimit.toLocaleString()} tokens) pura ho chuka hai. Kripya apne company admin se limit badhwane ke liye sampark karein.`,
            limit: userCallLimit,
            tokenLimit: userTokenLimit,
            tokensUsed: currentTokens,
          });
        }

        if (currentCount >= userCallLimit) {
          return res.status(429).json({
            success: false,
            code: 'EMPLOYEE_CALL_LIMIT_REACHED',
            message: `Aapki company ke admin dwara set kiye gaye daily AI requests (${userCallLimit}) pure ho chuke hain. Kripya kal dobara koshish karein.`,
            limit: userCallLimit,
            current: currentCount,
          });
        }
      }

      req.aiTaskUsage = {
        isClientApiKey: true,
        limit: userCallLimit,
        tokenLimit: userTokenLimit,
        current: currentCount,
        tokensUsed: currentTokens,
        todayIst,
      };
      return next();
    }

    const baseCallLimit = getLimit(req.user, limits);
    const callLimit = baseCallLimit + (limits.extraCalls || 0);
    const totalAllowedTokens = limits.tokenLimit + (limits.extraTokens || 0);

    const effectiveTokenLimit = (!isOwnerAdmin && aiConfig && !aiConfig.isUnlimited && typeof aiConfig.customDailyTokenLimit === 'number' && aiConfig.customDailyTokenLimit > 0)
      ? Math.min(totalAllowedTokens, aiConfig.customDailyTokenLimit)
      : totalAllowedTokens;

    // AI Plan Entitlement Gate: Strictly block companies without an active AI plan or allocated tokens
    if (limits.aiApiKeySource !== 'client' && totalAllowedTokens <= 0) {
      return res.status(403).json({
        success: false,
        code: 'AI_SUBSCRIPTION_REQUIRED',
        message: 'Aapki company ke active plan mein AI Assistant shamil nahi hai. Kripya AI Assistant activate karne ke liye Super Admin se plan upgrade karwayein.',
      });
    }

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
      if (currentTokens >= effectiveTokenLimit) {
        const isCustomQuota = effectiveTokenLimit < totalAllowedTokens;
        return res.status(429).json({
          success: false,
          code: isCustomQuota ? 'EMPLOYEE_TOKEN_LIMIT_REACHED' : 'AI_TOKEN_LIMIT_REACHED',
          message: isCustomQuota
            ? `Aapka daily AI token quota (${effectiveTokenLimit.toLocaleString()} tokens) pura ho chuka hai. Kripya apne company admin se limit badhwane ke liye sampark karein.`
            : `Aaj ka daily AI token limit (${totalAllowedTokens.toLocaleString()} tokens) exceed ho gaya hai. Kripya kal dobara koshish karein ya extra tokens ke liye company admin se sampark karein.`,
          limit: effectiveTokenLimit,
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

  let limits = null;
  try {
    limits = await getCompanyAiLimits(req.user.company);
  } catch (err) {
    // Non-fatal
  }
  const isClientKey = limits?.aiApiKeySource === 'client';
  const keySource = isClientKey ? 'client' : 'platform';

  const filter = {
    company: companyId,
    user: userId,
    date: todayIst,
    feature: 'task_agent',
  };

  const incFields = {
    count: 1,
    tokensUsed: actualTokens,
  };
  if (isClientKey) {
    incFields.tokensByok = actualTokens;
    incFields.callsByok = 1;
  } else {
    incFields.tokensPlatform = actualTokens;
    incFields.callsPlatform = 1;
  }

  const update = {
    $inc: incFields,
    $set: { keySource },
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

  // If company has extra top-up tokens and user exceeded plan limit, deduct from extra tokens (Platform Key only)
  try {
    if (!isClientKey && limits && limits.extraTokens > 0 && updatedDoc && updatedDoc.tokensUsed > limits.tokenLimit) {
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

    const isOwnerAdmin = isOwnerOrAdmin(req.user);
    const aiConfig = req.user.aiConfig;

    // Access explicitly disabled by company admin for this employee
    if (!isOwnerAdmin && aiConfig && aiConfig.enabled === false) {
      return res.status(403).json({
        success: false,
        code: 'AI_ACCESS_DISABLED_BY_ADMIN',
        message: "You don't have access to use CIIS AI. Please contact your company administrator.",
      });
    }

    // Owner/Admin or explicitly marked isUnlimited gets unmetered access
    if (isOwnerAdmin || (aiConfig && aiConfig.isUnlimited)) {
      req.aiSttUsage = {
        isUnlimited: true,
        limit: Infinity,
        current: 0,
        todayIst,
      };
      return next();
    }

    if (limits.aiApiKeySource === 'client') {
      req.aiSttUsage = {
        isClientApiKey: true,
        limit: Infinity,
        current: 0,
        todayIst,
      };
      return next();
    }

    if (limits.aiApiKeySource !== 'client' && limits.sttLimit <= 0 && limits.extraStt <= 0 && limits.tokenLimit <= 0 && limits.extraTokens <= 0) {
      return res.status(403).json({
        success: false,
        code: 'AI_SUBSCRIPTION_REQUIRED',
        message: 'Aapki company ke active plan mein AI Assistant shamil nahi hai. Kripya AI Assistant activate karne ke liye Super Admin se plan upgrade karwayein.',
      });
    }

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
