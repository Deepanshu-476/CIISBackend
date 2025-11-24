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

// 🔹 Helper to group tasks by date (latest first) with serial numbers
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

// 🔹 Enrich tasks with name/role for status info
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

    // Response
res.status(201).json({
  success: true,
  task: {
    ...task.toObject(),
    taskFor: task.taskFor || 'self',  // Ensure taskFor is always included in the response
  },
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
  task: {
    ...task.toObject(),
    taskFor: task.taskFor || 'others',  // Ensure taskFor is always included in the response
  },
  message: 'Self task created successfully'
});


  } catch (error) {
    console.error("❌ Error creating task for others:", error);
    res.status(500).json({ error: error.message || "Internal Server Error" });
  }
};


// 🔹 Get all tasks: created by or assigned to logged-in user
exports.getTasks = async (req, res) => {
  const { status, search } = req.query;
  
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

    const tasks = await Task.find(filter)
      .populate('assignedUsers', 'name email')
      .populate('assignedGroups', 'name description')
      .populate('createdBy', 'name email')
      .sort({ dueDateTime: 1, createdAt: -1 })
      .lean();

    const enriched = await enrichStatusInfo(tasks);
    const grouped = groupTasksByDate(enriched, 'createdAt', 'serialNo');
    
    res.json({ 
      groupedTasks: grouped
    });
  } catch (error) {
    console.error('❌ Error fetching tasks:', error);
    res.status(500).json({ error: 'Failed to get tasks' });
  }
};

// 🔹 Get only tasks assigned to logged-in user (including group assignments)
exports.getMyTasks = async (req, res) => {
  try {
    const { search, status } = req.query;

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

    const tasks = await Task.find(filter)
      .populate('assignedUsers', 'name email')
      .populate('assignedGroups', 'name description')
      .populate('createdBy', 'name email')
      .sort({ dueDateTime: 1, createdAt: -1 })
      .lean();

    const enriched = await enrichStatusInfo(tasks);
    const grouped = groupTasksByDate(enriched, 'createdAt', 'mySerialNo');
    
    res.json({ 
      groupedTasks: grouped
    });
  } catch (error) {
    console.error('❌ Error fetching my tasks:', error);
    res.status(500).json({ error: 'Failed to get your tasks' });
  }
};

