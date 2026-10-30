const ClientTask = require('../../models/ClientTask');
const Client = require('../../models/Client');
const { syncClient } = require('../../utils/clientChatService');
const { context, ids } = require('../../utils/projectChatEvents');
const { createHash } = require('node:crypto');

async function authorized(req) {
  const client = await Client.findById(req.params.clientId).lean();
  if (!client) return null;
  const conversation = await syncClient(client._id);
  if (!conversation || String(conversation.companyId) !== String(req.user.company?._id || req.user.company) ||
    !conversation.members.some(member => String(member) === String(req.user.id || req.user._id))) return null;
  return client;
}

exports.getTask = async (req, res, next) => {
  try {
    const client = await authorized(req);
    if (!client) return res.status(403).json({ success: false, message: 'Client group access denied' });
    const task = await ClientTask.findOne({ _id: req.params.taskId, clientId: client._id }).populate('assigneeId remarks.user', 'name email');
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });
    res.json({ success: true, task: { ...task.toObject(), title: task.name, clientId: client._id, clientName: client.client, source: 'client' } });
  } catch (error) { next(error); }
};

exports.addRemark = async (req, res, next) => {
  try {
    const client = await authorized(req);
    if (!client) return res.status(403).json({ success: false, message: 'Client group access denied' });
    const task = await ClientTask.findOne({ _id: req.params.taskId, clientId: client._id });
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });
    const text = String(req.body.text || '').trim();
    if (!text) return res.status(400).json({ success: false, message: 'Comment is required' });
    const key = req.headers['idempotency-key'];
    const mongoose = require('mongoose');
    const remarkId = key ? new mongoose.Types.ObjectId(createHash('sha256').update(`${req.user.id || req.user._id}:${task._id}:${key}`).digest('hex').slice(0, 24)) : new mongoose.Types.ObjectId();
    if (task.remarks.id(remarkId)) return res.json({ success: true, remark: task.remarks.id(remarkId) });
    task.remarks.push({ _id: remarkId, text, mentions: ids(req.body.mentions || []), user: req.user.id || req.user._id, userName: req.user.name });
    await context.run({ actor: req.user.id || req.user._id }, () => task.save());
    res.status(201).json({ success: true, remark: task.remarks.id(remarkId) });
  } catch (error) { next(error); }
};
