const Task = require('../models/Task');
const User = require('../../models/User');
const Group = require('../models/Group');
const Notification = require('../models/Notification');
const ActivityLog = require('../models/ActivityLog');
const moment = require('moment');
const sendEmail = require('../../utils/sendEmail');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// ==================== HELPER FUNCTIONS ====================

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

// 🔹 Helper to group tasks by date
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

// 🔹 Get all users including group members
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
      case 'in-progress':
        statusColor = '#ffc107';
        statusEmoji = '🔄';
        break;
      case 'overdue':
        statusColor = '#dc3545';
        statusEmoji = '⚠️';
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
          
          ${newStatus === 'overdue' ? `
            <div style="background: #f8d7da; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #dc3545;">
              <p style="margin: 0; font-weight: bold; color: #721c24;">⚠️ Task Overdue!</p>
              <p style="margin: 10px 0 0 0;">Attention required: This task is now overdue.</p>
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

// ==================== MAIN CONTROLLER FUNCTIONS ====================

// ✅ GET ALL TASKS (assigned to or created by user)
exports.getTasks = async (req, res) => {
  const { status, search } = req.query;
  
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
        { assignedGroups: { $in: groupIds } },
        { 
          createdBy: req.user._id,
          taskFor: 'self'
        }
      ],
      isActive: true
    };

    if (status) {
      filter['statusByUser.status'] = status;
      filter['statusByUser.user'] = req.user._id;
    }

    // Add search functionality
    if (search) {
      filter.$or = [
        ...(filter.$or || []),
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
      success: true,
      groupedTasks: grouped
    });
  } catch (error) {
    console.error('❌ Error fetching tasks:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to get tasks' 
    });
  }
};

// ✅ GET MY TASKS (only tasks assigned to logged-in user)
exports.getMyTasks = async (req, res) => {
  try {
    const { search, status, period } = req.query;
    
    console.log('📅 Received period:', period);

    // Get user's groups to include group-assigned tasks
    const userGroups = await Group.find({ 
      members: req.user._id,
      isActive: true 
    }).select('_id').lean();

    const groupIds = userGroups.map(group => group._id);

    const filter = {
      $or: [
        { assignedUsers: req.user._id },
        { assignedGroups: { $in: groupIds } },
        { 
          createdBy: req.user._id,
          taskFor: 'self'
        }
      ],
      isActive: true
    };

    // Time period filter
    if (period && period !== 'all') {
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      
      let startDate, endDate;

      switch (period) {
        case 'today':
          startDate = new Date(now);
          endDate = new Date(now);
          endDate.setDate(now.getDate() + 1);
          break;
        
        case 'yesterday':
          startDate = new Date(now);
          startDate.setDate(now.getDate() - 1);
          endDate = new Date(now);
          break;
        
        case 'this-week':
          startDate = new Date(now);
          startDate.setDate(now.getDate() - now.getDay());
          endDate = new Date(startDate);
          endDate.setDate(startDate.getDate() + 7);
          break;
        
        case 'last-week':
          startDate = new Date(now);
          startDate.setDate(now.getDate() - now.getDay() - 7);
          endDate = new Date(startDate);
          endDate.setDate(startDate.getDate() + 7);
          break;
        
        case 'this-month':
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
          endDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
          break;
        
        case 'last-month':
          startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
          endDate = new Date(now.getFullYear(), now.getMonth(), 1);
          break;
        
        case 'last-7-days':
          startDate = new Date(now);
          startDate.setDate(now.getDate() - 7);
          endDate = new Date(now);
          endDate.setDate(now.getDate() + 1);
          break;
        
        case 'last-30-days':
          startDate = new Date(now);
          startDate.setDate(now.getDate() - 30);
          endDate = new Date(now);
          endDate.setDate(now.getDate() + 1);
          break;
        
        default:
          console.log('❌ Unknown period:', period);
          break;
      }

      if (startDate && endDate) {
        console.log('📅 Filtering by date range:', { 
          period, 
          startDate: startDate.toISOString(), 
          endDate: endDate.toISOString() 
        });
        
        filter.createdAt = {
          $gte: startDate,
          $lt: endDate
        };
      }
    }

    // Add search functionality
    if (search) {
      if (!filter.$or) filter.$or = [];
      filter.$or.push(
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      );
    }

    console.log('🔍 Final filter:', JSON.stringify(filter, null, 2));

    let tasks = await Task.find(filter)
      .populate('assignedUsers', 'name email')
      .populate('assignedGroups', 'name description')
      .populate('createdBy', 'name email')
      .sort({ dueDateTime: 1, createdAt: -1 })
      .lean();

    console.log('📊 Tasks found:', tasks.length);

    // Apply status filter
    if (status && status !== 'all') {
      tasks = tasks.filter(task => {
        const userStatus = task.statusByUser?.find(
          statusObj => statusObj.user && statusObj.user.toString() === req.user._id.toString()
        );
        return userStatus && userStatus.status === status;
      });
      console.log('📊 Tasks after status filter:', tasks.length);
    }

    const enriched = await enrichStatusInfo(tasks);
    const grouped = groupTasksByDate(enriched, 'createdAt', 'mySerialNo');
    
    res.json({ 
      success: true,
      groupedTasks: grouped
    });
  } catch (error) {
    console.error('❌ Error fetching my tasks:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to get your tasks' 
    });
  }
};

// ✅ GET ASSIGNED TASKS (tasks created by logged-in user for others)
exports.getAssignedTasks = async (req, res) => {
  try {
    const { search, status } = req.query;

    // Only show tasks created for others by current user
    const filter = { 
      createdBy: req.user._id,
      taskFor: 'others',
      isActive: true
    };

    // Add status filter
    if (status && status !== 'all') {
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
      success: true,
      groupedTasks: grouped
    });
  } catch (error) {
    console.error('❌ Error fetching assigned tasks:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to get assigned tasks' 
    });
  }
};

// ✅ CREATE TASK FOR SELF
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
        return res.status(400).json({ 
          success: false,
          error: 'Due date cannot be in the past' 
        });
      }
    }

    // For self-task, assign ONLY to current user
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
      assignedUsers: finalAssignedUsers,
      assignedGroups: finalAssignedGroups,
      statusByUser,
      files,
      voiceNote,
      createdBy: req.user._id,
      isRecurring: false,
      taskFor: 'self',
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
      task: {
        ...task.toObject(),
        taskFor: task.taskFor || 'self',
      },
      message: 'Self task created successfully'
    });

  } catch (error) {
    console.error("❌ Error creating self task:", error);
    res.status(500).json({ 
      success: false,
      error: error.message || "Internal Server Error" 
    });
  }
};

// ✅ CREATE TASK FOR OTHERS
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
      return res.status(403).json({ 
        success: false,
        error: 'Access denied. Only admins/managers can assign tasks to others.' 
      });
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

    // Safe JSON parsing
    const parsedUsers = assignedUsers && assignedUsers !== 'null' ? JSON.parse(assignedUsers) : [];
    const parsedGroups = assignedGroups && assignedGroups !== 'null' ? JSON.parse(assignedGroups) : [];

    // Validate that creator is NOT in assigned users
    if (parsedUsers.includes(req.user._id.toString())) {
      return res.status(400).json({ 
        success: false,
        error: 'You cannot assign task to yourself in "Create for Others". Use "Create for Self" instead.' 
      });
    }

    // Validate that at least one user or group is assigned
    if (parsedUsers.length === 0 && parsedGroups.length === 0) {
      return res.status(400).json({ 
        success: false,
        error: 'At least one user or group must be assigned' 
      });
    }

    // Validate due date is not in the past
    if (dueDateTime) {
      const dueDate = new Date(dueDateTime);
      if (dueDate < new Date()) {
        return res.status(400).json({ 
          success: false,
          error: 'Due date cannot be in the past' 
        });
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
          success: false,
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
      assignedUsers: parsedUsers,
      assignedGroups: parsedGroups,
      statusByUser,
      files,
      voiceNote,
      createdBy: req.user._id,
      isRecurring: false,
      taskFor: 'others',
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
        taskFor: task.taskFor || 'others',
      },
      message: 'Task created successfully for others'
    });

  } catch (error) {
    console.error("❌ Error creating task for others:", error);
    res.status(500).json({ 
      success: false,
      error: error.message || "Internal Server Error" 
    });
  }
};

// ✅ UPDATE TASK
exports.updateTask = async (req, res) => {
  try {
    const { taskId } = req.params;
    const updateData = req.body;

    if (!['admin', 'manager', 'hr', 'SuperAdmin'].includes(req.user.role)) {
      return res.status(403).json({ 
        success: false,
        error: 'Access denied' 
      });
    }

    const task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({ 
        success: false,
        error: 'Task not found' 
      });
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

    // Safe JSON parsing for assignedUsers and assignedGroups
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
    res.status(500).json({ 
      success: false,
      error: 'Failed to update task' 
    });
  }
};

// ✅ DELETE TASK
exports.deleteTask = async (req, res) => {
  try {
    const { taskId } = req.params;

    if (!['admin', 'manager', 'hr', 'SuperAdmin'].includes(req.user.role)) {
      return res.status(403).json({ 
        success: false,
        error: 'Access denied' 
      });
    }

    const task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({ 
        success: false,
        error: 'Task not found' 
      });
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
    res.status(500).json({ 
      success: false,
      error: 'Failed to delete task' 
    });
  }
};

// ✅ UPDATE TASK STATUS
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
    } else if (status === 'overdue') {
      task.overallStatus = 'overdue';
      task.markedOverdueAt = new Date();
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

// ✅ ADD REMARK TO TASK
exports.addRemark = async (req, res) => {
  try {
    const { taskId } = req.params;
    const { text } = req.body;

    // Check if we have either text or image
    if (!text && !req.file) {
      return res.status(400).json({ 
        success: false,
        error: 'Remark text or image is required' 
      });
    }

    const task = await Task.findById(taskId);
    if (!task) return res.status(404).json({ 
      success: false,
      error: 'Task not found' 
    });

    const isAuthorized =
      task.assignedUsers.some(userId => userId.toString() === req.user._id.toString()) ||
      task.createdBy.toString() === req.user._id.toString();

    if (!isAuthorized) return res.status(403).json({ 
      success: false,
      error: 'Not authorized to add remarks' 
    });

    let imagePath = null;

    // Handle image upload + compression
    if (req.file) {
      const uploadDir = "uploads/remarks/";
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      const filename = `remark_${Date.now()}_${req.user._id}.jpg`;
      imagePath = path.join(uploadDir, filename);

      try {
        // Compress and process image
        await sharp(req.file.buffer)
          .resize(1200, 1200, {
            fit: 'inside',
            withoutEnlargement: true
          })
          .jpeg({ 
            quality: 80,
            progressive: true 
          })
          .toFile(imagePath);

        // Check size and further compress if >1MB
        let stats = fs.statSync(imagePath);
        if (stats.size > 1024 * 1024) {
          const compressedPath = imagePath.replace('.jpg', '_compressed.jpg');
          
          await sharp(imagePath)
            .resize(800, 800, {
              fit: 'inside',
              withoutEnlargement: true
            })
            .jpeg({ 
              quality: 60,
              progressive: true 
            })
            .toFile(compressedPath);

          // Remove original and use compressed
          fs.unlinkSync(imagePath);
          imagePath = compressedPath;
        }
      } catch (imageError) {
        console.error("❌ Image processing error:", imageError);
        // Clean up if image processing fails
        if (fs.existsSync(imagePath)) {
          fs.unlinkSync(imagePath);
        }
        return res.status(400).json({ 
          success: false,
          error: 'Failed to process image' 
        });
      }
    }

    // Create remark object
    const newRemark = {
      user: req.user._id,
      text: text || '',
      image: imagePath,
      createdAt: new Date()
    };

    // Add remark to task
    task.remarks.push(newRemark);
    await task.save();

    // Populate the newly added remark for response
    await task.populate('remarks.user', 'name role email avatar');

    const addedRemark = task.remarks[task.remarks.length - 1];

    res.json({
      success: true,
      message: "Remark added successfully",
      remark: addedRemark,
    });

  } catch (error) {
    console.error("❌ Error adding remark:", error);
    
    // Clean up uploaded files if error occurs
    if (imagePath && fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath);
    }
    
    res.status(500).json({ 
      success: false,
      error: "Failed to add remark" 
    });
  }
};

// ✅ GET TASK REMARKS
exports.getRemarks = async (req, res) => {
  try {
    const { taskId } = req.params;

    const task = await Task.findById(taskId)
      .populate('remarks.user', 'name role email avatar')
      .select('remarks');

    if (!task) {
      return res.status(404).json({ 
        success: false,
        error: 'Task not found' 
      });
    }

    // Sort remarks by creation date (newest first)
    const sortedRemarks = task.remarks.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({ 
      success: true, 
      remarks: sortedRemarks 
    });

  } catch (error) {
    console.error('❌ Error fetching remarks:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch remarks' 
    });
  }
};

// ✅ GET USER NOTIFICATIONS
exports.getNotifications = async (req, res) => {
  try {
    const { unreadOnly = false } = req.query;

    const filter = { user: req.user._id };
    if (unreadOnly === 'true') {
      filter.isRead = false;
    }

    const notifications = await Notification.find(filter)
      .populate('relatedTask')
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
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch notifications' 
    });
  }
};

// ✅ MARK NOTIFICATION AS READ
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
      return res.status(404).json({ 
        success: false,
        error: 'Notification not found' 
      });
    }

    res.json({ 
      success: true, 
      message: 'Notification marked as read',
      notification 
    });

  } catch (error) {
    console.error('❌ Error marking notification as read:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to mark notification as read' 
    });
  }
};

// ✅ MARK ALL NOTIFICATIONS AS READ
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
    res.status(500).json({ 
      success: false,
      error: 'Failed to mark all notifications as read' 
    });
  }
};

// ✅ GET ACTIVITY LOGS FOR TASK
exports.getTaskActivityLogs = async (req, res) => {
  try {
    const { taskId } = req.params;

    const task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({ 
        success: false,
        error: 'Task not found' 
      });
    }

    // Check if user is authorized to view task logs
    const isAuthorized = task.assignedUsers.some(userId => 
      userId.toString() === req.user._id.toString()
    ) || task.createdBy.toString() === req.user._id.toString();

    if (!isAuthorized) {
      return res.status(403).json({ 
        success: false,
        error: 'Not authorized to view activity logs for this task' 
      });
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
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch activity logs' 
    });
  }
};

// ✅ GET USER ACTIVITY TIMELINE
exports.getUserActivityTimeline = async (req, res) => {
  try {
    const { userId } = req.params;

    // Check if user is authorized (own timeline or admin/manager/hr)
    const isAuthorized = userId === req.user._id.toString() || 
                        ['admin', 'manager', 'hr', 'SuperAdmin'].includes(req.user.role);

    if (!isAuthorized) {
      return res.status(403).json({ 
        success: false,
        error: 'Not authorized to view this activity timeline' 
      });
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
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch activity timeline' 
    });
  }
};

// ✅ GET ASSIGNABLE USERS AND GROUPS
exports.getAssignableUsers = async (req, res) => {
  try {
    const users = await getAllAssignableUsers(req);
    const groups = await getAllAssignableGroups(req);

    res.json({ 
      success: true,
      users,
      groups 
    });
  } catch (error) {
    console.error('❌ Error fetching assignable data:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch assignable data.' 
    });
  }
};

// ✅ GET TASK STATUS COUNTS
exports.getTaskStatusCounts = async (req, res) => {
  try {
    const { period = 'today' } = req.query;

    // Get user's groups
    const userGroups = await Group.find({ 
      members: req.user._id,
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

    // Base filter
    const baseFilter = {
      ...dateFilter,
      isActive: true,
      $or: [
        { assignedUsers: req.user._id },
        { assignedGroups: { $in: groupIds } },
        { 
          createdBy: req.user._id,
          taskFor: 'self'
        }
      ]
    };

    const tasks = await Task.find(baseFilter).lean();

    // Calculate statistics
    let total = 0;
    const statusCounts = {
      pending: 0,
      'in-progress': 0,
      completed: 0,
      approved: 0,
      rejected: 0,
      onhold: 0,
      reopen: 0,
      cancelled: 0,
      overdue: 0
    };

    tasks.forEach(task => {
      total++;
      const userStatus = task.statusByUser?.find(s => 
        s.user && s.user.toString() === req.user._id.toString()
      );
      
      const status = userStatus ? userStatus.status : 'pending';
      
      if (statusCounts[status] !== undefined) {
        statusCounts[status]++;
      }

      // Check overdue
      if (task.dueDateTime && new Date(task.dueDateTime) < new Date()) {
        if (['pending', 'in-progress', 'reopen', 'onhold'].includes(status)) {
          statusCounts.overdue++;
        }
      }
    });

    // Calculate percentages
    const calculatePercentage = (count) => total > 0 ? Math.round((count / total) * 100) : 0;

    res.json({
      success: true,
      statistics: {
        total,
        pending: { count: statusCounts.pending, percentage: calculatePercentage(statusCounts.pending) },
        inProgress: { count: statusCounts['in-progress'], percentage: calculatePercentage(statusCounts['in-progress']) },
        completed: { count: statusCounts.completed, percentage: calculatePercentage(statusCounts.completed) },
        approved: { count: statusCounts.approved, percentage: calculatePercentage(statusCounts.approved) },
        rejected: { count: statusCounts.rejected, percentage: calculatePercentage(statusCounts.rejected) },
        onHold: { count: statusCounts.onhold, percentage: calculatePercentage(statusCounts.onhold) },
        reopen: { count: statusCounts.reopen, percentage: calculatePercentage(statusCounts.reopen) },
        cancelled: { count: statusCounts.cancelled, percentage: calculatePercentage(statusCounts.cancelled) },
        overdue: { count: statusCounts.overdue, percentage: calculatePercentage(statusCounts.overdue) }
      }
    });

  } catch (error) {
    console.error('❌ Error fetching task statistics:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch task statistics' 
    });
  }
};

// ✅ GET USER DETAILED ANALYTICS
exports.getUserDetailedAnalytics = async (req, res) => {
  try {
    if (!['admin', 'manager', 'hr', 'SuperAdmin'].includes(req.user.role)) {
      return res.status(403).json({ 
        success: false,
        error: 'Access denied. Admin privileges required.' 
      });
    }

    const { userId } = req.params;
    const { startDate, endDate, period = 'all' } = req.query;

    // Get user details
    const user = await User.findById(userId)
      .select('name email role department employeeType joiningDate')
      .lean();

    if (!user) {
      return res.status(404).json({ 
        success: false,
        error: 'User not found' 
      });
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
        { assignedUsers: userId },
        { assignedGroups: { $in: groupIds } },
        { createdBy: userId }
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

// ✅ GET USER TASK STATISTICS
exports.getUserTaskStats = async (req, res) => {
  try {
    const { userId } = req.params;
    const { period = 'today' } = req.query;

    if (!['admin', 'manager', 'hr', 'SuperAdmin'].includes(req.user.role)) {
      return res.status(403).json({ 
        success: false,
        error: 'Access denied. Admin privileges required.' 
      });
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

// ✅ GET ALL USERS WITH THEIR TASK COUNTS
exports.getUsersWithTaskCounts = async (req, res) => {
  try {
    if (!['admin', 'manager', 'hr', 'SuperAdmin'].includes(req.user.role)) {
      return res.status(403).json({ 
        success: false,
        error: 'Access denied. Admin privileges required.' 
      });
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

// ✅ GET USER TASKS WITH FILTERS
exports.getUserTasks = async (req, res) => {
  try {
    const { userId } = req.params;
    const { status, search, period = 'all' } = req.query;

    if (!['admin', 'manager', 'hr', 'SuperAdmin'].includes(req.user.role)) {
      return res.status(403).json({ 
        success: false,
        error: 'Access denied. Admin privileges required.' 
      });
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

// ==================== OVERDUE TASKS FUNCTIONS ====================

// ✅ GET OVERDUE TASKS FOR LOGGED-IN USER
exports.getOverdueTasks = async (req, res) => {
  try {
    // Get user's groups for group-assigned tasks
    const userGroups = await Group.find({ 
      members: req.user._id,
      isActive: true 
    }).select('_id').lean();

    const groupIds = userGroups.map(group => group._id);
    const now = new Date();

    // Find tasks that should be overdue for this user
    const filter = {
      $or: [
        { assignedUsers: req.user._id },
        { assignedGroups: { $in: groupIds } },
        { 
          createdBy: req.user._id,
          taskFor: 'self'
        }
      ],
      isActive: true,
      dueDateTime: { $lt: now },
      $or: [
        { 
          'statusByUser': {
            $elemMatch: {
              user: req.user._id,
              status: { $in: ['pending', 'in-progress', 'reopen', 'onhold'] }
            }
          }
        },
        { 
          assignedUsers: req.user._id,
          'statusByUser.user': { $ne: req.user._id }
        }
      ]
    };

    let tasks = await Task.find(filter)
      .populate('assignedUsers', 'name email')
      .populate('assignedGroups', 'name description')
      .populate('createdBy', 'name email')
      .sort({ dueDateTime: 1, createdAt: -1 })
      .lean();

    // Mark tasks as overdue in database
    const overdueTasks = [];
    
    for (const task of tasks) {
      const taskDoc = await Task.findById(task._id);
      if (taskDoc) {
        // Check if user's status needs to be marked overdue
        const userStatus = taskDoc.statusByUser.find(
          s => s.user && s.user.toString() === req.user._id.toString()
        );
        
        if (!userStatus) {
          // User doesn't have status entry, create one
          taskDoc.statusByUser.push({
            user: req.user._id,
            status: 'overdue',
            updatedAt: new Date(),
            remarks: 'Automatically marked as overdue'
          });
          
          // Add to status history
          taskDoc.statusHistory.push({
            status: 'overdue',
            changedBy: req.user._id,
            changedByType: 'user',
            remarks: 'Automatically marked as overdue due to passed deadline',
            changedAt: new Date()
          });
          
          await taskDoc.save();
          overdueTasks.push(taskDoc.toObject());
          
        } else if (['pending', 'in-progress', 'reopen', 'onhold'].includes(userStatus.status)) {
          // User's status can be marked overdue
          const oldStatus = userStatus.status;
          userStatus.status = 'overdue';
          userStatus.updatedAt = new Date();
          userStatus.remarks = 'Automatically marked as overdue';
          
          // Add to status history
          taskDoc.statusHistory.push({
            status: 'overdue',
            changedBy: req.user._id,
            changedByType: 'user',
            remarks: `Automatically marked as overdue from ${oldStatus}`,
            changedAt: new Date()
          });
          
          // Update overall status if needed
          if (taskDoc.overallStatus !== 'overdue') {
            taskDoc.overallStatus = 'overdue';
            taskDoc.markedOverdueAt = new Date();
            taskDoc.overdueReason = 'Automatic overdue detection';
          }
          
          await taskDoc.save();
          overdueTasks.push(taskDoc.toObject());
          
          // Create notification
          await createNotification(
            req.user._id,
            'Task Marked as Overdue',
            `Task "${taskDoc.title}" has been automatically marked as overdue`,
            'task_overdue',
            taskDoc._id,
            { 
              dueDate: taskDoc.dueDateTime,
              oldStatus,
              markedAt: new Date()
            }
          );
        } else if (userStatus.status === 'overdue') {
          // Already overdue
          overdueTasks.push(taskDoc.toObject());
        }
      }
    }

    const enriched = await enrichStatusInfo(overdueTasks);
    const grouped = groupTasksByDate(enriched, 'dueDateTime', 'overdueSerialNo');
    
    res.json({
      success: true,
      overdueTasks: grouped,
      count: overdueTasks.length,
      asOf: new Date(),
      message: `Found ${overdueTasks.length} overdue task(s)`
    });

  } catch (error) {
    console.error('❌ Error fetching overdue tasks:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch overdue tasks',
      details: error.message 
    });
  }
};

// ✅ GET USER OVERDUE TASKS (ADMIN/HR/MANAGER)
exports.getUserOverdueTasks = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!['admin', 'manager', 'hr', 'SuperAdmin'].includes(req.user.role)) {
      return res.status(403).json({ 
        success: false,
        error: 'Access denied. Admin privileges required.' 
      });
    }

    // Get user's groups for group-assigned tasks
    const userGroups = await Group.find({ 
      members: userId,
      isActive: true 
    }).select('_id').lean();

    const groupIds = userGroups.map(group => group._id);
    const now = new Date();

    const filter = {
      $or: [
        { assignedUsers: userId },
        { assignedGroups: { $in: groupIds } },
        { createdBy: userId }
      ],
      isActive: true,
      dueDateTime: { $lt: now },
      $or: [
        { 
          'statusByUser': {
            $elemMatch: {
              user: userId,
              status: { $in: ['pending', 'in-progress', 'reopen', 'onhold'] }
            }
          }
        },
        { 
          assignedUsers: userId,
          'statusByUser.user': { $ne: userId }
        }
      ]
    };

    const tasks = await Task.find(filter)
      .populate('assignedUsers', 'name email')
      .populate('assignedGroups', 'name description')
      .populate('createdBy', 'name email')
      .sort({ dueDateTime: 1, createdAt: -1 })
      .lean();

    const enriched = await enrichStatusInfo(tasks);
    const grouped = groupTasksByDate(enriched, 'dueDateTime', 'overdueSerialNo');
    
    res.json({
      success: true,
      userId,
      overdueTasks: grouped,
      count: tasks.length,
      asOf: new Date()
    });

  } catch (error) {
    console.error('❌ Error fetching user overdue tasks:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch user overdue tasks' 
    });
  }
};

// ✅ MANUALLY MARK TASK AS OVERDUE
exports.markTaskAsOverdue = async (req, res) => {
  try {
    const { taskId } = req.params;
    const { remarks } = req.body;

    const task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({ 
        success: false,
        error: 'Task not found' 
      });
    }

    // Check if user is authorized
    const isAuthorized = 
      task.assignedUsers.some(userId => userId.toString() === req.user._id.toString()) ||
      task.createdBy.toString() === req.user._id.toString() ||
      ['admin', 'manager', 'hr', 'SuperAdmin'].includes(req.user.role);

    if (!isAuthorized) {
      return res.status(403).json({ 
        success: false,
        error: 'Not authorized to mark this task as overdue' 
      });
    }

    // Check if task is already overdue
    if (task.overallStatus === 'overdue') {
      return res.status(400).json({ 
        success: false,
        error: 'Task is already marked as overdue' 
      });
    }

    // Check if due date has passed
    if (task.dueDateTime && new Date(task.dueDateTime) >= new Date()) {
      return res.status(400).json({ 
        success: false,
        error: 'Task due date has not passed yet' 
      });
    }

    // Mark user's status as overdue
    const wasMarked = task.markUserStatusOverdue(req.user._id, remarks);
    
    if (!wasMarked) {
      return res.status(400).json({ 
        success: false,
        error: 'Task cannot be marked as overdue' 
      });
    }

    await task.save();

    // Create notifications for all assigned users
    const assignedUserIds = task.assignedUsers.map(id => id.toString());
    
    for (const userId of assignedUserIds) {
      await createNotification(
        userId,
        'Task Marked as Overdue',
        `Task "${task.title}" has been marked as overdue by ${req.user.name}`,
        'task_overdue_manual',
        task._id,
        { markedBy: req.user.name, remarks }
      );
    }

    // Create activity log
    await createActivityLog(
      req.user,
      'task_marked_overdue',
      task._id,
      `Manually marked task as overdue: ${task.title}`,
      { status: task.overallStatus },
      { status: 'overdue', remarks },
      req
    );

    res.json({
      success: true,
      message: '✅ Task marked as overdue successfully',
      task: {
        _id: task._id,
        title: task.title,
        overallStatus: task.overallStatus,
        markedOverdueAt: task.markedOverdueAt
      }
    });

  } catch (error) {
    console.error('❌ Error marking task as overdue:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to mark task as overdue' 
    });
  }
};

// ✅ UPDATE ALL OVERDUE TASKS (FOR CRON)
exports.updateAllOverdueTasks = async (req, res) => {
  try {
    if (!['admin', 'manager', 'hr', 'SuperAdmin'].includes(req.user.role)) {
      return res.status(403).json({ 
        success: false,
        error: 'Access denied. Admin privileges required.' 
      });
    }

    const now = new Date();
    const overdueTasks = await Task.find({
      dueDateTime: { $lt: now },
      isActive: true,
      $or: [
        { overallStatus: { $in: ['pending', 'in-progress', 'reopen', 'onhold'] } },
        { 
          'statusByUser.status': { $in: ['pending', 'in-progress', 'reopen', 'onhold'] }
        }
      ]
    });

    let updated = 0;
    let alreadyOverdue = 0;
    let skipped = 0;

    for (const task of overdueTasks) {
      try {
        const wasUpdated = task.checkAndMarkOverdue();
        if (wasUpdated) {
          await task.save();
          updated++;
        } else {
          if (task.overallStatus === 'overdue') {
            alreadyOverdue++;
          } else {
            skipped++;
          }
        }
      } catch (taskError) {
        console.error(`Error updating task ${task._id}:`, taskError);
      }
    }

    // Create activity log
    await createActivityLog(
      req.user,
      'update_all_overdue',
      null,
      `Updated all overdue tasks: ${updated} updated, ${alreadyOverdue} already overdue, ${skipped} skipped`,
      null,
      { updated, alreadyOverdue, skipped },
      req
    );

    res.json({
      success: true,
      message: `✅ Updated ${updated} tasks as overdue`,
      results: { updated, alreadyOverdue, skipped, total: overdueTasks.length },
      timestamp: new Date()
    });

  } catch (error) {
    console.error('❌ Error updating all overdue tasks:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to update overdue tasks' 
    });
  }
};

// ✅ GET OVERDUE SUMMARY
exports.getOverdueSummary = async (req, res) => {
  try {
    const userId = req.params.userId || req.user._id;
    const { period = '30days' } = req.query;

    // Calculate date range
    const now = new Date();
    let startDate = new Date();
    
    switch (period) {
      case '7days':
        startDate.setDate(now.getDate() - 7);
        break;
      case '30days':
        startDate.setDate(now.getDate() - 30);
        break;
      case '90days':
        startDate.setDate(now.getDate() - 90);
        break;
      default:
        startDate.setDate(now.getDate() - 30);
    }

    // Get user's groups
    const userGroups = await Group.find({ 
      members: userId,
      isActive: true 
    }).select('_id').lean();
    const groupIds = userGroups.map(group => group._id);

    const filter = {
      $or: [
        { assignedUsers: userId },
        { assignedGroups: { $in: groupIds } },
        { createdBy: userId }
      ],
      isActive: true,
      dueDateTime: { 
        $gte: startDate,
        $lt: now 
      },
      $or: [
        { overallStatus: 'overdue' },
        { 
          dueDateTime: { $lt: now },
          overallStatus: { $in: ['pending', 'in-progress', 'reopen', 'onhold'] }
        }
      ]
    };

    const tasks = await Task.find(filter)
      .populate('assignedUsers', 'name email')
      .populate('createdBy', 'name email')
      .sort({ dueDateTime: 1 })
      .lean();

    // Categorize tasks
    const summary = {
      total: tasks.length,
      alreadyOverdue: 0,
      potentialOverdue: 0,
      byPriority: {
        high: 0,
        medium: 0,
        low: 0
      },
      byDuration: {
        lessThan1Day: 0,
        '1-3Days': 0,
        '4-7Days': 0,
        moreThan7Days: 0
      },
      tasks: []
    };

    tasks.forEach(task => {
      const isAlreadyOverdue = task.overallStatus === 'overdue';
      
      if (isAlreadyOverdue) {
        summary.alreadyOverdue++;
      } else {
        summary.potentialOverdue++;
      }

      // Count by priority
      if (task.priority && summary.byPriority[task.priority] !== undefined) {
        summary.byPriority[task.priority]++;
      }

      // Calculate overdue duration
      if (task.dueDateTime) {
        const dueDate = new Date(task.dueDateTime);
        const diffDays = Math.floor((now - dueDate) / (1000 * 60 * 60 * 24));
        
        if (diffDays < 1) summary.byDuration.lessThan1Day++;
        else if (diffDays <= 3) summary.byDuration['1-3Days']++;
        else if (diffDays <= 7) summary.byDuration['4-7Days']++;
        else summary.byDuration.moreThan7Days++;
      }

      // Add task to summary
      summary.tasks.push({
        _id: task._id,
        title: task.title,
        dueDateTime: task.dueDateTime,
        priority: task.priority,
        overallStatus: task.overallStatus,
        isOverdue: isAlreadyOverdue,
        overdueDays: task.dueDateTime ? 
          Math.floor((now - new Date(task.dueDateTime)) / (1000 * 60 * 60 * 24)) : null
      });
    });

    // Calculate percentages
    summary.overdueRate = summary.total > 0 ? 
      Math.round((summary.alreadyOverdue / summary.total) * 100) : 0;
    
    summary.potentialOverdueRate = summary.total > 0 ? 
      Math.round((summary.potentialOverdue / summary.total) * 100) : 0;

    res.json({
      success: true,
      userId,
      period,
      dateRange: {
        start: startDate,
        end: now
      },
      summary
    });

  } catch (error) {
    console.error('❌ Error fetching overdue summary:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch overdue summary' 
    });
  }
};

// ✅ ALIAS FOR TASK STATISTICS
exports.getTaskStatistics = exports.getTaskStatusCounts;

module.exports = exports;