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

// 🔹 Helper to group tasks by date (latest first) with serial numbers - OPTIMIZED
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

// ==================== NEW ROUTES ====================

// ✅ CREATE TASK FOR SELF (Khud ke liye task create kare) - ONLY IN MY TASKS
exports.createTaskForSelf = async (req, res) => {
  try {
    const {
      title,
      description,
      dueDateTime,
      whatsappNumber,
      priorityDays,
      priority
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

    // Validate due date is not in the past
    if (dueDateTime) {
      const dueDate = new Date(dueDateTime);
      if (dueDate < new Date()) {
        return res.status(400).json({ error: 'Due date cannot be in the past' });
      }
    }

    // 🔹 CRITICAL: For self-task, assign ONLY to current user
    const finalAssignedUsers = [req.user._id.toString()];
    const finalAssignedGroups = [];

    // Create status tracking ONLY for self
    const statusByUser = [{
      user: req.user._id,
      status: "pending",
    }];

    // Create the task
    const task = await Task.create({
      title,
      description,
      dueDateTime: dueDateTime ? new Date(dueDateTime) : null,
      whatsappNumber,
      priorityDays,
      priority: priority || "medium",
      assignedUsers: finalAssignedUsers, // ONLY SELF
      assignedGroups: finalAssignedGroups,
      statusByUser, // ONLY SELF STATUS
      files,
      voiceNote,
      createdBy: req.user._id,
      isRecurring: false,
      taskFor: 'self', // 🔹 ADDED: Identify as self task
      statusHistory: [{
        status: 'pending',
        changedBy: req.user._id,
        remarks: 'Task created for self'
      }]
    });

    // Populate task data
    await task.populate("assignedUsers", "name role email");
    await task.populate("createdBy", "name email");

    // Create notification for self
    await createNotification(
      req.user._id,
      'Self Task Created',
      `You created a task for yourself: ${title}`,
      'task_created',
      task._id,
      { priority, dueDateTime, selfAssigned: true }
    );

    // Create activity log
    await createActivityLog(
      req.user,
      'self_task_created',
      task._id,
      `Created self task: ${title}`,
      null,
      { title, description, priority },
      req
    );

    res.status(201).json({ 
      success: true, 
      task,
      message: 'Self task created successfully'
    });
  } catch (error) {
    console.error("❌ Error creating self task:", error);
    res.status(500).json({ error: error.message || "Internal Server Error" });
  }
};

// ✅ CREATE TASK FOR OTHERS (Dusre users ko assign kare) - ONLY IN ASSIGNED TASKS
exports.createTaskForOthers = async (req, res) => {
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

    // Check if user has permission to assign to others
    const isPrivileged = ['admin', 'manager', 'hr', 'SuperAdmin'].includes(req.user.role);
    if (!isPrivileged) {
      return res.status(403).json({ error: 'Access denied. Only admins/managers can assign tasks to others.' });
    }

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

    // Safe JSON parsing with null handling
    const parsedUsers = assignedUsers && assignedUsers !== 'null' ? JSON.parse(assignedUsers) : [];
    const parsedGroups = assignedGroups && assignedGroups !== 'null' ? JSON.parse(assignedGroups) : [];

    // 🔹 CRITICAL: Validate that creator is NOT in assigned users
    if (parsedUsers.includes(req.user._id.toString())) {
      return res.status(400).json({ error: 'You cannot assign task to yourself in "Create for Others". Use "Create for Self" instead.' });
    }

    // Validate that at least one user or group is assigned
    if (parsedUsers.length === 0 && parsedGroups.length === 0) {
      return res.status(400).json({ error: 'At least one user or group must be assigned' });
    }

    // Validate due date is not in the past
    if (dueDateTime) {
      const dueDate = new Date(dueDateTime);
      if (dueDate < new Date()) {
        return res.status(400).json({ error: 'Due date cannot be in the past' });
      }
    }

    // Validate groups for privileged users
    if (parsedGroups.length > 0) {
      const groups = await Group.find({
        _id: { $in: parsedGroups },
        createdBy: req.user._id,
        isActive: true,
      }).lean();

      if (groups.length !== parsedGroups.length) {
        return res.status(400).json({
          error: "Some groups are invalid or you do not have permission",
        });
      }
    }

    // Collect all assigned users (direct + group members)
    const allAssignedUsers = [...new Set([...parsedUsers])];

    if (parsedGroups.length > 0) {
      const groupsWithMembers = await Group.find({
        _id: { $in: parsedGroups },
      }).populate("members", "_id name email").lean();

      groupsWithMembers.forEach((group) => {
        group.members.forEach((member) => {
          allAssignedUsers.push(member._id.toString());
        });
      });
    }

    // Remove duplicates and ensure creator is NOT included
    const uniqueAssignedUsers = [...new Set(allAssignedUsers)].filter(userId => 
      userId !== req.user._id.toString()
    );

    // Create status tracking ONLY for assigned users (not creator)
    const statusByUser = uniqueAssignedUsers.map((uid) => ({
      user: uid,
      status: "pending",
    }));

    // Create the task
    const task = await Task.create({
      title,
      description,
      dueDateTime: dueDateTime ? new Date(dueDateTime) : null,
      whatsappNumber,
      priorityDays,
      priority: priority || "medium",
      assignedUsers: parsedUsers, // ONLY OTHER USERS (not self)
      assignedGroups: parsedGroups,
      statusByUser, // ONLY FOR ASSIGNED USERS (not creator)
      files,
      voiceNote,
      createdBy: req.user._id,
      isRecurring: false,
      taskFor: 'others', // 🔹 ADDED: Identify as others task
      statusHistory: [{
        status: 'pending',
        changedBy: req.user._id,
        remarks: 'Task created and assigned to others'
      }]
    });

    // Populate task data for email
    await task.populate("assignedUsers", "name role email");
    await task.populate("assignedGroups", "name description");
    await task.populate("createdBy", "name email");

    // Create notifications for all assigned users (not creator)
    for (const userId of uniqueAssignedUsers) {
      await createNotification(
        userId,
        'New Task Assigned',
        `You have been assigned a new task: ${title}`,
        'task_assigned',
        task._id,
        { priority, dueDateTime, assignedBy: req.user.name }
      );
    }

    // Create activity log
    await createActivityLog(
      req.user,
      'task_created_for_others',
      task._id,
      `Created task for others: ${title}`,
      null,
      { 
        title, 
        description, 
        priority, 
        assignedUsers: uniqueAssignedUsers,
        assignedGroups: parsedGroups 
      },
      req
    );

    // Send email notifications to all assigned users (not creator)
    if (task.assignedUsers && task.assignedUsers.length > 0) {
      await sendTaskCreationEmail(task, task.assignedUsers);
    }

    res.status(201).json({ 
      success: true, 
      task,
      message: 'Task created and assigned successfully to others'
    });
  } catch (error) {
    console.error("❌ Error creating task for others:", error);
    res.status(500).json({ error: error.message || "Internal Server Error" });
  }
};

