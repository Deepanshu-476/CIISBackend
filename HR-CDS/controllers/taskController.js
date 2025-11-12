const Task = require('../models/Task');
const User = require('../../models/User');
const Group = require('../models/Group');
const Notification = require('../models/Notification');
const ActivityLog = require('../models/ActivityLog');
const moment = require('moment');
const sendEmail = require('../../utils/sendEmail');

// 🔹 Helper to create notifications
const createNotification = async (userId, title, message, type, relatedTask = null, metadata = null) => {
  try {
    await Notification.create({
      user: userId,
      title,
      message,
      type,
      relatedTask,
      metadata
    });
  } catch (error) {
    console.error('❌ Error creating notification:', error);
  }
};

// 🔹 Helper to create activity logs
const createActivityLog = async (user, action, task, description, oldValues = null, newValues = null, req = null) => {
  try {
    await ActivityLog.create({
      user: user._id,
      action,
      task,
      description,
      oldValues,
      newValues,
      ipAddress: req?.ip || req?.connection?.remoteAddress,
      userAgent: req?.get('User-Agent')
    });
  } catch (error) {
    console.error('❌ Error creating activity log:', error);
  }
};

// 🔹 Helper to group tasks by createdAt (latest first) with serial numbers - OPTIMIZED
const groupTasksByDate = (tasks, dateField = 'createdAt', serialKey = 'serialNo') => {
  const grouped = {};

  tasks.forEach(task => {
    const dateKey = moment(task[dateField]).format('DD-MM-YYYY');
    if (!grouped[dateKey]) grouped[dateKey] = [];
    grouped[dateKey].push(task);
  });

  const sortedKeys = Object.keys(grouped).sort((a, b) =>
    moment(b, 'DD-MM-YYYY').toDate() - moment(a, 'DD-MM-YYYY').toDate()
  );

  const sortedGrouped = {};
  sortedKeys.forEach(dateKey => {
    sortedGrouped[dateKey] = grouped[dateKey]
      .sort((a, b) => new Date(b[dateField]) - new Date(a[dateField]))
      .map((task, index) => ({
        ...task,
        [serialKey]: index + 1
      }));
  });

  return sortedGrouped;
};

// 🔹 Enrich tasks with name/role for status info - OPTIMIZED
const enrichStatusInfo = async (tasks) => {
  if (!tasks || tasks.length === 0) return tasks;

  const userIds = [];
  tasks.forEach(task => {
    if (task.statusByUser && Array.isArray(task.statusByUser)) {
      task.statusByUser.forEach(status => {
        if (status.user) userIds.push(status.user.toString());
      });
    }
  });

  if (userIds.length === 0) return tasks;

  const uniqueUserIds = [...new Set(userIds)];
  const users = await User.find({ _id: { $in: uniqueUserIds } }).select('name role email').lean();
  const userMap = {};
  users.forEach(u => {
    userMap[u._id.toString()] = u;
  });

  return tasks.map(task => {
    if (!task.statusByUser || !Array.isArray(task.statusByUser)) {
      return task.toObject ? task.toObject() : task;
    }

    const newStatusInfo = task.statusByUser.map(status => {
      const userObj = userMap[status.user.toString()];
      const base = {
        userId: status.user,
        name: userObj?.name || 'Unknown',
        role: userObj?.role || 'N/A',
        email: userObj?.email || 'N/A',
        status: status.status,
      };

      if (status.status === 'approved') {
        base.approvedByUser = `${userObj.name} (${userObj.role})`;
      } else if (status.status === 'rejected') {
        base.rejectedByUser = `${userObj.name} (${userObj.role})`;
      }

      return base;
    });

    return {
      ...(task.toObject ? task.toObject() : task),
      statusInfo: newStatusInfo
    };
  });
};

// 🔹 Get all users including group members for task assignment
const getAllAssignableUsers = async (req) => {
  const isPrivileged = ['admin', 'manager', 'hr', 'SuperAdmin'].includes(req.user.role);

  if (!isPrivileged) {
    return [{ _id: req.user._id, name: req.user.name, role: req.user.role, employeeType: req.user.employeeType, email: req.user.email }];
  }

  const users = await User.find().select('name _id role employeeType email').lean();
  return users;
};

// 🔹 Get all groups for task assignment
const getAllAssignableGroups = async (req) => {
  const isPrivileged = ['admin', 'manager', 'hr', 'SuperAdmin'].includes(req.user.role);

  if (!isPrivileged) {
    return [];
  }

  const groups = await Group.find({
    createdBy: req.user._id,
    isActive: true
  })
  .populate('members', 'name role email')
  .select('name description members')
  .lean();

  return groups;
};

