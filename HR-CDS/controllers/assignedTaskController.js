
const {
  Task,
  Group,
  User,
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
  sendTaskCreationEmail,
  applyCleanListFilters,
  sendCleanTaskList,
  fs,
  path,
  sharp
} = require('./taskHelper');
const { enqueueCompletionJob } = require('../utils/backgroundJobQueue');


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
    const { title, description, dueDateTime, whatsappNumber, priorityDays, priority, assignedUsers, assignedGroups, checkpoints } = req.body;
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
      assignedGroups: parsedGroups,
      statusByUser,
      checkpoints: parsedCheckpoints,
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

exports.addCheckpoint = async (req, res) => {
  try {
    const { taskId } = req.params;
    const title = String(req.body.title || '').trim();

    if (!title) {
      return res.status(400).json({ success: false, error: 'Checkpoint title is required' });
    }

    const task = await Task.findById(taskId);
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });

    const currentUserId = (req.user._id || req.user.id).toString();
    const userGroups = await Group.find({ members: req.user._id, isActive: true }).select('_id').lean();
    const groupIds = userGroups.map(group => group._id.toString());
    const isCreator = task.createdBy.toString() === currentUserId;
    const isAssigned = task.assignedUsers.some(userId => userId.toString() === currentUserId);
    const isGroupAssigned = task.assignedGroups?.some(groupId => groupIds.includes(groupId.toString()));

    if (!isCreator && !isAssigned && !isGroupAssigned) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }

    const userStatusEntry = task.statusByUser?.find(item => item.user?.toString() === currentUserId);
    const effectiveStatus = String(userStatusEntry?.status || task.overallStatus || '')
      .toLowerCase()
      .replace(/[\s_]+/g, '-');

    if (effectiveStatus !== 'in-progress') {
      return res.status(400).json({
        success: false,
        error: 'Checkpoints can only be added to in-progress tasks'
      });
    }

    const duplicateCheckpoint = task.checkpoints.some(
      checkpoint => String(checkpoint.title || '').trim().toLowerCase() === title.toLowerCase()
    );
    if (duplicateCheckpoint) {
      return res.status(409).json({ success: false, error: 'This checkpoint already exists' });
    }

    task.checkpoints.push({ title, completed: false });
    await task.save();

    const checkpoint = task.checkpoints[task.checkpoints.length - 1];
    await createActivityLog(
      req.user,
      'checkpoint_added',
      task._id,
      `Added checkpoint: ${title}`,
      null,
      { checkpointId: checkpoint._id, title },
      req
    );

    return res.status(201).json({
      success: true,
      message: 'Checkpoint added successfully',
      checkpoint,
      task
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

exports.deleteCheckpoint = async (req, res) => {
  try {
    const { taskId, checkpointId } = req.params;
    const task = await Task.findById(taskId);
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });

    const currentUserId = (req.user._id || req.user.id).toString();
    const userGroups = await Group.find({ members: req.user._id, isActive: true }).select('_id').lean();
    const groupIds = userGroups.map(group => group._id.toString());
    const isCreator = task.createdBy.toString() === currentUserId;
    const isAssigned = task.assignedUsers.some(userId => userId.toString() === currentUserId);
    const isGroupAssigned = task.assignedGroups?.some(groupId => groupIds.includes(groupId.toString()));

    if (!isCreator && !isAssigned && !isGroupAssigned) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }

    const checkpoint = task.checkpoints.id(checkpointId);
    if (!checkpoint) return res.status(404).json({ success: false, error: 'Checkpoint not found' });

    const checkpointTitle = checkpoint.title;
    task.checkpoints.pull(checkpointId);
    await task.save();

    await createActivityLog(
      req.user,
      'checkpoint_deleted',
      task._id,
      `Deleted checkpoint: ${checkpointTitle}`,
      null,
      { checkpointId, title: checkpointTitle },
      req
    );

    return res.json({ success: true, message: 'Checkpoint deleted successfully', task });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

exports.updateCheckpoint = async (req, res) => {
  try {
    const { taskId, checkpointId } = req.params;
    const { completed } = req.body;

    const task = await Task.findById(taskId);
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });

    const currentUserId = (req.user._id || req.user.id).toString();
    const userGroups = await Group.find({ members: req.user._id, isActive: true }).select('_id').lean();
    const groupIds = userGroups.map(g => g._id.toString());
    const isCreator = task.createdBy.toString() === currentUserId;
    const isAssigned = task.assignedUsers.some(uid => uid.toString() === currentUserId);
    const isGroupAssigned = task.assignedGroups?.some(gid => groupIds.includes(gid.toString()));

    if (!isCreator && !isAssigned && !isGroupAssigned) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }

    const checkpoint = task.checkpoints.id(checkpointId);
    if (!checkpoint) return res.status(404).json({ success: false, error: 'Checkpoint not found' });

    const isCompleted = completed !== false;
    const oldStatus = task.overallStatus || 'pending';
    checkpoint.completed = isCompleted;
    checkpoint.completedAt = isCompleted ? new Date() : null;
    checkpoint.completedBy = isCompleted ? req.user._id : null;

    const hasCheckpoints = task.checkpoints.length > 0;
    const allCompleted = hasCheckpoints && task.checkpoints.every(item => item.completed);

    if (allCompleted) {
      task.overallStatus = 'completed';
      task.completionDate = new Date();
      task.statusByUser.forEach(item => {
        item.status = 'completed';
        item.updatedAt = new Date();
        item.remarks = 'All checkpoints completed';
      });
      if (oldStatus !== 'completed') {
        task.statusHistory.push({ status: 'completed', changedBy: req.user._id, remarks: 'All checkpoints completed' });
      }
    } else if (oldStatus === 'completed') {
      task.overallStatus = 'in-progress';
      task.completionDate = null;
      task.statusByUser.forEach(item => {
        if (item.status === 'completed') {
          item.status = 'in-progress';
          item.updatedAt = new Date();
          item.remarks = 'Checkpoint reopened';
        }
      });
      task.statusHistory.push({ status: 'in-progress', changedBy: req.user._id, remarks: 'Checkpoint reopened' });
    } else if (oldStatus === 'pending' && isCompleted) {
      task.overallStatus = 'in-progress';
    }

    await task.save();
    await createActivityLog(req.user, 'checkpoint_updated', task._id, `${isCompleted ? 'Completed' : 'Reopened'} checkpoint: ${checkpoint.title}`, null, { checkpointId, completed: isCompleted }, req);

    res.json({ success: true, message: 'Checkpoint updated successfully', task });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
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
    const oldStatus = oldStatusEntry?.status || task.overallStatus || 'pending';
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
      isTaskOverdueForStatus(task.dueDateTime || task.dueDate, oldStatus, task)
    ) {
      if (!['onhold', 'completed', 'approved', 'rejected', 'cancelled', 'overdue'].includes(normalizeTaskStatus(oldStatus))) {
        task.markUserStatusOverdue(currentUserId, 'Automatically marked overdue after due time passed');
        await task.save();
      }
      return res.status(400).json({ success: false, error: 'Cannot change status of an overdue task' });
    }

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

    res.json({ success: true, message: 'Status updated successfully', data: { taskId, newStatus: status, overallStatus: task.overallStatus } });

    const runStatusPostProcessing = async () => {
      if (!isCreator) {
        await createNotification(
          task.createdBy,
          'Task Status Updated',
          `${req.user.name || 'User'} updated task status to ${status}`,
          'status_updated',
          task._id
        );
      }

      await createActivityLog(
        req.user,
        'status_updated',
        task._id,
        `Updated task status to ${status}`,
        { status: oldStatus },
        { status, remarks },
        req
      );
    };

    if (status === 'completed') {
      enqueueCompletionJob(async () => {
        try {
          await runStatusPostProcessing();
        } catch (asyncErr) {
          console.error('❌ Background assigned task post-processing failed:', asyncErr);
        }
      });
    } else {
      void (async () => {
        try {
          await runStatusPostProcessing();
        } catch (asyncErr) {
          console.error('❌ Background assigned task post-processing failed:', asyncErr);
        }
      })();
    }
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