// ==================== EXISTING ROUTES (SAME AS BEFORE) ====================

// 🔹 Get assigned tasks for logged-in user
// 🔹 Get only tasks created by logged-in user (e.g., admin) - WITH PAGINATION - FIXED
exports.getAssignedTasks = async (req, res) => {
  try {
    const { page = 1, limit = 20, search, status } = req.query;

    // 🔹 CRITICAL FIX: Only show tasks created for others by current user
    const filter = { 
      createdBy: req.user._id,
      taskFor: 'others' // 🔹 ONLY SHOW TASKS CREATED FOR OTHERS
    };

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

// 🔹 Get all tasks: created by or assigned to logged-in user - WITH PAGINATION
// 🔹 Get all tasks: created by or assigned to logged-in user - WITH PAGINATION - UPDATED
exports.getTasks = async (req, res) => {
  const { status, page = 1, limit = 20, search } = req.query;
  
  try {
    // Get user's groups to include group-assigned tasks
    const userGroups = await Group.find({ 
      members: req.user._id,
      isActive: true 
    }).select('_id').lean();

    const groupIds = userGroups.map(group => group._id);

    // 🔹 UPDATED: Better filtering for tasks
    const filter = {
      $or: [
        { assignedUsers: req.user._id }, // User is assigned
        { assignedGroups: { $in: groupIds } }, // User is in assigned group
        { 
          createdBy: req.user._id,
          taskFor: 'self' // 🔹 User created task for self
        }
      ]
    };

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

    // 🔹 UPDATED: Show tasks where user is assigned OR created self tasks
    const filter = {
      $or: [
        { assignedUsers: req.user._id }, // User is directly assigned
        { assignedGroups: { $in: groupIds } }, // User is in assigned group
        { 
          createdBy: req.user._id,
          taskFor: 'self' // 🔹 User created task for self
        }
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

    // 🔹 CRITICAL FIX: Only show tasks created for others by current user
    const filter = { 
      createdBy: req.user._id,
      taskFor: 'others' // 🔹 ONLY SHOW TASKS CREATED FOR OTHERS
    };

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

// 🔄 Update status of task - NO RECURRING TASK SUPPORT
exports.updateStatus = async (req, res) => {
  try {
    const { taskId } = req.params;
    const { status, remarks } = req.body;

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


// 🔹 Get user task counts (Assigned, Created, Completed, Pending)
exports.getUserTaskCounts = async (req, res) => {
  try {
    if (!['admin', 'manager', 'hr', 'SuperAdmin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const users = await User.find().select('name email role _id').lean();
    
    const userStats = [];
    
    for (const user of users) {
      // User ke groups find karo
      const userGroups = await Group.find({ 
        members: user._id,
        isActive: true 
      }).select('_id').lean();

      const groupIds = userGroups.map(group => group._id);

      // Total tasks filter
      const totalFilter = {
        $or: [
          { assignedUsers: user._id },
          { assignedGroups: { $in: groupIds } }
        ],
        isActive: true
      };

      // Today's tasks filter
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      
      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);

      const todayFilter = {
        ...totalFilter,
        createdAt: {
          $gte: todayStart,
          $lte: todayEnd
        }
      };

      const totalTasks = await Task.countDocuments(totalFilter);
      const todayTasks = await Task.countDocuments(todayFilter);

      // Status-wise count
      const userTasks = await Task.find(totalFilter).lean();
      
      let pending = 0;
      let inProgress = 0;
      let completed = 0;

      userTasks.forEach(task => {
        const userStatus = task.statusByUser.find(status => 
          status.user && status.user.toString() === user._id.toString()
        );
        
        const status = userStatus ? userStatus.status : 'pending';
        
        if (status === 'completed') completed++;
        else if (status === 'in-progress') inProgress++;
        else pending++;
      });

      userStats.push({
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          role: user.role
        },
        tasks: {
          total: totalTasks,
          today: todayTasks,
          pending,
          inProgress,
          completed
        }
      });
    }

    res.json({
      success: true,
      data: userStats
    });

  } catch (error) {
    console.error('❌ Error fetching all users task stats:', error);
    res.status(500).json({ error: 'Failed to fetch users task stats' });
  }
};

// Controller mein yeh add karo
exports.getSingleUserTaskStats = async (req, res) => {
  try {
    const { userId } = req.params;

    // Check if user is accessing own data or is admin
    if (userId !== req.user._id.toString() && 
        !['admin', 'manager', 'hr', 'SuperAdmin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const user = await User.findById(userId).select('name email role').lean();
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // User ke groups find karo
    const userGroups = await Group.find({ 
      members: userId,
      isActive: true 
    }).select('_id').lean();

    const groupIds = userGroups.map(group => group._id);

    // Total tasks filter
    const totalFilter = {
      $or: [
        { assignedUsers: userId },
        { assignedGroups: { $in: groupIds } }
      ],
      isActive: true
    };

    // Today's tasks filter
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const todayFilter = {
      ...totalFilter,
      createdAt: {
        $gte: todayStart,
        $lte: todayEnd
      }
    };

    // Counts nikal lo
    const [totalTasks, todayTasks, userTasks] = await Promise.all([
      Task.countDocuments(totalFilter),
      Task.countDocuments(todayFilter),
      Task.find(totalFilter).lean()
    ]);

    // Status-wise count
    let pending = 0;
    let inProgress = 0;
    let completed = 0;

    userTasks.forEach(task => {
      const userStatus = task.statusByUser.find(status => 
        status.user && status.user.toString() === userId
      );
      
      const status = userStatus ? userStatus.status : 'pending';
      
      if (status === 'completed') completed++;
      else if (status === 'in-progress') inProgress++;
      else pending++;
    });

    res.json({
      success: true,
      data: {
        user: {
          _id: userId,
          name: user.name,
          email: user.email,
          role: user.role
        },
        tasks: {
          total: totalTasks,
          today: todayTasks,
          pending,
          inProgress, 
          completed
        }
      }
    });

  } catch (error) {
    console.error('❌ Error fetching single user task stats:', error);
    res.status(500).json({ error: 'Failed to fetch user task stats' });
  }
};

// ✅ NEW: Get current user's stats
exports.getMyStats = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('name email role').lean();
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // User ke groups find karo
    const userGroups = await Group.find({ 
      members: req.user._id,
      isActive: true 
    }).select('_id').lean();

    const groupIds = userGroups.map(group => group._id);

    // Total tasks filter
    const totalFilter = {
      $or: [
        { assignedUsers: req.user._id },
        { assignedGroups: { $in: groupIds } }
      ],
      isActive: true
    };

    // Today's tasks filter
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const todayFilter = {
      ...totalFilter,
      createdAt: {
        $gte: todayStart,
        $lte: todayEnd
      }
    };

    // Counts nikal lo
    const [totalTasks, todayTasks, userTasks] = await Promise.all([
      Task.countDocuments(totalFilter),
      Task.countDocuments(todayFilter),
      Task.find(totalFilter).lean()
    ]);

    // Status-wise count
    let pending = 0;
    let inProgress = 0;
    let completed = 0;

    userTasks.forEach(task => {
      const userStatus = task.statusByUser.find(status => 
        status.user && status.user.toString() === req.user._id.toString()
      );
      
      const status = userStatus ? userStatus.status : 'pending';
      
      if (status === 'completed') completed++;
      else if (status === 'in-progress') inProgress++;
      else pending++;
    });

    res.json({
      success: true,
      data: {
        user: {
          _id: req.user._id,
          name: user.name,
          email: user.email,
          role: user.role
        },
        tasks: {
          total: totalTasks,
          today: todayTasks,
          pending,
          inProgress, 
          completed
        }
      }
    });

  } catch (error) {
    console.error('❌ Error fetching my task stats:', error);
    res.status(500).json({ error: 'Failed to fetch my task stats' });
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

    // 🔹 UPDATED: Only show self tasks
    const tasks = await Task.find({
      createdBy: userId,
      assignedUsers: userId,
      taskFor: 'self' // 🔹 ONLY SELF TASKS
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
// 🔹 Get assigned tasks for logged-in user - UPDATED
exports.getAssignedTasksWithStatus = async (req, res) => {
  try {
    if (!['admin', 'manager', 'hr', 'SuperAdmin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // 🔹 UPDATED: Only show tasks created for others
    const tasks = await Task.find({ 
      createdBy: req.user._id,
      taskFor: 'others' // 🔹 ONLY OTHERS TASKS
    })
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
