
const {
  Task,
  parsePositiveInt,
  getCleanTaskDateRange,
  normalizeTaskStatus,
  isOnHoldStatus,
  canChangeFromOnHold,
  parseTaskCheckpoints,
  isTaskOverdueForStatus,
  calculateUnifiedTaskStats,
  groupTasksByDate,
  sortTasksNewestFirst,
  paginateTasks,
  getRequestCompanyCode,
  createNotification,
  createActivityLog,
  enrichStatusInfo,
  applyCleanListFilters,
  sendCleanTaskList,
  User,
  fs,
  path,
  sharp
} = require('./taskHelper');
const { enqueueCompletionJob } = require('../utils/backgroundJobQueue');


const fetchPersonalTaskList = async (req) => {
  const companyCode = req.user.companyCode;
  const baseCode = typeof companyCode === 'string' ? companyCode.split('-')[0].trim() : '';
  const companyFilter = baseCode ? { $regex: new RegExp('^' + baseCode + '(-|$)', 'i') } : companyCode;

  const tasks = await Task.find({
    companyCode: companyFilter,
    createdBy: req.user._id,
    taskFor: 'self',
    isActive: true
  }).populate('assignedUsers', 'name email').populate('createdBy', 'name email').sort({ createdAt: -1 }).lean();

  const enriched = await enrichStatusInfo(tasks);
  return enriched.map(t => ({ ...t, status: normalizeTaskStatus(t.overallStatus), taskSource: 'self', __taskSource: 'self' }));
};

const normalizeCodeBase = (code) => {
  if (!code) return '';
  return String(code).split('-')[0].trim().toUpperCase();
};

const isPrivilegedCompanyUser = (user) => {
  const roles = [user?.role, user?.companyRole, user?.jobRole]
    .map(role => String(role || '').toLowerCase().replace(/[\s_]/g, '-'));
  return roles.some(role => ['admin', 'super-admin', 'superadmin', 'owner', 'company-admin', 'hr', 'manager'].includes(role));
};

const isCompanyAllTaskEdit = (req) => (
  req.body?.allowCompanyAllTaskEdit === true ||
  req.body?.allowCompanyAllTaskEdit === 'true' ||
  req.headers?.['x-company-all-task-edit'] === 'true'
);

const isSameCompanyTaskRequest = (req, task) => {
  const requesterCompany = normalizeCodeBase(getRequestCompanyCode(req));
  const taskCompany = normalizeCodeBase(task?.companyCode);
  return Boolean(requesterCompany && taskCompany && requesterCompany === taskCompany);
};

const canManagePersonalTask = async (req, task) => {
  if (task.taskFor !== 'self') return false;
  const currentUserId = (req.user._id || req.user.id).toString();
  if (task.createdBy.toString() === currentUserId) return true;
  if (isCompanyAllTaskEdit(req) && isSameCompanyTaskRequest(req, task)) return true;
  if (!isPrivilegedCompanyUser(req.user)) return false;

  const requesterCompany = normalizeCodeBase(getRequestCompanyCode(req));
  if (isSameCompanyTaskRequest(req, task)) return true;

  const owner = await User.findById(task.createdBy).select('companyCode company').lean();
  return Boolean(
    requesterCompany &&
    normalizeCodeBase(owner?.companyCode) &&
    requesterCompany === normalizeCodeBase(owner.companyCode)
  );
};


