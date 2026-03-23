const Task = require('../models/ClientTask');
const Client = require('../models/Client');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

console.log("✅ ClientTask.js loading...");

// ===== HELPER FUNCTIONS =====

const addClientActivityLogHelper = async (task, logData, req = null) => {
  try {
    const { action, description, user, userName } = logData;
    
    const activityLog = {
      action: action || 'update',
      description: description || 'Task updated',
      user: user || null,
      userName: userName || 'System',
      ipAddress: req?.ip || req?.connection?.remoteAddress || req?.socket?.remoteAddress,
      userAgent: req?.get('User-Agent'),
      createdAt: new Date()
    };

    if (!task.activityLogs) {
      task.activityLogs = [];
    }

    task.activityLogs.push(activityLog);
    console.log(`📝 Activity log added: ${action} - ${description}`);
    return activityLog;
  } catch (error) {
    console.error('Error in addClientActivityLogHelper:', error);
    return null;
  }
};

const deleteImageFiles = (images) => {
  if (!images || images.length === 0) return;
  images.forEach(image => {
    const filePath = path.join(__dirname, '../uploads/client-remarks', path.basename(image.url));
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`🗑️ Deleted image: ${filePath}`);
    }
  });
};

// ===== REMARK FUNCTIONS =====

const addClientRemark = async (req, res) => {
  try {
    console.log('📝 addClientRemark called');
    const { taskId } = req.params;
    const { text } = req.body;
    const currentUser = req.user;

    if (!text || text.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Remark text is required'
      });
    }

    if (!mongoose.Types.ObjectId.isValid(taskId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid task ID format'
      });
    }

    const task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    const remark = {
      text: text.trim(),
      images: [],
      user: currentUser?.id || currentUser?._id,
      userName: currentUser?.name || currentUser?.username || 'System',
      createdAt: new Date()
    };

    if (!task.remarks) {
      task.remarks = [];
    }

    task.remarks.push(remark);
    
    await addClientActivityLogHelper(task, {
      action: 'remark_added',
      description: `Added remark: ${text.substring(0, 100)}${text.length > 100 ? '...' : ''}`,
      user: currentUser?.id || currentUser?._id,
      userName: currentUser?.name || currentUser?.username || 'System'
    }, req);

    await task.save();
    await task.populate('remarks.user', 'name email');

    const addedRemark = task.remarks[task.remarks.length - 1];

    res.status(201).json({
      success: true,
      message: 'Remark added successfully',
      data: addedRemark
    });

  } catch (error) {
    console.error('❌ Error adding client remark:', error);
    res.status(500).json({
      success: false,
      message: 'Error adding remark',
      error: error.message
    });
  }
};

const addClientRemarkWithImages = async (req, res) => {
  try {
    console.log('📸 addClientRemarkWithImages called');
    const { taskId } = req.params;
    const { text } = req.body;
    const currentUser = req.user;
    
    if (!mongoose.Types.ObjectId.isValid(taskId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid task ID format'
      });
    }
    
    const task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }
    
    // FIX: Ensure full URL path is stored correctly
    const images = (req.files || []).map(file => ({
      url: `/uploads/client-remarks/${file.filename}`, // Full path with leading slash
      filename: file.filename,
      originalName: file.originalname,
      size: file.size,
      mimeType: file.mimetype,
      uploadedBy: currentUser?.id || currentUser?._id,
      uploadedAt: new Date()
    }));
    
    console.log(`📸 Storing ${images.length} images with URLs:`, images.map(img => img.url));
    
    const remark = {
      text: text || '',
      images: images,
      user: currentUser?.id || currentUser?._id,
      userName: currentUser?.name || currentUser?.username || 'System',
      createdAt: new Date()
    };
    
    if (!task.remarks) {
      task.remarks = [];
    }
    
    task.remarks.push(remark);
    
    await addClientActivityLogHelper(task, {
      action: 'remark_added',
      description: `Added remark with ${images.length} image(s): ${text ? text.substring(0, 100) : 'No text'}`,
      user: currentUser?.id || currentUser?._id,
      userName: currentUser?.name || currentUser?.username || 'System'
    }, req);
    
    await task.save();
    await task.populate('remarks.user', 'name email');
    
    const addedRemark = task.remarks[task.remarks.length - 1];
    
    res.status(201).json({
      success: true,
      message: 'Remark with images added successfully',
      data: addedRemark
    });
    
  } catch (error) {
    console.error('❌ Error uploading images:', error);
    res.status(500).json({
      success: false,
      message: 'Error uploading images',
      error: error.message
    });
  }
};

