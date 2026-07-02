const Task = require('../models/ClientTask');
const Client = require('../models/Client');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const User = require('../../models/User');
const { notifyPageUsers, notifyDirectUsers } = require('../utils/systemNotificationService');
const { sendEmail } = require('../../utils/sendEmail');
const { getPaginationOptions, buildPaginationMeta } = require('../../utils/pagination');

void 0;



const formatDuration = (seconds) => {
  if (!seconds || seconds <= 0) return '0s';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  const parts = [];
  if (hrs > 0) parts.push(`${hrs}h`);
  if (mins > 0) parts.push(`${mins}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);
  return parts.join(' ');
};

const getLocalDateStart = (value = new Date()) => {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
};

const getClientTaskOverdueCutoff = () => new Date();

const isClientTaskOverdue = task => {
  if (!task?.dueDate || task.completed) return false;
  const status = String(task.status || 'pending').trim().toLowerCase();
  if (status === 'overdue') return true;
  if (status !== 'pending') return false;
  const dueDate = new Date(task.dueDate);
  return !Number.isNaN(dueDate.getTime()) && dueDate < new Date();
};

const parseClientDueDate = value => {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  let dateStr = String(value).trim();
  
  if (dateStr.includes('T') && !/Z|[+-]\d{2}:?\d{2}$/i.test(dateStr)) {
    dateStr = `${dateStr}+05:30`;
  }
  const date = new Date(dateStr);
  return Number.isNaN(date.getTime()) ? null : date;
};

const getClientTaskDueDateRange = period => {
  if (!period || period === 'all') return null;

  const now = new Date();
  const startDate = getLocalDateStart(now);
  if (!startDate) return null;
  const endDate = new Date(startDate);

  switch (period) {
    case 'today':
      endDate.setDate(startDate.getDate() + 1);
      break;
    case 'yesterday':
      startDate.setDate(startDate.getDate() - 1);
      endDate.setDate(endDate.getDate());
      break;
    case 'this-week':
      startDate.setDate(startDate.getDate() - startDate.getDay());
      endDate.setTime(startDate.getTime());
      endDate.setDate(startDate.getDate() + 7);
      break;
    case 'last-week':
      startDate.setDate(startDate.getDate() - startDate.getDay() - 7);
      endDate.setTime(startDate.getTime());
      endDate.setDate(startDate.getDate() + 7);
      break;
    case 'this-month':
      startDate.setDate(1);
      endDate.setTime(startDate.getTime());
      endDate.setMonth(startDate.getMonth() + 1);
      break;
    case 'last-month':
      startDate.setMonth(startDate.getMonth() - 1, 1);
      endDate.setTime(startDate.getTime());
      endDate.setMonth(startDate.getMonth() + 1);
      break;
    default:
      return null;
  }

  return { $gte: startDate, $lt: endDate };
};

const addDueDateCondition = (filter, condition) => {
  if (!condition) return;

  if (filter.dueDate) {
    filter.$and = filter.$and || [];
    filter.$and.push({ dueDate: filter.dueDate }, { dueDate: condition });
    delete filter.dueDate;
    return;
  }

  filter.dueDate = condition;
};

const getAssignedClientTaskFilter = async (currentUser) => {
  const companyCode = currentUser?.companyCode ? String(currentUser.companyCode).trim().toUpperCase() : '';
  const clientFilter = companyCode ? { companyCode } : {};
  const clients = await Client.find(clientFilter).select('_id').lean();
  const clientIds = clients.map(client => client._id);

  return {
    clientId: { $in: clientIds },
    $or: [
      { assigneeId: currentUser.id || currentUser._id },
      { assignee: currentUser.id?.toString() },
      { assignee: currentUser._id?.toString() },
      { assignee: currentUser.name },
      { assignee: currentUser.email }
    ].filter(Boolean)
  };
};

const calculateClientAssignedStats = tasks => {
  const total = tasks.length;
  const completed = tasks.filter(task => task.completed || task.status === 'completed').length;
  const overdue = tasks.filter(task => !task.completed && isClientTaskOverdue(task)).length;
  const inProgress = tasks.filter(task => !task.completed && !isClientTaskOverdue(task) && task.status === 'in-progress').length;
  const pending = tasks.filter(task => !task.completed && !isClientTaskOverdue(task) && task.status !== 'in-progress').length;
  const percentage = count => total > 0 ? Math.round((count / total) * 100) : 0;

  return {
    total,
    completed: { count: completed, percentage: percentage(completed) },
    pending: { count: pending, percentage: percentage(pending) },
    inProgress: { count: inProgress, percentage: percentage(inProgress) },
    overdue: { count: overdue, percentage: percentage(overdue) }
  };
};

const addClientActivityLogHelper = async (task, logData, req = null) => {
  try {
    const { action, description, user, userName, oldValues, newValues } = logData;
    
    const activityLog = {
      action: action || 'update',
      description: description || 'Task updated',
      user: user || null,
      userName: userName || 'System',
      oldValues,
      newValues,
      ipAddress: req?.ip || req?.connection?.remoteAddress || req?.socket?.remoteAddress,
      userAgent: req?.get('User-Agent'),
      createdAt: new Date()
    };

    if (!task.activityLogs) {
      task.activityLogs = [];
    }

    task.activityLogs.push(activityLog);
    void 0;
    return activityLog;
  } catch (error) {
    console.error('Error in addClientActivityLogHelper:', error);
    return null;
  }
};

const getId = value => {
  if (!value) return '';
  if (typeof value === 'object') return String(value._id || value.id || value.userId || '');
  return String(value);
};

const getClientDisplayName = client => client?.client || client?.name || 'Client';

const getNotificationCompanyId = (client, currentUser) => {
  const candidates = [
    currentUser?.company?._id,
    currentUser?.company,
    client?.company?._id,
    client?.company,
  ].map(getId).filter(Boolean);

  return candidates.find(id => mongoose.Types.ObjectId.isValid(id)) || '';
};

const resolveClientPortalUsers = async clientOrId => {
  const client = typeof clientOrId === 'object' && clientOrId?._id
    ? clientOrId
    : await Client.findById(clientOrId).select('client name email company companyCode userId');

  if (!client) return [];

  const clientId = getId(client._id);
  const email = client.email ? String(client.email).trim().toLowerCase() : '';
  const companyCode = client.companyCode ? String(client.companyCode).trim().toUpperCase() : '';
  const orFilters = [
    client.userId ? {_id: client.userId} : null,
    email ? {email} : null,
    clientId ? {employeeType: clientId} : null,
    clientId ? {additionalDetails: {$regex: clientId}} : null,
  ].filter(Boolean);

  if (!orFilters.length) return [];

  const query = {
    isActive: {$ne: false},
    $or: orFilters,
  };

  if (companyCode) {
    query.companyCode = companyCode;
  }

  const users = await User.find(query).select('_id name email companyCode companyRole');
  const uniqueUsers = new Map();
  users.forEach(user => uniqueUsers.set(user._id.toString(), user));
  return [...uniqueUsers.values()];
};

const notifyClientPortalUsers = async ({
  client,
  task,
  actor,
  title,
  message,
  data = {},
  priority = 'medium',
}) => {
  try {
    const clientUsers = await resolveClientPortalUsers(client || task?.clientId);
    const recipientIds = clientUsers.map(user => user._id);

    if (!recipientIds.length) {
      console.warn('[CLIENT TASK NOTIFICATION] skipped-no-client-user', {
        taskId: task?._id,
        clientId: getId(client?._id || task?.clientId),
        clientEmail: client?.email || undefined,
        companyCode: client?.companyCode || undefined,
      });
      return [];
    }

    const notifications = await notifyDirectUsers({
      userIds: recipientIds,
      targetPath: '/ciisUser/ClientDashboard',
      targetScreen: 'Dashboard',
      type: 'task_client',
      title,
      message,
      actor: actor?._id || actor?.id,
      company: actor?.company,
      data: {
        taskId: task?._id,
        clientId: task?.clientId || client?._id,
        service: task?.service,
        taskName: task?.name || task?.title,
        source: 'client_task',
        ...data,
      },
      priority,
    });

    void 0;

    return notifications;
  } catch (error) {
    console.error('[CLIENT TASK NOTIFICATION] client-user-dispatch-failed', {
      taskId: task?._id,
      clientId: getId(client?._id || task?.clientId),
      message: error.message,
      stack: error.stack,
    });
    return [];
  }
};

const notifyAssignedClientTaskUser = async ({
  task,
  actor,
  title,
  message,
  data = {},
  priority = 'medium',
}) => {
  try {
    const assigneeId = getId(task?.assigneeId);
    if (!assigneeId) return [];

    return notifyDirectUsers({
      userIds: [assigneeId],
      targetPath: '/ciisUser/task-management',
      targetScreen: 'Task Management',
      type: 'task_assigned',
      title,
      message,
      actor: actor?._id || actor?.id,
      company: actor?.company,
      data: {
        taskId: task?._id,
        clientId: task?.clientId,
        service: task?.service,
        taskName: task?.name || task?.title,
        source: 'client_task',
        ...data,
      },
      priority,
    });
  } catch (error) {
    console.error('[CLIENT TASK NOTIFICATION] assignee-dispatch-failed', {
      taskId: task?._id,
      assigneeId: getId(task?.assigneeId),
      message: error.message,
    });
    return [];
  }
};

const notifyClientTaskCompleted = async ({ task, actor, req }) => {
  try {
    const client = await Client.findById(task.clientId).select('client name email company companyCode userId');
    if (!client) {
      console.warn('[CLIENT TASK NOTIFICATION] skipped-no-client', {
        taskId: task?._id,
        clientId: task?.clientId,
      });
      return;
    }

    const clientName = getClientDisplayName(client);
    const taskName = task.name || task.title || 'Task';
    const actorName = actor?.name || actor?.username || 'Team';
    const message = `Your task "${taskName}" has been completed.`;
    await notifyClientPortalUsers({
      client,
      task,
      actor,
      title: 'Task Completed',
      message,
      data: {completedAt: task.completedAt},
      priority: 'high',
    });

    if (client.email) {
      const html = `
        <p>Hello ${clientName},</p>
        <p>Your task "<strong>${taskName}</strong>" has been completed by ${actorName}.</p>
        <p>Service: ${task.service || '-'}</p>
        <p>Completed at: ${task.completedAt ? new Date(task.completedAt).toLocaleString('en-IN') : new Date().toLocaleString('en-IN')}</p>
      `;
      await sendEmail(client.email, `Task Completed: ${taskName}`, html, {
        skipNotification: true,
      });
      void 0;
    }
  } catch (error) {
    console.error('[CLIENT TASK NOTIFICATION] failed', {
      taskId: task?._id,
      clientId: task?.clientId,
      message: error.message,
      stack: error.stack,
    });
  }
};


const deleteImageFiles = (images) => {
  if (!images || images.length === 0) return;
  images.forEach(image => {
    let filename = '';
    if (image.url) {
      filename = path.basename(image.url);
    } else if (image.filename) {
      filename = image.filename;
    }
    
    if (filename) {
      const filePath = path.join(__dirname, '../uploads/client-remarks', filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        void 0;
      }
    }
  });
};


const addClientRemarkWithImages = async (req, res) => {
  try {
    void 0;
    const { taskId } = req.params;
    const { text } = req.body;
    const currentUser = req.user;
    
    void 0;
    void 0;
    void 0;
    void 0;
    
    if (!mongoose.Types.ObjectId.isValid(taskId)) {
      void 0;
      return res.status(400).json({
        success: false,
        message: 'Invalid task ID format'
      });
    }
    
    const task = await Task.findById(taskId);
    if (!task) {
      void 0;
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }
    
    void 0;
    
    
    const images = [];
    
    if (req.files && req.files.length > 0) {
      const uploadDir = path.join(__dirname, '../uploads/client-remarks');
      
      
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
        void 0;
      }
      
      for (const file of req.files) {
        try {
          
          const timestamp = Date.now();
          const randomStr = Math.random().toString(36).substring(2, 8);
          const filename = `remark_${timestamp}_${randomStr}_${currentUser?._id || 'user'}.jpg`;
          
          
          const savePath = path.join(uploadDir, filename);
          
          void 0;
          
          
          await sharp(file.buffer)
            .resize(1200, 1200, {
              fit: "inside",
              withoutEnlargement: true
            })
            .jpeg({
              quality: 80,
              progressive: true
            })
            .toFile(savePath);
          
          
          const imageUrl = `/uploads/client-remarks/${filename}`;
          
          void 0;
          
          images.push({
            url: imageUrl,
            filename: filename,
            originalName: file.originalname,
            size: file.size,
            mimeType: file.mimetype,
            uploadedBy: currentUser?.id || currentUser?._id,
            uploadedAt: new Date()
          });
          
        } catch (imgError) {
          console.error(`❌ Error processing image ${file.originalname}:`, imgError);
        }
      }
    }
    
    void 0;
    
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
      description: `Added remark with ${images.length} image(s)${text ? `: ${text.substring(0, 50)}` : ''}`,
      user: currentUser?.id || currentUser?._id,
      userName: currentUser?.name || currentUser?.username || 'System'
    }, req);
    
    await task.save();
    
    
    const addedRemark = task.remarks[task.remarks.length - 1];
    if (addedRemark.user) {
      await task.populate('remarks.user', 'name email');
    }
    
    void 0;
    
    try {
      const client = await Client.findById(task.clientId).select('company companyCode');
      await notifyPageUsers({
        companyId: getNotificationCompanyId(client, req.user),
        targetPath: '/ciisUser/company-all-task',
        type: 'task_remark_added',
        title: 'Client Task Remark',
        message: `${currentUser?.name || 'User'} added a remark on client task "${task.name || task.title}"`,
        data: { taskId: task._id, remarkId: addedRemark._id },
        priority: 'medium'
      });
    } catch (notifyErr) {
      console.error('Error notifying page users for client remark:', notifyErr);
    }

    try {
      const client = await Client.findById(task.clientId).select('client name email company companyCode userId');
      await notifyClientPortalUsers({
        client,
        task,
        actor: currentUser,
        title: 'Client Task Remark',
        message: `${currentUser?.name || 'A user'} added a remark on "${task.name || task.title}"`,
        data: {remarkId: addedRemark._id},
        priority: 'medium',
      });
      await notifyAssignedClientTaskUser({
        task,
        actor: currentUser,
        title: 'Client Task Remark',
        message: `${currentUser?.name || 'A user'} added a remark on client task "${task.name || task.title}"`,
        data: {remarkId: addedRemark._id},
        priority: 'medium',
      });
    } catch (notifyErr) {
      console.error('Error notifying client/assignee for client remark:', notifyErr);
    }

    
    try {
      const client = await Client.findById(task.clientId).select('name email');
      if (client && client.email) {
        const subject = `New remark on your task: ${task.name || task.title}`;
        const html = `<p>Hello ${client.name || 'Client'},</p><p>${currentUser?.name || 'A user'} added a remark on task "${task.name || task.title}".</p><p>Remark: ${text || ''}</p><p>View details in your portal.</p>`;
        await sendEmail(client.email, subject, html, {
          skipNotification: true,
          notificationType: 'task_remark_added',
          notificationTargetPath: '/ciisUser/ClientDashboard',
          notificationMessage: `${currentUser?.name || 'A user'} added a remark on "${task.name || task.title}"`,
          notificationData: {taskId: task._id, remarkId: addedRemark._id, source: 'client_task'},
          notificationPriority: 'medium',
        });
      }
    } catch (emailErr) {
      console.error('Error sending client email for remark:', emailErr);
    }
    void 0;
    
    res.status(201).json({
      success: true,
      message: 'Remark with images added successfully',
      data: addedRemark
    });
    
  } catch (error) {
    console.error('❌ Error in addClientRemarkWithImages:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Error uploading images',
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};


const addClientRemark = async (req, res) => {
  try {
    void 0;
    const { taskId } = req.params;
    const { text } = req.body;
    const currentUser = req.user;

    void 0;
    void 0;
    void 0;

    if (!text || text.trim().length === 0) {
      void 0;
      return res.status(400).json({
        success: false,
        message: 'Remark text is required'
      });
    }

    if (!mongoose.Types.ObjectId.isValid(taskId)) {
      void 0;
      return res.status(400).json({
        success: false,
        message: 'Invalid task ID format'
      });
    }

    const task = await Task.findById(taskId);
    if (!task) {
      void 0;
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    void 0;

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
    
    
    const addedRemark = task.remarks[task.remarks.length - 1];
    if (addedRemark.user) {
      await task.populate('remarks.user', 'name email');
    }

    void 0;
    void 0;

      void 0;
      void 0;

      
      try {
        const client = await Client.findById(task.clientId).select('company companyCode');
        await notifyPageUsers({
          companyId: getNotificationCompanyId(client, req.user),
          targetPath: '/ciisUser/company-all-task',
          type: 'task_remark_added',
          title: 'Client Task Remark',
          message: `${currentUser?.name || 'User'} added a remark on client task "${task.name || task.title}"`,
          data: { taskId: task._id, remarkId: addedRemark._id },
          priority: 'medium'
        });
      } catch (notifyErr) {
        console.error('Error notifying page users for client remark:', notifyErr);
      }

      try {
        const client = await Client.findById(task.clientId).select('client name email company companyCode userId');
        await notifyClientPortalUsers({
          client,
          task,
          actor: currentUser,
          title: 'Client Task Remark',
          message: `${currentUser?.name || 'A user'} added a remark on "${task.name || task.title}"`,
          data: {remarkId: addedRemark._id},
          priority: 'medium',
        });
        await notifyAssignedClientTaskUser({
          task,
          actor: currentUser,
          title: 'Client Task Remark',
          message: `${currentUser?.name || 'A user'} added a remark on client task "${task.name || task.title}"`,
          data: {remarkId: addedRemark._id},
          priority: 'medium',
        });
      } catch (notifyErr) {
        console.error('Error notifying client/assignee for client remark:', notifyErr);
      }

      
      try {
        const client = await Client.findById(task.clientId).select('name email');
        if (client && client.email) {
          const subject = `New remark on your task: ${task.name || task.title}`;
          const html = `<p>Hello ${client.name || 'Client'},</p><p>${currentUser?.name || 'A user'} added a remark on task "${task.name || task.title}".</p><p>Remark: ${text || ''}</p><p>View details in your portal.</p>`;
          await sendEmail(client.email, subject, html, {
            skipNotification: true,
            notificationType: 'task_remark_added',
            notificationTargetPath: '/ciisUser/ClientDashboard',
            notificationMessage: `${currentUser?.name || 'A user'} added a remark on "${task.name || task.title}"`,
            notificationData: {taskId: task._id, remarkId: addedRemark._id, source: 'client_task'},
            notificationPriority: 'medium',
          });
        }
      } catch (emailErr) {
        console.error('Error sending client email for remark:', emailErr);
      }

      res.status(201).json({
        success: true,
        message: 'Remark added successfully',
        data: addedRemark
      });

  } catch (error) {
    console.error('❌ Error in addClientRemark:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Error adding remark',
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};


const getClientRemarks = async (req, res) => {
  try {
    const { taskId } = req.params;
    const { limit = 50, page = 1 } = req.query;

    void 0;
    void 0;

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
    
    void 0;
    
    
    let imagesFound = 0;
    let imagesMissing = 0;
    
    remarks = remarks.map(remark => {
      if (remark.images && remark.images.length > 0) {
        remark.images = remark.images.map(img => {
          
          if (img.url && !img.url.startsWith('/')) {
            img.url = '/' + img.url;
          }
          
          
          const filename = img.filename;
          if (filename) {
            const fullPath = path.join(__dirname, '../uploads/client-remarks', filename);
            const fileExists = fs.existsSync(fullPath);
            
            if (fileExists) {
              imagesFound++;
            } else {
              imagesMissing++;
            }
          }
          
          return img;
        });
      }
      return remark;
    });
    
    void 0;
    
    
    remarks.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + parseInt(limit);
    const paginatedRemarks = remarks.slice(startIndex, endIndex);

    void 0;
    void 0;

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


const updateAssignedTaskStatus = async (req, res) => {
  try {
    const { taskId } = req.params;
    const { status, completed, remarks } = req.body;
    const currentUser = req.user;

    void 0;
    void 0;
    void 0;

    const task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    
    const isAssignedToUser = 
      task.assigneeId?.toString() === currentUser.id?.toString() ||
      task.assigneeId?.toString() === currentUser._id?.toString() ||
      task.assignee === currentUser.id?.toString() ||
      task.assignee === currentUser._id?.toString() ||
      task.assignee === currentUser.name ||
      task.assignee === currentUser.email;

    if (!isAssignedToUser) {
      void 0;
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to update this task'
      });
    }

    const previousStatus = task.status;
    const previousCompleted = task.completed;
    const now = new Date();

    
    let targetStatus = status;
    if (completed === true) {
      targetStatus = 'completed';
    } else if (!status && previousStatus === 'overdue' && !completed) {
      targetStatus = 'in-progress';
    }

    
    let elapsedSeconds = 0;
    if (previousStatus === 'in-progress' && targetStatus !== 'in-progress') {
      if (task.inProgressSince) {
        elapsedSeconds = Math.max(0, Math.floor((now - new Date(task.inProgressSince)) / 1000));
        task.timeSpent = (task.timeSpent || 0) + elapsedSeconds;
        task.inProgressSince = null;
        void 0;
      }
    }

    
    if (targetStatus === 'in-progress' && previousStatus !== 'in-progress') {
      task.inProgressSince = now;
      void 0;
    }

    
    if (targetStatus === 'completed') {
      task.completed = true;
      task.completedAt = now;
      task.status = 'completed';
      void 0;
    } else if (targetStatus === 'in-progress') {
      task.completed = false;
      task.status = 'in-progress';
      void 0;
    } else if (targetStatus === 'pending') {
      task.completed = false;
      task.status = 'pending';
      void 0;
    } else if (targetStatus === 'overdue') {
      task.completed = false;
      task.status = 'overdue';
      void 0;
    } else if (targetStatus === 'onhold') {
      task.completed = false;
      task.status = 'onhold';
      void 0;
    } else if (status) {
      task.completed = false;
      task.status = status;
    }

    
    if (previousStatus !== task.status) {
      let logDescription = `Status changed from "${previousStatus}" to "${task.status}"`;
      if (elapsedSeconds > 0) {
        logDescription += ` (Timer stopped. Session duration: ${formatDuration(elapsedSeconds)}, Total time: ${formatDuration(task.timeSpent)})`;
      } else if (task.status === 'in-progress') {
        logDescription += ` (Timer started)`;
      }

      await addClientActivityLogHelper(task, {
        action: 'status_updated',
        description: logDescription,
        oldValues: {status: previousStatus},
        newValues: {status: task.status},
        user: currentUser?.id || currentUser?._id,
        userName: currentUser?.name || currentUser?.username || 'System'
      }, req);
      void 0;
    }

    
    if (previousCompleted !== task.completed) {
      const action = task.completed ? 'completed' : 'reopened';
      await addClientActivityLogHelper(task, {
        action: action,
        description: `Task ${action}`,
        user: currentUser?.id || currentUser?._id,
        userName: currentUser?.name || currentUser?.username || 'System'
      }, req);
      void 0;
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
      void 0;
    }

    await task.save();

    if (!previousCompleted && task.completed) {
      await notifyClientTaskCompleted({task, actor: currentUser, req});
    }

    if (previousStatus !== task.status || previousCompleted !== task.completed || (remarks && remarks.trim())) {
      const statusMessage = previousStatus !== task.status
        ? `${currentUser?.name || 'User'} changed task "${task.name}" status to ${task.status}`
        : `${currentUser?.name || 'User'} updated task "${task.name}"`;

      try {
        const client = await Client.findById(task.clientId).select('client name email company companyCode userId');
        await notifyPageUsers({
          companyId: getNotificationCompanyId(client, req.user),
          targetPath: '/ciisUser/company-all-task',
          type: 'task_status_updated',
          title: 'Client Task Status Updated',
          message: statusMessage,
          data: {taskId: task._id, status: task.status, source: 'client_task'},
          priority: task.completed ? 'high' : 'medium',
        });
        await notifyClientPortalUsers({
          client,
          task,
          actor: currentUser,
          title: 'Task Status Updated',
          message: statusMessage,
          data: {status: task.status},
          priority: task.completed ? 'high' : 'medium',
        });
      } catch (notifyErr) {
        console.error('Error notifying client task status update:', notifyErr);
      }
    }

    void 0;

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
    
    let filter = await getAssignedClientTaskFilter(currentUser);

    if (status && status !== 'all' && status !== '') {
      if (status === 'completed') {
        filter.completed = true;
      } else if (status === 'pending') {
        filter.completed = false;
        filter.status = 'pending';
      } else if (status === 'in-progress') {
        filter.status = 'in-progress';
        filter.completed = false;
      } else if (status === 'overdue') {
        filter.completed = false;
        addDueDateCondition(filter, { $lt: getClientTaskOverdueCutoff() });
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

    const dueDateRange = getClientTaskDueDateRange(period);
    if (dueDateRange) {
      addDueDateCondition(filter, dueDateRange);
    }

    const { page, limit, skip } = getPaginationOptions(req.query, { limit: 50, maxLimit: 100 });
    const [tasks, totalMatchingTasks] = await Promise.all([
      Task.find(filter)
        .populate('clientId', 'name email company phone')
        .sort({ dueDate: 1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Task.countDocuments(filter)
    ]);

    const groupedTasks = {};
    let overdueCount = 0;
    tasks.forEach(task => {
      let taskStatus = 'pending';
      if (task.completed) {
        taskStatus = 'completed';
      } else if (task.status === 'in-progress') {
        taskStatus = 'in-progress';
      }
      
      if (isClientTaskOverdue(task)) {
        taskStatus = 'overdue';
        overdueCount++;
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
      pageStats: stats,
      count: tasks.length,
      total: totalMatchingTasks,
      pagination: buildPaginationMeta({ page, limit, total: totalMatchingTasks }),
      statsEndpoint: '/assigned-to-me/stats'
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

const getAssignedToMeTaskStats = async (req, res) => {
  try {
    const currentUser = req.user;

    if (!currentUser) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    const { status, search, period } = req.query;
    let filter = await getAssignedClientTaskFilter(currentUser);

    if (status && status !== 'all' && status !== '') {
      if (status === 'completed') {
        filter.completed = true;
      } else if (status === 'pending') {
        filter.completed = false;
        filter.status = 'pending';
      } else if (status === 'in-progress') {
        filter.status = 'in-progress';
        filter.completed = false;
      } else if (status === 'overdue') {
        filter.completed = false;
        addDueDateCondition(filter, { $lt: getClientTaskOverdueCutoff() });
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

    const dueDateRange = getClientTaskDueDateRange(period);
    if (dueDateRange) {
      addDueDateCondition(filter, dueDateRange);
    }

    const tasks = await Task.find(filter).select('completed status dueDate').lean();

    return res.json({
      success: true,
      view: 'client',
      stats: calculateClientAssignedStats(tasks)
    });
  } catch (error) {
    console.error('❌ Error in getAssignedToMeTaskStats:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch client task stats',
      message: error.message
    });
  }
};


const getAssignedTasksByUserId = async (req, res) => {
  try {
    const { userId } = req.params;
    const User = require('../../models/User');

    const user = await User.findById(userId).select('name email').lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const tasks = await Task.find({
      $or: [
        { assignee: userId.toString() },
        { assignee: userId },
        { assignee: user.name },
        { assignee: user.email }
      ]
    })
      .populate('clientId', 'name email company phone')
      .sort({ createdAt: -1 });

    const formattedTasks = tasks.map(task => ({
      _id: task._id,
      title: task.name,
      name: task.name,
      description: task.description || task.name,
      dueDate: task.dueDate,
      dueDateTime: task.dueDate,
      completed: task.completed,
      status: task.completed
        ? 'completed'
        : task.status === 'in-progress'
        ? 'in-progress'
        : 'pending',
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
      source: 'client'
    }));

    res.json({
      success: true,
      tasks: formattedTasks,
      count: formattedTasks.length
    });

  } catch (error) {
    console.error('❌ Error in getAssignedTasksByUserId:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch assigned tasks by user',
      message: error.message
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

    const filter = { clientId, service };
    if (req.query.subscriptionId && mongoose.Types.ObjectId.isValid(req.query.subscriptionId)) {
      filter.subscriptionId = req.query.subscriptionId;
    } else if (req.query.subscriptionNo) {
      filter.subscriptionNo = Number(req.query.subscriptionNo);
    } else if (req.query.startDate && req.query.endDate) {
      filter.createdAt = {
        $gte: new Date(req.query.startDate),
        $lte: new Date(req.query.endDate)
      };
    }

    const { page, limit, skip } = getPaginationOptions(req.query, { limit: 50, maxLimit: 100 });
    const [tasks, total] = await Promise.all([
      Task.find(filter)
        .sort({ completed: 1, dueDate: 1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Task.countDocuments(filter)
    ]);

    res.json({
      success: true,
      data: tasks,
      count: tasks.length,
      total,
      pagination: buildPaginationMeta({ page, limit, total })
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
    const { service, completed, assignee, priority, subscriptionId, subscriptionNo } = req.query;

    const filter = { clientId };
    if (service) filter.service = service;
    if (completed !== undefined) filter.completed = completed === 'true';
    if (assignee) filter.assignee = assignee;
    if (priority) filter.priority = priority;
    if (subscriptionId && mongoose.Types.ObjectId.isValid(subscriptionId)) filter.subscriptionId = subscriptionId;
    if (subscriptionNo) filter.subscriptionNo = Number(subscriptionNo);

    if (!subscriptionId && !subscriptionNo && req.query.startDate && req.query.endDate) {
      filter.createdAt = {
        $gte: new Date(req.query.startDate),
        $lte: new Date(req.query.endDate)
      };
    }

    const { page, limit, skip } = getPaginationOptions(req.query, { limit: 50, maxLimit: 100 });
    const [tasks, total] = await Promise.all([
      Task.find(filter)
        .populate('remarks.user', 'name email')
        .sort({ completed: 1, dueDate: 1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Task.countDocuments(filter)
    ]);

    const tasksByService = {};
    tasks.forEach(task => {
      if (!tasksByService[task.service]) {
        tasksByService[task.service] = [];
      }
      tasksByService[task.service].push(task);
    });

    const pageTotalTasks = tasks.length;
    const completedTasks = tasks.filter(t => t.completed).length;
    const pendingTasks = pageTotalTasks - completedTasks;
    
    const overdueTasks = tasks.filter(t => {
      return isClientTaskOverdue(t);
    }).length;

    res.json({
      success: true,
      data: {
        tasks,
        groupedByService: tasksByService,
        pageStats: {
          totalTasks: pageTotalTasks,
          completedTasks,
          pendingTasks,
          overdueTasks,
          completionRate: pageTotalTasks > 0 ? Math.round((completedTasks / pageTotalTasks) * 100) : 0
        }
      },
      count: tasks.length,
      total,
      pagination: buildPaginationMeta({ page, limit, total }),
      statsEndpoint: `/client/${clientId}/stats`
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
    const { name, dueDate, dueDateTime, assignee, assigneeId, priority, description, subscriptionId, subscriptionNo } = req.body;
    const currentUser = req.user;
    const parsedDueDate = parseClientDueDate(dueDateTime || dueDate);

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

    const selectedSubscription = subscriptionId
      ? client.subscription.id(subscriptionId)
      : subscriptionNo
        ? client.subscription.find(sub => Number(sub.subscriptionNo) === Number(subscriptionNo))
        : client.subscription?.[client.subscription.length - 1];

    let resolvedAssigneeId = assigneeId || null;
    if (!resolvedAssigneeId && assignee) {
      const user = await User.findOne({ name: assignee });
      if (user) {
        resolvedAssigneeId = user._id;
      }
    }

    const task = new Task({
      clientId,
      subscriptionId: selectedSubscription?._id || null,
      subscriptionNo: selectedSubscription?.subscriptionNo || null,
      planId: selectedSubscription?.planId || null,
      planName: selectedSubscription?.planName || '',
      service,
      name: name.trim(),
      description: description || name.trim(),
      dueDate: parsedDueDate,
      assignee: assignee || '',
      assigneeId: resolvedAssigneeId,
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

    
    try {
      await notifyPageUsers({
        companyId: getNotificationCompanyId(client, req.user),
        targetPath: '/ciisUser/company-all-task',
        type: 'task_assigned',
        title: 'New Client Task Created',
        message: `${currentUser?.name || 'User'} created task "${task.name}" for client ${client.client || client.name}`,
        data: { taskId: task._id },
        priority: 'medium'
      });
    } catch (notifyErr) {
      console.error('Error notifying page users for client task create:', notifyErr);
    }

    try {
      await notifyAssignedClientTaskUser({
        task,
        actor: currentUser,
        title: 'New Client Task Assigned',
        message: `You have been assigned client task "${task.name}" for ${getClientDisplayName(client)}`,
        priority: 'high',
      });
      await notifyClientPortalUsers({
        client,
        task,
        actor: currentUser,
        title: 'New Task Created',
        message: `New task created: ${task.name}`,
        priority: 'high',
      });
    } catch (notifyErr) {
      console.error('Error notifying client/assignee for client task create:', notifyErr);
    }

    
    try {
      if (client && client.email) {
        const subject = `New Task Created: ${task.name}`;
        const html = `<p>Hello ${client.client || client.name || 'Client'},</p><p>A new task "${task.name}" has been created for your project/service.</p><p>Details: ${task.description || ''}</p>`;
        await sendEmail(client.email, subject, html, {
          skipNotification: true,
          notificationType: 'task_client',
          notificationTargetPath: '/ciisUser/ClientDashboard',
          notificationMessage: `New task created: ${task.name}`,
          notificationData: {taskId: task._id, source: 'client_task'},
          notificationPriority: 'high',
        });
      }
    } catch (emailErr) {
      console.error('Error sending client email for new task:', emailErr);
    }

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
    const previousCompleted = task.completed;
    const previousStatus = task.status;
    const now = new Date();
    
    
    for (const key of Object.keys(updates)) {
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
        
        
        if (oldValue === 'in-progress') {
          if (task.inProgressSince) {
            const elapsed = Math.max(0, Math.floor((now - new Date(task.inProgressSince)) / 1000));
            task.timeSpent = (task.timeSpent || 0) + elapsed;
            task.inProgressSince = null;
            changes.push(`timer stopped (session duration: ${formatDuration(elapsed)}, total: ${formatDuration(task.timeSpent)})`);
          }
        }
        
        
        if (newValue === 'in-progress') {
          task.inProgressSince = now;
          changes.push(`timer started`);
        }

        if (newValue === 'completed') {
          task.completed = true;
          task.completedAt = task.completedAt || now;
        } else if (oldValue === 'completed') {
          task.completed = false;
          task.completedAt = null;
        }
      } else if (key === 'completed' && oldValue !== newValue) {
        changes.push(`completed from "${oldValue}" to "${newValue}"`);
        task.completed = !!newValue;
        task.completedAt = task.completed ? (task.completedAt || now) : null;
        
        
        if (task.completed && task.status === 'in-progress' && task.inProgressSince) {
          const elapsed = Math.max(0, Math.floor((now - new Date(task.inProgressSince)) / 1000));
          task.timeSpent = (task.timeSpent || 0) + elapsed;
          task.inProgressSince = null;
          changes.push(`timer stopped (session duration: ${formatDuration(elapsed)}, total: ${formatDuration(task.timeSpent)})`);
        }
        
        task.status = task.completed ? 'completed' : 'pending';
      } else if (key === 'priority' && oldValue !== newValue) {
        changes.push(`priority from "${oldValue}" to "${newValue}"`);
        task[key] = newValue;
      } else if (key === 'assignee' && oldValue !== newValue) {
        changes.push(`assignee from "${oldValue}" to "${newValue}"`);
        task[key] = newValue;
        
        
        if (updates.assigneeId === undefined) {
          const user = await User.findOne({ name: newValue });
          task.assigneeId = user ? user._id : null;
        }
      } else if (key === 'assigneeId' && oldValue !== newValue) {
        task[key] = newValue;
      } else if ((key === 'dueDate' || key === 'dueDateTime') && newValue !== undefined) {
        const parsedDueDate = parseClientDueDate(newValue);
        const oldTime = oldValue ? new Date(oldValue).getTime() : null;
        const newTime = parsedDueDate ? parsedDueDate.getTime() : null;
        if (oldTime !== newTime) {
          changes.push(`due date from "${oldValue}" to "${parsedDueDate}"`);
        }
        task.dueDate = parsedDueDate;
      } else if (updates[key] !== undefined) {
        task[key] = updates[key];
      }
    }

    if (changes.length > 0) {
      await addClientActivityLogHelper(task, {
        action: 'updated',
        description: `Updated: ${changes.join(', ')}`,
        user: currentUser?.id || currentUser?._id,
        userName: currentUser?.name || currentUser?.username || 'System'
      }, req);
    }

    await task.save();

    if (!previousCompleted && task.completed) {
      await notifyClientTaskCompleted({task, actor: currentUser, req});
    }

    
    if (changes.length > 0) {
      try {
        const client = await Client.findById(task.clientId).select('client name email company companyCode userId');
        await notifyPageUsers({
          companyId: getNotificationCompanyId(client, req.user),
          targetPath: '/ciisUser/company-all-task',
          type: 'task_assigned',
          title: 'Client Task Updated',
          message: `${currentUser?.name || 'User'} updated task "${task.name}" (${changes.join(', ')})`,
          data: { taskId: task._id, changes },
          priority: 'medium'
        });
        await notifyAssignedClientTaskUser({
          task,
          actor: currentUser,
          title: 'Client Task Updated',
          message: `${currentUser?.name || 'User'} updated client task "${task.name}"`,
          data: {changes},
          priority: 'medium',
        });
        await notifyClientPortalUsers({
          client,
          task,
          actor: currentUser,
          title: 'Task Updated',
          message: `Task updated: ${task.name}`,
          data: {changes},
          priority: 'medium',
        });
      } catch (notifyErr) {
        console.error('Error notifying users for client task update:', notifyErr);
      }

      
      try {
        const client = await Client.findById(task.clientId).select('name email');
        if (client && client.email) {
          const subject = `Task Updated: ${task.name}`;
          const html = `<p>Hello ${client.client || client.name || 'Client'},</p><p>The task "${task.name}" has been updated: ${changes.join(', ')}.</p>`;
          await sendEmail(client.email, subject, html, {
            skipNotification: true,
            notificationType: 'task_client',
            notificationTargetPath: '/ciisUser/ClientDashboard',
            notificationMessage: `Task updated: ${task.name}`,
            notificationData: {taskId: task._id, source: 'client_task'},
            notificationPriority: 'medium',
          });
        }
      } catch (emailErr) {
        console.error('Error sending client email for task update:', emailErr);
      }
    }

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
    const previousStatus = task.status;
    const now = new Date();
    
    let elapsedSeconds = 0;
    if (previousStatus === 'in-progress') {
      if (task.inProgressSince) {
        elapsedSeconds = Math.max(0, Math.floor((now - new Date(task.inProgressSince)) / 1000));
        task.timeSpent = (task.timeSpent || 0) + elapsedSeconds;
        task.inProgressSince = null;
      }
    }

    task.completed = !task.completed;
    task.completedAt = task.completed ? now : null;
    task.status = task.completed ? 'completed' : 'pending';
    
    const action = task.completed ? 'completed' : 'reopened';
    let logDescription = `Task ${action}`;
    if (elapsedSeconds > 0) {
      logDescription += ` (Timer stopped. Session duration: ${formatDuration(elapsedSeconds)}, Total time: ${formatDuration(task.timeSpent)})`;
    }

    await addClientActivityLogHelper(task, {
      action: action,
      description: logDescription,
      user: currentUser?.id || currentUser?._id,
      userName: currentUser?.name || currentUser?.username || 'System'
    }, req);
    
    await task.save();

    if (!previousCompleted && task.completed) {
      await notifyClientTaskCompleted({task, actor: currentUser, req});
    }

    if (previousCompleted && !task.completed) {
      try {
        const client = await Client.findById(task.clientId).select('client name email company companyCode userId');
        await notifyClientPortalUsers({
          client,
          task,
          actor: currentUser,
          title: 'Task Reopened',
          message: `Task reopened: ${task.name}`,
          data: {status: task.status},
          priority: 'medium',
        });
        await notifyAssignedClientTaskUser({
          task,
          actor: currentUser,
          title: 'Client Task Reopened',
          message: `${currentUser?.name || 'User'} reopened client task "${task.name}"`,
          data: {status: task.status},
          priority: 'medium',
        });
      } catch (notifyErr) {
        console.error('Error notifying client task reopen:', notifyErr);
      }
    }

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

    try {
      const client = await Client.findById(task.clientId).select('client name email company companyCode userId');
      await notifyPageUsers({
        companyId: getNotificationCompanyId(client, req.user),
        targetPath: '/ciisUser/company-all-task',
        type: 'task_status_updated',
        title: 'Client Task Deleted',
        message: `${currentUser?.name || 'User'} deleted client task "${task.name}"`,
        data: {taskId: task._id, source: 'client_task'},
        priority: 'medium',
      });
      await notifyAssignedClientTaskUser({
        task,
        actor: currentUser,
        title: 'Client Task Deleted',
        message: `Client task "${task.name}" was deleted`,
        priority: 'medium',
      });
      await notifyClientPortalUsers({
        client,
        task,
        actor: currentUser,
        title: 'Task Deleted',
        message: `Task deleted: ${task.name}`,
        priority: 'medium',
      });
    } catch (notifyErr) {
      console.error('Error notifying client task delete:', notifyErr);
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
                    { $lt: ['$dueDate', getClientTaskOverdueCutoff()] }
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
          },
          pendingTasks: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$completed', false] },
                    { $ne: ['$status', 'in-progress'] }
                  ]
                },
                1,
                0
              ]
            }
          },
          inProgressTasks: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$completed', false] },
                    { $eq: ['$status', 'in-progress'] }
                  ]
                },
                1,
                0
              ]
            }
          },
          overdueTasks: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$completed', false] },
                    { $ne: ['$dueDate', null] },
                    { $lt: ['$dueDate', getClientTaskOverdueCutoff()] }
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
          _id: 0,
          totalTasks: 1,
          completedTasks: 1,
          pendingTasks: 1,
          inProgressTasks: 1,
          overdueTasks: 1
        }
      }
    ]);

    const emptyOverallStats = {
      totalTasks: 0,
      completedTasks: 0,
      pendingTasks: 0,
      inProgressTasks: 0,
      overdueTasks: 0,
      completionRate: 0
    };
    const overall = overallStats.length > 0 ? overallStats[0] : emptyOverallStats;
    overall.completionRate = overall.totalTasks > 0
      ? Math.round((overall.completedTasks / overall.totalTasks) * 100)
      : 0;

    res.json({
      success: true,
      data: {
        serviceStats: stats,
        overall
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
  getAssignedToMeTaskStats,
  updateAssignedTaskStatus,
  debugActivityLogs,
  getAssignedTasksByUserId
};

void 0;
