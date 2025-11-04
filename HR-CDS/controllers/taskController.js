const Task = require('../models/Task');
const User = require('../../models/User');
const Group = require('../models/Group');
const moment = require('moment');
const sendEmail = require('../../utils/sendEmail'); // Add this import

// 🔹 Helper to group tasks by createdAt (latest first) with serial numbers
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
  const userIds = [];
  tasks.forEach(task => {
    task.statusByUser.forEach(status => {
      if (status.user) userIds.push(status.user.toString());
    });
  });

  const uniqueUserIds = [...new Set(userIds)];
  const users = await User.find({ _id: { $in: uniqueUserIds } }).select('name role email');
  const userMap = {};
  users.forEach(u => {
    userMap[u._id.toString()] = u;
  });

  return tasks.map(task => {
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
      ...task.toObject(),
      statusInfo: newStatusInfo
    };
  });
};

// 🔹 Get all users including group members for task assignment
const getAllAssignableUsers = async (req) => {
  const isPrivileged = ['admin', 'manager', 'hr'].includes(req.user.role);

  if (!isPrivileged) {
    return [{ _id: req.user._id, name: req.user.name, role: req.user.role, employeeType: req.user.employeeType, email: req.user.email }];
  }

  const users = await User.find().select('name _id role employeeType email');
  return users;
};

// 🔹 Get all groups for task assignment
const getAllAssignableGroups = async (req) => {
  const isPrivileged = ['admin', 'manager', 'hr'].includes(req.user.role);

  if (!isPrivileged) {
    return [];
  }

  const groups = await Group.find({
    createdBy: req.user._id,
    isActive: true
  })
  .populate('members', 'name role email')
  .select('name description members');

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
              <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard" 
                 style="background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">
                View Task Dashboard
              </a>
            </div>
          </div>
          
          <div style="border-top: 1px solid #e0e0e0; padding-top: 15px; text-align: center; color: #666; font-size: 12px;">
            <p>This is an automated notification. Please do not reply to this email.</p>
            <p>© ${new Date().getFullYear()} RUNO Task Management System</p>
          </div>
        </div>
      `;

      await sendEmail(user.email, emailSubject, emailHtml);
      console.log(`✅ Task creation email sent to: ${user.email}`);
    }
  } catch (emailError) {
    console.error('❌ Failed to send task creation email:', emailError);
    // Don't fail the task creation if email fails
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
            <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard" 
               style="background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">
              View Task Dashboard
            </a>
          </div>
        </div>
        
        <div style="border-top: 1px solid #e0e0e0; padding-top: 15px; text-align: center; color: #666; font-size: 12px;">
          <p>This is an automated notification. Please do not reply to this email.</p>
          <p>© ${new Date().getFullYear()} RUNO Task Management System</p>
        </div>
      </div>
    `;

    await sendEmail(task.createdBy.email, emailSubject, emailHtml);
    console.log(`✅ Task status update email sent to: ${task.createdBy.email}`);
  } catch (emailError) {
    console.error('❌ Failed to send task status update email:', emailError);
    // Don't fail the status update if email fails
  }
};

