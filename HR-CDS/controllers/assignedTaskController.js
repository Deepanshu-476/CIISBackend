
const {
  Task,
  Group,
  User,
  parsePositiveInt,
  getCleanTaskDateRange,
  normalizeTaskStatus,
  isTaskOverdueForStatus,
  calculateUnifiedTaskStats,
  groupTasksByDate,
  sortTasksNewestFirst,
  paginateTasks,
  getRequestCompanyCode,
  createNotification,
  createActivityLog,
  enrichStatusInfo,
  sendTaskCreationEmail,
  sendTaskStatusUpdateEmail,
  applyCleanListFilters,
  sendCleanTaskList,
  fs,
  path,
  sharp
} = require('./taskHelper');


const fetchAssignedToMeTaskList = async (req) => {
  const currentUserId = req.user._id || req.user.id;
  const groups = await Group.find({ members: currentUserId, isActive: true }).select('_id').lean();
  const groupIds = groups.map(g => g._id);

  const companyCode = req.user.companyCode;
  const baseCode = typeof companyCode === 'string' ? companyCode.split('-')[0].trim() : '';
  const companyFilter = baseCode ? { $regex: new RegExp('^' + baseCode + '(-|$)', 'i') } : companyCode;

  const tasks = await Task.find({
    companyCode: companyFilter,
    isActive: true,
    taskFor: 'others',
    createdBy: { $ne: currentUserId },
    $or: [
      { assignedUsers: currentUserId },
      { assignedGroups: { $in: groupIds } }
    ]
  }).populate('assignedUsers', 'name email').populate('createdBy', 'name email').sort({ createdAt: -1 }).lean();

  const enriched = await enrichStatusInfo(tasks);
  return enriched.map(t => {
    const userEntry = t.statusByUser?.find(s => (s.user?._id || s.user)?.toString() === currentUserId.toString());
    const status = userEntry?.status || t.overallStatus || 'pending';
    return { ...t, status: normalizeTaskStatus(status), taskSource: 'assigned', __taskSource: 'assigned' };
  });
};


exports.createTaskForOthers = async (req, res) => {
  try {
    const { title, description, dueDateTime, whatsappNumber, priorityDays, priority, assignedUsers, assignedGroups } = req.body;
    const companyCode = getRequestCompanyCode(req);
    
    if (!companyCode) {
      return res.status(400).json({ success: false, error: 'Company code is missing. Please login again.' });
    }

    let parsedUsers = [];
    if (assignedUsers && assignedUsers !== 'null') {
      parsedUsers = typeof assignedUsers === 'string' ? JSON.parse(assignedUsers) : assignedUsers;
    }

    const parsedGroups = assignedGroups && assignedGroups !== 'null' ? 
      (typeof assignedGroups === 'string' ? JSON.parse(assignedGroups) : assignedGroups) : [];

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
      assignedGroups: parsedGroups,
      statusByUser,
      files,
      voiceNote,
      createdBy: req.user._id,
      taskFor: 'others',
      statusHistory: [{ status: 'pending', changedBy: req.user._id, remarks: 'Task assigned to others' }]
    });

    await task.populate('assignedUsers', 'name role email');
    await task.populate('createdBy', 'name email');

    if (task.assignedUsers?.length > 0) {
      await sendTaskCreationEmail(task, task.assignedUsers);
      const targetUsers = task.assignedUsers.map(u => u._id.toString()).filter(id => id !== req.user._id.toString());
      await createNotification(
        task.createdBy._id, 
        'New Task Assigned',
        `${req.user.name} assigned you task "${title}"`,
        'task_assigned',
        task._id,
        { priority, dueDateTime: parsedDue, targetUsers }
      );
    }

    await createActivityLog(req.user, 'task_created_for_others', task._id, `Created task for others: ${title}`, null, task.toObject(), req);

    return res.status(201).json({ success: true, task, message: 'Task created successfully' });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};


