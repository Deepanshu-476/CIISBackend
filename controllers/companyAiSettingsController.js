const mongoose = require('mongoose');
const Groq = require('groq-sdk');
const Company = require('../models/Company');
const User = require('../models/User');
const AiUsage = require('../models/AiUsage');
const JobRole = require('../models/JobRole');
const { getTodayIstDate } = require('../middleware/aiTaskBudget');
const { invalidateAuthUser } = require('../middleware/authMiddleware');

function maskApiKey(key) {
  if (!key || typeof key !== 'string') return '';
  const clean = key.trim();
  if (clean.length <= 11) return '***';
  return clean.slice(0, 7) + '...' + clean.slice(-4);
}

function isOwnerOrAdminUser(user) {
  if (!user) return false;
  const roles = [user.companyRole, user.role, user.jobRole]
    .filter(Boolean)
    .map((r) => String(r).trim().toLowerCase().replace(/[\s_-]+/g, ''));
  return roles.some((r) =>
    ['owner', 'admin', 'companyowner', 'companyadmin', 'superadmin'].includes(r)
  );
}

function getCompanyIdFromReq(req) {
  return req.params.companyId || req.params.id || req.user?.company?._id || req.user?.company || req.user?.companyId || null;
}

/**
 * GET /api/company/:companyId/ai-settings
 * Returns company BYOK settings, masked key, and today's total usage.
 */
exports.getCompanyAiSettings = async (req, res) => {
  try {
    const companyId = getCompanyIdFromReq(req);
    const company = await Company.findById(companyId)
      .select('companyName companyCode aiApiKeySource customGroqApiKey byokDefaultEmployeeDailyTokens byokDefaultEmployeeDailyCalls aiDailyTokenLimit aiDailyCallLimit aiDailySttLimit aiExtraTokens aiExtraCalls aiExtraStt selectedPlan')
      .populate('selectedPlan', 'name aiDailyTokenLimit aiDailyCallLimit aiDailySttLimit aiApiKeySource')
      .lean();

    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    const plan = company.selectedPlan;
    const planTokenLimit = (plan && typeof plan === 'object' && plan.aiDailyTokenLimit !== undefined) ? Number(plan.aiDailyTokenLimit) : 0;
    const planCallLimit = (plan && typeof plan === 'object' && plan.aiDailyCallLimit !== undefined) ? Number(plan.aiDailyCallLimit) : 0;
    const planSttLimit = (plan && typeof plan === 'object' && plan.aiDailySttLimit !== undefined) ? Number(plan.aiDailySttLimit) : 0;

    const companyDailyTokenLimit = (company.aiDailyTokenLimit !== undefined && company.aiDailyTokenLimit !== null)
      ? Number(company.aiDailyTokenLimit)
      : planTokenLimit;
    const companyDailyCallLimit = (company.aiDailyCallLimit !== undefined && company.aiDailyCallLimit !== null)
      ? Number(company.aiDailyCallLimit)
      : planCallLimit;
    const companyDailySttLimit = (company.aiDailySttLimit !== undefined && company.aiDailySttLimit !== null)
      ? Number(company.aiDailySttLimit)
      : planSttLimit;
    const companyExtraTokens = Number(company.aiExtraTokens || 0);
    const companyExtraCalls = Number(company.aiExtraCalls || 0);
    const companyExtraStt = Number(company.aiExtraStt || 0);

    const todayIst = getTodayIstDate();
    const todayUsage = await AiUsage.aggregate([
      {
        $match: {
          company: new mongoose.Types.ObjectId(companyId),
          date: todayIst,
          feature: 'task_agent',
        },
      },
      {
        $group: {
          _id: null,
          totalTokens: { $sum: '$tokensUsed' },
          totalCalls: { $sum: '$count' },
          activeUsers: { $addToSet: '$user' },
        },
      },
    ]);

    const stats = todayUsage[0] || { totalTokens: 0, totalCalls: 0, activeUsers: [] };

    return res.status(200).json({
      success: true,
      data: {
        companyId: company._id,
        companyName: company.companyName,
        aiApiKeySource: company.aiApiKeySource || 'platform',
        hasCustomApiKey: Boolean(company.customGroqApiKey),
        maskedKey: company.customGroqApiKey ? maskApiKey(company.customGroqApiKey) : null,
        byokDefaultEmployeeDailyTokens: company.byokDefaultEmployeeDailyTokens ?? 10000,
        byokDefaultEmployeeDailyCalls: company.byokDefaultEmployeeDailyCalls ?? 30,
        platformPlanTokenLimit: companyDailyTokenLimit,
        companyDailyTokenLimit,
        companyDailyCallLimit,
        companyDailySttLimit,
        companyExtraTokens,
        companyExtraCalls,
        companyExtraStt,
        todayUsage: {
          date: todayIst,
          totalTokens: stats.totalTokens,
          totalCalls: stats.totalCalls,
          activeUsersCount: stats.activeUsers.length,
        },
      },
    });
  } catch (error) {
    console.error('[getCompanyAiSettings] Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch company AI settings' });
  }
};