// 🔹 Get only tasks created by logged-in user (e.g., admin)
exports.getAssignedTasks = async (req, res) => {
  try {
    const { search, status } = req.query;

    // 🔹 CRITICAL FIX: Only show tasks created for others by current user
    const filter = { 
      createdBy: req.user._id,
      
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

    const tasks = await Task.find(filter)
      .populate('assignedUsers', 'name role email')
      .populate('assignedGroups', 'name description')
      .populate('createdBy', 'name email')
      .sort({ dueDateTime: 1, createdAt: -1 })
      .lean();

    const enriched = await enrichStatusInfo(tasks);
    const grouped = groupTasksByDate(enriched, 'createdAt', 'assignedSerialNo');
    
    res.json({ 
      groupedTasks: grouped
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
      // Check if all assigned users have completed
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
    } else if (status === 'in-progress') {
      task.overallStatus = 'in-progress';
    } else {
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

// 🔹 Get user notifications
exports.getNotifications = async (req, res) => {
  try {
    const { unreadOnly = false } = req.query;

    const filter = { user: req.user._id };
    if (unreadOnly === 'true') {
      filter.isRead = false;
    }

    const notifications = await Notification.find(filter)
      .populate('title')
      .sort({ createdAt: -1 })
      .lean();

    const unreadCount = await Notification.countDocuments({ 
      user: req.user._id, 
      isRead: false 
    });

    res.json({
      success: true,
      notifications,
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

// 🔹 Get activity logs for a task
exports.getTaskActivityLogs = async (req, res) => {
  try {
    const { taskId } = req.params;

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

    const logs = await ActivityLog.find({ task: taskId })
      .populate('user', 'name role email')
      .sort({ createdAt: -1 })
      .lean();

    res.json({
      success: true,
      logs
    });

  } catch (error) {
    console.error('❌ Error fetching activity logs:', error);
    res.status(500).json({ error: 'Failed to fetch activity logs' });
  }
};

// 🔹 Get user activity timeline
exports.getUserActivityTimeline = async (req, res) => {
  try {
    const { userId } = req.params;

    // Check if user is authorized (own timeline or admin/manager/hr)
    const isAuthorized = userId === req.user._id.toString() || 
                        ['admin', 'manager', 'hr', 'SuperAdmin'].includes(req.user.role);

    if (!isAuthorized) {
      return res.status(403).json({ error: 'Not authorized to view this activity timeline' });
    }

    const logs = await ActivityLog.find({ user: userId })
      .populate('task', 'title')
      .populate('user', 'name role email')
      .sort({ createdAt: -1 })
      .lean();

    res.json({
      success: true,
      logs
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

// 🔹 Get user's all tasks status counts (complete breakdown)
// 🔹 Get user's task status counts with time filters
exports.getTaskStatusCounts = async (req, res) => {
  try {
    const { period = 'today' } = req.query; // today, week, month

    // Get user's groups for group-assigned tasks
    const userGroups = await Group.find({ 
      members: req.user._id,
      isActive: true 
    }).select('_id').lean();

    const groupIds = userGroups.map(group => group._id);

    // Date range calculation based on period
    let startDate, endDate;
    const now = new Date();
    
    switch (period) {
      case 'today':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        break;
      case 'week':
        const dayOfWeek = now.getDay();
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek);
        endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (6 - dayOfWeek) + 1);
        break;
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        break;
      default:
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    }

    // Base filter for all tasks where user is involved
    const baseFilter = {
      $or: [
        { assignedUsers: req.user._id }, // Directly assigned
        { assignedGroups: { $in: groupIds } }, // In assigned group
        { 
          createdBy: req.user._id,
          taskFor: 'self' // Self-created tasks
        }
      ],
      isActive: true,
      createdAt: {
        $gte: startDate,
        $lt: endDate
      }
    };

    // Get counts for all statuses
    const [
      total, 
      pending, 
      inProgress, 
      completed, 
      approved,
      rejected,
      onHold,
      reopen,
      cancelled,
      overdue
    ] = await Promise.all([
      // Total tasks
      Task.countDocuments(baseFilter),
      
      // Pending tasks
      Task.countDocuments({
        ...baseFilter,
        'statusByUser.status': 'pending',
        'statusByUser.user': req.user._id
      }),
      
      // In Progress tasks - FIXED: baseFilter (not baseBuffer)
      Task.countDocuments({
        ...baseFilter, // ✅ FIXED TYPO
        'statusByUser.status': 'in-progress', 
        'statusByUser.user': req.user._id
      }),
      
      // Completed tasks
      Task.countDocuments({
        ...baseFilter,
        'statusByUser.status': 'completed',
        'statusByUser.user': req.user._id
      }),

      // Approved tasks
      Task.countDocuments({
        ...baseFilter,
        'statusByUser.status': 'approved',
        'statusByUser.user': req.user._id
      }),

      // Rejected tasks
      Task.countDocuments({
        ...baseFilter,
        'statusByUser.status': 'rejected',
        'statusByUser.user': req.user._id
      }),

      // On Hold tasks
      Task.countDocuments({
        ...baseFilter,
        'statusByUser.status': 'on-hold',
        'statusByUser.user': req.user._id
      }),

      // Reopen tasks
      Task.countDocuments({
        ...baseFilter,
        'statusByUser.status': 'reopen',
        'statusByUser.user': req.user._id
      }),

      // Cancelled tasks
      Task.countDocuments({
        ...baseFilter,
        'statusByUser.status': 'cancelled',
        'statusByUser.user': req.user._id
      }),
      
      // Overdue tasks (pending/in-progress + past due date)
      Task.countDocuments({
        ...baseFilter,
        'statusByUser.status': { $in: ['pending', 'in-progress'] },
        'statusByUser.user': req.user._id,
        dueDateTime: { $lt: new Date() } // Past due date
      })
    ]);

    // Calculate percentages
    const calculatePercentage = (count) => total > 0 ? Math.round((count / total) * 100) : 0;

    res.json({
      success: true,
      period,
      dateRange: {
        start: startDate,
        end: endDate
      },
      statusCounts: {
        total,
        pending: {
          count: pending,
          percentage: calculatePercentage(pending)
        },
        inProgress: {
          count: inProgress, 
          percentage: calculatePercentage(inProgress)
        },
        completed: {
          count: completed,
          percentage: calculatePercentage(completed)
        },
        approved: {
          count: approved,
          percentage: calculatePercentage(approved)
        },
        rejected: {
          count: rejected,
          percentage: calculatePercentage(rejected)
        },
        onHold: {
          count: onHold,
          percentage: calculatePercentage(onHold)
        },
        reopen: {
          count: reopen,
          percentage: calculatePercentage(reopen)
        },
        cancelled: {
          count: cancelled,
          percentage: calculatePercentage(cancelled)
        },
        overdue: {
          count: overdue,
          percentage: calculatePercentage(overdue)
        }
      },
      message: `Task status counts for ${period}`
    });

  } catch (error) {
    console.error('❌ Error fetching task status counts:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to get task status counts',
      details: error.message 
    });
  }
};

// 👤 SPECIFIC USER DETAILED ANALYTICS - Kisi specific user ka complete data
exports.getUserDetailedAnalytics = async (req, res) => {
  try {
    if (!['admin', 'manager', 'hr', 'SuperAdmin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
    }

    const { userId } = req.params;
    const { startDate, endDate, period = 'all' } = req.query;

    // Get user details
    const user = await User.findById(userId)
      .select('name email role department employeeType joiningDate')
      .lean();

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Date range setup
    let dateFilter = {};
    if (startDate && endDate) {
      dateFilter.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    } else {
      // Auto date range based on period
      const now = new Date();
      switch (period) {
        case 'today':
          dateFilter.createdAt = {
            $gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
            $lte: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
          };
          break;
        case 'week':
          const weekStart = new Date(now);
          weekStart.setDate(now.getDate() - now.getDay());
          dateFilter.createdAt = {
            $gte: weekStart,
            $lte: now
          };
          break;
        case 'month':
          dateFilter.createdAt = {
            $gte: new Date(now.getFullYear(), now.getMonth(), 1),
            $lte: now
          };
          break;
        // 'all' - no date filter
      }
    }

    // Get user's groups for group tasks
    const userGroups = await Group.find({ 
      members: userId,
      isActive: true 
    }).select('_id').lean();
    const groupIds = userGroups.map(group => group._id);

    // Base filter for tasks involving this user
    const baseFilter = {
      ...dateFilter,
      isActive: true,
      $or: [
        { assignedUsers: userId },           // Directly assigned
        { assignedGroups: { $in: groupIds } }, // In assigned group  
        { createdBy: userId }                // Created by this user
      ]
    };

    // Get all relevant tasks
    const tasks = await Task.find(baseFilter)
      .populate('assignedUsers', 'name role email')
      .populate('createdBy', 'name role email')
      .populate('assignedGroups', 'name description')
      .sort({ createdAt: -1 })
      .lean();

    // Comprehensive analysis
    const analysis = {
      userInfo: user,
      
      // Basic counts
      summary: {
        totalInvolved: tasks.length,
        assigned: tasks.filter(task => 
          task.assignedUsers?.some(u => u._id.toString() === userId)
        ).length,
        created: tasks.filter(task => 
          task.createdBy && task.createdBy._id.toString() === userId
        ).length,
        groupTasks: tasks.filter(task => 
          task.assignedGroups && task.assignedGroups.length > 0 &&
          !task.assignedUsers?.some(u => u._id.toString() === userId)
        ).length
      },

      // Status analysis for assigned tasks
      statusAnalysis: {
        pending: 0,
        'in-progress': 0,
        completed: 0,
        approved: 0,
        rejected: 0,
        overdue: 0
      },

      // Priority analysis
      priorityAnalysis: {
        high: 0,
        medium: 0, 
        low: 0
      },

      // Performance metrics
      performance: {
        completionRate: 0,
        avgCompletionTime: 0,
        efficiency: 0
      },

      // Timeline (last 30 days)
      timeline: {},
      
      // Recent activities
      recentTasks: tasks.slice(0, 10).map(task => ({
        _id: task._id,
        title: task.title,
        type: task.createdBy && task.createdBy._id.toString() === userId ? 
              'created' : 'assigned',
        status: task.statusByUser?.find(s => s.user && s.user.toString() === userId)?.status || 'pending',
        priority: task.priority,
        dueDate: task.dueDateTime,
        createdAt: task.createdAt
      }))
    };

    // Process each task for detailed analysis
    let totalCompletionTime = 0;
    let completedCount = 0;

    tasks.forEach(task => {
      const userStatus = task.statusByUser?.find(s => 
        s.user && s.user.toString() === userId
      );

      const status = userStatus?.status || 'pending';

      // Status counts
      if (analysis.statusAnalysis[status] !== undefined) {
        analysis.statusAnalysis[status]++;
      }

      // Priority counts  
      if (task.priority && analysis.priorityAnalysis[task.priority] !== undefined) {
        analysis.priorityAnalysis[task.priority]++;
      }

      // Overdue check
      if (task.dueDateTime && new Date(task.dueDateTime) < new Date() && 
          status !== 'completed') {
        analysis.statusAnalysis.overdue++;
      }

      // Completion time calculation
      if (status === 'completed' && userStatus?.updatedAt && task.createdAt) {
        const completionTime = new Date(userStatus.updatedAt) - new Date(task.createdAt);
        totalCompletionTime += completionTime;
        completedCount++;
      }

      // Timeline data (group by date)
      const dateKey = new Date(task.createdAt).toISOString().split('T')[0];
      if (!analysis.timeline[dateKey]) {
        analysis.timeline[dateKey] = {
          date: dateKey,
          tasks: 0,
          completed: 0
        };
      }
      analysis.timeline[dateKey].tasks++;
      if (status === 'completed') {
        analysis.timeline[dateKey].completed++;
      }
    });

    // Calculate performance metrics
    const totalAssigned = analysis.summary.assigned + analysis.summary.groupTasks;
    analysis.performance.completionRate = totalAssigned > 0 ?
      Math.round((analysis.statusAnalysis.completed / totalAssigned) * 100) : 0;
    
    analysis.performance.avgCompletionTime = completedCount > 0 ?
      Math.round(totalCompletionTime / (completedCount * 1000 * 60 * 60 * 24)) : 0; // in days

    analysis.performance.efficiency = totalAssigned > 0 ?
      Math.round(((analysis.statusAnalysis.completed + analysis.statusAnalysis['in-progress'] * 0.5) / totalAssigned) * 100) : 0;

    // Convert timeline to array
    analysis.timelineArray = Object.values(analysis.timeline)
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(-30); // Last 30 days

    res.json({
      success: true,
      userAnalytics: analysis,
      dateRange: {
        start: startDate || 'beginning',
        end: endDate || 'now',
        period
      }
    });

  } catch (error) {
    console.error('❌ Error in user detailed analytics:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch user analytics' 
    });
  }
};
// 📊 GET USER SPECIFIC TASK STATISTICS
exports.getUserTaskStats = async (req, res) => {
  try {
    const { userId } = req.params;
    const { period = 'today' } = req.query;

    if (!['admin', 'manager', 'hr', 'SuperAdmin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
    }

    // Get user's groups for group tasks
    const userGroups = await Group.find({ 
      members: userId,
      isActive: true 
    }).select('_id').lean();
    const groupIds = userGroups.map(group => group._id);

    // Date range calculation
    let dateFilter = {};
    const now = new Date();
    
    switch (period) {
      case 'today':
        dateFilter.createdAt = {
          $gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
          $lte: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
        };
        break;
      case 'week':
        const dayOfWeek = now.getDay();
        dateFilter.createdAt = {
          $gte: new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek),
          $lte: new Date(now.getFullYear(), now.getMonth(), now.getDate() + (6 - dayOfWeek) + 1)
        };
        break;
      case 'month':
        dateFilter.createdAt = {
          $gte: new Date(now.getFullYear(), now.getMonth(), 1),
          $lte: new Date(now.getFullYear(), now.getMonth() + 1, 1)
        };
        break;
      default:
        dateFilter.createdAt = {
          $gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
          $lte: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
        };
    }

    // Base filter for user tasks
    const baseFilter = {
      ...dateFilter,
      isActive: true,
      $or: [
        { assignedUsers: userId },
        { assignedGroups: { $in: groupIds } },
        { createdBy: userId }
      ]
    };

    // Get all tasks for this user
    const tasks = await Task.find(baseFilter)
      .populate('assignedUsers', 'name email')
      .populate('createdBy', 'name email')
      .lean();

    // Calculate statistics
    const statusCounts = {
      pending: 0,
      'in-progress': 0,
      completed: 0,
      approved: 0,
      rejected: 0,
      overdue: 0
    };

    tasks.forEach(task => {
      // Find user's status in this task
      const userStatus = task.statusByUser?.find(s => 
        s.user && s.user.toString() === userId
      );

      const status = userStatus?.status || 'pending';

      if (statusCounts[status] !== undefined) {
        statusCounts[status]++;
      }

      // Check overdue
      if (task.dueDateTime && new Date(task.dueDateTime) < new Date() && 
          status !== 'completed') {
        statusCounts.overdue++;
      }
    });

    const totalTasks = tasks.length;

    // Calculate percentages
    const calculatePercentage = (count) => 
      totalTasks > 0 ? Math.round((count / totalTasks) * 100) : 0;

    res.json({
      success: true,
      userId,
      period,
      statusCounts: {
        total: totalTasks,
        pending: {
          count: statusCounts.pending,
          percentage: calculatePercentage(statusCounts.pending)
        },
        inProgress: {
          count: statusCounts['in-progress'],
          percentage: calculatePercentage(statusCounts['in-progress'])
        },
        completed: {
          count: statusCounts.completed,
          percentage: calculatePercentage(statusCounts.completed)
        },
        approved: {
          count: statusCounts.approved,
          percentage: calculatePercentage(statusCounts.approved)
        },
        rejected: {
          count: statusCounts.rejected,
          percentage: calculatePercentage(statusCounts.rejected)
        },
        overdue: {
          count: statusCounts.overdue,
          percentage: calculatePercentage(statusCounts.overdue)
        }
      },
      tasksSummary: {
        assigned: tasks.filter(task => 
          task.assignedUsers?.some(u => u._id.toString() === userId)
        ).length,
        created: tasks.filter(task => 
          task.createdBy && task.createdBy._id.toString() === userId
        ).length,
        groupTasks: tasks.filter(task => 
          task.assignedGroups && task.assignedGroups.length > 0
        ).length
      }
    });

  } catch (error) {
    console.error('❌ Error in getUserTaskStats:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch user task statistics' 
    });
  }
};

// 👥 GET ALL USERS WITH THEIR TASK COUNTS
exports.getUsersWithTaskCounts = async (req, res) => {
  try {
    if (!['admin', 'manager', 'hr', 'SuperAdmin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
    }

    const { period = 'all', employeeType } = req.query;

    // Get all active users with filters
    const userFilter = { isActive: true };
    if (employeeType && employeeType !== 'all') {
      userFilter.employeeType = employeeType;
    }

    const users = await User.find(userFilter)
      .select('name email role employeeType department')
      .lean();

    // Date filter for tasks
    let dateFilter = {};
    if (period !== 'all') {
      const now = new Date();
      switch (period) {
        case 'today':
          dateFilter.createdAt = {
            $gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
            $lte: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
          };
          break;
        case 'week':
          const dayOfWeek = now.getDay();
          dateFilter.createdAt = {
            $gte: new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek),
            $lte: new Date(now.getFullYear(), now.getMonth(), now.getDate() + (6 - dayOfWeek) + 1)
          };
          break;
        case 'month':
          dateFilter.createdAt = {
            $gte: new Date(now.getFullYear(), now.getMonth(), 1),
            $lte: new Date(now.getFullYear(), now.getMonth() + 1, 1)
          };
          break;
      }
    }

    // Get users with their task counts
    const usersWithCounts = await Promise.all(
      users.map(async (user) => {
        const userGroups = await Group.find({ 
          members: user._id,
          isActive: true 
        }).select('_id').lean();
        
        const groupIds = userGroups.map(group => group._id);

        const taskFilter = {
          ...dateFilter,
          isActive: true,
          $or: [
            { assignedUsers: user._id },
            { assignedGroups: { $in: groupIds } },
            { createdBy: user._id }
          ]
        };

        const userTasks = await Task.find(taskFilter).lean();

        const statusCounts = {
          pending: 0,
          'in-progress': 0,
          completed: 0
        };

        userTasks.forEach(task => {
          const userStatus = task.statusByUser?.find(s => 
            s.user && s.user.toString() === user._id.toString()
          );
          const status = userStatus?.status || 'pending';
          if (statusCounts[status] !== undefined) {
            statusCounts[status]++;
          }
        });

        const totalTasks = userTasks.length;
        const completedCount = statusCounts.completed;
        const completionRate = totalTasks > 0 ? 
          Math.round((completedCount / totalTasks) * 100) : 0;

        return {
          ...user,
          taskStats: {
            total: totalTasks,
            pending: statusCounts.pending,
            inProgress: statusCounts['in-progress'],
            completed: completedCount,
            completionRate: completionRate
          }
        };
      })
    );

    res.json({
      success: true,
      period,
      employeeType: employeeType || 'all',
      users: usersWithCounts,
      summary: {
        totalUsers: usersWithCounts.length,
        totalTasks: usersWithCounts.reduce((sum, user) => sum + user.taskStats.total, 0),
        averageCompletionRate: Math.round(
          usersWithCounts.reduce((sum, user) => sum + user.taskStats.completionRate, 0) / 
          Math.max(usersWithCounts.length, 1)
        )
      }
    });

  } catch (error) {
    console.error('❌ Error in getUsersWithTaskCounts:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch users with task counts' 
    });
  }
};

// 📈 GET USER TASKS WITH FILTERS
exports.getUserTasks = async (req, res) => {
  try {
    const { userId } = req.params;
    const { status, search, period = 'all' } = req.query;

    if (!['admin', 'manager', 'hr', 'SuperAdmin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
    }

    // Get user's groups
    const userGroups = await Group.find({ 
      members: userId,
      isActive: true 
    }).select('_id').lean();
    const groupIds = userGroups.map(group => group._id);

    // Date filter
    let dateFilter = {};
    if (period !== 'all') {
      const now = new Date();
      switch (period) {
        case 'today':
          dateFilter.createdAt = {
            $gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
            $lte: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
          };
          break;
        case 'week':
          const dayOfWeek = now.getDay();
          dateFilter.createdAt = {
            $gte: new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek),
            $lte: new Date(now.getFullYear(), now.getMonth(), now.getDate() + (6 - dayOfWeek) + 1)
          };
          break;
        case 'month':
          dateFilter.createdAt = {
            $gte: new Date(now.getFullYear(), now.getMonth(), 1),
            $lte: new Date(now.getFullYear(), now.getMonth() + 1, 1)
          };
          break;
      }
    }

    // Build filter
    const filter = {
      ...dateFilter,
      isActive: true,
      $or: [
        { assignedUsers: userId },
        { assignedGroups: { $in: groupIds } },
        { createdBy: userId }
      ]
    };

    // Add status filter
    if (status && status !== 'all') {
      filter['statusByUser.status'] = status;
      filter['statusByUser.user'] = userId;
    }

    // Add search filter
    if (search) {
      filter.$or = [
        ...filter.$or,
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    const tasks = await Task.find(filter)
      .populate('assignedUsers', 'name email')
      .populate('createdBy', 'name email')
      .populate('assignedGroups', 'name description')
      .sort({ createdAt: -1 })
      .lean();

    // Enhance tasks with user-specific status
    const enhancedTasks = tasks.map(task => {
      const userStatus = task.statusByUser?.find(s => 
        s.user && s.user.toString() === userId
      );
      
      return {
        ...task,
        userStatus: userStatus?.status || 'pending',
        userStatusRemarks: userStatus?.remarks,
        userStatusUpdatedAt: userStatus?.updatedAt
      };
    });

    res.json({
      success: true,
      userId,
      filters: { status, search, period },
      tasks: enhancedTasks,
      total: enhancedTasks.length
    });

  } catch (error) {
    console.error('❌ Error in getUserTasks:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch user tasks' 
    });
  }
};