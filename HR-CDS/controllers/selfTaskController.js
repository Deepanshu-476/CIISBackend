
const {
  Task,
  parsePositiveInt,
  getCleanTaskDateRange,
  normalizeTaskStatus,
  isOnHoldStatus,
  canChangeFromOnHold,
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
  fs,
  path,
  sharp
} = require('./taskHelper');


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


exports.createTaskForSelf = async (req, res) => {
  try {
    const { title, description, dueDateTime, whatsappNumber, priorityDays, priority } = req.body;
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
    if (task.createdBy.toString() !== req.user._id.toString()) return res.status(403).json({ success: false, error: 'Not authorized' });

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
    if (task.createdBy.toString() !== req.user._id.toString()) return res.status(403).json({ success: false, error: 'Not authorized' });

    const oldStatus = task.overallStatus || 'pending';
    const normalizedStatus = normalizeTaskStatus(status);

    if (isOnHoldStatus(oldStatus) && !canChangeFromOnHold(normalizedStatus)) {
      return res.status(400).json({
        success: false,
        error: 'On hold tasks can only be changed to in-progress or completed'
      });
    }

    if (
      normalizedStatus !== 'overdue' &&
      normalizeTaskStatus(oldStatus) === 'overdue'
    ) {
      return res.status(400).json({ success: false, error: 'Cannot change status of an overdue task' });
    }

    if (
      !['overdue', 'onhold'].includes(normalizedStatus) &&
      isTaskOverdueForStatus(task.dueDateTime || task.dueDate, oldStatus)
    ) {
      if (!['onhold', 'completed', 'approved', 'rejected', 'cancelled', 'overdue'].includes(normalizeTaskStatus(oldStatus))) {
        task.markUserStatusOverdue(req.user._id, 'Automatically marked overdue after due time passed');
        task.overallStatus = 'overdue';
        await task.save();
      }
      return res.status(400).json({ success: false, error: 'Cannot change status of an overdue task' });
    }

    const idx = task.statusByUser.findIndex(s => s.user?.toString() === req.user._id.toString());
    if (idx === -1) {
      task.statusByUser.push({ user: req.user._id, status: status, updatedAt: new Date(), remarks });
    } else {
      task.statusByUser[idx].status = status;
      task.statusByUser[idx].updatedAt = new Date();
      if (remarks) task.statusByUser[idx].remarks = remarks;
    }

    task.overallStatus = status;
    if (status === 'completed') {
      task.completionDate = new Date();
    } else {
      task.completionDate = null;
    }

    task.statusHistory.push({ status, changedBy: req.user._id, remarks: remarks || `Status changed from ${oldStatus} to ${status}` });

    await task.save();
    await createActivityLog(req.user, 'status_updated', task._id, `Updated task status to ${status}`, { status: oldStatus }, { status, remarks }, req);
    res.json({ success: true, message: 'Status updated successfully', data: { taskId, newStatus: status, overallStatus: task.overallStatus } });
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

    await task.populate('remarks.user', 'name role email avatar');
    res.json({ success: true, message: 'Remark added successfully', remark: task.remarks[task.remarks.length - 1] });
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