/**
 * PUT /api/company/:companyId/ai-settings/key
 * Updates Groq API Key and BYOK configuration.
 */
exports.updateCompanyAiKey = async (req, res) => {
  try {
    const companyId = getCompanyIdFromReq(req);
    const {
      customGroqApiKey,
      aiApiKeySource,
      byokDefaultEmployeeDailyTokens,
      byokDefaultEmployeeDailyCalls,
    } = req.body;

    const company = await Company.findById(companyId);
    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    if (customGroqApiKey !== undefined) {
      const trimmed = String(customGroqApiKey || '').trim();
      if (trimmed === '') {
        company.customGroqApiKey = null;
      } else if (!trimmed.includes('...')) {
        // Only update if it's a real new key (not the masked placeholder)
        company.customGroqApiKey = trimmed;
      }
    }

    if (aiApiKeySource && ['platform', 'client'].includes(aiApiKeySource)) {
      if (aiApiKeySource === 'client' && !company.customGroqApiKey && !req.body.customGroqApiKey) {
        return res.status(400).json({
          success: false,
          message: 'Client API key mode requires a valid Groq API key.',
        });
      }
      company.aiApiKeySource = aiApiKeySource;
    }

    if (byokDefaultEmployeeDailyTokens !== undefined) {
      const parsed = Number(byokDefaultEmployeeDailyTokens);
      if (!isNaN(parsed) && parsed >= 0) {
        company.byokDefaultEmployeeDailyTokens = parsed;
      }
    }

    if (byokDefaultEmployeeDailyCalls !== undefined) {
      const parsed = Number(byokDefaultEmployeeDailyCalls);
      if (!isNaN(parsed) && parsed >= 0) {
        company.byokDefaultEmployeeDailyCalls = parsed;
      }
    }

    await company.save();

    // Invalidate auth user cache for requesting user to pick up new company fields
    if (req.user?._id) invalidateAuthUser(req.user._id);

    return res.status(200).json({
      success: true,
      message: 'Company AI configuration saved successfully.',
      data: {
        aiApiKeySource: company.aiApiKeySource,
        hasCustomApiKey: Boolean(company.customGroqApiKey),
        maskedKey: company.customGroqApiKey ? maskApiKey(company.customGroqApiKey) : null,
        byokDefaultEmployeeDailyTokens: company.byokDefaultEmployeeDailyTokens,
        byokDefaultEmployeeDailyCalls: company.byokDefaultEmployeeDailyCalls,
      },
    });
  } catch (error) {
    console.error('[updateCompanyAiKey] Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update company AI key' });
  }
};

/**
 * POST /api/company/:companyId/ai-settings/test-key
 * Validates a Groq API key against Groq API.
 */
exports.testCompanyGroqKey = async (req, res) => {
  try {
    const companyId = getCompanyIdFromReq(req);
    let { apiKey } = req.body;

    if (!apiKey || typeof apiKey !== 'string' || apiKey.includes('...')) {
      // If masked or not provided, fetch current stored key
      if (mongoose.Types.ObjectId.isValid(companyId)) {
        const company = await Company.findById(companyId).select('customGroqApiKey');
        apiKey = company?.customGroqApiKey;
      }
    }

    const cleanKey = String(apiKey || '').trim();
    if (!cleanKey) {
      return res.status(400).json({
        success: false,
        message: 'No Groq API Key provided to test.',
      });
    }

    const groq = new Groq({ apiKey: cleanKey });
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
    });

    return res.status(200).json({
      success: true,
      message: 'Groq API Key is valid and working!',
      model: completion.model || 'llama-3.3-70b-versatile',
    });
  } catch (error) {
    console.error('[testCompanyGroqKey] Verification failed:', error.message);
    const msg = error.status === 401
      ? 'Invalid Groq API key (401 Unauthorized).'
      : error.message || 'Groq connection failed.';
    return res.status(400).json({
      success: false,
      message: msg,
    });
  }
};

