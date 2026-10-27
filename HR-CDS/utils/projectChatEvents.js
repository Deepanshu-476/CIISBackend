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

const plain = text => String(text || '').replace(/@\[([^\]]+)\]\([a-f\d]{24}\)/gi, '@$1').replace(/\s+/g, ' ').trim();
const clip = (text, max = 140) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const dueOf = task => {
  const time = new Date(task?.dueDateTime || task?.dueDate || NaN).getTime();
  return Number.isNaN(time) ? null : new Date(time).toISOString();
};
const assigneesOf = task => ids([task?.assignedTo, ...(task?.assignedUsers || [])]);
const fileName = file => file?.originalName || file?.filename || String(file?.path || '').split(/[\\/]/).pop() || 'a file';
const filesOf = task => [...(task?.files || []), ...(task?.pdfFile?.path ? [{ _id: task.pdfFile.path, ...task.pdfFile }] : [])];

// Field-level changes on an existing task; each becomes its own chat card.
function changeEvents(old, task, add) {
  if (String(old.title || '').trim() !== String(task.title || '').trim()) add('task_renamed', { from: old.title, title: task.title });
  if (plain(old.description) !== plain(task.description)) add('task_description_updated');
  if (String(old.priority || '').toLowerCase() !== String(task.priority || '').toLowerCase()) {
    add('task_priority_changed', { from: label(old.priority), to: label(task.priority) });
  }
  if (dueOf(old) !== dueOf(task)) add('task_due_changed', { from: dueOf(old), to: dueOf(task) });
  const oldAssigned = assigneesOf(old), assigned = assigneesOf(task);
  const nameChanged = !assigned.length && String(old.assigneeName || '') !== String(task.assigneeName || '');
  if (oldAssigned.sort().join() !== [...assigned].sort().join() || nameChanged) {
    add('task_assignee_changed', { assigned, assigneeName: task.assigneeName || '' });
  }
  const oldCheckpoints = new Map((old.checkpoints || []).map(item => [id(item), item]));
  for (const checkpoint of task.checkpoints || []) {
    const previous = oldCheckpoints.get(id(checkpoint));
    if (!previous) add('task_checkpoint_added', { checkpoint: checkpoint.title }, id(checkpoint));
    else if (Boolean(previous.completed) !== Boolean(checkpoint.completed)) {
      add(checkpoint.completed ? 'task_checkpoint_completed' : 'task_checkpoint_reopened', {
        checkpoint: checkpoint.title, ...(checkpoint.completedBy ? { actor: id(checkpoint.completedBy) } : {}),
      }, id(checkpoint));
    }
  }
  const oldFiles = new Set(filesOf(old).map(id));
  const files = filesOf(task);
  for (const file of files) if (!oldFiles.has(id(file))) add('task_file_added', { file: fileName(file) }, id(file));
  const fileIds = new Set(files.map(id));
  for (const file of filesOf(old)) if (!fileIds.has(id(file))) add('task_file_removed', { file: fileName(file) }, id(file));
  const oldRemarks = new Set((old.remarks || []).map(id));
  for (const remark of task.remarks || []) {
    if (oldRemarks.has(id(remark))) continue;
    const author = id(remark.createdBy || remark.user);
    add('task_remark_added', {
      remark: clip(plain(remark.text)), images: (remark.images || []).length + (remark.image ? 1 : 0),
      ...(author ? { actor: author } : {}),
    }, id(remark));
  }
}

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
    const revision = old ? `${before.__v ?? before.updatedAt ?? ''}:${id(task.activityLogs?.at(-1))}` : '';
    if (old && status(old.status) !== status(task.status)) {
      add('task_status_changed', `${revision}:${status(old.status)}:${status(task.status)}`, { from: label(old.status), to: label(task.status) });
    }
    if (old) changeEvents(old, task, (type, extra = {}, part = '') => add(type, `${revision}:${part}`, extra));
    const sources = [{ key: 'description', source: task }, ...(task.remarks || []).map(remark => ({ key: id(remark), source: remark })), ...(task.activityLogs || []).filter(log => log.remark).map(log => ({ key: `activity:${id(log)}`, source: { text: log.remark } }))];
    for (const { key, source } of sources) {
      const previous = key === 'description' ? old : key.startsWith('activity:') ? { text: old?.activityLogs?.find(log => `activity:${id(log)}` === key)?.remark } : old?.remarks?.find(remark => id(remark) === key);
      for (const user of sourceMentions(source)) {
        if (!sourceMentions(previous).includes(user)) add('task_mentioned', `${key}:${user}`, { mentioned: user, source: key });
      }
    }
  }
  const remaining = new Set((after.tasks || []).map(id));
  for (const [taskId, task] of oldTasks) {
    if (remaining.has(taskId)) continue;
    const actorId = id(actor || after.createdBy);
    if (actorId) events.push({ key: hash(`${id(after)}:${taskId}:task_deleted`), type: 'task_deleted', actor: actorId, task: taskId, title: task.title });
  }
  return events;
}

module.exports = { context, id, ids, status, label, diffEvents, sourceMentions };