const getClientRemarks = async (req, res) => {
  try {
    const { taskId } = req.params;
    const { limit = 50, page = 1 } = req.query;

    if (!mongoose.Types.ObjectId.isValid(taskId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid task ID format'
      });
    }

    const task = await Task.findById(taskId)
      .select('remarks')
      .populate('remarks.user', 'name email')
      .lean();

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    let remarks = task.remarks || [];
    
    // FIX: Ensure all image URLs are properly formatted
    remarks = remarks.map(remark => {
      if (remark.images && remark.images.length > 0) {
        remark.images = remark.images.map(img => {
          // Ensure URL has leading slash
          if (img.url && !img.url.startsWith('/')) {
            img.url = '/' + img.url;
          }
          return img;
        });
      }
      return remark;
    });
    
    remarks.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + parseInt(limit);
    const paginatedRemarks = remarks.slice(startIndex, endIndex);

    console.log(`📤 Sending ${paginatedRemarks.length} remarks with images`);

    res.json({
      success: true,
      data: paginatedRemarks,
      pagination: {
        total: remarks.length,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(remarks.length / limit)
      }
    });

  } catch (error) {
    console.error('❌ Error fetching client remarks:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching remarks',
      error: error.message
    });
  }
};

const deleteClientRemark = async (req, res) => {
  try {
    const { taskId, remarkId } = req.params;
    const currentUser = req.user;

    if (!mongoose.Types.ObjectId.isValid(taskId) || !mongoose.Types.ObjectId.isValid(remarkId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid ID format'
      });
    }

    const task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    const remarkIndex = task.remarks.findIndex(r => r._id.toString() === remarkId);
    if (remarkIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Remark not found'
      });
    }

    const remark = task.remarks[remarkIndex];
    
    const isAuthorized = 
      (remark.user && remark.user.toString() === (currentUser?.id || currentUser?._id)) ||
      currentUser?.role === 'admin';
    
    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this remark'
      });
    }
    
    if (remark.images && remark.images.length > 0) {
      deleteImageFiles(remark.images);
    }
    
    task.remarks.splice(remarkIndex, 1);
    
    await addClientActivityLogHelper(task, {
      action: 'remark_deleted',
      description: `Deleted remark${remark.images?.length ? ` with ${remark.images.length} image(s)` : ''}`,
      user: currentUser?.id || currentUser?._id,
      userName: currentUser?.name || currentUser?.username || 'System'
    }, req);
    
    await task.save();
    
    res.json({
      success: true,
      message: 'Remark deleted successfully'
    });
    
  } catch (error) {
    console.error('❌ Error deleting remark:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting remark',
      error: error.message
    });
  }
};

// ===== ACTIVITY LOG FUNCTIONS =====

const addClientActivityLog = async (req, res) => {
  try {
    const { taskId } = req.params;
    const { action, description } = req.body;
    const currentUser = req.user;

    if (!action || action.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Action is required'
      });
    }

    if (!mongoose.Types.ObjectId.isValid(taskId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid task ID format'
      });
    }

    const task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    const activityLog = await addClientActivityLogHelper(task, {
      action: action.trim(),
      description: description?.trim() || '',
      user: currentUser?.id || currentUser?._id,
      userName: currentUser?.name || currentUser?.username || 'System'
    }, req);

    await task.save();

    res.status(201).json({
      success: true,
      message: 'Activity log added successfully',
      data: activityLog
    });

  } catch (error) {
    console.error('❌ Error adding client activity log:', error);
    res.status(500).json({
      success: false,
      message: 'Error adding activity log',
      error: error.message
    });
  }
};

const getClientTaskActivityLogs = async (req, res) => {
  try {
    const { taskId } = req.params;
    const { limit = 50, page = 1 } = req.query;

    if (!mongoose.Types.ObjectId.isValid(taskId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid task ID format'
      });
    }

    const task = await Task.findById(taskId)
      .select('activityLogs')
      .populate('activityLogs.user', 'name email')
      .lean();

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    let logs = task.activityLogs || [];
    logs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + parseInt(limit);
    const paginatedLogs = logs.slice(startIndex, endIndex);

    res.json({
      success: true,
      data: paginatedLogs,
      pagination: {
        total: logs.length,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(logs.length / limit)
      }
    });

  } catch (error) {
    console.error('❌ Error fetching client activity logs:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching activity logs',
      error: error.message
    });
  }
};

