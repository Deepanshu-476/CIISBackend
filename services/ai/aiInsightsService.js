const { z } = require('zod');
const { getModel, getModelName } = require('./llm');

const employeeSchema = z.object({
    headline: z.string().default(''),
    strengths: z.array(z.string()).default([]),
    improvements: z.array(z.string()).default([]),
    mentorTip: z.string().default(''),
    learningTopics: z.array(z.string()).default([]),
});

const executiveSchema = z.object({
    headline: z.string().default(''),
    bottlenecks: z
        .array(
            z.object({
                title: z.string(),
                severity: z.enum(['high', 'medium', 'low']).default('medium'),
                detail: z.string().default(''),
            })
        )
        .default([]),
    workshopProposals: z
        .array(z.object({ title: z.string(), audience: z.string().default(''), reason: z.string().default('') }))
        .default([]),
    recommendations: z.array(z.string()).default([]),
});

const EMPLOYEE_PROMPT = `Tum ek supportive, non-judgmental Career Mentor ho.
Tumhe METRICS JSON milega (deterministic backend numbers).
RULES:
- Sirf diye gaye numbers quote karo. Koi number calculate, estimate ya guess mat karo. null ka matlab data nahi hai.
- Hinglish (Roman script) mein likho, warm aur specific.
- Pehle strengths (delivery/punctuality), phir quality bottlenecks (jaise reopen rate), phir 1-3 improvements.
- Koi URL mat likho.
- Sirf valid JSON return karo: {"headline": string, "strengths": string[2-3], "improvements": string[1-3], "mentorTip": string, "learningTopics": string[max 3, short skill phrases]}`;

const EXECUTIVE_PROMPT = `You are a McKinsey-style Executive Talent & Operations Advisor.
You get METRICS JSON computed deterministically by the backend.
RULES:
- Quote only numbers present in METRICS. Never compute or guess numbers. null means no data.
- Departments with total < 3 tasks are statistically weak; mention that instead of drawing conclusions.
- Be concise and decision-oriented. English.
- Return only valid JSON: {"headline": string, "bottlenecks": [{"title": string, "severity": "high"|"medium"|"low", "detail": string}], "workshopProposals": [{"title": string, "audience": string, "reason": string}], "recommendations": string[max 4]}`;

function extractText(resp) {
    const c = resp?.content;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) return c.map((p) => (typeof p === 'string' ? p : p?.text || '')).join('');
    return '';
}

function parseJson(text) {
    if (!text) return null;
    const cleaned = String(text).replace(/```json|```/gi, '');
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try {
        return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
        return null;
    }
}

async function callLlmJson(systemPrompt, metrics, schema, opts = {}) {
    const model = (opts.getModel || getModel)({ temperature: 0.3, maxTokens: 900 });
    const resp = await model.invoke([
        ['system', systemPrompt],
        ['human', 'METRICS:\n' + JSON.stringify(metrics)],
    ]);
    const parsed = schema.safeParse(parseJson(extractText(resp)));
    return parsed.success ? parsed.data : null;
}

// Links deterministic banate hain, LLM se URL nahi (hallucinated links se bachne ke liye).
function buildLearningLinks(topics) {
    return (topics || [])
        .map((t) => String(t || '').replace(/[^\p{L}\p{N}\s+.#-]/gu, '').trim().slice(0, 80))
        .filter(Boolean)
        .slice(0, 3)
        .map((topic) => ({
            topic,
            youtube: 'https://www.youtube.com/results?search_query=' + encodeURIComponent(topic + ' tutorial'),
            search: 'https://www.google.com/search?q=' + encodeURIComponent(topic + ' course'),
        }));
}

function fallbackEmployee(m) {
    const t = m.tasks;
    const strengths = [];
    const improvements = [];
    if (t.onTimePct != null && t.onTimePct >= 80) strengths.push(`On-time delivery ${t.onTimePct}% hai, bahut badhiya.`);
    if (m.attendance.punctualityPct != null && m.attendance.punctualityPct >= 90) strengths.push(`Punctuality ${m.attendance.punctualityPct}% hai.`);
    if (t.overdueCount > 0) improvements.push(`${t.overdueCount} task overdue hain, unhe pehle clear karein.`);
    if (t.reopenedCount > 0) improvements.push(`${t.reopenedCount} task reopen hue, submit se pehle ek baar self-review karein.`);
    return {
        headline: `Pichle ${m.period.days} din mein ${t.completed}/${t.totalAssigned} tasks complete hue.`,
        strengths,
        improvements,
        mentorTip: 'Roz din ke end mein 5 minute apne pending tasks review karein.',
        learningTopics: [],
    };
}

function fallbackExecutive(m) {
    const weak = (m.tasks.byDepartment || [])
        .filter((d) => d.total >= 3 && d.onTimePct != null)
        .sort((a, b) => a.onTimePct - b.onTimePct)
        .slice(0, 3);
    return {
        headline: `Company-wide on-time delivery ${m.tasks.overall.onTimePct ?? 'N/A'}% (last ${m.period.days} days).`,
        bottlenecks: weak.map((d) => ({
            title: `${d.department}: on-time ${d.onTimePct}%`,
            severity: d.onTimePct < 50 ? 'high' : 'medium',
            detail: `${d.overdue} overdue, ${d.reopened} reopened out of ${d.total} tasks.`,
        })),
        workshopProposals: [],
        recommendations: [],
    };
}

async function generateEmployeeInsight(metrics, opts = {}) {
    try {
        const out = await callLlmJson(EMPLOYEE_PROMPT, metrics, employeeSchema, opts);
        if (out) return { insight: { ...out, learningLinks: buildLearningLinks(out.learningTopics) }, model: getModelName() };
    } catch (err) {
        console.error('[ai-insights] employee LLM failed:', err?.message || err);
    }
    return { insight: { ...fallbackEmployee(metrics), learningLinks: [] }, model: null };
}

async function generateExecutiveInsight(metrics, opts = {}) {
    try {
        const out = await callLlmJson(EXECUTIVE_PROMPT, metrics, executiveSchema, opts);
        if (out) return { insight: out, model: getModelName() };
    } catch (err) {
        console.error('[ai-insights] executive LLM failed:', err?.message || err);
    }
    return { insight: fallbackExecutive(metrics), model: null };
}

module.exports = { generateEmployeeInsight, generateExecutiveInsight, buildLearningLinks };