// Time-gate: employees ko sirf 5:00 PM - 7:00 PM IST window mein access.
// Owner/Admin 24/7. Env se override: AI_TIME_GATE_ENABLED, AI_TIME_GATE_START, AI_TIME_GATE_END
const PRIVILEGED_ROLES = new Set(['Owner', 'Admin']);

function getIstMinutes(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).formatToParts(now);
    const hour = Number(parts.find((p) => p.type === 'hour').value) % 24;
    const minute = Number(parts.find((p) => p.type === 'minute').value);
    return hour * 60 + minute;
}

function parseHm(value, fallbackMinutes) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
    if (!m) return fallbackMinutes;
    const h = Number(m[1]);
    const mi = Number(m[2]);
    if (h > 23 || mi > 59) return fallbackMinutes;
    return h * 60 + mi;
}

function isWithinWindow(nowMinutes, startMin, endMin) {
    if (startMin <= endMin) return nowMinutes >= startMin && nowMinutes < endMin;
    return nowMinutes >= startMin || nowMinutes < endMin; // midnight cross
}

const aiTimeGate = (req, res, next) => {
    try {
        if (String(process.env.AI_TIME_GATE_ENABLED || 'true').toLowerCase() === 'false') {
            return next();
        }
        if (!req.user) {
            return res.status(401).json({ success: false, message: 'Not authorized.' });
        }
        if (PRIVILEGED_ROLES.has(req.user.companyRole)) return next();

        const startMin = parseHm(process.env.AI_TIME_GATE_START, 17 * 60);
        const endMin = parseHm(process.env.AI_TIME_GATE_END, 19 * 60);
        const nowMin = req._deps?.nowIstMinutes ?? getIstMinutes();

        if (isWithinWindow(nowMin, startMin, endMin)) return next();

        return res.status(403).json({
            success: false,
            code: 'AI_TIME_GATED',
            message: 'AI Assistant employees ke liye sirf shaam 5:00 PM se 7:00 PM (IST) ke beech available hai.',
        });
    } catch (error) {
        console.error('[ai-time-gate] error:', error?.message || error);
        return res.status(500).json({ success: false, message: 'Time gate check failed.' });
    }
};

module.exports = aiTimeGate;
module.exports.getIstMinutes = getIstMinutes;
module.exports.isWithinWindow = isWithinWindow;