exports.createTaskForSelf = async (req, res) => {
  try {
    const { title, description, dueDateTime, whatsappNumber, priorityDays, priority, checkpoints } = req.body;
    const companyCode = getRequestCompanyCode(req);
    
    if (!companyCode) {
      return res.status(400).json({ success: false, error: 'Company code is missing. Please login again.' });
    }

    const parsedUsers = [req.user._id.toString()];
    const files = (req.files?.files || []).map(f => ({ filename: f.filename, originalName: f.originalname, path: f.path, uploadedBy: req.user._id }));
    const voiceNote = req.files?.voiceNote?.[0] ? { filename: req.files.voiceNote[0].filename, originalName: req.files.voiceNote[0].originalname, path: req.files.voiceNote[0].path, uploadedBy: req.user._id } : null;

    let parsedDue = null;
    if (dueDateTime) {
      parsedDue = new Date(dueDateTime);
      if (isNaN(parsedDue.getTime())) return res.status(400).json({ success: false, error: 'Invalid due date format' });
    }

    const statusByUser = parsedUsers.map(uid => ({ user: uid, status: 'pending' }));
    const parsedCheckpoints = parseTaskCheckpoints(checkpoints);

    const task = await Task.create({
      title,
      description,
      dueDateTime: parsedDue,
      whatsappNumber,
      priorityDays,
      priority: priority || 'medium',
      companyCode,
      assignedUsers: parsedUsers,
      assignedGroups: [],
      statusByUser,
      checkpoints: parsedCheckpoints,
      files,
      voiceNote,
      createdBy: req.user._id,
      taskFor: 'self',
      statusHistory: [{ status: 'pending', changedBy: req.user._id, remarks: 'Self task created' }]
    });

    await task.populate('assignedUsers', 'name role email');
    await task.populate('createdBy', 'name email');

    await createActivityLog(req.user, 'self_task_created', task._id, `Created self task: ${title}`, null, task.toObject(), req);

    return res.status(201).json({ success: true, task, message: 'Self task created successfully' });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};


exports.getPersonalTasks = async (req, res) => {
  try {
    const list = await fetchPersonalTaskList(req);
    return sendCleanTaskList(res, applyCleanListFilters(list, req), 'personal', 'createdAt');
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};


exports.getPersonalTaskStats = async (req, res) => {
  try {
    const list = applyCleanListFilters(await fetchPersonalTaskList(req), req);
    return res.json({ success: true, view: 'personal', stats: calculateUnifiedTaskStats(list) });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};


exports.updateTask = async (req, res) => {
  try {
    const { taskId } = req.params;
    const task = await Task.findById(taskId);
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
    if (!(await canManagePersonalTask(req, task))) return res.status(403).json({ success: false, error: 'Not authorized' });

    const oldTask = task.toObject();

    if (req.files?.files) {
      task.files.push(...req.files.files.map(f => ({ filename: f.filename, originalName: f.originalname, path: f.path, uploadedBy: req.user._id })));
    }
    if (req.files?.voiceNote?.[0]) {
      task.voiceNote = { filename: req.files.voiceNote[0].filename, originalName: req.files.voiceNote[0].originalname, path: req.files.voiceNote[0].path, uploadedBy: req.user._id };
    }

    const fields = ['title', 'description', 'dueDateTime', 'whatsappNumber', 'priorityDays', 'priority'];
    fields.forEach(f => {
      if (req.body[f] !== undefined && req.body[f] !== 'null') task[f] = req.body[f];
    });
    if (req.body.checkpoints !== undefined) {
      task.checkpoints = parseTaskCheckpoints(req.body.checkpoints);
    }

    await task.save();
    await createActivityLog(req.user, 'task_updated', task._id, `Updated task details`, oldTask, task.toObject(), req);

    res.json({ success: true, message: 'Task updated successfully', task });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};


exports.deleteTask = async (req, res) => {
  try {
    const { taskId } = req.params;
    const task = await Task.findById(taskId);
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
    if (task.createdBy.toString() !== req.user._id.toString()) return res.status(403).json({ success: false, error: 'Not authorized' });

    task.isActive = false;
    await task.save();

    await createActivityLog(req.user, 'task_deleted', taskId, `Deleted task: ${task.title}`, task.toObject(), null, req);
    res.json({ success: true, message: 'Task deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};


exports.updateStatus = async (req, res) => {
  try {
    const { taskId } = req.params;
    const { status, remarks } = req.body;

    const task = await Task.findById(taskId);
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
    if (!(await canManagePersonalTask(req, task))) return res.status(403).json({ success: false, error: 'Not authorized' });

    const oldStatus = task.overallStatus || 'pending';
    const normalizedStatus = normalizeTaskStatus(status);
    const ownerUserId = task.createdBy;
    const allowCompanyAllEdit = isCompanyAllTaskEdit(req);

    if (isOnHoldStatus(oldStatus) && !canChangeFromOnHold(normalizedStatus) && !allowCompanyAllEdit) {
      return res.status(400).json({
        success: false,
        error: 'On hold tasks can only be changed to in-progress or completed'
      });
    }

    if (
      normalizedStatus !== 'overdue' &&
      normalizeTaskStatus(oldStatus) === 'overdue' &&
      !allowCompanyAllEdit
    ) {
      return res.status(400).json({ success: false, error: 'Cannot change status of an overdue task' });
    }

    if (
      !['overdue', 'onhold'].includes(normalizedStatus) &&
      isTaskOverdueForStatus(task.dueDateTime || task.dueDate, oldStatus, task) &&
      !allowCompanyAllEdit
    ) {
      if (!['onhold', 'completed', 'approved', 'rejected', 'cancelled', 'overdue'].includes(normalizeTaskStatus(oldStatus))) {
        task.markUserStatusOverdue(ownerUserId, 'Automatically marked overdue after due time passed');
        task.overallStatus = 'overdue';
        await task.save();
      }
      return res.status(400).json({ success: false, error: 'Cannot change status of an overdue task' });
    }

    const idx = task.statusByUser.findIndex(s => s.user?.toString() === ownerUserId.toString());
    if (idx === -1) {
      task.statusByUser.push({ user: ownerUserId, status: status, updatedAt: new Date(), remarks });
    } else {
      task.statusByUser[idx].status = status;
      task.statusByUser[idx].updatedAt = new Date();
      if (remarks) task.statusByUser[idx].remarks = remarks;
    }

    task.overallStatus = status;
    if (isOnHoldStatus(oldStatus) && normalizedStatus === 'in-progress') {
      task.onHoldReleasedAt = new Date();
    } else if (normalizedStatus === 'onhold') {
      task.onHoldReleasedAt = null;
    }
    if (status === 'completed') {
      task.completionDate = new Date();
    } else {
      task.completionDate = null;
    }

    task.statusHistory.push({ status, changedBy: req.user._id, remarks: remarks || `Status changed from ${oldStatus} to ${status}` });

    await task.save();
    res.json({ success: true, message: 'Status updated successfully', data: { taskId, newStatus: status, overallStatus: task.overallStatus } });

    const runStatusPostProcessing = async () => {
      await createActivityLog(req.user, 'status_updated', task._id, `Updated task status to ${status}`, { status: oldStatus }, { status, remarks }, req);
    };

    if (status === 'completed') {
      enqueueCompletionJob(async () => {
        try {
          await runStatusPostProcessing();
        } catch (asyncErr) {
          console.error('❌ Background self task post-processing failed:', asyncErr);
        }
      });
    } else {
      void (async () => {
        try {
          await runStatusPostProcessing();
        } catch (asyncErr) {
          console.error('❌ Background self task post-processing failed:', asyncErr);
        }
      })();
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.updateCheckpoint = async (req, res) => {
  try {
    const { taskId, checkpointId } = req.params;
    const { completed } = req.body;

    const task = await Task.findById(taskId);
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
    if (!(await canManagePersonalTask(req, task))) return res.status(403).json({ success: false, error: 'Not authorized' });

    const checkpoint = task.checkpoints.id(checkpointId);
    if (!checkpoint) return res.status(404).json({ success: false, error: 'Checkpoint not found' });

    const isCompleted = completed !== false;
    const oldStatus = task.overallStatus || 'pending';
    checkpoint.completed = isCompleted;
    checkpoint.completedAt = isCompleted ? new Date() : null;
    checkpoint.completedBy = isCompleted ? req.user._id : null;

    const hasCheckpoints = task.checkpoints.length > 0;
    const allCompleted = hasCheckpoints && task.checkpoints.every(item => item.completed);
    const ownerUserId = task.createdBy;
    const idx = task.statusByUser.findIndex(s => s.user?.toString() === ownerUserId.toString());

    if (allCompleted) {
      task.overallStatus = 'completed';
      task.completionDate = new Date();
      if (idx === -1) {
        task.statusByUser.push({ user: ownerUserId, status: 'completed', updatedAt: new Date(), remarks: 'All checkpoints completed' });
      } else {
        task.statusByUser[idx].status = 'completed';
        task.statusByUser[idx].updatedAt = new Date();
        task.statusByUser[idx].remarks = 'All checkpoints completed';
      }
      if (oldStatus !== 'completed') {
        task.statusHistory.push({ status: 'completed', changedBy: req.user._id, remarks: 'All checkpoints completed' });
      }
    } else if (oldStatus === 'completed') {
      task.overallStatus = 'in-progress';
      task.completionDate = null;
      if (idx !== -1) {
        task.statusByUser[idx].status = 'in-progress';
        task.statusByUser[idx].updatedAt = new Date();
        task.statusByUser[idx].remarks = 'Checkpoint reopened';
      }
      task.statusHistory.push({ status: 'in-progress', changedBy: req.user._id, remarks: 'Checkpoint reopened' });
    }

    await task.save();
    await createActivityLog(req.user, 'checkpoint_updated', task._id, `${isCompleted ? 'Completed' : 'Reopened'} checkpoint: ${checkpoint.title}`, null, { checkpointId, completed: isCompleted }, req);

    res.json({ success: true, message: 'Checkpoint updated successfully', task });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};


exports.addRemark = async (req, res) => {
  try {
    const { taskId } = req.params;
    const { text } = req.body;

    const task = await Task.findById(taskId);
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });

    let imgPath = null;
    if (req.file) {
      const uploadDir = path.join(__dirname, '../../uploads/remarks');
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
      const filename = `remark_${Date.now()}_${req.user._id}.jpg`;
      const savePath = path.join(uploadDir, filename);
      imgPath = `remarks/${filename}`;

      await sharp(req.file.buffer).resize(1200, 1200, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toFile(savePath);
    }

    const remark = { user: req.user._id, text: text || '', image: imgPath, createdAt: new Date() };
    task.remarks.push(remark);
    await task.save();

    const savedRemark = task.remarks[task.remarks.length - 1];
    const responseRemark = {
      ...(typeof savedRemark.toObject === 'function' ? savedRemark.toObject() : savedRemark),
      user: {
        _id: req.user._id,
        name: req.user.name,
        email: req.user.email,
        role: req.user.role,
        avatar: req.user.avatar || null
      },
      userName: req.user.name || ''
    };

    res.status(201).json({ success: true, message: 'Remark added successfully', remark: responseRemark });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getRemarks = async (req, res) => {
  try {
    const task = await Task.findById(req.params.taskId).populate('remarks.user', 'name role email avatar').select('remarks');
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
    res.json({ success: true, remarks: task.remarks.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
