const Task = require('../models/Task');
const User = require('../../models/User');
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

// ✅ Get Self-Assigned Tasks of a User (For Admin to see tasks assigned to a specific user)
exports.getUserSelfAssignedTasks = async (req, res) => {
  try {
    if (!['admin', 'manager', 'hr'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { userId } = req.params;  // Get userId from route params

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    // Find self-assigned tasks for the user
    const tasks = await Task.find({
      createdBy: userId,
      assignedUsers: userId
    })
    .populate('assignedUsers', 'name role');  // Populate user info (name, role)

    const enrichedTasks = await enrichStatusInfo(tasks);  // Enrich tasks with status info
    const groupedTasks = groupTasksByDate(enrichedTasks, 'createdAt', 'serialNo');  // Group by date

    res.json({ groupedTasks });  // Return the tasks grouped by date
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
      .populate('assignedUsers', 'name role');  // Populate user info

    const enriched = await enrichStatusInfo(tasks);  // Enrich status info
    res.json({ tasks: enriched });
  } catch (error) {
    console.error('❌ Error in getAssignedTasksWithStatus:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// 🔹 Get all tasks: created by or assigned to logged-in user
exports.getTasks = async (req, res) => {
  const { status } = req.query;
  const filter = {
    $or: [
      { assignedUsers: req.user._id },
      { createdBy: req.user._id }
    ]
  };

  if (status) {
    filter['statusByUser.status'] = status;
  }

  try {
    const tasks = await Task.find(filter).populate('assignedUsers', 'name');
    const enriched = await enrichStatusInfo(tasks);
    const grouped = groupTasksByDate(enriched, 'createdAt', 'serialNo');
    res.json({ groupedTasks: grouped });
  } catch (error) {
    console.error('❌ Error fetching tasks:', error);
    res.status(500).json({ error: 'Failed to get tasks' });
  }
};

// 🔹 Get only tasks assigned to logged-in user
exports.getMyTasks = async (req, res) => {
  try {
    const tasks = await Task.find({ assignedUsers: req.user._id });
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
    const tasks = await Task.find({ createdBy: req.user._id });
    const enriched = await enrichStatusInfo(tasks);
    const grouped = groupTasksByDate(enriched, 'createdAt', 'assignedSerialNo');
    res.json({ groupedTasks: grouped });
  } catch (error) {
    console.error('❌ Error fetching assigned tasks:', error);
    res.status(500).json({ error: 'Failed to get assigned tasks' });
  }
};

// 🔹 Create task with role-based assignment rules
exports.createTask = async (req, res) => {
  try {
    const {
      title, description, dueDate,
      whatsappNumber, priorityDays,
      assignedUsers
    } = req.body;

    const files = (req.files?.files || []).map(f => f.path);
    const voiceNote = req.files?.voiceNote?.[0]?.path || '';

    const parsedUsers = JSON.parse(assignedUsers);
    const role = req.user.role;
    const isPrivileged = ['admin', 'manager', 'hr'].includes(role);

    if (!isPrivileged) {
      const onlySelfAssigned = parsedUsers.length === 1 && parsedUsers[0] === req.user._id.toString();
      if (!onlySelfAssigned) {
        return res.status(403).json({ error: 'You can only assign tasks to yourself.' });
      }
    }

    const statusByUser = parsedUsers.map(uid => ({
      user: uid,
      status: 'pending'
    }));

    const task = await Task.create({
      title,
      description,
      dueDate,
      whatsappNumber,
      priorityDays,
      assignedUsers: parsedUsers,
      statusByUser,
      files,
      voiceNote,
      createdBy: req.user._id
    });

    res.status(201).json({ success: true, task });
  } catch (error) {
    console.error('❌ Error creating task:', error);
    res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
};

// 🔄 Update status of task
exports.updateStatus = async (req, res) => {
  const { taskId } = req.params;
  const { status } = req.body;

  try {
    const task = await Task.findById(taskId);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const assignedUserIds = task.assignedUsers.map(id => id.toString());
    const currentUserId = req.user._id.toString();

    if (!assignedUserIds.includes(currentUserId)) {
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

// 🔹 Get assignable users
exports.getAssignableUsers = async (req, res) => {
  const isPrivileged = ['admin', 'manager', 'hr'].includes(req.user.role);

  try {
    let users;
    if (isPrivileged) {
      users = await User.find().select('name _id role employeeType');
    } else {
      users = [{ _id: req.user._id, name: req.user.name, role: req.user.role, employeeType: req.user.employeeType }];
    }

    res.json({ users });
  } catch (error) {
    console.error('❌ Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users.' });
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