// ✅ Get Self-Assigned Tasks of a User (For Admin to see tasks assigned to a specific user)
exports.getUserSelfAssignedTasks = async (req, res) => {
  try {
    if (!['admin', 'manager', 'hr'].includes(req.user.role)) {
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
    .populate('createdBy', 'name email');

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
    if (!['admin', 'manager', 'hr'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const tasks = await Task.find({ createdBy: req.user._id })
      .populate('assignedUsers', 'name role email')
      .populate('assignedGroups', 'name description')
      .populate('createdBy', 'name email');

    const enriched = await enrichStatusInfo(tasks);
    res.json({ tasks: enriched });
  } catch (error) {
    console.error('❌ Error in getAssignedTasksWithStatus:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// 🔹 Get all tasks: created by or assigned to logged-in user
exports.getTasks = async (req, res) => {
  const { status } = req.query;
  
  try {
    // Get user's groups to include group-assigned tasks
    const userGroups = await Group.find({ 
      members: req.user._id,
      isActive: true 
    }).select('_id');

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

    const tasks = await Task.find(filter)
      .populate('assignedUsers', 'name email')
      .populate('assignedGroups', 'name description')
      .populate('createdBy', 'name email');

    const enriched = await enrichStatusInfo(tasks);
    const grouped = groupTasksByDate(enriched, 'createdAt', 'serialNo');
    res.json({ groupedTasks: grouped });
  } catch (error) {
    console.error('❌ Error fetching tasks:', error);
    res.status(500).json({ error: 'Failed to get tasks' });
  }
};

// 🔹 Get only tasks assigned to logged-in user (including group assignments)
exports.getMyTasks = async (req, res) => {
  try {
    // Get user's groups to include group-assigned tasks
    const userGroups = await Group.find({ 
      members: req.user._id,
      isActive: true 
    }).select('_id');

    const groupIds = userGroups.map(group => group._id);

    const filter = {
      $or: [
        { assignedUsers: req.user._id },
        { assignedGroups: { $in: groupIds } }
      ]
    };

    const tasks = await Task.find(filter)
      .populate('assignedUsers', 'name email')
      .populate('assignedGroups', 'name description')
      .populate('createdBy', 'name email');

    const enriched = await enrichStatusInfo(tasks);
    const grouped = groupTasksByDate(enriched, 'createdAt', 'mySerialNo');
    res.json({ groupedTasks: grouped });
  } catch (error) {
    console.error('❌ Error fetching my tasks:', error);
    res.status(500).json({ error: 'Failed to get your tasks' });
  }
};

// 🔹 Get only tasks created by logged-in user (e.g., admin)
exports.getAssignedTasks = async (req, res) => {
  try {
    const tasks = await Task.find({ createdBy: req.user._id })
      .populate('assignedUsers', 'name role email')
      .populate('assignedGroups', 'name description')
      .populate('createdBy', 'name email');

    const enriched = await enrichStatusInfo(tasks);
    const grouped = groupTasksByDate(enriched, 'createdAt', 'assignedSerialNo');
    res.json({ groupedTasks: grouped });
  } catch (error) {
    console.error('❌ Error fetching assigned tasks:', error);
    res.status(500).json({ error: 'Failed to get assigned tasks' });
  }
};

// 🔹 Create task with role-based assignment rules and repeat functionality
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
      assignedGroups,
      repeatPattern,
      repeatDays
    } = req.body;

    const files = (req.files?.files || []).map((f) => ({
      filename: f.filename,
      originalName: f.originalname,
      path: f.path
    }));

    const voiceNote = req.files?.voiceNote?.[0] ? {
      filename: req.files.voiceNote[0].filename,
      originalName: req.files.voiceNote[0].originalname,
      path: req.files.voiceNote[0].path
    } : null;

    const parsedUsers = assignedUsers ? JSON.parse(assignedUsers) : [];
    const parsedGroups = assignedGroups ? JSON.parse(assignedGroups) : [];
    const parsedRepeatDays = repeatDays ? JSON.parse(repeatDays) : [];

    const role = req.user.role;
    const isPrivileged = ["admin", "manager", "hr"].includes(role);

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
    let finalRepeatPattern = repeatPattern || 'none';
    let finalRepeatDays = parsedRepeatDays;

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
      });

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
      }).populate("members", "_id name email");

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

    // Calculate next occurrence for recurring tasks
    let nextOccurrence = null;
    if (finalRepeatPattern !== 'none' && dueDateTime) {
      const dueDate = new Date(dueDateTime);
      nextOccurrence = calculateNextOccurrence(dueDate, finalRepeatPattern, finalRepeatDays);
    }

    // 🔹 Create the task
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
      repeatPattern: finalRepeatPattern,
      repeatDays: finalRepeatDays,
      isRecurring: finalRepeatPattern !== 'none',
      nextOccurrence
    });

    // Populate task data for email
    await task.populate("assignedUsers", "name role email");
    await task.populate("assignedGroups", "name description");
    await task.populate("createdBy", "name email");

    // 🔹 Send email notifications to all assigned users
    if (task.assignedUsers && task.assignedUsers.length > 0) {
      await sendTaskCreationEmail(task, task.assignedUsers);
    }

    res.status(201).json({ 
      success: true, 
      task,
      message: finalRepeatPattern !== 'none' ? 'Recurring task created successfully' : 'Task created successfully'
    });
  } catch (error) {
    console.error("❌ Error creating task:", error);
    res.status(500).json({ error: error.message || "Internal Server Error" });
  }
};

// Helper function to calculate next occurrence
const calculateNextOccurrence = (dueDateTime, repeatPattern, repeatDays) => {
  if (!dueDateTime || repeatPattern === 'none') return null;

  let nextDate = new Date(dueDateTime);
  
  switch (repeatPattern) {
    case 'daily':
      nextDate.setDate(nextDate.getDate() + 1);
      break;
    
    case 'weekly':
      if (repeatDays && repeatDays.length > 0) {
        const currentDay = nextDate.getDay();
        const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const currentDayName = dayNames[currentDay];
        
        // Find the next scheduled day
        const currentIndex = repeatDays.indexOf(currentDayName);
        let nextDayIndex;
        
        if (currentIndex === -1 || currentIndex === repeatDays.length - 1) {
          nextDayIndex = 0;
        } else {
          nextDayIndex = currentIndex + 1;
        }
        
        const nextDayName = repeatDays[nextDayIndex];
        const targetDayIndex = dayNames.indexOf(nextDayName);
        let daysToAdd = targetDayIndex - currentDay;
        
        if (daysToAdd <= 0) {
          daysToAdd += 7;
        }
        
        nextDate.setDate(nextDate.getDate() + daysToAdd);
      } else {
        nextDate.setDate(nextDate.getDate() + 7);
      }
      break;
    
    case 'monthly':
      nextDate.setMonth(nextDate.getMonth() + 1);
      break;
    
    default:
      return null;
  }
  
  return nextDate;
};

// 🔄 Update status of task - FIXED VERSION
// 🎯 SIMPLE & SAFE Update status of task
exports.updateStatus = async (req, res) => {
  try {
    const { taskId } = req.params;
    const { status } = req.body;

    console.log(`🎯 Simple updateStatus called for task: ${taskId}`);

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
        updatedAt: new Date()
      });
    } else {
      task.statusByUser[statusIndex].status = status;
      task.statusByUser[statusIndex].updatedAt = new Date();
    }

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
    const users = await User.find().select('name _id role employeeType email');
    res.json({ users });
  } catch (error) {
    res.status(500).json({ error: 'Unable to fetch users' });
  }
};

// 🔹 Get recurring tasks for a user
exports.getRecurringTasks = async (req, res) => {
  try {
    const tasks = await Task.find({
      createdBy: req.user._id,
      isRecurring: true
    })
    .populate('assignedUsers', 'name role email')
    .populate('assignedGroups', 'name description')
    .populate('createdBy', 'name email')
    .sort({ nextOccurrence: 1 });

    res.json({ tasks });
  } catch (error) {
    console.error('❌ Error fetching recurring tasks:', error);
    res.status(500).json({ error: 'Failed to fetch recurring tasks' });
  }
};