/**
 * GET /api/company/:companyId/ai-settings/employees
 * Lists all company employees with their AI token allocations and today's usage.
 */
exports.getEmployeeTokenAllocations = async (req, res) => {
  try {
    const companyId = getCompanyIdFromReq(req);
    const company = await Company.findById(companyId).select('byokDefaultEmployeeDailyTokens byokDefaultEmployeeDailyCalls');
    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    const defaultTokens = company.byokDefaultEmployeeDailyTokens ?? 10000;
    const defaultCalls = company.byokDefaultEmployeeDailyCalls ?? 30;

    const users = await User.find({ company: companyId, isActive: true })
      .select('name email companyRole jobRole department aiConfig')
      .populate('department', 'name')
      .lean();

    // Populate jobRole name if ObjectId
    const roleIds = users
      .map((u) => u.jobRole)
      .filter((id) => id && mongoose.Types.ObjectId.isValid(id));
    const jobRoleDocs = await JobRole.find({ _id: { $in: roleIds } }).select('name').lean();
    const roleMap = new Map(jobRoleDocs.map((r) => [String(r._id), r.name]));

    const todayIst = getTodayIstDate();
    const usageDocs = await AiUsage.find({
      company: companyId,
      date: todayIst,
      feature: 'task_agent',
    }).lean();
    const usageMap = new Map(usageDocs.map((u) => [String(u.user), u]));

    const employees = users.map((u) => {
      const uId = String(u._id);
      const usage = usageMap.get(uId) || { tokensUsed: 0, count: 0 };
      const jobRoleName = roleMap.get(String(u.jobRole)) || u.jobRole || '';
      const isOwnerAdmin = isOwnerOrAdminUser(u);

      const aiConfig = u.aiConfig || {
        enabled: true,
        customDailyTokenLimit: null,
        customDailyCallLimit: null,
        isUnlimited: false,
      };

      const isUnlimited = Boolean(isOwnerAdmin || aiConfig.isUnlimited);
      const effectiveTokenLimit = isUnlimited
        ? Infinity
        : (aiConfig.customDailyTokenLimit ?? defaultTokens);
      const effectiveCallLimit = isUnlimited
        ? Infinity
        : (aiConfig.customDailyCallLimit ?? defaultCalls);

      return {
        _id: u._id,
        name: u.name,
        email: u.email,
        companyRole: u.companyRole || 'employee',
        jobRole: jobRoleName,
        department: u.department?.name || 'General',
        isOwnerAdmin,
        aiConfig: {
          enabled: aiConfig.enabled !== false,
          customDailyTokenLimit: aiConfig.customDailyTokenLimit,
          customDailyCallLimit: aiConfig.customDailyCallLimit,
          isUnlimited: Boolean(aiConfig.isUnlimited),
        },
        effectiveTokenLimit: effectiveTokenLimit === Infinity ? 'Unlimited' : effectiveTokenLimit,
        effectiveCallLimit: effectiveCallLimit === Infinity ? 'Unlimited' : effectiveCallLimit,
        todayUsage: {
          tokensUsed: usage.tokensUsed || 0,
          count: usage.count || 0,
        },
      };
    });

    return res.status(200).json({
      success: true,
      data: {
        defaultTokens,
        defaultCalls,
        employees,
      },
    });
  } catch (error) {
    console.error('[getEmployeeTokenAllocations] Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch employee token allocations' });
  }
};

/**
 * PUT /api/company/:companyId/ai-settings/employees/:userId
 * Updates an employee's AI token allocation / access.
 */
