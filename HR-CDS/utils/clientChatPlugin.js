const { context, diffEvents, id } = require('./projectChatEvents');
const SYSTEM = '000000000000000000000001';
const clone = value => JSON.parse(JSON.stringify(value));

function taskEvents(before, after) {
  const adapt = task => task && ({ ...task, title: task.name, assignedTo: task.assigneeId,
    status: task.completed ? 'completed' : task.status,
    activityLogs: (task.activityLogs || []).map(log => ({ ...log, performedBy: log.user })),
  });
  const old = adapt(before), next = adapt(after);
  const actor = context.getStore()?.actor || after.activityLogs?.at(-1)?.user || after.lastEditedBy || SYSTEM;
  return diffEvents(before ? { _id: after.clientId, __v: before.__v ?? String(before.updatedAt || ''), tasks: [old] } : null,
    { _id: after.clientId, tasks: [next] }, actor);
}

function simulate(doc, update) {
  const after = clone(doc);
  for (const [path, value] of Object.entries(update.$set || {})) set(after, path, value);
  for (const [path, value] of Object.entries(update)) if (!path.startsWith('$')) set(after, path, value);
  for (const [path, value] of Object.entries(update.$push || {})) after[path] = [...(after[path] || []), ...(value.$each || [value])];
  return after;
}
function set(object, path, value) { const parts = path.split('.'); const key = parts.pop(); for (const part of parts) object = object[part] ||= {}; object[key] = value; }

async function safeDeliver(model, doc, session) {
  if (session?.inTransaction()) return;
  try {
    const service = require('./clientChatService');
    if (model === 'ClientTask') await service.drainTask(doc._id); else await service.syncClient(doc._id);
  } catch (error) { console.error('[client-chat] pending', id(doc), error.message); }
}

module.exports = function clientChatPlugin(schema, { task = false } = {}) {
  schema.add({ chatSyncPending: { type: Boolean, default: true, select: false } });
  if (task) schema.add({ chatOutbox: { type: [Object], default: [], select: false } });
  schema.set('optimisticConcurrency', true);
  schema.pre('save', async function() {
    this.chatSyncPending = true;
    if (!task) return;
    const before = this.isNew ? null : await this.constructor.findById(this._id).select('+chatOutbox').session(this.$session()).lean();
    // Reminder/activity paths may save a projection: unselected fields did not change.
    const after = before ? { ...before, ...this.toObject() } : this.toObject();
    for (const path of this.directModifiedPaths()) {
      if (before && !path.includes('.')) after[path] = this.get(path);
    }
    if (before && !this.isSelected('__v')) this.set('__v', before.__v || 0);
    const events = taskEvents(before, after);
    if (events.length) this.chatOutbox = [...(before?.chatOutbox || []), ...events];
  });
  schema.post('save', async function(doc) { await safeDeliver(task ? 'ClientTask' : 'Client', doc, doc.$session()); });

  for (const operation of ['updateOne', 'findOneAndUpdate', 'updateMany']) {
    schema.pre(operation, async function() {
      const update = this.getUpdate();
      if (Array.isArray(update)) throw new Error('Client chat mutations require object updates');
      const docs = await this.model.find(this.getFilter()).session(this.getOptions().session || null).lean();
      this._chatDocs = operation === 'updateMany' ? docs : docs.slice(0, 1);
      if (!task) { update.$set = { ...update.$set, chatSyncPending: true }; update.$inc = { ...update.$inc, __v: 1 }; return; }
      if (operation === 'updateMany') {
        // Do not mutate a row that changed after the event snapshot was read.
        this.setQuery({ $and: [this.getFilter(), { $or: docs.length ? docs.map(doc => ({ _id: doc._id, ...(doc.__v === undefined ? { __v: { $exists: false } } : { __v: doc.__v }) })) : [{ _id: null }] }] });
        // Execute a single atomic per-document pipeline, retaining existing arrays.
        const cases = docs.map(doc => ({ case: { $eq: ['$_id', doc._id] }, then: { $literal: taskEvents(doc, simulate(doc, update)) } }));
        const fields = { ...update.$set };
        for (const [key, value] of Object.entries(update)) if (!key.startsWith('$')) fields[key] = value;
        const stage = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, { $literal: value }]));
        for (const [key, value] of Object.entries(update.$push || {})) stage[key] = { $concatArrays: [{ $ifNull: [`$${key}`, []] }, { $literal: value.$each || [value] }] };
        stage.chatOutbox = { $concatArrays: [{ $ifNull: ['$chatOutbox', []] }, { $switch: { branches: cases.length ? cases : [{ case: true, then: [] }], default: [] } }] };
        stage.chatSyncPending = true; stage.__v = { $add: [{ $ifNull: ['$__v', 0] }, 1] };
        this.setUpdate([{ $set: stage }]);
      } else if (docs[0]) {
        const before = docs[0], events = taskEvents(before, simulate(before, update));
        // Version compare prevents duplicate concurrent transitions from a stale read.
        this.setQuery({ $and: [this.getFilter(), before.__v === undefined ? { __v: { $exists: false } } : { __v: before.__v }] });
        update.$set = { ...update.$set, chatSyncPending: true };
        update.$inc = { ...update.$inc, __v: 1 };
        if (events.length) { update.$push ||= {}; update.$push.chatOutbox = { $each: events }; }
      }
    });
    schema.post(operation, async function() {
      for (const doc of this._chatDocs || []) await safeDeliver(task ? 'ClientTask' : 'Client', doc, this.getOptions().session);
    });
  }
  schema.pre('bulkWrite', async function(next, operations, options) {
    try {
      const rewritten = [];
      for (const operation of operations) {
        const entry = operation.updateMany || operation.updateOne;
        if (task && entry) {
          const docs = await this.find(entry.filter).session(options?.session || null).lean();
          for (const doc of (operation.updateOne ? docs.slice(0, 1) : docs)) {
            const update = clone(entry.update), events = taskEvents(doc, simulate(doc, entry.update));
            update.$set = { ...update.$set, chatSyncPending: true }; update.$inc = { ...update.$inc, __v: 1 };
            if (events.length) { update.$push ||= {}; update.$push.chatOutbox = { $each: events }; }
            rewritten.push({ updateOne: { ...entry, filter: { $and: [entry.filter, { _id: doc._id }, doc.__v === undefined ? { __v: { $exists: false } } : { __v: doc.__v }] }, update } });
          }
        } else rewritten.push(operation);
      }
      operations.splice(0, operations.length, ...rewritten); next();
    } catch (error) { next(error); }
  });
  for (const operation of ['findOneAndDelete', 'deleteOne', 'deleteMany']) {
    schema.pre(operation, { query: true, document: false }, async function() { this._chatDocs = await this.model.find(this.getFilter()).select('_id clientId').lean(); });
    schema.post(operation, { query: true, document: false }, async function() {
      if (this.getOptions().session?.inTransaction()) return;
      for (const doc of this._chatDocs || []) {
        try { await require('./clientChatService').syncClient(task ? doc.clientId : doc._id); }
        catch (error) { console.error('[client-chat] delete sync pending', error.message); }
      }
    });
  }
};
module.exports.taskEvents = taskEvents;
