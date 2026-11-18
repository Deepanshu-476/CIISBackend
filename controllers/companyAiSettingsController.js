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

/**
 * GET /api/company/:companyId/ai-settings
 * Returns company BYOK settings, masked key, and today's total usage.
 */
exports.getCompanyAiSettings = async (req, res) => {
  try {
    const { companyId } = req.params;
    const company = await Company.findById(companyId)
      .select('companyName companyCode aiApiKeySource customGroqApiKey byokDefaultEmployeeDailyTokens byokDefaultEmployeeDailyCalls aiDailyTokenLimit aiDailyCallLimit aiDailySttLimit aiExtraTokens aiExtraCalls aiExtraStt selectedPlan')
      .populate('selectedPlan', 'name aiDailyTokenLimit aiDailyCallLimit aiDailySttLimit aiApiKeySource')
      .lean();

    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    const companyDailyTokenLimit = company.aiDailyTokenLimit ?? company.selectedPlan?.aiDailyTokenLimit ?? 25000;
    const companyDailyCallLimit = company.aiDailyCallLimit ?? company.selectedPlan?.aiDailyCallLimit ?? 35;
    const companyDailySttLimit = company.aiDailySttLimit ?? company.selectedPlan?.aiDailySttLimit ?? 100;
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
    const { companyId } = req.params;
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
    const { companyId } = req.params;
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
    const { companyId } = req.params;
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
    const { companyId, userId } = req.params;
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
    const { companyId } = req.params;
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
