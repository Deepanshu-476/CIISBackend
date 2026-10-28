const AiUsage = require('../models/AiUsage');
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

const getLimit = (user) => {
  const isPrivileged = isOwnerOrAdmin(user);
  if (isPrivileged) {
    const adminVal = process.env.AI_TASK_DAILY_LIMIT_ADMIN;
    if (adminVal !== undefined && adminVal !== null && adminVal !== '') {
      const parsed = parseInt(adminVal, 10);
      if (!isNaN(parsed) && parsed >= 0) return parsed;
    }
    return 150;
  }

  const defaultVal = process.env.AI_TASK_DAILY_LIMIT;
  if (defaultVal !== undefined && defaultVal !== null && defaultVal !== '') {
    const parsed = parseInt(defaultVal, 10);
    if (!isNaN(parsed) && parsed >= 0) return parsed;
  }
  return 40;
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

    const todayIst = getTodayIstDate();
    const limit = getLimit(req.user);

    // Multi-tenant isolation: every query MUST include { company: req.user.company }
    const filter = {
      company: req.user.company,
      user: userId,
      date: todayIst,
      feature: 'task_agent',
    };

    const AiUsageModel = req?._deps?.AiUsage || AiUsage;
    const record = await AiUsageModel.findOne
      ? await AiUsageModel.findOne(filter)
      : (await AiUsageModel.findOneAndUpdate(filter, { $setOnInsert: filter }, { upsert: true, new: true }));

    const currentCount = record ? record.count || 0 : 0;

    if (currentCount >= limit) {
      return res.status(429).json({
        success: false,
        message: 'Aaj ka daily AI task budget exceed ho gaya hai. Kripya kal dobara koshish karein.',
        limit,
        current: currentCount,
      });
    }

    req.aiTaskUsage = {
      limit,
      current: currentCount,
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
const consumeTaskBudget = async (req) => {
  if (mongoose.connection.readyState !== 1 && !req?._deps?.AiUsage) return null;
  if (!req?.user || !req.user.company) return null;
  const userId = req.user._id || req.user.id;
  if (!userId) return null;

  const todayIst = getTodayIstDate();
  const filter = {
    company: req.user.company,
    user: userId,
    date: todayIst,
    feature: 'task_agent',
  };

  const update = {
    $inc: { count: 1 },
    $setOnInsert: {
      company: req.user.company,
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
  return await AiUsageModel.findOneAndUpdate(filter, update, options);
};

const getSttLimit = (user) => {
  const isPrivileged = isOwnerOrAdmin(user);
  if (isPrivileged) {
    const adminVal = process.env.AI_STT_DAILY_LIMIT_ADMIN;
    if (adminVal !== undefined && adminVal !== null && adminVal !== '') {
      const parsed = parseInt(adminVal, 10);
      if (!isNaN(parsed) && parsed >= 0) return parsed;
    }
    return 300;
  }

  const defaultVal = process.env.AI_STT_DAILY_LIMIT;
  if (defaultVal !== undefined && defaultVal !== null && defaultVal !== '') {
    const parsed = parseInt(defaultVal, 10);
    if (!isNaN(parsed) && parsed >= 0) return parsed;
  }
  return 120;
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

    const todayIst = getTodayIstDate();
    const limit = getSttLimit(req.user);

    const filter = {
      company: req.user.company,
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

  const todayIst = getTodayIstDate();
  const filter = {
    company: req.user.company,
    user: userId,
    date: todayIst,
    feature: 'stt',
  };

  const update = {
    $inc: { count: 1 },
    $setOnInsert: {
      company: req.user.company,
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
aiTaskBudget.getLimit = getLimit;
aiTaskBudget.consumeTaskBudget = consumeTaskBudget;
aiTaskBudget.getSttLimit = getSttLimit;
aiTaskBudget.aiSttBudget = aiSttBudget;
aiTaskBudget.consumeSttBudget = consumeSttBudget;

module.exports = aiTaskBudget;

