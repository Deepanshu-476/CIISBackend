const { createHash } = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const context = new AsyncLocalStorage();
const id = value => String(value?._id || value || '');
const hash = value => createHash('sha256').update(value).digest('hex');
const status = value => String(value || 'pending').replace(/[-_]/g, ' ').replace(/^onhold$/, 'on hold').trim().toLowerCase();
const label = value => status(value).replace(/\b\w/g, letter => letter.toUpperCase());
const ids = values => [...new Set((values || []).map(id).filter(value => /^[a-f\d]{24}$/i.test(value)))];
const mentions = source => ids(source?.mentions || []);

// IDs, rather than display names, are the persistent mention identity. Text clients
// may also send @[Display name](userId); bare @names are intentionally ambiguous.
const textMentions = text => ids([...String(text || '').matchAll(/@\[[^\]]+\]\(([a-f\d]{24})\)/gi)].map(match => match[1]));
const sourceMentions = source => ids([...mentions(source), ...textMentions(source?.text || source?.description)]);

function diffEvents(before, after, actor) {
  const events = [];
  const oldTasks = new Map((before?.tasks || []).map(task => [id(task), task]));
  for (const task of after.tasks || []) {
    const old = oldTasks.get(id(task));
    const actorId = id(actor || task.activityLogs?.at(-1)?.performedBy || task.createdBy || after.createdBy);
    if (!actorId) continue;
    const add = (type, suffix, extra = {}) => events.push({
      key: hash(`${id(after)}:${id(task)}:${type}:${suffix}`), type,
      actor: actorId, task: id(task), title: task.title, ...extra,
    });
    if (!old) add('task_created', '', { assigned: ids([task.assignedTo, ...(task.assignedUsers || [])]) });
    if (old && status(old.status) !== status(task.status)) {
      const revision = `${before.__v ?? before.updatedAt ?? ''}:${id(task.activityLogs?.at(-1))}`;
      add('task_status_changed', `${revision}:${status(old.status)}:${status(task.status)}`, { from: label(old.status), to: label(task.status) });
    }
    const sources = [{ key: 'description', source: task }, ...(task.remarks || []).map(remark => ({ key: id(remark), source: remark })), ...(task.activityLogs || []).filter(log => log.remark).map(log => ({ key: `activity:${id(log)}`, source: { text: log.remark } }))];
    for (const { key, source } of sources) {
      const previous = key === 'description' ? old : key.startsWith('activity:') ? { text: old?.activityLogs?.find(log => `activity:${id(log)}` === key)?.remark } : old?.remarks?.find(remark => id(remark) === key);
      for (const user of sourceMentions(source)) {
        if (!sourceMentions(previous).includes(user)) add('task_mentioned', `${key}:${user}`, { mentioned: user, source: key });
      }
    }
  }
  return events;
}

module.exports = { context, id, ids, status, label, diffEvents, sourceMentions };