exports.updateEmployeeTokenAllocation = async (req, res) => {
  try {
    const { userId } = req.params;
    const companyId = getCompanyIdFromReq(req);
    const { enabled, customDailyTokenLimit, customDailyCallLimit, isUnlimited } = req.body;

    const user = await User.findOne({ _id: userId, company: companyId });
    if (!user) {
      return res.status(404).json({ success: false, message: 'Employee not found in this company' });
    }

    if (!user.aiConfig) {
      user.aiConfig = {
        enabled: true,
        customDailyTokenLimit: null,
        customDailyCallLimit: null,
        isUnlimited: false,
      };
    }

    if (enabled !== undefined) {
      user.aiConfig.enabled = Boolean(enabled);
    }

    if (customDailyTokenLimit !== undefined) {
      if (customDailyTokenLimit === null || customDailyTokenLimit === '') {
        user.aiConfig.customDailyTokenLimit = null;
      } else {
        const val = Number(customDailyTokenLimit);
        user.aiConfig.customDailyTokenLimit = !isNaN(val) && val >= 0 ? val : null;
      }
    }

    if (customDailyCallLimit !== undefined) {
      if (customDailyCallLimit === null || customDailyCallLimit === '') {
        user.aiConfig.customDailyCallLimit = null;
      } else {
        const val = Number(customDailyCallLimit);
        user.aiConfig.customDailyCallLimit = !isNaN(val) && val >= 0 ? val : null;
      }
    }

    if (isUnlimited !== undefined) {
      user.aiConfig.isUnlimited = Boolean(isUnlimited);
    }

    await user.save();
    invalidateAuthUser(userId);

    return res.status(200).json({
      success: true,
      message: `Token allocation updated for ${user.name}`,
      data: {
        userId: user._id,
        aiConfig: user.aiConfig,
      },
    });
  } catch (error) {
    console.error('[updateEmployeeTokenAllocation] Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update employee token allocation' });
  }
};

/**
 * PUT /api/company/:companyId/ai-settings/employees/bulk
 * Bulk updates token limits for multiple employees.
 */
exports.bulkUpdateEmployeeTokenAllocations = async (req, res) => {
  try {
    const companyId = getCompanyIdFromReq(req);
    const { userIds, updates } = req.body;

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ success: false, message: 'No employees specified' });
    }

    const setFields = {};
    if (updates.enabled !== undefined) setFields['aiConfig.enabled'] = Boolean(updates.enabled);
    if (updates.customDailyTokenLimit !== undefined) {
      setFields['aiConfig.customDailyTokenLimit'] =
        updates.customDailyTokenLimit === null || updates.customDailyTokenLimit === ''
          ? null
          : Math.max(0, Number(updates.customDailyTokenLimit));
    }
    if (updates.isUnlimited !== undefined) setFields['aiConfig.isUnlimited'] = Boolean(updates.isUnlimited);

    await User.updateMany(
      { _id: { $in: userIds }, company: companyId },
      { $set: setFields }
    );

    userIds.forEach((id) => invalidateAuthUser(id));

    return res.status(200).json({
      success: true,
      message: `Updated AI settings for ${userIds.length} employees`,
    });
  } catch (error) {
    console.error('[bulkUpdateEmployeeTokenAllocations] Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to bulk update employees' });
  }
};

/**
 * GET /api/company/:companyId/ai-settings/history
 * Returns historical AI token usage analytics, daily breakdown, and employee leaderboard.
 * Supports date ranges, keySource filter (platform vs client BYOK), and department filters.
 */
