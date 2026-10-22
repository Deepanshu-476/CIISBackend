const Conversation = require('../models/Conversation');
const { Project } = require('../../models/Project');
const { refreshConversation } = require('../../utils/projectChatService');

exports.getTask = async (req, res, next) => {
  try {
    const existing = await Conversation.findOne({ projectId: req.params.projectId, companyId: req.user.company });
    const conversation = existing && await refreshConversation(existing._id, req.user.company);
    if (!conversation || !conversation.members.some(member => String(member) === String(req.user.id || req.user._id))) {
      return res.status(403).json({ success: false, message: 'Project group access denied' });
    }
    const project = await Project.findById(req.params.projectId)
      .populate('tasks.assignedTo tasks.assignedUsers tasks.createdBy tasks.remarks.createdBy', 'name email');
    const task = project?.tasks.id(req.params.taskId);
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });
    res.json({ success: true, task: { ...task.toObject(), projectId: project._id, projectName: project.projectName } });
  } catch (error) { next(error); }
};
