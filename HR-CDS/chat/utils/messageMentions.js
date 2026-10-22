const invalid = () => Object.assign(new Error('Mentions must refer to current conversation members and match the message text'), { status: 400 });

async function validateMessageMentions(raw, text, conversation, User) {
    let requested = raw || [];
    if (typeof requested === 'string') {
        try { requested = JSON.parse(requested); } catch { throw invalid(); }
    }
    if (!Array.isArray(requested) || requested.length > 100) throw invalid();
    if (!requested.length) return [];
    if (typeof text !== 'string') throw invalid();
    const members = new Set(conversation.members.map(member => String(member._id || member)));
    for (const mention of requested) {
        if (!mention || !/^[a-f\d]{24}$/i.test(mention.user) || !members.has(mention.user)
            || !Number.isInteger(mention.start) || !Number.isInteger(mention.end)
            || mention.start < 0 || mention.end <= mention.start || mention.end > text.length) throw invalid();
    }
    const users = await User.find({ _id: { $in: requested.map(mention => mention.user) }, company: conversation.companyId, isActive: { $ne: false } }).select('_id name');
    const names = new Map(users.map(user => [String(user._id), String(user.name || '').trim()]));
    const result = [];
    for (const mention of requested.sort((a, b) => a.start - b.start)) {
        const label = names.get(mention.user);
        if (!label || text.slice(mention.start, mention.end) !== `@${label}`) throw invalid();
        const previous = result.at(-1);
        if (previous && mention.start === previous.start && mention.end === previous.end && mention.user === previous.user) continue;
        if (previous && mention.start < previous.end) throw invalid();
        result.push({ user: mention.user, label, start: mention.start, end: mention.end });
    }
    return result;
}

module.exports = { validateMessageMentions };
