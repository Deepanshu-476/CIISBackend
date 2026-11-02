const { context, diffEvents } = require('./projectChatEvents');

// Outbox entries are committed in the SAME document write as the task mutation.
// Delivery failure never rejects a successfully committed project/task write.
module.exports = function projectChatPlugin(schema) {
  schema.set("optimisticConcurrency", true);
  schema.add({ chatSyncPending: { type: Boolean, default: true, select: false }, chatOutbox: { type: [Object], default: [], select: false } });
  schema.pre('save', async function() {
    this.chatSyncPending = true;
    if (!this.isNew && !this.isModified('tasks')) return;
    const previous = this.isNew ? null : await this.constructor.findById(this._id).select('+chatOutbox').lean();
    const events = diffEvents(previous, this.toObject(), context.getStore()?.actor);
    if (events.length) this.chatOutbox = [...(previous?.chatOutbox || []), ...events];
  });
  // Project task creation and remarks use atomic $push rather than document.save().
  for (const operation of ['updateOne', 'findOneAndUpdate']) {
    schema.pre(operation, async function() {
      const update = this.getUpdate();
      update.$inc = { ...update.$inc, __v: 1 };
      update.$set = { ...update.$set, chatSyncPending: true };
      if (!update.$push?.tasks && !update.$push?.['tasks.$.remarks'] && !update.$set?.tasks) return;
      const previous = await this.model.findOne(this.getFilter()).lean();
      if (!previous) return;
      const after = JSON.parse(JSON.stringify(previous));
      if (update.$set?.tasks) after.tasks = update.$set.tasks;
      if (update.$push?.tasks) {
        const incoming = update.$push.tasks;
        after.tasks.push(...(incoming.$each || [incoming]));
      }
      if (update.$push?.['tasks.$.remarks']) {
        const task = after.tasks.find(item => String(item._id) === String((this.getFilter()['tasks._id'] || this.getFilter().tasks?.$elemMatch?._id)));
        if (!task) return;
        // Preserve the original BSON task identity in the simulated update.
        const original = previous.tasks.find(item => String(item._id) === String((this.getFilter()['tasks._id'] || this.getFilter().tasks?.$elemMatch?._id)));
        task._id = original._id;
        task.remarks ||= [];
        task.remarks.push(update.$push['tasks.$.remarks']);
      }
      const events = diffEvents(previous, after, context.getStore()?.actor);
      if (events.length) { update.$push ||= {}; update.$push.chatOutbox = { $each: events }; }
      this._chatProjectId = previous._id;
    });
    schema.post(operation, function(result) {
      if (!this._chatProjectId || (result?.matchedCount === 0)) return;
      deliver(this._chatProjectId);
    });
  }
  schema.post('save', function(doc) {
    if (doc?._id) deliver(doc._id);
  });
  schema.post('deleteOne', { document: true, query: false }, async function() {
    try {
      if (!this._id || !require('mongoose').isValidObjectId(this._id)) return;
      const service = require('./projectChatService');
      const Conversation = require('../chat/models/Conversation');
      const conversation = await Conversation.findOne({ projectId: this._id, clientId: { $exists: false } });
      if (conversation) {
        service.emitMembers(conversation, 'chat:project-membership-updated', { conversationId: conversation._id });
        await service.refreshConversation(conversation._id, conversation.companyId);
      }
    } catch (error) { console.error('[project-chat] deletion cleanup', error.message); }
  });
};

async function deliver(projectId) {
  try { await require('./projectChatService').syncAndDrain(projectId); }
  catch (error) { console.error('[project-chat] pending delivery', String(projectId), error.message); }
}