exports.getAssignedToMeTasks = async (req, res) => {
  try {
    const list = await fetchAssignedToMeTaskList(req);
    return sendCleanTaskList(res, applyCleanListFilters(list, req), 'assigned', 'createdAt');
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};


exports.getAssignedToMeTaskStats = async (req, res) => {
  try {
    const list = applyCleanListFilters(await fetchAssignedToMeTaskList(req), req);
    return res.json({ success: true, view: 'assigned', stats: calculateUnifiedTaskStats(list) });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};


exports.getAssignedTasks = async (req, res) => {
  try {
    const currentUserId = req.user._id || req.user.id;
    const tasks = await Task.find({
      companyCode: req.user.companyCode,
      createdBy: currentUserId,
      taskFor: 'others',
      isActive: true
    }).populate('assignedUsers', 'name role email').populate('createdBy', 'name email').sort({ createdAt: -1 }).lean();

    const enriched = await enrichStatusInfo(tasks);
    const mapped = enriched.map(t => ({ ...t, status: normalizeTaskStatus(t.overallStatus) }));
    const filtered = sortTasksNewestFirst(applyCleanListFilters(mapped, req));

    return res.json({ success: true, groupedTasks: groupTasksByDate(filtered, 'createdAt', 'assignedSerialNo') });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};


exports.updateStatus = async (req, res) => {
  try {
    const { taskId } = req.params;
    const { status, remarks } = req.body;

    const task = await Task.findById(taskId);
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });

    const currentUserId = (req.user._id || req.user.id).toString();
    const userCompanyCode = getRequestCompanyCode(req);

    const isCreator = task.createdBy.toString() === currentUserId;
    const isAssigned = task.assignedUsers.some(uid => uid.toString() === currentUserId);

    
    const userGroups = await Group.find({ members: req.user._id, isActive: true }).select('_id').lean();
    const groupIds = userGroups.map(g => g._id.toString());
    const isGroupAssigned = task.assignedGroups?.some(gid => groupIds.includes(gid.toString()));

    const isSameCompany = task.companyCode && userCompanyCode && 
      task.companyCode.toUpperCase() === userCompanyCode.toUpperCase();

    if (!isCreator && !isAssigned && !isGroupAssigned && !isSameCompany) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }

    const oldStatusEntry = task.statusByUser.find(s => s.user?.toString() === currentUserId);
    const oldStatus = oldStatusEntry?.status || 'pending';

    const updateUserStatusInList = (targetUserId, newStatus, userRemarks) => {
      const idx = task.statusByUser.findIndex(s => s.user?.toString() === targetUserId.toString());
      if (idx === -1) {
        task.statusByUser.push({ user: targetUserId, status: newStatus, updatedAt: new Date(), remarks: userRemarks });
      } else {
        task.statusByUser[idx].status = newStatus;
        task.statusByUser[idx].updatedAt = new Date();
        if (userRemarks) task.statusByUser[idx].remarks = userRemarks;
      }
    };

    const isUpdaterAssignee = isAssigned || isGroupAssigned;
    if (isUpdaterAssignee) {
      updateUserStatusInList(currentUserId, status, remarks);

      if (status === 'completed') {
        let allCompleted = true;
        if (task.assignedUsers && task.assignedUsers.length > 0) {
          for (const uid of task.assignedUsers) {
            const entry = task.statusByUser.find(s => s.user?.toString() === uid.toString());
            if (!entry || !['completed', 'approved', 'cancelled'].includes(entry.status)) {
              allCompleted = false;
              break;
            }
          }
        }
        if (allCompleted) {
          task.overallStatus = 'completed';
          task.completionDate = new Date();
        } else if (['pending', 'overdue'].includes(task.overallStatus)) {
          task.overallStatus = 'in-progress';
        }
      } else if (status === 'in-progress') {
        if (['pending', 'overdue'].includes(task.overallStatus)) {
          task.overallStatus = 'in-progress';
        }
      } else {
        if (isCreator) {
          task.overallStatus = status;
          if (status === 'completed') task.completionDate = new Date();
        }
      }
    } else {
      task.overallStatus = status;
      if (status === 'completed') {
        task.completionDate = new Date();
      } else {
        task.completionDate = null;
      }

      const targetStatus = status === 'reopen' ? 'pending' : status;
      if (task.assignedUsers && task.assignedUsers.length > 0) {
        task.assignedUsers.forEach(uid => {
          updateUserStatusInList(uid, targetStatus, remarks || 'Updated by administrator');
        });
      }
      task.statusByUser.forEach(s => {
        s.status = targetStatus;
        s.updatedAt = new Date();
        if (remarks) s.remarks = remarks;
      });
    }

    task.statusHistory.push({ status, changedBy: req.user._id, remarks: remarks || `Status changed from ${oldStatus} to ${status}` });

    await task.save();
    await task.populate('createdBy', 'name email');
    const updatedUser = await User.findById(req.user._id).select('name role email');

    if (!isCreator) {
      await createNotification(task.createdBy._id, 'Task Status Updated', `${updatedUser.name} updated task status to ${status}`, 'status_updated', task._id);
      await sendTaskStatusUpdateEmail(task, updatedUser, oldStatus, status);
    }

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