exports.getCompanyAiUsageHistory = async (req, res) => {
  try {
    const companyId = getCompanyIdFromReq(req);
    let { startDate, endDate, keySource = 'all', department, search } = req.query;

    const todayIst = getTodayIstDate();
    if (!endDate || typeof endDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      endDate = todayIst;
    }
    if (!startDate || typeof startDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      // Default: 30 days ago
      const d = new Date();
      d.setDate(d.getDate() - 30);
      startDate = getTodayIstDate(d);
    }

    if (!mongoose.Types.ObjectId.isValid(companyId)) {
      return res.status(400).json({ success: false, message: 'Invalid company ID' });
    }

    const companyObjId = new mongoose.Types.ObjectId(companyId);

    // Optional user pre-filtering by department or search
    let targetUserIds = null;
    if ((department && department !== 'ALL') || search) {
      const userFilter = { company: companyObjId };
      if (department && department !== 'ALL') {
        if (mongoose.Types.ObjectId.isValid(department)) {
          userFilter.department = department;
        } else {
          // If department name passed, find Department by name
          const DepartmentModel = mongoose.models.Department;
          if (DepartmentModel) {
            const deptDoc = await DepartmentModel.findOne({ company: companyObjId, name: department }).select('_id');
            if (deptDoc) userFilter.department = deptDoc._id;
          }
        }
      }
      if (search) {
        userFilter.$or = [
          { name: { $regex: search.trim(), $options: 'i' } },
          { email: { $regex: search.trim(), $options: 'i' } },
        ];
      }
      const matchedUsers = await User.find(userFilter).select('_id').lean();
      targetUserIds = matchedUsers.map((u) => u._id);
    }

    const matchStage = {
      company: companyObjId,
      feature: 'task_agent',
      date: { $gte: startDate, $lte: endDate },
    };

    if (targetUserIds !== null) {
      matchStage.user = { $in: targetUserIds };
    }

    if (keySource === 'platform') {
      matchStage.$or = [
        { keySource: 'platform' },
        { tokensPlatform: { $gt: 0 } },
        { $and: [{ tokensByok: { $in: [0, null] } }, { tokensUsed: { $gt: 0 } }] },
      ];
    } else if (keySource === 'client') {
      matchStage.$or = [
        { keySource: 'client' },
        { tokensByok: { $gt: 0 } },
      ];
    }

    // 1. Group by Date for Daily Breakdown
    const dailyAgg = await AiUsage.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: '$date',
          totalTokens: { $sum: '$tokensUsed' },
          platformTokens: {
            $sum: {
              $cond: [
                { $gt: ['$tokensPlatform', 0] },
                '$tokensPlatform',
                {
                  $cond: [
                    { $eq: ['$keySource', 'client'] },
                    0,
                    { $ifNull: ['$tokensUsed', 0] }
                  ]
                }
              ]
            }
          },
          byokTokens: {
            $sum: {
              $cond: [
                { $gt: ['$tokensByok', 0] },
                '$tokensByok',
                {
                  $cond: [
                    { $eq: ['$keySource', 'client'] },
                    { $ifNull: ['$tokensUsed', 0] },
                    0
                  ]
                }
              ]
            }
          },
          calls: { $sum: '$count' },
          activeUsers: { $addToSet: '$user' },
        },
      },
      { $sort: { _id: -1 } },
    ]);

    const dailyBreakdown = dailyAgg.map((d) => ({
      date: d._id,
      totalTokens: d.totalTokens || 0,
      platformTokens: d.platformTokens || 0,
      byokTokens: d.byokTokens || 0,
      calls: d.calls || 0,
      activeUsersCount: d.activeUsers?.length || 0,
    }));

    // 2. Group by User for Leaderboard
    const userAgg = await AiUsage.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: '$user',
          totalTokens: { $sum: '$tokensUsed' },
          platformTokens: {
            $sum: {
              $cond: [
                { $gt: ['$tokensPlatform', 0] },
                '$tokensPlatform',
                {
                  $cond: [
                    { $eq: ['$keySource', 'client'] },
                    0,
                    { $ifNull: ['$tokensUsed', 0] }
                  ]
                }
              ]
            }
          },
          byokTokens: {
            $sum: {
              $cond: [
                { $gt: ['$tokensByok', 0] },
                '$tokensByok',
                {
                  $cond: [
                    { $eq: ['$keySource', 'client'] },
                    { $ifNull: ['$tokensUsed', 0] },
                    0
                  ]
                }
              ]
            }
          },
          calls: { $sum: '$count' },
          daysActive: { $addToSet: '$date' },
        },
      },
      { $sort: { totalTokens: -1 } },
      { $limit: 100 },
    ]);

    const userIds = userAgg.map((u) => u._id);
    const users = await User.find({ _id: { $in: userIds } })
      .select('name email department jobRole companyRole')
      .populate('department', 'name')
      .lean();

    const roleIds = users
      .map((u) => u.jobRole)
      .filter((id) => id && mongoose.Types.ObjectId.isValid(id));
    const jobRoleDocs = await JobRole.find({ _id: { $in: roleIds } }).select('name').lean();
    const roleMap = new Map(jobRoleDocs.map((r) => [String(r._id), r.name]));
    const userMap = new Map(users.map((u) => [String(u._id), u]));

    const grandTotalTokens = dailyBreakdown.reduce((sum, d) => sum + d.totalTokens, 0);
    const grandPlatformTokens = dailyBreakdown.reduce((sum, d) => sum + d.platformTokens, 0);
    const grandByokTokens = dailyBreakdown.reduce((sum, d) => sum + d.byokTokens, 0);
    const grandCalls = dailyBreakdown.reduce((sum, d) => sum + d.calls, 0);

    const allActiveUsersSet = new Set();
    dailyAgg.forEach((d) => {
      (d.activeUsers || []).forEach((uId) => allActiveUsersSet.add(String(uId)));
    });

    const employeeLeaderboard = userAgg.map((u, idx) => {
      const userDoc = userMap.get(String(u._id)) || {};
      const jobRoleName = roleMap.get(String(userDoc.jobRole)) || userDoc.jobRole || userDoc.companyRole || 'Employee';
      const pct = grandTotalTokens > 0 ? Number(((u.totalTokens / grandTotalTokens) * 100).toFixed(1)) : 0;

      return {
        rank: idx + 1,
        userId: u._id,
        name: userDoc.name || 'Unknown User',
        email: userDoc.email || '',
        department: userDoc.department?.name || 'General',
        jobRole: jobRoleName,
        totalTokens: u.totalTokens || 0,
        platformTokens: u.platformTokens || 0,
        byokTokens: u.byokTokens || 0,
        calls: u.calls || 0,
        daysActiveCount: u.daysActive?.length || 0,
        percentOfTotal: pct,
      };
    });

    const topUser = employeeLeaderboard[0] || null;

    return res.status(200).json({
      success: true,
      data: {
        dateRange: { startDate, endDate },
        summary: {
          totalTokens: grandTotalTokens,
          platformTokens: grandPlatformTokens,
          byokTokens: grandByokTokens,
          totalCalls: grandCalls,
          activeUsersCount: allActiveUsersSet.size,
          topUser: topUser
            ? {
                name: topUser.name,
                email: topUser.email,
                department: topUser.department,
                tokens: topUser.totalTokens,
                percentOfTotal: topUser.percentOfTotal,
              }
            : null,
        },
        dailyBreakdown,
        employeeLeaderboard,
      },
    });
  } catch (error) {
    console.error('[getCompanyAiUsageHistory] Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch AI usage history' });
  }
};

