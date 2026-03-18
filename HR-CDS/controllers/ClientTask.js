const Task = require('../models/ClientTask');
const Client = require('../models/Client');
const mongoose = require('mongoose');

console.log("✅ ClientTask.js loading...");

// ===== नया FUNCTION 1: Assigned to Me Tasks =====
// GET /api/tasks/assigned-to-me
const getAssignedToMeTasks = async (req, res) => {
  try {
    // Get current user from auth middleware
    const currentUser = req.user;
    
    if (!currentUser) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    console.log('👤 Current User:', {
      id: currentUser.id || currentUser._id,
      name: currentUser.name,
      email: currentUser.email,
      role: currentUser.role
    });

    // Get query parameters
    const { status, search, period } = req.query;
    
    // Build filter based on assignee field
    // NOTE: आपके schema में 'assignee' field है जिसमें User ID या Name store हो सकता है
    let filter = {
      $or: [
        { assignee: currentUser.id?.toString() },
        { assignee: currentUser._id?.toString() },
        { assignee: currentUser.name },
        { assignee: currentUser.email }
      ].filter(Boolean) // Remove null/undefined values
    };

    console.log('🔍 Initial Filter:', JSON.stringify(filter, null, 2));

    // Status filter
    if (status && status !== 'all' && status !== '') {
      if (status === 'completed') {
        filter.completed = true;
      } else if (status === 'pending') {
        filter.completed = false;
        // अगर आपके पास 'status' field है तो
        // filter.status = { $ne: 'in-progress' };
      } else if (status === 'in-progress') {
        // अगर 'in-progress' अलग से track करते हैं
        filter.status = 'in-progress';
        filter.completed = false;
      } else if (status === 'overdue') {
        // Overdue tasks filter
        filter.completed = false;
        filter.dueDate = { $lt: new Date() };
      }
    }

    // Search filter
    if (search && search.trim() !== '') {
      filter.$and = filter.$and || [];
      filter.$and.push({
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { service: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } }
        ]
      });
    }

    // Time period filter
    if (period && period !== 'all') {
      const now = new Date();
      let startDate = new Date();
      let endDate = new Date();
      
      switch(period) {
        case 'today':
          startDate.setHours(0, 0, 0, 0);
          endDate.setHours(23, 59, 59, 999);
          filter.createdAt = { $gte: startDate, $lte: endDate };
          break;
          
        case 'yesterday':
          startDate.setDate(startDate.getDate() - 1);
          startDate.setHours(0, 0, 0, 0);
          endDate.setDate(endDate.getDate() - 1);
          endDate.setHours(23, 59, 59, 999);
          filter.createdAt = { $gte: startDate, $lte: endDate };
          break;
          
        case 'this-week':
          startDate.setDate(startDate.getDate() - startDate.getDay());
          startDate.setHours(0, 0, 0, 0);
          filter.createdAt = { $gte: startDate };
          break;
          
        case 'last-week':
          startDate.setDate(startDate.getDate() - startDate.getDay() - 7);
          startDate.setHours(0, 0, 0, 0);
          endDate.setDate(endDate.getDate() - endDate.getDay() - 1);
          endDate.setHours(23, 59, 59, 999);
          filter.createdAt = { $gte: startDate, $lte: endDate };
          break;
          
        case 'this-month':
          startDate.setDate(1);
          startDate.setHours(0, 0, 0, 0);
          filter.createdAt = { $gte: startDate };
          break;
          
        case 'last-month':
          startDate.setMonth(startDate.getMonth() - 1, 1);
          startDate.setHours(0, 0, 0, 0);
          endDate.setMonth(endDate.getMonth(), 0);
          endDate.setHours(23, 59, 59, 999);
          filter.createdAt = { $gte: startDate, $lte: endDate };
          break;
      }
    }

    console.log('📊 Final Filter:', JSON.stringify(filter, null, 2));

    // Fetch tasks from database
    const tasks = await Task.find(filter)
      .populate('clientId', 'name email company phone')
      .sort({ dueDate: 1, createdAt: -1 });

    console.log(`📊 Found ${tasks.length} tasks assigned to current user`);

    // Group tasks by due date
    const groupedTasks = {};
    let overdueCount = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    tasks.forEach(task => {
      // Determine task status
      let taskStatus = 'pending';
      if (task.completed) {
        taskStatus = 'completed';
      } else if (task.status === 'in-progress') {
        taskStatus = 'in-progress';
      }
      
      // Check if overdue
      const dueDate = task.dueDate ? new Date(task.dueDate) : null;
      if (dueDate) {
        dueDate.setHours(0, 0, 0, 0);
        if (!task.completed && dueDate < today) {
          taskStatus = 'overdue';
          overdueCount++;
        }
      }

      // Use dueDate or createdAt for grouping
      const groupDate = task.dueDate || task.createdAt;
      const dateKey = new Date(groupDate).toLocaleDateString('en-IN', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
      
      if (!groupedTasks[dateKey]) {
        groupedTasks[dateKey] = [];
      }
      
      // Format task for frontend
      groupedTasks[dateKey].push({
        _id: task._id,
        title: task.name,
        name: task.name,
        description: task.description || task.name,
        dueDate: task.dueDate,
        dueDateTime: task.dueDate,
        completed: task.completed,
        status: taskStatus,
        priority: (task.priority || 'Medium').toLowerCase(),
        clientName: task.clientId?.name || 'Unknown Client',
        clientId: task.clientId,
        clientEmail: task.clientId?.email,
        clientCompany: task.clientId?.company,
        files: task.files || [],
        createdAt: task.createdAt,
        service: task.service,
        assignee: task.assignee,
        isOverdue: taskStatus === 'overdue'
      });
    });

    // Calculate statistics
    const total = tasks.length;
    const completed = tasks.filter(t => t.completed).length;
    const pending = tasks.filter(t => !t.completed && t.status !== 'in-progress').length;
    const inProgress = tasks.filter(t => t.status === 'in-progress').length;

    const calculatePercentage = (count) => total > 0 ? Math.round((count / total) * 100) : 0;

    const stats = {
      total,
      completed: { count: completed, percentage: calculatePercentage(completed) },
      pending: { count: pending, percentage: calculatePercentage(pending) },
      inProgress: { count: inProgress, percentage: calculatePercentage(inProgress) },
      overdue: { count: overdueCount, percentage: calculatePercentage(overdueCount) }
    };

    console.log('📈 Statistics:', stats);

    res.json({
      success: true,
      groupedTasks,
      stats,
      count: tasks.length
    });

  } catch (error) {
    console.error('❌ Error in getAssignedToMeTasks:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch assigned tasks',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

// ===== नया FUNCTION 2: Update Assigned Task Status =====
// PATCH /api/tasks/assigned/:taskId/status
const updateAssignedTaskStatus = async (req, res) => {
  try {
    const { taskId } = req.params;
    const { status, completed, remarks } = req.body;
    const currentUser = req.user;

    console.log('🔄 Updating task status:', { taskId, status, completed, userId: currentUser?.id });

    // Find the task
    const task = await Task.findById(taskId);
    
    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    // Verify that this task is assigned to current user
    const isAssignedToUser = 
      task.assignee === currentUser.id?.toString() ||
      task.assignee === currentUser._id?.toString() ||
      task.assignee === currentUser.name;

    if (!isAssignedToUser) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to update this task'
      });
    }

    // Update task based on status
    if (status === 'completed' || completed === true) {
      task.completed = true;
      task.completedAt = new Date();
      task.status = 'completed';
    } else if (status === 'in-progress') {
      task.completed = false;
      task.status = 'in-progress';
    } else if (status === 'pending') {
      task.completed = false;
      task.status = 'pending';
    } else if (status === 'overdue') {
      task.completed = false;
      task.status = 'overdue';
      // Optionally set a flag for overdue
    }

    // Add remark if provided
    if (remarks) {
      task.remarks = task.remarks || [];
      task.remarks.push({
        text: remarks,
        user: currentUser.id || currentUser._id,
        userName: currentUser.name,
        createdAt: new Date()
      });
    }

    await task.save();

    console.log('✅ Task updated successfully:', task._id);

    res.json({
      success: true,
      message: 'Task status updated successfully',
      data: {
        _id: task._id,
        name: task.name,
        completed: task.completed,
        status: task.status,
        completedAt: task.completedAt
      }
    });

  } catch (error) {
    console.error('❌ Error updating assigned task:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update task status',
      error: error.message
    });
  }
};