// ===== EXISTING TASK FUNCTIONS =====

const getAssignedToMeTasks = async (req, res) => {
  try {
    const currentUser = req.user;
    
    if (!currentUser) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    const { status, search, period } = req.query;
    
    let filter = {
      $or: [
        { assignee: currentUser.id?.toString() },
        { assignee: currentUser._id?.toString() },
        { assignee: currentUser.name },
        { assignee: currentUser.email }
      ].filter(Boolean)
    };

    if (status && status !== 'all' && status !== '') {
      if (status === 'completed') {
        filter.completed = true;
      } else if (status === 'pending') {
        filter.completed = false;
      } else if (status === 'in-progress') {
        filter.status = 'in-progress';
        filter.completed = false;
      } else if (status === 'overdue') {
        filter.completed = false;
        filter.dueDate = { $lt: new Date() };
      }
    }

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

    const tasks = await Task.find(filter)
      .populate('clientId', 'name email company phone')
      .sort({ dueDate: 1, createdAt: -1 });

    const groupedTasks = {};
    let overdueCount = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    tasks.forEach(task => {
      let taskStatus = 'pending';
      if (task.completed) {
        taskStatus = 'completed';
      } else if (task.status === 'in-progress') {
        taskStatus = 'in-progress';
      }
      
      const dueDate = task.dueDate ? new Date(task.dueDate) : null;
      if (dueDate) {
        dueDate.setHours(0, 0, 0, 0);
        if (!task.completed && dueDate < today) {
          taskStatus = 'overdue';
          overdueCount++;
        }
      }

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
        remarks: task.remarks || [],
        activityLogs: task.activityLogs || [],
        createdAt: task.createdAt,
        service: task.service,
        assignee: task.assignee,
        isOverdue: taskStatus === 'overdue'
      });
    });

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
      message: error.message
    });
  }
};

