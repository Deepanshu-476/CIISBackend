const AiUsage = require('../models/AiUsage');
const { istDateString, istDayStart } = require('../services/ai/aiMetricsService');

const BUDGETED_FEATURES = Object.freeze([
  'chat',
  'performance_summary',
  'task_agent',
]);

const DEFAULT_EMPLOYEE_DAILY_LIMIT = 5;

/**
 * Returns whether the authenticated user has Owner/Admin privileges.
 */
function isOwnerOrAdminUser(user) {
  if (!user) return false;
  const roles = [user.companyRole, user.role, user.jobRole]
    .filter(Boolean)
    .map((r) => String(r).trim().toLowerCase().replace(/[\s_-]+/g, ''));
  return roles.some((r) =>
    ['owner', 'admin', 'companyowner', 'companyadmin', 'superadmin'].includes(r)
  );
}

/**
 * Returns ISO string for the next midnight in Asia/Kolkata timezone.
 */
function getNextMidnightIso(now = new Date()) {
  const todayStart = istDayStart(now);
  const nextMidnight = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
  return nextMidnight.toISOString();
}

/**
 * Returns configured daily AI query limit for standard employees.
 */
function getEmployeeDailyLimit() {
  const envVal = process.env.AI_DAILY_LIMIT_EMPLOYEE;
  if (envVal !== undefined && envVal !== null && envVal !== '') {
    const parsed = parseInt(envVal, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_EMPLOYEE_DAILY_LIMIT;
}

/**
 * Express middleware: early read-only daily budget check.
 * Rejects with HTTP 429 if the user has already hit their daily quota.
 * Unaffected: Owner/Admin (unlimited).
 */
async function aiDailyBudget(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        code: 'AUTH_REQUIRED',
        message: 'Authentication required for AI service.',
      });
    }

    const companyId = req.user.company?._id || req.user.company || req.user.companyId;
    const userId = req.user._id || req.user.id;

    if (!companyId || !userId) {
      return res.status(403).json({
        success: false,
        code: 'COMPANY_MISSING',
        message: 'Company context missing. Please login again.',
      });
    }

    // Owner / Admin bypass
    if (isOwnerOrAdminUser(req.user)) {
      req.aiBudget = { unlimited: true };
      res.locals.aiBudget = { unlimited: true };
      return next();
    }

    const limit = getEmployeeDailyLimit();
    const now = new Date();
    const date = istDateString(now);

    const AiUsageModel = req?._deps?.AiUsage || AiUsage;
    const used = await AiUsageModel.getBudgetUsage({
      company: companyId,
      user: userId,
      date,
    });

    const resetsAt = getNextMidnightIso(now);

    if (used >= limit) {
      return res.status(429).json({
        success: false,
        code: 'AI_DAILY_LIMIT',
        message: `Aapka aaj ka daily AI quota (${limit} queries) pura ho chuka hai. Yeh kal midnight (12:00 AM IST) ko reset hoga.`,
        limit,
        used,
        remaining: 0,
        resetsAt,
      });
    }

    const budgetInfo = {
      limit,
      used,
      remaining: Math.max(0, limit - used),
      date,
      resetsAt,
      unlimited: false,
    };

    req.aiBudget = budgetInfo;
    res.locals.aiBudget = budgetInfo;
    return next();
  } catch (err) {
    console.error('[aiDailyBudget] unexpected error:', err.message || err);
    // Fail closed to prevent unchecked LLM execution on DB failure
    return res.status(503).json({
      success: false,
      code: 'AI_BUDGET_UNAVAILABLE',
      message: 'AI service temporarily unavailable. Please try again.',
    });
  }
}

/**
 * Atomic reservation helper called right before an actual LLM invocation.
 * Enforces race-condition-safe count reservation via atomic findOneAndUpdate with unique index.
 */
async function reserveAiQuery(req, feature = 'chat') {
  if (!req?.user) {
    return { ok: false, code: 'AUTH_REQUIRED' };
  }

  if (isOwnerOrAdminUser(req.user)) {
    return { ok: true, unlimited: true };
  }

  const companyId = req.user.company?._id || req.user.company || req.user.companyId;
  const userId = req.user._id || req.user.id;
  const limit = getEmployeeDailyLimit();
  const now = new Date();
  const date = istDateString(now);
  const resetsAt = getNextMidnightIso(now);

  const AiUsageModel = req?._deps?.AiUsage || AiUsage;
  const reservation = await AiUsageModel.reserveBudget({
    company: companyId,
    user: userId,
    date,
    limit,
  });

  if (!reservation.ok) {
    return {
      ok: false,
      code: 'AI_DAILY_LIMIT',
      limit,
      used: limit,
      remaining: 0,
      resetsAt,
    };
  }

  // Atomically track feature-level analytics document without affecting enforcement
  try {
    await AiUsageModel.incrementUsage({
      company: companyId,
      user: userId,
      date,
      feature: feature || 'interactive',
      inc: 1,
    });
  } catch (analyticsErr) {
    // Non-fatal analytics log
    console.warn('[aiDailyBudget] analytics increment failed:', analyticsErr.message);
  }

  req._aiQueryReserved = true;
  req._aiReservedFeature = feature || 'interactive';

  const used = reservation.count;
  const remaining = Math.max(0, limit - used);

  req.aiBudget = {
    limit,
    used,
    remaining,
    date,
    resetsAt,
    unlimited: false,
  };

  return {
    ok: true,
    limit,
    used,
    remaining,
    resetsAt,
    unlimited: false,
  };
}

/**
 * Idempotent refund helper: restores 1 query to budget and feature analytics if an LLM call fails.
 */
async function refundAiQuery(req, feature) {
  if (!req || isOwnerOrAdminUser(req.user)) return;
  if (!req._aiQueryReserved || req._aiQueryRefunded) return;

  req._aiQueryRefunded = true;

  const companyId = req.user?.company?._id || req.user?.company || req.user?.companyId;
  const userId = req.user?._id || req.user?.id;
  const now = new Date();
  const date = istDateString(now);

  const AiUsageModel = req?._deps?.AiUsage || AiUsage;

  try {
    await Promise.all([
      AiUsageModel.refundBudget({ company: companyId, user: userId, date }),
      AiUsageModel.incrementUsage({
        company: companyId,
        user: userId,
        date,
        feature: feature || req._aiReservedFeature || 'interactive',
        inc: -1,
      }),
    ]);
  } catch (refundErr) {
    console.error('[aiDailyBudget] refund failed:', refundErr.message);
  }
}

/**
 * Injects standard aiBudget metadata into the response body and attaches standard rate limit headers.
 */
function attachBudgetToResponse(req, payload = {}, res) {
  const budget = req?.aiBudget || { unlimited: isOwnerOrAdminUser(req?.user) };

  if (res && typeof res.set === 'function' && !res.headersSent) {
    if (budget.unlimited) {
      res.set('X-AI-Budget-Unlimited', 'true');
    } else {
      res.set('X-AI-Budget-Limit', String(budget.limit || DEFAULT_EMPLOYEE_DAILY_LIMIT));
      res.set('X-AI-Budget-Remaining', String(budget.remaining ?? 0));
      if (budget.resetsAt) res.set('X-AI-Budget-Reset', String(budget.resetsAt));
    }
  }

  return {
    ...payload,
    aiBudget: budget,
  };
}

module.exports = {
  aiDailyBudget,
  reserveAiQuery,
  refundAiQuery,
  attachBudgetToResponse,
  isOwnerOrAdminUser,
  getNextMidnightIso,
  getEmployeeDailyLimit,
  BUDGETED_FEATURES,
};