// ===== EXISTING FUNCTIONS (Unchanged) =====
const getTasksByClientService = async (req, res) => {
  try {
    const { clientId, service } = req.params;

    const client = await Client.findById(clientId);
    if (!client) {
      return res.status(404).json({
        success: false,
        message: 'Client not found'
      });
    }

    const tasks = await Task.find({ clientId, service }).sort({ completed: 1, dueDate: 1, createdAt: -1 });

    res.json({
      success: true,
      data: tasks,
      count: tasks.length
    });
  } catch (error) {
    console.error('Error fetching tasks:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching tasks',
      error: error.message
    });
  }
};

const getClientTasks = async (req, res) => {
  try {
    const { clientId } = req.params;
    const { service, completed, assignee, priority } = req.query;

    const filter = { clientId };
    if (service) filter.service = service;
    if (completed !== undefined) filter.completed = completed === 'true';
    if (assignee) filter.assignee = assignee;
    if (priority) filter.priority = priority;

    const tasks = await Task.find(filter).sort({ completed: 1, dueDate: 1, createdAt: -1 });

    const tasksByService = {};
    tasks.forEach(task => {
      if (!tasksByService[task.service]) {
        tasksByService[task.service] = [];
      }
      tasksByService[task.service].push(task);
    });

    const totalTasks = tasks.length;
    const completedTasks = tasks.filter(t => t.completed).length;
    const pendingTasks = totalTasks - completedTasks;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const overdueTasks = tasks.filter(t => {
      const dueDate = t.dueDate ? new Date(t.dueDate) : null;
      if (dueDate) {
        dueDate.setHours(0, 0, 0, 0);
        return !t.completed && dueDate < today;
      }
      return false;
    }).length;

    res.json({
      success: true,
      data: {
        tasks,
        groupedByService: tasksByService,
        stats: {
          totalTasks,
          completedTasks,
          pendingTasks,
          overdueTasks,
          completionRate: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0
        }
      }
    });
  } catch (error) {
    console.error('Error fetching client tasks:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching client tasks',
      error: error.message
    });
  }
};

