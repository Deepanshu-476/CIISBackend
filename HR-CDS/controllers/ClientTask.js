const Task = require('../models/ClientTask');
const Client = require('../models/Client');

// Get tasks for a client's service
const getTasksByClientService = async (req, res) => {
  try {
    const { clientId, service } = req.params;

    // Verify client exists
    const client = await Client.findById(clientId);
    if (!client) {
      return res.status(404).json({
        success: false,
        message: 'Client not found'
      });
    }

    // Get tasks
    const tasks = await Task.find({ 
      clientId, 
      service 
    }).sort({ 
      completed: 1, 
      dueDate: 1, 
      createdAt: -1 
    });

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

// Get all tasks for a client
const getClientTasks = async (req, res) => {
  try {
    const { clientId } = req.params;
    const { service, completed, assignee, priority } = req.query;

    // Build filter
    const filter = { clientId };
    if (service) filter.service = service;
    if (completed !== undefined) filter.completed = completed === 'true';
    if (assignee) filter.assignee = assignee;
    if (priority) filter.priority = priority;

    // Get tasks
    const tasks = await Task.find(filter).sort({ 
      completed: 1, 
      dueDate: 1, 
      createdAt: -1 
    });

    // Group by service
    const tasksByService = {};
    tasks.forEach(task => {
      if (!tasksByService[task.service]) {
        tasksByService[task.service] = [];
      }
      tasksByService[task.service].push(task);
    });

    // Calculate statistics
    const totalTasks = tasks.length;
    const completedTasks = tasks.filter(t => t.completed).length;
    const pendingTasks = totalTasks - completedTasks;
    
    // Calculate overdue tasks
    const overdueTasks = tasks.filter(t => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
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

// Add new task
const addTask = async (req, res) => {
  try {
    const { clientId, service } = req.params;
    const { name, dueDate, assignee, priority } = req.body;

    // Validation
    if (!name || name.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Task name is required'
      });
    }

    // Verify client exists
    const client = await Client.findById(clientId);
    if (!client) {
      return res.status(404).json({
        success: false,
        message: 'Client not found'
      });
    }

    // Verify service exists for this client
    if (!client.services || !client.services.includes(service)) {
      return res.status(400).json({
        success: false,
        message: 'Service not found for this client'
      });
    }

    // Create task
    const task = new Task({
      clientId,
      service,
      name: name.trim(),
      dueDate: dueDate || null,
      assignee: assignee ? assignee.trim() : '',
      priority: priority || 'Medium'
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

// Update task
const updateTask = async (req, res) => {
  try {
    const { taskId } = req.params;
    const updates = req.body;

    // Find task
    const task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    // If updating name, ensure it's not empty
    if (updates.name !== undefined && (!updates.name || updates.name.trim().length === 0)) {
      return res.status(400).json({
        success: false,
        message: 'Task name cannot be empty'
      });
    }

    // Update task
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

// Toggle task completion
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

// Delete task
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

// Get task statistics
const getTaskStats = async (req, res) => {
  try {
    const { clientId } = req.params;

    const stats = await Task.aggregate([
      { $match: { clientId: mongoose.Types.ObjectId(clientId) } },
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
          // Calculate overdue tasks
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

    // Overall statistics
    const overallStats = await Task.aggregate([
      { $match: { clientId: mongoose.Types.ObjectId(clientId) } },
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

module.exports = {
  getTasksByClientService,
  getClientTasks,
  addTask,
  updateTask,
  toggleTaskCompletion,
  deleteTask,
  getTaskStats
};