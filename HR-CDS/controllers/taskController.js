const Task = require('../models/Task');
const User = require('../../models/User');
const Group = require('../models/Group');
const moment = require('moment');

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
  const users = await User.find({ _id: { $in: uniqueUserIds } }).select('name role');
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
    return [{ _id: req.user._id, name: req.user.name, role: req.user.role, employeeType: req.user.employeeType }];
  }

  const users = await User.find().select('name _id role employeeType');
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
  .populate('members', 'name role')
  .select('name description members');

  return groups;
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
    .populate('assignedUsers', 'name role')
    .populate('assignedGroups', 'name description');

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
      .populate('assignedUsers', 'name role')
      .populate('assignedGroups', 'name description');

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
      .populate('assignedUsers', 'name')
      .populate('assignedGroups', 'name description');

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
      .populate('assignedUsers', 'name')
      .populate('assignedGroups', 'name description');

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
      .populate('assignedUsers', 'name role')
      .populate('assignedGroups', 'name description');

    const enriched = await enrichStatusInfo(tasks);
    const grouped = groupTasksByDate(enriched, 'createdAt', 'assignedSerialNo');
    res.json({ groupedTasks: grouped });
  } catch (error) {
    console.error('❌ Error fetching assigned tasks:', error);
    res.status(500).json({ error: 'Failed to get assigned tasks' });
  }
};

// 🔹 Create task with role-based assignment rules // 🔹 Create task with role-based assignment rules (including groups)
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
    } = req.body;

    const files = (req.files?.files || []).map((f) => f.path);
    const voiceNote = req.files?.voiceNote?.[0]?.path || "";

    const parsedUsers = assignedUsers ? JSON.parse(assignedUsers) : [];
    const parsedGroups = assignedGroups ? JSON.parse(assignedGroups) : [];

    const role = req.user.role;
    const isPrivileged = ["admin", "manager", "hr"].includes(role);

    // 🔹 Auto-assign for normal users
    let finalAssignedUsers = parsedUsers;
    let finalAssignedGroups = parsedGroups;

    if (!isPrivileged) {
      finalAssignedUsers = [req.user._id.toString()]; // assign to self
      finalAssignedGroups = []; // not allowed to assign groups
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
      }).populate("members", "_id");

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

    // 🔹 Create the task
    const task = await Task.create({
      title,
      description,
      dueDateTime,
      whatsappNumber,
      priorityDays,
      priority: priority || "medium",
      assignedUsers: finalAssignedUsers,
      assignedGroups: finalAssignedGroups,
      statusByUser,
      files,
      voiceNote,
      createdBy: req.user._id,
    });

    await task.populate("assignedUsers", "name role");
    await task.populate("assignedGroups", "name description");

    res.status(201).json({ success: true, task });
  } catch (error) {
    console.error("❌ Error creating task:", error);
    res.status(500).json({ error: error.message || "Internal Server Error" });
  }
};


// 🔄 Update status of task
exports.updateStatus = async (req, res) => {
  const { taskId } = req.params;
  const { status } = req.body;

  try {
    const task = await Task.findById(taskId)
      .populate('assignedGroups', 'members');

    if (!task) return res.status(404).json({ error: 'Task not found' });

    // Get all users assigned to this task (direct + group members)
    const allAssignedUsers = [...task.assignedUsers.map(id => id.toString())];
    
    // Add group members
    if (task.assignedGroups && task.assignedGroups.length > 0) {
      task.assignedGroups.forEach(group => {
        group.members.forEach(member => {
          allAssignedUsers.push(member._id.toString());
        });
      });
    }

    const currentUserId = req.user._id.toString();

    if (!allAssignedUsers.includes(currentUserId)) {
      return res.status(403).json({ error: 'You are not assigned to this task.' });
    }

    const statusIndex = task.statusByUser.findIndex(
      s => s.user.toString() === currentUserId
    );

    if (statusIndex === -1) {
      task.statusByUser.push({ user: req.user._id, status });
    } else {
      task.statusByUser[statusIndex].status = status;
    }

    task.markModified('statusByUser');
    await task.save();

    res.json({ message: '✅ Status updated successfully' });
  } catch (error) {
    console.error('❌ Error updating status:', error);
    res.status(500).json({ error: 'Failed to update task status' });
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
    const users = await User.find().select('name _id role employeeType');
    res.json({ users });
  } catch (error) {
    res.status(500).json({ error: 'Unable to fetch users' });
  }
};