// 🔹 Send email notification for task creation
const sendTaskCreationEmail = async (task, assignedUsers) => {
  try {
    for (const user of assignedUsers) {
      const emailSubject = `🎯 New Task Assigned: ${task.title}`;
      const emailHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
          <div style="text-align: center; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; border-radius: 8px 8px 0 0; color: white;">
            <h1 style="margin: 0; font-size: 24px;">New Task Assigned</h1>
          </div>
          
          <div style="padding: 20px;">
            <p>Hello <strong>${user.name}</strong>,</p>
            <p>You have been assigned a new task. Here are the details:</p>
            
            <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 15px 0; border-left: 4px solid #667eea;">
              <h3 style="margin-top: 0; color: #333;">${task.title}</h3>
              ${task.description ? `<p style="margin: 10px 0;"><strong>Description:</strong> ${task.description}</p>` : ''}
              <p style="margin: 5px 0;"><strong>Priority:</strong> <span style="color: ${
                task.priority === 'high' ? '#dc3545' : 
                task.priority === 'medium' ? '#ffc107' : '#28a745'
              };">${task.priority.toUpperCase()}</span></p>
              ${task.dueDateTime ? `<p style="margin: 5px 0;"><strong>Due Date:</strong> ${moment(task.dueDateTime).format('DD MMM YYYY, hh:mm A')}</p>` : ''}
              ${task.priorityDays ? `<p style="margin: 5px 0;"><strong>Priority Days:</strong> ${task.priorityDays}</p>` : ''}
              <p style="margin: 5px 0;"><strong>Assigned By:</strong> ${task.createdBy.name}</p>
            </div>
            
            <div style="background: #e7f3ff; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #1976d2;">
              <p style="margin: 0; font-weight: bold;">📋 Action Required:</p>
              <p style="margin: 10px 0 0 0;">Please login to your dashboard to view the complete task details and update the status.</p>
            </div>
            
            <div style="text-align: center; margin: 25px 0;">
              <a href="https://cds.ciisnetwork.in/login"
                 style="background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">
                View Task Dashboard
              </a>
            </div>
          </div>
          
          <div style="border-top: 1px solid #e0e0e0; padding-top: 15px; text-align: center; color: #666; font-size: 12px;">
            <p>This is an automated notification. Please do not reply to this email.</p>
            <p>© ${new Date().getFullYear()} Ciis Task Management System</p>
          </div>
        </div>
      `;

      await sendEmail(user.email, emailSubject, emailHtml);
      console.log(`✅ Task creation email sent to: ${user.email}`);
    }
  } catch (emailError) {
    console.error('❌ Failed to send task creation email:', emailError);
  }
};

// 🔹 Send email notification for task status update
const sendTaskStatusUpdateEmail = async (task, updatedUser, oldStatus, newStatus) => {
  try {
    const emailSubject = `🔄 Task Status Updated: ${task.title}`;
    
    let statusColor = '#666';
    let statusEmoji = '📝';
    
    switch (newStatus) {
      case 'completed':
        statusColor = '#28a745';
        statusEmoji = '✅';
        break;
      case 'in progress':
        statusColor = '#ffc107';
        statusEmoji = '🔄';
        break;
      case 'pending':
        statusColor = '#6c757d';
        statusEmoji = '⏳';
        break;
    }

    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <div style="text-align: center; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; border-radius: 8px 8px 0 0; color: white;">
          <h1 style="margin: 0; font-size: 24px;">Task Status Updated</h1>
        </div>
        
        <div style="padding: 20px;">
          <p>Hello <strong>${task.createdBy.name}</strong>,</p>
          <p><strong>${updatedUser.name}</strong> has updated the status of the following task:</p>
          
          <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 15px 0; border-left: 4px solid ${statusColor};">
            <h3 style="margin-top: 0; color: #333;">${task.title}</h3>
            <div style="display: flex; align-items: center; gap: 10px; margin: 10px 0;">
              <span style="font-size: 20px;">${statusEmoji}</span>
              <div>
                <p style="margin: 0; font-weight: bold; color: ${statusColor};">Status: ${newStatus.toUpperCase()}</p>
                <p style="margin: 5px 0 0 0; font-size: 12px; color: #666;">
                  Previous: ${oldStatus.toUpperCase()} → New: ${newStatus.toUpperCase()}
                </p>
              </div>
            </div>
            ${task.description ? `<p style="margin: 10px 0;"><strong>Description:</strong> ${task.description}</p>` : ''}
            <p style="margin: 5px 0;"><strong>Updated By:</strong> ${updatedUser.name} (${updatedUser.role})</p>
            <p style="margin: 5px 0;"><strong>Updated At:</strong> ${moment().format('DD MMM YYYY, hh:mm A')}</p>
          </div>

          ${newStatus === 'completed' ? `
            <div style="background: #d4edda; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #28a745;">
              <p style="margin: 0; font-weight: bold; color: #155724;">🎉 Task Completed!</p>
              <p style="margin: 10px 0 0 0;">Great work! The task has been successfully completed.</p>
            </div>
          ` : ''}
          
          <div style="text-align: center; margin: 25px 0;">
            <a href="https://cds.ciisnetwork.in/login" 
               style="background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">
              View Task Dashboard
            </a>
          </div>
        </div>
        
        <div style="border-top: 1px solid #e0e0e0; padding-top: 15px; text-align: center; color: #666; font-size: 12px;">
          <p>This is an automated notification. Please do not reply to this email.</p>
          <p>© ${new Date().getFullYear()} Ciis Task Management System</p>
        </div>
      </div>
    `;

    await sendEmail(task.createdBy.email, emailSubject, emailHtml);
    console.log(`✅ Task status update email sent to: ${task.createdBy.email}`);
  } catch (emailError) {
    console.error('❌ Failed to send task status update email:', emailError);
  }
};