/**
 * GET /api/company/:companyId/ai-settings/my-access
 * Lightweight endpoint for any logged-in user to check if they currently have AI access.
 */
exports.getMyAiAccess = async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ success: false, hasAccess: false, message: 'Unauthorized' });
    }

    const roles = [user.companyRole, user.jobRole, user.role]
      .filter(Boolean)
      .map((r) => String(r).trim().toLowerCase().replace(/[\s_-]+/g, ''));

    const isClient = roles.includes('client');
    if (isClient) {
      return res.status(200).json({
        success: true,
        hasAccess: false,
        isClient: true,
        reason: 'Client accounts do not have AI access',
      });
    }

    const isPrivileged = roles.some((r) =>
      ['owner', 'admin', 'companyowner', 'companyadmin', 'superadmin'].includes(r)
    ) || Boolean(user.isSuperAdmin || user.isPlatformOwner);

    if (isPrivileged) {
      return res.status(200).json({
        success: true,
        hasAccess: true,
        isPrivileged: true,
      });
    }

    // Fetch fresh user from DB if connected to avoid any stale cached aiConfig
    let aiConfig = user.aiConfig || { enabled: true };
    if (mongoose.connection.readyState === 1 && user._id) {
      try {
        const dbUser = await User.findById(user._id).select('aiConfig company').lean();
        if (dbUser?.aiConfig) {
          aiConfig = dbUser.aiConfig;
        }
      } catch (err) {
        console.warn('[getMyAiAccess] DB lookup fallback to session user:', err.message);
      }
    }

    const isEnabled = aiConfig.enabled !== false;
    const isZeroLimit = aiConfig.customDailyTokenLimit === 0;
    const hasAccess = isEnabled && !isZeroLimit;

    return res.status(200).json({
      success: true,
      hasAccess,
      aiConfig: {
        enabled: isEnabled,
        customDailyTokenLimit: aiConfig.customDailyTokenLimit,
        isUnlimited: Boolean(aiConfig.isUnlimited),
      },
    });
  } catch (error) {
    console.error('[getMyAiAccess] Error:', error);
    return res.status(500).json({ success: false, hasAccess: true, error: error.message });
  }
};