const updateAssignedTaskStatus = async (req, res) => {
  try {
    const { taskId } = req.params;
    const { status, completed, remarks } = req.body;
    const currentUser = req.user;

    const task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

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

    const previousStatus = task.status;
    const previousCompleted = task.completed;

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
    }

    if (previousStatus !== task.status) {
      await addClientActivityLogHelper(task, {
        action: 'status_changed',
        description: `Status changed from "${previousStatus}" to "${task.status}"`,
        user: currentUser?.id || currentUser?._id,
        userName: currentUser?.name || currentUser?.username || 'System'
      }, req);
    }

    if (previousCompleted !== task.completed) {
      const action = task.completed ? 'completed' : 'reopened';
      await addClientActivityLogHelper(task, {
        action: action,
        description: `Task ${action}`,
        user: currentUser?.id || currentUser?._id,
        userName: currentUser?.name || currentUser?.username || 'System'
      }, req);
    }

    if (remarks && remarks.trim()) {
      task.remarks = task.remarks || [];
      const remark = {
        text: remarks.trim(),
        images: [],
        user: currentUser?.id || currentUser?._id,
        userName: currentUser?.name || currentUser?.username || 'System',
        createdAt: new Date()
      };
      task.remarks.push(remark);
      
      await addClientActivityLogHelper(task, {
        action: 'remark_added',
        description: `Added remark: ${remarks.substring(0, 100)}${remarks.length > 100 ? '...' : ''}`,
        user: currentUser?.id || currentUser?._id,
        userName: currentUser?.name || currentUser?.username || 'System'
      }, req);
    }

    await task.save();

    res.json({
      success: true,
      message: 'Task status updated successfully',
      data: {
        _id: task._id,
        name: task.name,
        completed: task.completed,
        status: task.status,
        completedAt: task.completedAt,
        remarks: task.remarks,
        activityLogs: task.activityLogs
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

    const tasks = await Task.find({ clientId, service })
      .sort({ completed: 1, dueDate: 1, createdAt: -1 });

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

    const tasks = await Task.find(filter)
      .populate('remarks.user', 'name email')
      .sort({ completed: 1, dueDate: 1, createdAt: -1 });

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
    const currentUser = req.user;

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
      completed: false,
      activityLogs: [],
      remarks: []
    });

    await task.save();

    await addClientActivityLogHelper(task, {
      action: 'created',
      description: `Task "${task.name}" created`,
      user: currentUser?.id || currentUser?._id,
      userName: currentUser?.name || currentUser?.username || 'System'
    }, req);

    await task.save();

    res.status(201).json({
      success: true,
      message: 'Task added successfully',
      data: task
    });
  } catch (error) {
    console.error('Error adding task:', error);
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
    const currentUser = req.user;

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

    const changes = [];
    
    Object.keys(updates).forEach(key => {
      const oldValue = task[key];
      let newValue = updates[key];
      
      if (key === 'name') {
        newValue = updates[key].trim();
        if (oldValue !== newValue) {
          changes.push(`name from "${oldValue}" to "${newValue}"`);
        }
        task[key] = newValue;
      } else if (key === 'status' && oldValue !== newValue) {
        changes.push(`status from "${oldValue}" to "${newValue}"`);
        task[key] = newValue;
      } else if (key === 'priority' && oldValue !== newValue) {
        changes.push(`priority from "${oldValue}" to "${newValue}"`);
        task[key] = newValue;
      } else if (key === 'assignee' && oldValue !== newValue) {
        changes.push(`assignee from "${oldValue}" to "${newValue}"`);
        task[key] = newValue;
      } else if (key === 'dueDate' && JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        changes.push(`due date from "${oldValue}" to "${newValue}"`);
        task[key] = newValue;
      } else if (updates[key] !== undefined) {
        task[key] = updates[key];
      }
    });

    if (changes.length > 0) {
      await addClientActivityLogHelper(task, {
        action: 'updated',
        description: `Updated: ${changes.join(', ')}`,
        user: currentUser?.id || currentUser?._id,
        userName: currentUser?.name || currentUser?.username || 'System'
      }, req);
    }

    await task.save();

    res.json({
      success: true,
      message: 'Task updated successfully',
      data: task
    });
  } catch (error) {
    console.error('Error updating task:', error);
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
    const currentUser = req.user;

    const task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    const previousCompleted = task.completed;
    task.completed = !task.completed;
    task.completedAt = task.completed ? new Date() : null;
    task.status = task.completed ? 'completed' : 'pending';
    
    const action = task.completed ? 'completed' : 'reopened';
    await addClientActivityLogHelper(task, {
      action: action,
      description: `Task ${action}`,
      user: currentUser?.id || currentUser?._id,
      userName: currentUser?.name || currentUser?.username || 'System'
    }, req);
    
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
    const currentUser = req.user;

    const task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    if (task.remarks && task.remarks.length > 0) {
      task.remarks.forEach(remark => {
        if (remark.images && remark.images.length > 0) {
          deleteImageFiles(remark.images);
        }
      });
    }

    await addClientActivityLogHelper(task, {
      action: 'deleted',
      description: `Task "${task.name}" deleted`,
      user: currentUser?.id || currentUser?._id,
      userName: currentUser?.name || currentUser?.username || 'System'
    }, req);
    
    await task.save();
    await Task.findByIdAndDelete(taskId);

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

const debugActivityLogs = async (req, res) => {
  try {
    const { taskId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(taskId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid task ID format'
      });
    }
    
    const task = await Task.findById(taskId)
      .select('activityLogs name remarks')
      .populate('activityLogs.user', 'name email')
      .lean();
    
    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }
    
    res.json({
      success: true,
      data: {
        taskId: task._id,
        taskName: task.name,
        activityLogsCount: task.activityLogs?.length || 0,
        activityLogs: task.activityLogs || [],
        remarksCount: task.remarks?.length || 0,
        remarks: task.remarks || []
      }
    });
  } catch (error) {
    console.error('❌ Error in debug endpoint:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

module.exports = {
  addClientRemark,
  addClientRemarkWithImages,
  getClientRemarks,
  deleteClientRemark,
  addClientActivityLog,
  getClientTaskActivityLogs,
  addClientActivityLogHelper,
  getTasksByClientService,
  getClientTasks,
  addTask,
  updateTask,
  toggleTaskCompletion,
  deleteTask,
  getTaskStats,
  getAssignedToMeTasks,
  updateAssignedTaskStatus,
  debugActivityLogs
};

console.log("✅ ClientTask.js loaded successfully");