// ✅ Get Self-Assigned Tasks of a User (For Admin to see tasks assigned to a specific user)
exports.getUserSelfAssignedTasks = async (req, res) => {
  try {
    if (!['admin', 'manager', 'hr', 'SuperAdmin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const tasks = await Task.find({
      createdBy: userId,
      assignedUsers: userId
    })
    .populate('assignedUsers', 'name role email')
    .populate('assignedGroups', 'name description')
    .populate('createdBy', 'name email')
    .lean();

    const enrichedTasks = await enrichStatusInfo(tasks);
    const groupedTasks = groupTasksByDate(enrichedTasks, 'createdAt', 'serialNo');

    res.json({ groupedTasks });
  } catch (error) {
    console.error('❌ Error in getUserSelfAssignedTasks:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// 🔹 Get assigned tasks for logged-in user
exports.getAssignedTasksWithStatus = async (req, res) => {
  try {
    if (!['admin', 'manager', 'hr', 'SuperAdmin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const tasks = await Task.find({ createdBy: req.user._id })
      .populate('assignedUsers', 'name role email')
      .populate('assignedGroups', 'name description')
      .populate('createdBy', 'name email')
      .lean();

    const enriched = await enrichStatusInfo(tasks);
    res.json({ tasks: enriched });
  } catch (error) {
    console.error('❌ Error in getAssignedTasksWithStatus:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// 🔹 Get all tasks: created by or assigned to logged-in user - WITH PAGINATION
exports.getTasks = async (req, res) => {
  const { status, page = 1, limit = 20, search } = req.query;
  
  try {
    // Get user's groups to include group-assigned tasks
    const userGroups = await Group.find({ 
      members: req.user._id,
      isActive: true 
    }).select('_id').lean();

    const groupIds = userGroups.map(group => group._id);

    const filter = {
      $or: [
        { assignedUsers: req.user._id },
        { createdBy: req.user._id },
        { assignedGroups: { $in: groupIds } }
      ]
    };

    if (status) {
      filter['statusByUser.status'] = status;
    }

    // Add search functionality
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (page - 1) * limit;

    const tasks = await Task.find(filter)
      .populate('assignedUsers', 'name email')
      .populate('assignedGroups', 'name description')
      .populate('createdBy', 'name email')
      .sort({ dueDateTime: 1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await Task.countDocuments(filter);

    const enriched = await enrichStatusInfo(tasks);
    const grouped = groupTasksByDate(enriched, 'createdAt', 'serialNo');
    
    res.json({ 
      groupedTasks: grouped,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      limit: parseInt(limit)
    });
  } catch (error) {
    console.error('❌ Error fetching tasks:', error);
    res.status(500).json({ error: 'Failed to get tasks' });
  }
};

// 🔹 Get only tasks assigned to logged-in user (including group assignments) - WITH PAGINATION
exports.getMyTasks = async (req, res) => {
  try {
    const { page = 1, limit = 20, search, status } = req.query;

    // Get user's groups to include group-assigned tasks
    const userGroups = await Group.find({ 
      members: req.user._id,
      isActive: true 
    }).select('_id').lean();

    const groupIds = userGroups.map(group => group._id);

    const filter = {
      $or: [
        { assignedUsers: req.user._id },
        { assignedGroups: { $in: groupIds } }
      ]
    };

    // Add status filter
    if (status) {
      filter['statusByUser.status'] = status;
    }

    // Add search functionality
    if (search) {
      filter.$or = [
        ...filter.$or,
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (page - 1) * limit;

    const tasks = await Task.find(filter)
      .populate('assignedUsers', 'name email')
      .populate('assignedGroups', 'name description')
      .populate('createdBy', 'name email')
      .sort({ dueDateTime: 1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await Task.countDocuments(filter);

    const enriched = await enrichStatusInfo(tasks);
    const grouped = groupTasksByDate(enriched, 'createdAt', 'mySerialNo');
    
    res.json({ 
      groupedTasks: grouped,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      limit: parseInt(limit)
    });
  } catch (error) {
    console.error('❌ Error fetching my tasks:', error);
    res.status(500).json({ error: 'Failed to get your tasks' });
  }
};

// 🔹 Get only tasks created by logged-in user (e.g., admin) - WITH PAGINATION
exports.getAssignedTasks = async (req, res) => {
  try {
    const { page = 1, limit = 20, search, status } = req.query;

    const filter = { createdBy: req.user._id };

    // Add status filter
    if (status) {
      filter['statusByUser.status'] = status;
    }

    // Add search functionality
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (page - 1) * limit;

    const tasks = await Task.find(filter)
      .populate('assignedUsers', 'name role email')
      .populate('assignedGroups', 'name description')
      .populate('createdBy', 'name email')
      .sort({ dueDateTime: 1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await Task.countDocuments(filter);

    const enriched = await enrichStatusInfo(tasks);
    const grouped = groupTasksByDate(enriched, 'createdAt', 'assignedSerialNo');
    
    res.json({ 
      groupedTasks: grouped,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      limit: parseInt(limit)
    });
  } catch (error) {
    console.error('❌ Error fetching assigned tasks:', error);
    res.status(500).json({ error: 'Failed to get assigned tasks' });
  }
};

// 🔹 Create task with role-based assignment rules - SINGLE TASK ONLY (NO REPEAT)
exports.createTask = async (req, res) => {
  try {
    const {
      title,
      description,
      dueDateTime,
      whatsappNumber,
      priorityDays,
      priority,
      assignedUsers,
      assignedGroups
    } = req.body;

    const files = (req.files?.files || []).map((f) => ({
      filename: f.filename,
      originalName: f.originalname,
      path: f.path,
      uploadedBy: req.user._id
    }));

    const voiceNote = req.files?.voiceNote?.[0] ? {
      filename: req.files.voiceNote[0].filename,
      originalName: req.files.voiceNote[0].originalname,
      path: req.files.voiceNote[0].path,
      uploadedBy: req.user._id
    } : null;

    // FIXED: Safe JSON parsing with null handling
    const parsedUsers = assignedUsers && assignedUsers !== 'null' ? JSON.parse(assignedUsers) : [];
    const parsedGroups = assignedGroups && assignedGroups !== 'null' ? JSON.parse(assignedGroups) : [];

    const role = req.user.role;
    const isPrivileged = ["admin", "manager", "hr", "SuperAdmin"].includes(role);

    // Validate due date is not in the past
    if (dueDateTime) {
      const dueDate = new Date(dueDateTime);
      if (dueDate < new Date()) {
        return res.status(400).json({ error: 'Due date cannot be in the past' });
      }
    }

    // 🔹 Auto-assign for normal users
    let finalAssignedUsers = parsedUsers;
    let finalAssignedGroups = parsedGroups;

    if (!isPrivileged) {
      finalAssignedUsers = [req.user._id.toString()]; // assign to self
      finalAssignedGroups = []; // not allowed to assign groups
      
      // For users, only allow current and future dates
      if (dueDateTime) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const dueDate = new Date(dueDateTime);
        if (dueDate < today) {
          return res.status(400).json({ error: 'You can only create tasks for current and upcoming dates' });
        }
      }
    }

    // 🔹 Validate groups for privileged users
    if (finalAssignedGroups.length > 0) {
      const groups = await Group.find({
        _id: { $in: finalAssignedGroups },
        createdBy: req.user._id,
        isActive: true,
      }).lean();

      if (groups.length !== finalAssignedGroups.length) {
        return res.status(400).json({
          error: "Some groups are invalid or you do not have permission",
        });
      }
    }

    // 🔹 Collect all assigned users (direct + group members)
    const allAssignedUsers = [...new Set([...finalAssignedUsers])];

    if (finalAssignedGroups.length > 0) {
      const groupsWithMembers = await Group.find({
        _id: { $in: finalAssignedGroups },
      }).populate("members", "_id name email").lean();

      groupsWithMembers.forEach((group) => {
        group.members.forEach((member) => {
          allAssignedUsers.push(member._id.toString());
        });
      });
    }

    // 🔹 Remove duplicates
    const uniqueAssignedUsers = [...new Set(allAssignedUsers)];

    // 🔹 Create status tracking for each user
    const statusByUser = uniqueAssignedUsers.map((uid) => ({
      user: uid,
      status: "pending",
    }));

    // 🔹 Create the task - SINGLE TASK ONLY
    const task = await Task.create({
      title,
      description,
      dueDateTime: dueDateTime ? new Date(dueDateTime) : null,
      whatsappNumber,
      priorityDays,
      priority: priority || "medium",
      assignedUsers: finalAssignedUsers,
      assignedGroups: finalAssignedGroups,
      statusByUser,
      files,
      voiceNote,
      createdBy: req.user._id,
      isRecurring: false, // Always false now
      statusHistory: [{
        status: 'pending',
        changedBy: req.user._id,
        remarks: 'Task created'
      }]
    });

    // Populate task data for email
    await task.populate("assignedUsers", "name role email");
    await task.populate("assignedGroups", "name description");
    await task.populate("createdBy", "name email");

    // 🔹 Create notifications for all assigned users
    for (const userId of uniqueAssignedUsers) {
      await createNotification(
        userId,
        'New Task Assigned',
        `You have been assigned a new task: ${title}`,
        'task_assigned',
        task._id,
        { priority, dueDateTime }
      );
    }

    // 🔹 Create activity log
    await createActivityLog(
      req.user,
      'task_created',
      task._id,
      `Created new task: ${title}`,
      null,
      { title, description, priority, assignedUsers: uniqueAssignedUsers },
      req
    );

    // 🔹 Send email notifications to all assigned users
    if (task.assignedUsers && task.assignedUsers.length > 0) {
      await sendTaskCreationEmail(task, task.assignedUsers);
    }

    res.status(201).json({ 
      success: true, 
      task,
      message: 'Task created successfully'
    });
  } catch (error) {
    console.error("❌ Error creating task:", error);
    res.status(500).json({ error: error.message || "Internal Server Error" });
  }
};

// 🔄 Update status of task - NO RECURRING TASK SUPPORT
exports.updateStatus = async (req, res) => {
  try {
    const { taskId } = req.params;
    const { status, remarks } = req.body;

    console.log(`🎯 updateStatus called for task: ${taskId}`);

    // Basic validation
    if (!status) {
      return res.status(400).json({ 
        success: false,
        error: 'Status is required' 
      });
    }

    // Find task without population first
    const task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({ 
        success: false,
        error: 'Task not found' 
      });
    }

    // Simple authorization - check if user is in assignedUsers
    const isAuthorized = task.assignedUsers.some(userId => 
      userId.toString() === req.user._id.toString()
    );

    if (!isAuthorized) {
      return res.status(403).json({ 
        success: false,
        error: 'You are not assigned to this task' 
      });
    }

    // Update status
    const statusIndex = task.statusByUser.findIndex(s => 
      s.user && s.user.toString() === req.user._id.toString()
    );

    const oldStatus = statusIndex !== -1 ? task.statusByUser[statusIndex].status : 'pending';

    if (statusIndex === -1) {
      task.statusByUser.push({
        user: req.user._id,
        status: status,
        updatedAt: new Date(),
        remarks: remarks
      });
    } else {
      task.statusByUser[statusIndex].status = status;
      task.statusByUser[statusIndex].updatedAt = new Date();
      if (remarks) {
        task.statusByUser[statusIndex].remarks = remarks;
      }
    }

    // Add to status history
    task.statusHistory.push({
      status: status,
      changedBy: req.user._id,
      remarks: remarks || `Status changed from ${oldStatus} to ${status}`
    });

    // Simple overall status update
  if (status === 'completed') {
  // ✅ Check if all assigned users have completed
  const allUsersCompleted = task.assignedUsers.every(assignedUserId => {
    const userStatus = task.statusByUser.find(s => 
      s.user && s.user.toString() === assignedUserId.toString()
    );
    return userStatus && userStatus.status === 'completed';
  });

  if (allUsersCompleted) {
    task.overallStatus = 'completed';
    task.completionDate = new Date();
  } else {
    task.overallStatus = 'in-progress';
  }
}

else if (status === 'in-progress') {
  task.overallStatus = 'in-progress';
}

else if (status === 'approved') {
  task.overallStatus = 'approved';
}

else if (status === 'rejected') {
  task.overallStatus = 'rejected';
}

else if (status === 'on-hold') {
  // 🟡 new condition for paused tasks
  task.overallStatus = 'on-hold';
  task.holdDate = new Date(); // optional: track when it went on hold
}

else if (status === 'reopen') {
  // 🔄 new condition for reopened tasks
  task.overallStatus = 'reopen';
  task.reopenedAt = new Date(); // optional: track reopen time
}

else {
  task.overallStatus = 'pending';
}

    // Save task
    await task.save();

    // Populate for notifications
    await task.populate('createdBy', 'name email');
    const updatedUser = await User.findById(req.user._id).select('name role email');

    // 🔹 Create notification for task creator
    await createNotification(
      task.createdBy._id,
      'Task Status Updated',
      `${updatedUser.name} updated task "${task.title}" status to ${status}`,
      'status_updated',
      task._id,
      { oldStatus, newStatus: status, updatedBy: updatedUser.name }
    );

    // 🔹 Create activity log
    await createActivityLog(
      req.user,
      'status_updated',
      task._id,
      `Updated task status from ${oldStatus} to ${status}`,
      { status: oldStatus },
      { status: status, remarks },
      req
    );

    // 🔹 Send email notification
    await sendTaskStatusUpdateEmail(task, updatedUser, oldStatus, status);

    res.json({ 
      success: true,
      message: '✅ Status updated successfully',
      data: {
        taskId: task._id,
        newStatus: status,
        overallStatus: task.overallStatus
      }
    });

  } catch (error) {
    console.error('💥 Error in updateStatus:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error',
      ...(process.env.NODE_ENV === 'development' && { details: error.message })
    });
  }
};

// 🔹 Add remark to task
exports.addRemark = async (req, res) => {
  try {
    const { taskId } = req.params;
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'Remark text is required' });
    }

    const task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Check if user is authorized (assigned to task or creator)
    const isAuthorized = task.assignedUsers.some(userId => 
      userId.toString() === req.user._id.toString()
    ) || task.createdBy.toString() === req.user._id.toString();

    if (!isAuthorized) {
      return res.status(403).json({ error: 'Not authorized to add remarks to this task' });
    }

    // Add remark
    task.remarks.push({
      user: req.user._id,
      text: text
    });

    await task.save();

    // Populate for notifications
    await task.populate('createdBy', 'name email');
    await task.populate('assignedUsers', 'name email');
    const remarkUser = await User.findById(req.user._id).select('name role');

    // 🔹 Create notifications for task creator and all assigned users
    const notifyUsers = [
      task.createdBy._id,
      ...task.assignedUsers.map(user => user._id)
    ].filter(userId => userId.toString() !== req.user._id.toString()); // Don't notify self

    for (const userId of notifyUsers) {
      await createNotification(
        userId,
        'New Remark Added',
        `${remarkUser.name} added a remark to task: ${task.title}`,
        'remark_added',
        task._id,
        { remark: text, addedBy: remarkUser.name }
      );
    }

    // 🔹 Create activity log
    await createActivityLog(
      req.user,
      'remark_added',
      task._id,
      `Added remark to task: ${text.substring(0, 50)}...`,
      null,
      { remark: text },
      req
    );

    res.json({ 
      success: true, 
      message: 'Remark added successfully',
      remark: task.remarks[task.remarks.length - 1]
    });

  } catch (error) {
    console.error('❌ Error adding remark:', error);
    res.status(500).json({ error: 'Failed to add remark' });
  }
};

// 🔹 Get task remarks
exports.getRemarks = async (req, res) => {
  try {
    const { taskId } = req.params;

    const task = await Task.findById(taskId)
      .populate('remarks.user', 'name role email')
      .select('remarks');

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    res.json({ 
      success: true, 
      remarks: task.remarks 
    });

  } catch (error) {
    console.error('❌ Error fetching remarks:', error);
    res.status(500).json({ error: 'Failed to fetch remarks' });
  }
};

// 🔹 Get user notifications - WITH PAGINATION
exports.getNotifications = async (req, res) => {
  try {
    const { page = 1, limit = 20, unreadOnly = false } = req.query;

    const filter = { user: req.user._id };
    if (unreadOnly === 'true') {
      filter.isRead = false;
    }

    const skip = (page - 1) * limit;

    const notifications = await Notification.find(filter)
      .populate('relatedTask', 'title')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip)
      .lean();

    const total = await Notification.countDocuments(filter);
    const unreadCount = await Notification.countDocuments({ 
      user: req.user._id, 
      isRead: false 
    });

    res.json({
      success: true,
      notifications,
      totalPages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      total,
      unreadCount
    });

  } catch (error) {
    console.error('❌ Error fetching notifications:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
};

// 🔹 Mark notification as read
exports.markNotificationAsRead = async (req, res) => {
  try {
    const { notificationId } = req.params;

    const notification = await Notification.findOneAndUpdate(
      { _id: notificationId, user: req.user._id },
      { 
        isRead: true,
        readAt: new Date()
      },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json({ 
      success: true, 
      message: 'Notification marked as read',
      notification 
    });

  } catch (error) {
    console.error('❌ Error marking notification as read:', error);
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
};

// 🔹 Mark all notifications as read
exports.markAllNotificationsAsRead = async (req, res) => {
  try {
    await Notification.updateMany(
      { user: req.user._id, isRead: false },
      { 
        isRead: true,
        readAt: new Date()
      }
    );

    res.json({ 
      success: true, 
      message: 'All notifications marked as read'
    });

  } catch (error) {
    console.error('❌ Error marking all notifications as read:', error);
    res.status(500).json({ error: 'Failed to mark all notifications as read' });
  }
};

// 🔹 Get activity logs for a task - WITH PAGINATION
exports.getTaskActivityLogs = async (req, res) => {
  try {
    const { taskId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    const task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Check if user is authorized to view task logs
    const isAuthorized = task.assignedUsers.some(userId => 
      userId.toString() === req.user._id.toString()
    ) || task.createdBy.toString() === req.user._id.toString();

    if (!isAuthorized) {
      return res.status(403).json({ error: 'Not authorized to view activity logs for this task' });
    }

    const skip = (page - 1) * limit;

    const logs = await ActivityLog.find({ task: taskId })
      .populate('user', 'name role email')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip)
      .lean();

    const total = await ActivityLog.countDocuments({ task: taskId });

    res.json({
      success: true,
      logs,
      totalPages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      total
    });

  } catch (error) {
    console.error('❌ Error fetching activity logs:', error);
    res.status(500).json({ error: 'Failed to fetch activity logs' });
  }
};

// 🔹 Get user activity timeline - WITH PAGINATION
exports.getUserActivityTimeline = async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    // Check if user is authorized (own timeline or admin/manager/hr)
    const isAuthorized = userId === req.user._id.toString() || 
                        ['admin', 'manager', 'hr', 'SuperAdmin'].includes(req.user.role);

    if (!isAuthorized) {
      return res.status(403).json({ error: 'Not authorized to view this activity timeline' });
    }

    const skip = (page - 1) * limit;

    const logs = await ActivityLog.find({ user: userId })
      .populate('task', 'title')
      .populate('user', 'name role email')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip)
      .lean();

    const total = await ActivityLog.countDocuments({ user: userId });

    res.json({
      success: true,
      logs,
      totalPages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      total
    });

  } catch (error) {
    console.error('❌ Error fetching activity timeline:', error);
    res.status(500).json({ error: 'Failed to fetch activity timeline' });
  }
};

// 🔹 Update task (Admin/Manager/HR only) - FIXED: Handle null values properly
exports.updateTask = async (req, res) => {
  try {
    const { taskId } = req.params;
    const updateData = req.body;

    if (!['admin', 'manager', 'hr', 'SuperAdmin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const oldTask = { ...task.toObject() };

    // Handle file updates
    if (req.files) {
      if (req.files.files) {
        const newFiles = req.files.files.map((f) => ({
          filename: f.filename,
          originalName: f.originalname,
          path: f.path,
          uploadedBy: req.user._id
        }));
        task.files.push(...newFiles);
      }

      if (req.files.voiceNote) {
        task.voiceNote = {
          filename: req.files.voiceNote[0].filename,
          originalName: req.files.voiceNote[0].originalname,
          path: req.files.voiceNote[0].path,
          uploadedBy: req.user._id
        };
      }
    }

    // FIXED: Safe JSON parsing for assignedUsers and assignedGroups
    let assignedUsers = [];
    let assignedGroups = [];

    if (updateData.assignedUsers) {
      if (typeof updateData.assignedUsers === 'string') {
        assignedUsers = updateData.assignedUsers !== 'null' ? JSON.parse(updateData.assignedUsers) : [];
      } else {
        assignedUsers = updateData.assignedUsers;
      }
    }

    if (updateData.assignedGroups) {
      if (typeof updateData.assignedGroups === 'string') {
        assignedGroups = updateData.assignedGroups !== 'null' ? JSON.parse(updateData.assignedGroups) : [];
      } else {
        assignedGroups = updateData.assignedGroups;
      }
    }

    // Update other fields with null checks
    const allowedFields = ['title', 'description', 'dueDateTime', 'whatsappNumber', 'priorityDays', 'priority'];
    allowedFields.forEach(field => {
      if (updateData[field] !== undefined && updateData[field] !== null && updateData[field] !== 'null') {
        task[field] = updateData[field];
      }
    });

    // Update assigned users and groups if provided
    if (assignedUsers.length > 0) {
      task.assignedUsers = assignedUsers;
    }

    if (assignedGroups.length > 0) {
      task.assignedGroups = assignedGroups;
    }

    await task.save();

    // 🔹 Create activity log
    await createActivityLog(
      req.user,
      'task_updated',
      task._id,
      `Updated task: ${task.title}`,
      oldTask,
      task.toObject(),
      req
    );

    res.json({ 
      success: true, 
      message: 'Task updated successfully',
      task 
    });

  } catch (error) {
    console.error('❌ Error updating task:', error);
    res.status(500).json({ error: 'Failed to update task' });
  }
};

// 🔹 Delete task (Admin/Manager/HR only)
exports.deleteTask = async (req, res) => {
  try {
    const { taskId } = req.params;

    if (!['admin', 'manager', 'hr', 'SuperAdmin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const taskTitle = task.title;

    // Soft delete by setting isActive to false
    task.isActive = false;
    await task.save();

    // 🔹 Create activity log
    await createActivityLog(
      req.user,
      'task_deleted',
      taskId,
      `Deleted task: ${taskTitle}`,
      task.toObject(),
      null,
      req
    );

    res.json({ 
      success: true, 
      message: 'Task deleted successfully' 
    });

  } catch (error) {
    console.error('❌ Error deleting task:', error);
    res.status(500).json({ error: 'Failed to delete task' });
  }
};

// 🔹 Get assignable users and groups
exports.getAssignableUsers = async (req, res) => {
  try {
    const users = await getAllAssignableUsers(req);
    const groups = await getAllAssignableGroups(req);

    res.json({ 
      users,
      groups 
    });
  } catch (error) {
    console.error('❌ Error fetching assignable data:', error);
    res.status(500).json({ error: 'Failed to fetch assignable data.' });
  }
};

// 🔹 Get all users
exports.getAllUsers = async (req, res) => {
  try {
    const users = await User.find().select('name _id role employeeType email').lean();
    res.json({ users });
  } catch (error) {
    res.status(500).json({ error: 'Unable to fetch users' });
  }
};


// 🔹 Upload PDF for Task
exports.uploadTaskPDF = async (req, res) => {
  try {
    const { taskId } = req.params;
    if (!req.file) return res.status(400).json({ error: "No PDF uploaded" });

    const task = await Task.findById(taskId);
    if (!task) return res.status(404).json({ error: "Task not found" });

    const pdfData = {
      filename: req.file.filename,
      originalName: req.file.originalname,
      path: req.file.path,
      uploadedBy: req.user._id,
    };

    task.pdfFiles.push(pdfData);
    await task.save();

    res.json({ success: true, message: "PDF uploaded successfully", pdf: pdfData });
  } catch (err) {
    console.error("❌ PDF Upload Error:", err);
    res.status(500).json({ error: "Failed to upload PDF" });
  }
};

// 🔹 Get (View) PDFs of a Task
exports.getTaskPDFs = async (req, res) => {
  try {
    const { taskId } = req.params;
    const task = await Task.findById(taskId).populate("pdfFiles.uploadedBy", "name email");
    if (!task) return res.status(404).json({ error: "Task not found" });
    res.json({ success: true, pdfFiles: task.pdfFiles });
  } catch (err) {
    console.error("❌ Get PDFs Error:", err);
    res.status(500).json({ error: "Failed to fetch PDF files" });
  }
};
// 🔹 Get user task counts (Assigned, Created, Completed, Pending)
exports.getUserTaskCounts = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    // Check if user exists
    const user = await User.findById(userId).select('name role email');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get user's groups for group-assigned tasks
    const userGroups = await Group.find({ 
      members: userId,
      isActive: true 
    }).select('_id').lean();

    const groupIds = userGroups.map(group => group._id);

    // Base filter for tasks assigned to user (directly or via groups)
    const assignedTasksFilter = {
      $or: [
        { assignedUsers: userId },
        { assignedGroups: { $in: groupIds } }
      ],
      isActive: true
    };

    // Tasks created by user
    const createdTasksFilter = {
      createdBy: userId,
      isActive: true
    };

    // Get all counts in parallel for better performance
    const [
      totalAssignedTasks,
      totalCreatedTasks,
      completedTasks,
      pendingTasks,
      inProgressTasks,
      overdueTasks
    ] = await Promise.all([
      // Total assigned tasks
      Task.countDocuments(assignedTasksFilter),
      
      // Total created tasks
      Task.countDocuments(createdTasksFilter),
      
      // Completed tasks (assigned)
      Task.countDocuments({
        ...assignedTasksFilter,
        'statusByUser': {
          $elemMatch: {
            user: userId,
            status: 'completed'
          }
        }
      }),
      
      // Pending tasks (assigned)
      Task.countDocuments({
        ...assignedTasksFilter,
        'statusByUser': {
          $elemMatch: {
            user: userId,
            status: 'pending'
          }
        }
      }),
      
      // In Progress tasks (assigned)
      Task.countDocuments({
        ...assignedTasksFilter,
        'statusByUser': {
          $elemMatch: {
            user: userId,
            status: 'in-progress'
          }
        }
      }),
      
      // Overdue tasks (assigned)
      Task.countDocuments({
        ...assignedTasksFilter,
        dueDateTime: { $lt: new Date() },
        'statusByUser': {
          $elemMatch: {
            user: userId,
            status: { $in: ['pending', 'in-progress'] }
          }
        }
      })
    ]);

    const taskCounts = {
      user: {
        _id: user._id,
        name: user.name,
        role: user.role,
        email: user.email
      },
      counts: {
        // Assigned tasks breakdown
        assigned: {
          total: totalAssignedTasks,
          completed: completedTasks,
          pending: pendingTasks,
          inProgress: inProgressTasks,
          overdue: overdueTasks
        },
        // Created tasks
        created: totalCreatedTasks,
        // Overall summary
        summary: {
          totalTasks: totalAssignedTasks + totalCreatedTasks,
          completionRate: totalAssignedTasks > 0 
            ? Math.round((completedTasks / totalAssignedTasks) * 100) 
            : 0,
          overdueRate: totalAssignedTasks > 0
            ? Math.round((overdueTasks / totalAssignedTasks) * 100)
            : 0
        }
      }
    };

    res.json({
      success: true,
      ...taskCounts
    });

  } catch (error) {
    console.error('❌ Error in getUserTaskCounts:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// 🔹 Get detailed user tasks with filters
exports.getUserTasksDetailed = async (req, res) => {
  try {
    const { userId } = req.params;
    const { 
      type = 'all', // 'assigned', 'created', 'all'
      status, 
      page = 1, 
      limit = 20,
      search 
    } = req.query;

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    // Check if user exists
    const user = await User.findById(userId).select('name role email');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get user's groups for group-assigned tasks
    const userGroups = await Group.find({ 
      members: userId,
      isActive: true 
    }).select('_id').lean();

    const groupIds = userGroups.map(group => group._id);

    let filter = { isActive: true };

    // Build filter based on type
    if (type === 'assigned') {
      filter.$or = [
        { assignedUsers: userId },
        { assignedGroups: { $in: groupIds } }
      ];
    } else if (type === 'created') {
      filter.createdBy = userId;
    } else { // 'all'
      filter.$or = [
        { assignedUsers: userId },
        { assignedGroups: { $in: groupIds } },
        { createdBy: userId }
      ];
    }

    // Add status filter
    if (status) {
      if (status === 'overdue') {
        filter.dueDateTime = { $lt: new Date() };
        filter['statusByUser'] = {
          $elemMatch: {
            user: userId,
            status: { $in: ['pending', 'in-progress'] }
          }
        };
      } else {
        filter['statusByUser'] = {
          $elemMatch: {
            user: userId,
            status: status
          }
        };
      }
    }

    // Add search functionality
    if (search) {
      filter.$and = [
        filter,
        {
          $or: [
            { title: { $regex: search, $options: 'i' } },
            { description: { $regex: search, $options: 'i' } }
          ]
        }
      ];
    }

    const skip = (page - 1) * limit;

    const tasks = await Task.find(filter)
      .populate('assignedUsers', 'name email')
      .populate('assignedGroups', 'name description')
      .populate('createdBy', 'name email')
      .sort({ dueDateTime: 1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await Task.countDocuments(filter);

    // Enrich tasks with user-specific status info
    const enrichedTasks = await enrichStatusInfo(tasks);
    
    // Add user-specific status for each task
    const tasksWithUserStatus = enrichedTasks.map(task => {
      const userStatus = task.statusByUser?.find(status => 
        status.user && status.user.toString() === userId
      );
      
      return {
        ...task,
        userStatus: userStatus?.status || 'pending',
        userRemarks: userStatus?.remarks,
        userUpdatedAt: userStatus?.updatedAt
      };
    });

    const groupedTasks = groupTasksByDate(tasksWithUserStatus, 'createdAt', 'serialNo');

    res.json({ 
      success: true,
      user: {
        _id: user._id,
        name: user.name,
        role: user.role,
        email: user.email
      },
      groupedTasks,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      limit: parseInt(limit),
      filters: {
        type,
        status,
        search
      }
    });

  } catch (error) {
    console.error('❌ Error in getUserTasksDetailed:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// 🔹 Get user task statistics for dashboard
exports.getUserTaskStatistics = async (req, res) => {
  try {
    const { userId } = req.params;
    const { period = 'month' } = req.query; // 'week', 'month', 'year'

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    // Date range calculation based on period
    const now = new Date();
    let startDate;

    switch (period) {
      case 'week':
        startDate = new Date(now.setDate(now.getDate() - 7));
        break;
      case 'month':
        startDate = new Date(now.setMonth(now.getMonth() - 1));
        break;
      case 'year':
        startDate = new Date(now.setFullYear(now.getFullYear() - 1));
        break;
      default:
        startDate = new Date(now.setMonth(now.getMonth() - 1));
    }

    // Get user's groups
    const userGroups = await Group.find({ 
      members: userId,
      isActive: true 
    }).select('_id').lean();

    const groupIds = userGroups.map(group => group._id);

    const assignedTasksFilter = {
      $or: [
        { assignedUsers: userId },
        { assignedGroups: { $in: groupIds } }
      ],
      isActive: true,
      createdAt: { $gte: startDate }
    };

    // Get task completion trend
    const completionTrend = await Task.aggregate([
      {
        $match: {
          ...assignedTasksFilter,
          'statusByUser': {
            $elemMatch: {
              user: userId,
              status: 'completed'
            }
          }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: "%Y-%m-%d",
              date: "$createdAt"
            }
          },
          completed: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Get tasks by priority
    const tasksByPriority = await Task.aggregate([
      {
        $match: assignedTasksFilter
      },
      {
        $group: {
          _id: "$priority",
          count: { $sum: 1 }
        }
      }
    ]);

    // Get tasks by status
    const tasksByStatus = await Task.aggregate([
      {
        $match: assignedTasksFilter
      },
      {
        $unwind: "$statusByUser"
      },
      {
        $match: {
          "statusByUser.user": userId
        }
      },
      {
        $group: {
          _id: "$statusByUser.status",
          count: { $sum: 1 }
        }
      }
    ]);

    res.json({
      success: true,
      statistics: {
        period,
        startDate,
        completionTrend,
        tasksByPriority,
        tasksByStatus
      }
    });

  } catch (error) {
    console.error('❌ Error in getUserTaskStatistics:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// 🔹 Get user-wise monthly task statistics
exports.getUserMonthlyStatistics = async (req, res) => {
  try {
    const { month, year } = req.query;
    
    // Default to current month if not provided
    const currentDate = new Date();
    const targetMonth = parseInt(month) || currentDate.getMonth() + 1;
    const targetYear = parseInt(year) || currentDate.getFullYear();

    // Calculate date range for the month
    const startDate = new Date(targetYear, targetMonth - 1, 1);
    const endDate = new Date(targetYear, targetMonth, 0, 23, 59, 59);

    console.log(`📅 Fetching statistics for ${targetMonth}-${targetYear}`);
    console.log(`📆 Date range: ${startDate} to ${endDate}`);

    // Get all active users
    const users = await User.find({ isActive: true })
      .select('name role email employeeType department')
      .lean();

    // Get all tasks for the month
    const monthlyTasks = await Task.find({
      createdAt: { $gte: startDate, $lte: endDate },
      isActive: true
    })
    .populate('assignedUsers', 'name')
    .populate('createdBy', 'name')
    .populate('assignedGroups', 'members')
    .lean();

    console.log(`👥 Total users: ${users.length}`);
    console.log(`📋 Total tasks in month: ${monthlyTasks.length}`);

    // Process statistics for each user
    const userStatistics = await Promise.all(
      users.map(async (user) => {
        const userId = user._id.toString();

        // Get user's groups for group-assigned tasks
        const userGroups = await Group.find({ 
          members: userId,
          isActive: true 
        }).select('_id').lean();
        
        const userGroupIds = userGroups.map(group => group._id.toString());

        // Filter tasks relevant to this user
        const userTasks = monthlyTasks.filter(task => {
          const isAssignedDirectly = task.assignedUsers?.some(assignedUser => 
            assignedUser._id.toString() === userId
          );
          
          const isAssignedViaGroup = task.assignedGroups?.some(group => 
            userGroupIds.includes(group._id.toString())
          );
          
          const isCreator = task.createdBy?._id.toString() === userId;

          return isAssignedDirectly || isAssignedViaGroup || isCreator;
        });

        // Calculate counts
        let assignedTasks = 0;
        let createdTasks = 0;
        let completedTasks = 0;
        let pendingTasks = 0;
        let inProgressTasks = 0;
        let overdueTasks = 0;

        userTasks.forEach(task => {
          // Check if user is creator
          if (task.createdBy?._id.toString() === userId) {
            createdTasks++;
          }

          // Check if user is assigned (directly or via group)
          const isAssignedDirectly = task.assignedUsers?.some(assignedUser => 
            assignedUser._id.toString() === userId
          );
          
          const isAssignedViaGroup = task.assignedGroups?.some(group => 
            userGroupIds.includes(group._id.toString())
          );

          if (isAssignedDirectly || isAssignedViaGroup) {
            assignedTasks++;

            // Get user's status from statusByUser array
            const userStatus = task.statusByUser?.find(status => 
              status.user && status.user.toString() === userId
            );

            const status = userStatus?.status || 'pending';

            // Count by status
            switch (status) {
              case 'completed':
                completedTasks++;
                break;
              case 'in-progress':
                inProgressTasks++;
                break;
              case 'pending':
                pendingTasks++;
                break;
            }

            // Check if overdue
            if (task.dueDateTime && new Date(task.dueDateTime) < new Date() && 
                status !== 'completed') {
              overdueTasks++;
            }
          }
        });

        const completionRate = assignedTasks > 0 
          ? Math.round((completedTasks / assignedTasks) * 100) 
          : 0;

        return {
          user: {
            _id: user._id,
            name: user.name,
            role: user.role,
            email: user.email,
            employeeType: user.employeeType,
            department: user.department
          },
          statistics: {
            assignedTasks,
            createdTasks,
            completedTasks,
            pendingTasks,
            inProgressTasks,
            overdueTasks,
            completionRate,
            totalTasks: assignedTasks + createdTasks
          }
        };
      })
    );

    // Sort by total tasks (descending)
    userStatistics.sort((a, b) => b.statistics.totalTasks - a.statistics.totalTasks);

    // Calculate overall statistics
    const overallStats = {
      totalUsers: users.length,
      totalTasks: monthlyTasks.length,
      totalAssigned: userStatistics.reduce((sum, stat) => sum + stat.statistics.assignedTasks, 0),
      totalCreated: userStatistics.reduce((sum, stat) => sum + stat.statistics.createdTasks, 0),
      totalCompleted: userStatistics.reduce((sum, stat) => sum + stat.statistics.completedTasks, 0),
      totalPending: userStatistics.reduce((sum, stat) => sum + stat.statistics.pendingTasks, 0),
      overallCompletionRate: Math.round(
        (userStatistics.reduce((sum, stat) => sum + stat.statistics.completedTasks, 0) / 
         userStatistics.reduce((sum, stat) => sum + stat.statistics.assignedTasks, 1)) * 100
      )
    };

    res.json({
      success: true,
      period: {
        month: targetMonth,
        year: targetYear,
        monthName: startDate.toLocaleString('default', { month: 'long' }),
        startDate,
        endDate
      },
      overallStats,
      userStatistics,
      summary: {
        topPerformers: userStatistics
          .filter(stat => stat.statistics.assignedTasks > 0)
          .sort((a, b) => b.statistics.completionRate - a.statistics.completionRate)
          .slice(0, 5),
        mostActive: userStatistics.slice(0, 5),
        needAttention: userStatistics
          .filter(stat => stat.statistics.overdueTasks > 0)
          .sort((a, b) => b.statistics.overdueTasks - a.statistics.overdueTasks)
          .slice(0, 5)
      }
    });

  } catch (error) {
    console.error('❌ Error in getUserMonthlyStatistics:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error',
      details: error.message 
    });
  }
};

// 🔹 Get user-specific monthly detail report
exports.getUserMonthlyDetail = async (req, res) => {
  try {
    const { userId } = req.params;
    const { month, year } = req.query;

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    // Default to current month if not provided
    const currentDate = new Date();
    const targetMonth = parseInt(month) || currentDate.getMonth() + 1;
    const targetYear = parseInt(year) || currentDate.getFullYear();

    const startDate = new Date(targetYear, targetMonth - 1, 1);
    const endDate = new Date(targetYear, targetMonth, 0, 23, 59, 59);

    // Get user details
    const user = await User.findById(userId)
      .select('name role email employeeType department')
      .lean();

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get user's groups
    const userGroups = await Group.find({ 
      members: userId,
      isActive: true 
    }).select('_id').lean();

    const userGroupIds = userGroups.map(group => group._id.toString());

    // Get all tasks for the user in this month
    const tasks = await Task.find({
      $or: [
        { assignedUsers: userId },
        { assignedGroups: { $in: userGroupIds } },
        { createdBy: userId }
      ],
      createdAt: { $gte: startDate, $lte: endDate },
      isActive: true
    })
    .populate('assignedUsers', 'name email')
    .populate('assignedGroups', 'name description')
    .populate('createdBy', 'name email')
    .sort({ createdAt: -1 })
    .lean();

    // Categorize tasks
    const assignedTasks = tasks.filter(task => 
      task.assignedUsers?.some(u => u._id.toString() === userId) ||
      task.assignedGroups?.some(g => userGroupIds.includes(g._id.toString()))
    );

    const createdTasks = tasks.filter(task => 
      task.createdBy?._id.toString() === userId
    );

    // Status breakdown for assigned tasks
    const completedTasks = assignedTasks.filter(task => {
      const userStatus = task.statusByUser?.find(status => 
        status.user && status.user.toString() === userId
      );
      return userStatus?.status === 'completed';
    });

    const pendingTasks = assignedTasks.filter(task => {
      const userStatus = task.statusByUser?.find(status => 
        status.user && status.user.toString() === userId
      );
      return userStatus?.status === 'pending';
    });

    const inProgressTasks = assignedTasks.filter(task => {
      const userStatus = task.statusByUser?.find(status => 
        status.user && status.user.toString() === userId
      );
      return userStatus?.status === 'in-progress';
    });

    const overdueTasks = assignedTasks.filter(task => 
      task.dueDateTime && 
      new Date(task.dueDateTime) < new Date() &&
      !completedTasks.some(t => t._id.toString() === task._id.toString())
    );

    // Daily activity breakdown
    const dailyActivity = [];
    for (let day = 1; day <= endDate.getDate(); day++) {
      const currentDate = new Date(targetYear, targetMonth - 1, day);
      const nextDate = new Date(targetYear, targetMonth - 1, day + 1);
      
      const dayTasks = tasks.filter(task => 
        task.createdAt >= currentDate && task.createdAt < nextDate
      );

      const dayCompleted = assignedTasks.filter(task => {
        const userStatus = task.statusByUser?.find(status => 
          status.user && status.user.toString() === userId
        );
        return userStatus?.status === 'completed' && 
               userStatus.updatedAt >= currentDate && 
               userStatus.updatedAt < nextDate;
      });

      dailyActivity.push({
        date: currentDate.toISOString().split('T')[0],
        day: day,
        tasksCreated: dayTasks.filter(t => t.createdBy._id.toString() === userId).length,
        tasksCompleted: dayCompleted.length,
        totalActivity: dayTasks.length + dayCompleted.length
      });
    }

    res.json({
      success: true,
      user,
      period: {
        month: targetMonth,
        year: targetYear,
        monthName: startDate.toLocaleString('default', { month: 'long' }),
        startDate,
        endDate
      },
      summary: {
        assignedTasks: assignedTasks.length,
        createdTasks: createdTasks.length,
        completedTasks: completedTasks.length,
        pendingTasks: pendingTasks.length,
        inProgressTasks: inProgressTasks.length,
        overdueTasks: overdueTasks.length,
        completionRate: assignedTasks.length > 0 
          ? Math.round((completedTasks.length / assignedTasks.length) * 100) 
          : 0,
        productivityScore: Math.round(
          (completedTasks.length + (inProgressTasks.length * 0.5)) / 
          Math.max(assignedTasks.length, 1) * 100
        )
      },
      dailyActivity,
      tasks: {
        assigned: assignedTasks,
        created: createdTasks
      }
    });

  } catch (error) {
    console.error('❌ Error in getUserMonthlyDetail:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  }
};