const addTask = async (req, res) => {
  try {
    const { clientId, service } = req.params;
    const { name, dueDate, assignee, priority, description } = req.body;

    if (!name || name.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Task name is required'
      });
    }

    const client = await Client.findById(clientId);
    if (!client) {
      return res.status(404).json({
        success: false,
        message: 'Client not found'
      });
    }

    if (!client.services || !client.services.includes(service)) {
      return res.status(400).json({
        success: false,
        message: 'Service not found for this client'
      });
    }

    const task = new Task({
      clientId,
      service,
      name: name.trim(),
      description: description || name.trim(),
      dueDate: dueDate || null,
      assignee: assignee || '',
      priority: priority || 'Medium',
      status: 'pending',
      completed: false
    });

    await task.save();

    res.status(201).json({
      success: true,
      message: 'Task added successfully',
      data: task
    });
  } catch (error) {
    console.error('Error adding task:', error);
    
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Error adding task',
      error: error.message
    });
  }
};

const updateTask = async (req, res) => {
  try {
    const { taskId } = req.params;
    const updates = req.body;

    const task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    if (updates.name !== undefined && (!updates.name || updates.name.trim().length === 0)) {
      return res.status(400).json({
        success: false,
        message: 'Task name cannot be empty'
      });
    }

    Object.keys(updates).forEach(key => {
      if (key === 'name') {
        task[key] = updates[key].trim();
      } else if (updates[key] !== undefined) {
        task[key] = updates[key];
      }
    });

    await task.save();

    res.json({
      success: true,
      message: 'Task updated successfully',
      data: task
    });
  } catch (error) {
    console.error('Error updating task:', error);
    
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Error updating task',
      error: error.message
    });
  }
};

