const DailyAiSummary = require('../models/DailyAiSummary');
const {
    getCompanyScope,
    getEmployeeMetrics,
    getExecutiveMetrics,
    istDateString,
} = require('../services/ai/aiMetricsService');
const { generateEmployeeInsight, generateExecutiveInsight } = require('../services/ai/aiInsightsService');

const FALLBACK_RETRY_MS = 30 * 60 * 1000; // LLM fail hua to 30 min baad dobara try
const EXEC_TTL_MS = 60 * 60 * 1000;       // executive cache 1 ghanta
const EXEC_REFRESH_MIN_MS = 10 * 60 * 1000; // manual refresh kam se kam 10 min baad

function ageMs(doc) {
    return Date.now() - new Date(doc.generatedAt || doc.updatedAt || 0).getTime();
}

function send(res, doc, cached, extra = {}) {
    return res.status(200).json({
        success: true,
        cached,
        date: doc.date,
        source: doc.model ? 'llm' : 'fallback',
        generatedAt: doc.generatedAt,
        metrics: doc.metrics,
        insight: doc.summary,
        ...extra,
    });
}

function handleError(res, err, label) {
    if (err?.code === 'COMPANY_MISSING') {
        return res.status(403).json({ success: false, message: 'Company context missing. Please login again.' });
    }
    console.error(`[${label}] error:`, err?.message || err);
    return res.status(500).json({ success: false, message: 'Insights abhi generate nahi ho paye.' });
}

// GET /api/ai/daily-summary  (employee wrap-up; lazy cache, absent employee = 0 tokens)
exports.getDailySummary = async (req, res) => {
    try {
        const scope = getCompanyScope(req.user);
        const today = istDateString(new Date());
        const filter = { company: scope.companyObjectId, user: req.user._id, date: today, kind: 'employee_daily' };

        const existing = await DailyAiSummary.findOne(filter).lean();
        if (existing && (existing.model || ageMs(existing) < FALLBACK_RETRY_MS)) {
            return send(res, existing, true);
        }

        const metrics = await getEmployeeMetrics({ user: req.user, userId: req.user._id });
        const { insight, model } = await generateEmployeeInsight(metrics);

        const doc = await DailyAiSummary.findOneAndUpdate(
            filter,
            { $set: { companyCode: req.user.companyCode, metrics, summary: insight, model, generatedAt: new Date() } },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        ).lean();

        return send(res, doc, false);
    } catch (err) {
        return handleError(res, err, 'ai-daily-summary');
    }
};

// GET /api/ai/executive-insights?days=30&refresh=1  (Owner/Admin only, route par restrictTo)
exports.getExecutiveInsights = async (req, res) => {
    try {
        const scope = getCompanyScope(req.user);
        const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 7), 90);
        const force = String(req.query.refresh || '') === '1';
        const today = istDateString(new Date());
        const filter = { company: scope.companyObjectId, user: req.user._id, date: today, kind: 'executive' };

        const existing = await DailyAiSummary.findOne(filter).lean();
        if (existing && existing.metrics?.period?.days === days) {
            const age = ageMs(existing);
            const usable = existing.model || age < FALLBACK_RETRY_MS;
            if (usable && !force && age < EXEC_TTL_MS) return send(res, existing, true);
            if (usable && force && age < EXEC_REFRESH_MIN_MS) return send(res, existing, true, { throttled: true });
        }

        const metrics = await getExecutiveMetrics({ user: req.user, days });
        const { insight, model } = await generateExecutiveInsight(metrics);

        const doc = await DailyAiSummary.findOneAndUpdate(
            filter,
            { $set: { companyCode: req.user.companyCode, metrics, summary: insight, model, generatedAt: new Date() } },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        ).lean();

        return send(res, doc, false);
    } catch (err) {
        return handleError(res, err, 'ai-executive-insights');
    }
};