const toggleTaskCompletion = async (req, res) => {
  try {
    const { taskId } = req.params;

    const task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    task.completed = !task.completed;
    task.completedAt = task.completed ? new Date() : null;
    task.status = task.completed ? 'completed' : 'pending';
    await task.save();

    res.json({
      success: true,
      message: task.completed ? 'Task marked as completed' : 'Task marked as pending',
      data: task
    });
  } catch (error) {
    console.error('Error toggling task completion:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating task',
      error: error.message
    });
  }
};

const deleteTask = async (req, res) => {
  try {
    const { taskId } = req.params;

    const task = await Task.findByIdAndDelete(taskId);
    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    res.json({
      success: true,
      message: 'Task deleted successfully',
      data: task
    });
  } catch (error) {
    console.error('Error deleting task:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting task',
      error: error.message
    });
  }
};

const getTaskStats = async (req, res) => {
  try {
    const { clientId } = req.params;

    const stats = await Task.aggregate([
      { $match: { clientId: new mongoose.Types.ObjectId(clientId) } },
      {
        $group: {
          _id: '$service',
          totalTasks: { $sum: 1 },
          completedTasks: { 
            $sum: { $cond: [{ $eq: ['$completed', true] }, 1, 0] } 
          },
          pendingTasks: { 
            $sum: { $cond: [{ $eq: ['$completed', false] }, 1, 0] } 
          },
          highPriorityTasks: {
            $sum: { $cond: [{ $eq: ['$priority', 'High'] }, 1, 0] }
          },
          overdueTasks: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$completed', false] },
                    { $ne: ['$dueDate', null] },
                    { $lt: ['$dueDate', new Date()] }
                  ]
                },
                1,
                0
              ]
            }
          }
        }
      },
      {
        $project: {
          service: '$_id',
          totalTasks: 1,
          completedTasks: 1,
          pendingTasks: 1,
          highPriorityTasks: 1,
          overdueTasks: 1,
          completionRate: {
            $cond: [
              { $eq: ['$totalTasks', 0] },
              0,
              { $multiply: [{ $divide: ['$completedTasks', '$totalTasks'] }, 100] }
            ]
          }
        }
      },
      { $sort: { service: 1 } }
    ]);

    const overallStats = await Task.aggregate([
      { $match: { clientId: new mongoose.Types.ObjectId(clientId) } },
      {
        $group: {
          _id: null,
          totalTasks: { $sum: 1 },
          completedTasks: { 
            $sum: { $cond: [{ $eq: ['$completed', true] }, 1, 0] } 
          }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        serviceStats: stats,
        overall: overallStats.length > 0 ? overallStats[0] : {
          totalTasks: 0,
          completedTasks: 0,
          completionRate: 0
        }
      }
    });
  } catch (error) {
    console.error('Error fetching task statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching task statistics',
      error: error.message
    });
  }
};

// Export all functions
module.exports = {
  getTasksByClientService,
  getClientTasks,
  addTask,
  updateTask,
  toggleTaskCompletion,
  deleteTask,
  getTaskStats,
  getAssignedToMeTasks,      // नया export
  updateAssignedTaskStatus    // नया export
};

console.log("✅ ClientTask.js loaded successfully with new assigned-to-me functions");