const Task = require('../models/ClientTask');
const Client = require('../models/Client');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const User = require('../../models/User');
const { notifyPageUsers, notifyDirectUsers } = require('../utils/systemNotificationService');
const { enqueueCompletionJob, enqueueBackgroundJob } = require('../utils/backgroundJobQueue');
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
const CLIENT_TASK_OVERDUE_EXCLUDED_STATUSES = ['completed', 'onhold', 'on hold'];

const isCompanyAllTaskEdit = (req) => (
  req.body?.allowCompanyAllTaskEdit === true ||
  req.body?.allowCompanyAllTaskEdit === 'true' ||
  req.headers?.['x-company-all-task-edit'] === 'true'
);

const isClientTaskOverdue = task => {
  if (!task?.dueDate || task.completed) return false;
  const status = String(task.status || 'pending').trim().toLowerCase();
  if (CLIENT_TASK_OVERDUE_EXCLUDED_STATUSES.includes(status)) return false;
  const dueDate = new Date(task.dueDate);
  return !Number.isNaN(dueDate.getTime()) && dueDate < new Date();
};

const isClientTaskOpen = task => {
  if (!task || task.completed) return false;
  const status = String(task.status || 'pending').trim().toLowerCase();
  return !CLIENT_TASK_OVERDUE_EXCLUDED_STATUSES.includes(status);
};

const normalizeClientTaskStatusForDueDate = task => {
  if (task?.completed) return 'completed';
  if (isClientTaskOverdue(task)) return 'overdue';
  const status = String(task?.status || 'pending').trim().toLowerCase();
  return status === 'overdue' ? 'pending' : (task?.status || 'pending');
};

const parseTaskCheckpoints = value => {
  if (!value || value === 'null') return [];
  const raw = typeof value === 'string' ? JSON.parse(value) : value;
  if (!Array.isArray(raw)) return [];

  return raw
    .map(item => {
      const title = typeof item === 'string' ? item : item?.title;
      const cleanTitle = String(title || '').trim();
      if (!cleanTitle) return null;

      const completed = Boolean(typeof item === 'object' ? item.completed : false);
      return {
        title: cleanTitle,
        completed,
        completedAt: completed ? (item?.completedAt ? new Date(item.completedAt) : new Date()) : null,
        completedBy: item?.completedBy || null
      };
    })
    .filter(Boolean);
};

const getLatestSubscription = client => {
  const subscriptions = Array.isArray(client?.subscription) ? client.subscription : [];
  if (!subscriptions.length) return null;

  return [...subscriptions].sort((a, b) => {
    const noDiff = Number(b?.subscriptionNo || 0) - Number(a?.subscriptionNo || 0);
    if (noDiff) return noDiff;
    return new Date(b?.endDate || 0) - new Date(a?.endDate || 0);
  })[0];
};

const syncExpiredSubscriptionClientTasks = async (clientIds = []) => {
  const normalizedClientIds = [...new Set(
    (Array.isArray(clientIds) ? clientIds : [clientIds])
      .map(id => String(id || '').trim())
      .filter(id => mongoose.Types.ObjectId.isValid(id))
  )];
  const now = new Date();
  const clientFilter = normalizedClientIds.length ? { _id: { $in: normalizedClientIds } } : {};
  const clients = await Client.find(clientFilter).select('_id subscription').lean();
  const bulkOps = [];

  clients.forEach(client => {
    const latestSubscription = getLatestSubscription(client);
    const subscriptionEnd = latestSubscription?.endDate ? new Date(latestSubscription.endDate) : null;
    if (!subscriptionEnd || Number.isNaN(subscriptionEnd.getTime()) || subscriptionEnd >= now) return;

    bulkOps.push({
      updateMany: {
        filter: {
          clientId: client._id,
          completed: { $ne: true },
          status: { $nin: ['completed', 'onhold', 'on hold', 'overdue'] }
        },
        update: {
          $set: {
            status: 'overdue'
          },
          $push: {
            activityLogs: {
              action: 'subscription_expired_task_overdue',
              userName: 'System',
              description: `Subscription expired on ${subscriptionEnd.toISOString()}`,
              oldValues: { syncedAt: now },
              newValues: {
                status: 'overdue',
                subscriptionEndDate: subscriptionEnd,
                subscriptionNo: latestSubscription.subscriptionNo || null,
                subscriptionId: latestSubscription._id || null
              },
              createdAt: now
            }
          }
        }
      }
    });
  });

  if (!bulkOps.length) {
    return { matchedCount: 0, modifiedCount: 0 };
  }

  const result = await Task.bulkWrite(bulkOps);
  return {
    matchedCount: result.matchedCount || 0,
    modifiedCount: result.modifiedCount || 0
  };
};

const applyClientTaskHoldTransition = (task, previousStatus, targetStatus, now = new Date()) => {
  const oldStatus = String(previousStatus || 'pending').trim().toLowerCase();
  const newStatus = String(targetStatus || 'pending').trim().toLowerCase();
  let holdSeconds = 0;

  if (newStatus === 'onhold' && oldStatus !== 'onhold') {
    task.holdStartedAt = task.holdStartedAt || now;
  }

  if (oldStatus === 'onhold' && newStatus !== 'onhold' && task.holdStartedAt) {
    holdSeconds = Math.max(0, Math.floor((now - new Date(task.holdStartedAt)) / 1000));
    task.totalHoldSeconds = (task.totalHoldSeconds || 0) + holdSeconds;
    task.holdStartedAt = null;

    if (task.dueDate && holdSeconds > 0) {
      const dueDate = new Date(task.dueDate);
      if (!Number.isNaN(dueDate.getTime())) {
        task.dueDate = new Date(dueDate.getTime() + holdSeconds * 1000);
      }
    }
  }

  return holdSeconds;
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

const getSubscriptionTaskDueDate = subscription => {
  if (!subscription?.endDate) return null;
  const dueDate = new Date(subscription.endDate);
  if (Number.isNaN(dueDate.getTime())) return null;
  return dueDate;
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

const escapeRegex = value => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getAssigneeNameAliases = value => {
  const name = String(value || '').trim();
  if (!name) return [];

  const aliases = new Set([name]);
  const firstName = name.split(/\s+/).find(Boolean);
  if (firstName && firstName.length >= 3) {
    aliases.add(firstName);
  }

  return [...aliases];
};

const buildAssigneeNameConditions = names => {
  const aliases = [...new Set(
    (Array.isArray(names) ? names : [names])
      .flatMap(getAssigneeNameAliases)
      .map(name => String(name || '').trim())
      .filter(Boolean)
  )];

  return aliases.flatMap(name => ([
    { assignee: name },
    { assignee: { $regex: `^${escapeRegex(name)}$`, $options: 'i' } }
  ]));
};

const resolveAssigneeUser = async (assignee, companyCode = '') => {
  const aliases = getAssigneeNameAliases(assignee);
  if (!aliases.length) return null;

  const companyCondition = companyCode ? { companyCode } : {};
  const exactUser = await User.findOne({
    ...companyCondition,
    $or: aliases.flatMap(name => ([
      { name },
      { email: name.toLowerCase() }
    ]))
  }).select('_id');

  if (exactUser) return exactUser;

  return User.findOne({
    ...companyCondition,
    $or: aliases.map(name => ({ name: { $regex: `^${escapeRegex(name)}(?:\\s|$)`, $options: 'i' } }))
  }).select('_id');
};

const getAssignedClientTaskFilter = async (currentUser) => {
  const companyCode = currentUser?.companyCode ? String(currentUser.companyCode).trim().toUpperCase() : '';
  const clientFilter = companyCode ? { companyCode } : {};
  const clients = await Client.find(clientFilter).select('_id').lean();
  const clientIds = clients.map(client => client._id);
  const currentUserId = currentUser.id || currentUser._id;

  return {
    clientId: { $in: clientIds },
    $or: [
      mongoose.Types.ObjectId.isValid(String(currentUserId || '')) ? { assigneeId: currentUserId } : null,
      { assignee: currentUser.id?.toString() },
      { assignee: currentUser._id?.toString() },
      ...buildAssigneeNameConditions([currentUser.name, currentUser.email])
    ].filter(Boolean)
  };
};

const normalizeClientTaskPriority = value => {
  const priority = String(value || '').trim().toLowerCase();
  if (priority === 'low') return 'Low';
  if (priority === 'high') return 'High';
  return 'Medium';
};

const calculateClientAssignedStats = tasks => {
  const total = tasks.length;
  const completed = tasks.filter(task => task.completed || task.status === 'completed').length;
  const overdue = tasks.filter(task => isClientTaskOpen(task) && isClientTaskOverdue(task)).length;
  const inProgress = tasks.filter(task => isClientTaskOpen(task) && !isClientTaskOverdue(task) && task.status === 'in-progress').length;
  const onHold = tasks.filter(task => task.status === 'onhold').length;
  const pending = tasks.filter(task => isClientTaskOpen(task) && !isClientTaskOverdue(task) && task.status !== 'in-progress').length;
  const percentage = count => total > 0 ? Math.round((count / total) * 100) : 0;

  return {
    total,
    completed: { count: completed, percentage: percentage(completed) },
    pending: { count: pending, percentage: percentage(pending) },
    inProgress: { count: inProgress, percentage: percentage(inProgress) },
    onHold: { count: onHold, percentage: percentage(onHold) },
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
    
    await task.save();
    const addedRemark = task.remarks[task.remarks.length - 1];
    const responseRemark = {
      ...(typeof addedRemark.toObject === 'function' ? addedRemark.toObject() : addedRemark),
      user: {
        _id: currentUser?.id || currentUser?._id,
        name: currentUser?.name || currentUser?.username || 'System',
        email: currentUser?.email || ''
      },
      userName: currentUser?.name || currentUser?.username || 'System'
    };

    res.status(201).json({
      success: true,
      message: 'Remark with images added successfully',
      data: responseRemark
    });

    void enqueueBackgroundJob(async () => {
      try {
        await addClientActivityLogHelper(task, {
          action: 'remark_added',
          description: `Added remark with ${images.length} image(s)${text ? `: ${text.substring(0, 50)}` : ''}`,
          user: currentUser?.id || currentUser?._id,
          userName: currentUser?.name || currentUser?.username || 'System'
        }, req);
      } catch (activityErr) {
        console.error('Error logging client remark activity:', activityErr);
      }

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
    
    await task.save();
    const addedRemark = task.remarks[task.remarks.length - 1];
    const responseRemark = {
      ...(typeof addedRemark.toObject === 'function' ? addedRemark.toObject() : addedRemark),
      user: {
        _id: currentUser?.id || currentUser?._id,
        name: currentUser?.name || currentUser?.username || 'System',
        email: currentUser?.email || ''
      },
      userName: currentUser?.name || currentUser?.username || 'System'
    };

    res.status(201).json({
      success: true,
      message: 'Remark added successfully',
      data: responseRemark
    });

    void enqueueBackgroundJob(async () => {
      try {
        await addClientActivityLogHelper(task, {
          action: 'remark_added',
          description: `Added remark: ${text.substring(0, 100)}${text.length > 100 ? '...' : ''}`,
          user: currentUser?.id || currentUser?._id,
          userName: currentUser?.name || currentUser?.username || 'System'
        }, req);
      } catch (activityErr) {
        console.error('Error logging client remark activity:', activityErr);
      }

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

    if (
      targetStatus !== 'overdue' &&
      (previousStatus === 'overdue' || isClientTaskOverdue(task)) &&
      !isCompanyAllTaskEdit(req)
    ) {
      if (previousStatus !== 'overdue' && isClientTaskOverdue(task)) {
        task.status = 'overdue';
        task.completed = false;
        await task.save();
      }
      return res.status(400).json({
        success: false,
        message: 'Cannot change status of an overdue task'
      });
    }

    
    let elapsedSeconds = 0;
    const holdSeconds = applyClientTaskHoldTransition(task, previousStatus, targetStatus, now);

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
      }
      if (holdSeconds > 0) {
        logDescription += ` (On hold paused for ${formatDuration(holdSeconds)}; due time resumed)`;
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

    const runStatusPostProcessing = async () => {
      if (!previousCompleted && task.completed) {
        await notifyClientTaskCompleted({task, actor: currentUser, req});
      }

      if (previousStatus !== task.status || previousCompleted !== task.completed || (remarks && remarks.trim())) {
        const statusMessage = previousStatus !== task.status
          ? `${currentUser?.name || 'User'} changed task "${task.name}" status to ${task.status}`
          : `${currentUser?.name || 'User'} updated task "${task.name}"`;

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
      }
    };

    if (task.completed && !previousCompleted) {
      enqueueCompletionJob(async () => {
        try {
          await runStatusPostProcessing();
        } catch (notifyErr) {
          console.error('Error notifying client task status update:', notifyErr);
        }
      });
    } else {
      void (async () => {
        try {
          await runStatusPostProcessing();
        } catch (notifyErr) {
          console.error('Error notifying client task status update:', notifyErr);
        }
      })();
    }

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
    await syncExpiredSubscriptionClientTasks();
    
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
      } else if (status === 'onhold') {
        filter.status = 'onhold';
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
    const returnAllTasks = ['true', '1', 'yes'].includes(
      String(req.query.all || req.query.noPagination || '').toLowerCase()
    );
    let tasksQuery = Task.find(filter)
      .populate('clientId', 'name email company phone')
      .sort({ dueDate: 1, createdAt: -1 });

    if (!returnAllTasks) {
      tasksQuery = tasksQuery.skip(skip).limit(limit);
    }

    const [tasks, totalMatchingTasks] = await Promise.all([
      tasksQuery.lean(),
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
      } else if (task.status === 'onhold') {
        taskStatus = 'onhold';
      }
      
      if (isClientTaskOverdue(task)) {
        taskStatus = 'overdue';
        overdueCount++;
      }

      const groupDate = task.dueDate || task.createdAt;
      const dateKey = new Date(groupDate).toLocaleDateString('en-IN', {
        timeZone: 'Asia/Kolkata',
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
        checkpoints: task.checkpoints || [],
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
    const pending = tasks.filter(t => isClientTaskOpen(t) && !isClientTaskOverdue(t) && t.status !== 'in-progress').length;
    const inProgress = tasks.filter(t => isClientTaskOpen(t) && !isClientTaskOverdue(t) && t.status === 'in-progress').length;

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
      ...(!returnAllTasks && {
        pagination: buildPaginationMeta({ page, limit, total: totalMatchingTasks })
      }),
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
    await syncExpiredSubscriptionClientTasks();
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
      } else if (status === 'onhold') {
        filter.status = 'onhold';
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

    await syncExpiredSubscriptionClientTasks();

    const tasks = await Task.find({
      $or: [
        mongoose.Types.ObjectId.isValid(String(userId || '')) ? { assigneeId: userId } : null,
        { assignee: userId.toString() },
        { assignee: userId },
        ...buildAssigneeNameConditions([user.name, user.email])
      ].filter(Boolean)
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
        : task.status === 'onhold'
        ? 'onhold'
        : isClientTaskOverdue(task)
        ? 'overdue'
        : task.status === 'in-progress'
        ? 'in-progress'
        : task.status || 'pending',
      priority: (task.priority || 'Medium').toLowerCase(),
      clientName: task.clientId?.name || 'Unknown Client',
      clientId: task.clientId,
      clientEmail: task.clientId?.email,
      clientCompany: task.clientId?.company,
      checkpoints: task.checkpoints || [],
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

    await syncExpiredSubscriptionClientTasks([clientId]);

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

    const responseTasks = tasks.map(task => ({
      ...task,
      status: normalizeClientTaskStatusForDueDate(task)
    }));

    res.json({
      success: true,
      data: responseTasks,
      count: responseTasks.length,
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

    await syncExpiredSubscriptionClientTasks([clientId]);

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

    const responseTasks = tasks.map(task => ({
      ...task,
      status: normalizeClientTaskStatusForDueDate(task)
    }));

    const tasksByService = {};
    responseTasks.forEach(task => {
      if (!tasksByService[task.service]) {
        tasksByService[task.service] = [];
      }
      tasksByService[task.service].push(task);
    });

    const pageTotalTasks = responseTasks.length;
    const completedTasks = responseTasks.filter(t => t.completed).length;
    const overdueTasks = responseTasks.filter(t => {
      return isClientTaskOverdue(t);
    }).length;
    const pendingTasks = responseTasks.filter(t => isClientTaskOpen(t) && !isClientTaskOverdue(t) && t.status !== 'in-progress').length;

    res.json({
      success: true,
      data: {
        tasks: responseTasks,
        groupedByService: tasksByService,
        pageStats: {
          totalTasks: pageTotalTasks,
          completedTasks,
          pendingTasks,
          overdueTasks,
          completionRate: pageTotalTasks > 0 ? Math.round((completedTasks / pageTotalTasks) * 100) : 0
        }
      },
      count: responseTasks.length,
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

// Return task counters for a page of clients in one database query. This avoids
// the client-management screen issuing one (or more) requests per client.
const getClientTaskSummaries = async (req, res) => {
  try {
    const rawIds = Array.isArray(req.query.clientIds)
      ? req.query.clientIds
      : String(req.query.clientIds || '').split(',');
    const clientIds = [...new Set(rawIds.map(id => String(id).trim()).filter(id => mongoose.Types.ObjectId.isValid(id)))];

    if (!clientIds.length) {
      return res.json({ success: true, data: {} });
    }
    if (clientIds.length > 100) {
      return res.status(400).json({ success: false, message: 'A maximum of 100 client IDs is allowed' });
    }

    await syncExpiredSubscriptionClientTasks(clientIds);

    const tasks = await Task.find({ clientId: { $in: clientIds } })
      .select('clientId name title taskName completed status dueDate')
      .lean();
    const summaries = Object.fromEntries(clientIds.map(id => [
      id,
      { total: 0, completed: 0, pending: 0, overdue: 0, overdueTaskNames: [] }
    ]));

    tasks.forEach(task => {
      const summary = summaries[String(task.clientId)];
      if (!summary) return;
      summary.total += 1;
      if (task.completed) summary.completed += 1;
      if (isClientTaskOverdue(task)) {
        summary.overdue += 1;
        const name = task.name || task.title || task.taskName;
        if (name) summary.overdueTaskNames.push(name);
      } else if (isClientTaskOpen(task) && task.status !== 'in-progress') {
        summary.pending += 1;
      }
    });

    return res.json({ success: true, data: summaries });
  } catch (error) {
    console.error('Error fetching client task summaries:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching client task summaries',
      error: error.message
    });
  }
};

const addTask = async (req, res) => {
  try {
    const { clientId, service } = req.params;
    const { name, dueDate, dueDateTime, assignee, assigneeId, priority, description, subscriptionId, subscriptionNo, checkpoints } = req.body;
    const currentUser = req.user;
    const requestedDueDate = dueDateTime || dueDate;
    const parsedDueDate = parseClientDueDate(requestedDueDate);

    if (!mongoose.Types.ObjectId.isValid(clientId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid client ID'
      });
    }

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

    const requestedService = String(service || '').trim();
    const clientServices = Array.isArray(client.services) ? client.services : [];
    const matchedService = clientServices.find(item => (
      String(item || '').trim().toLowerCase() === requestedService.toLowerCase()
    ));

    if (!matchedService) {
      return res.status(400).json({
        success: false,
        message: 'Service not found for this client'
      });
    }

    const subscriptions = Array.isArray(client.subscription) ? client.subscription : [];
    const selectedSubscription = subscriptionId && mongoose.Types.ObjectId.isValid(subscriptionId)
      ? (typeof client.subscription?.id === 'function'
          ? client.subscription.id(subscriptionId)
          : subscriptions.find(sub => String(sub?._id) === String(subscriptionId)))
      : subscriptionNo
        ? subscriptions.find(sub => Number(sub.subscriptionNo) === Number(subscriptionNo))
        : subscriptions[subscriptions.length - 1];
    const effectiveDueDate = parsedDueDate || getSubscriptionTaskDueDate(selectedSubscription);

    if (!effectiveDueDate) {
      return res.status(400).json({
        success: false,
        message: 'Task due date is required because the selected subscription has no valid end date'
      });
    }

    let resolvedAssigneeId = mongoose.Types.ObjectId.isValid(String(assigneeId || ''))
      ? assigneeId
      : null;
    if (!resolvedAssigneeId && assignee) {
      const user = await resolveAssigneeUser(assignee, client.companyCode);
      if (user) {
        resolvedAssigneeId = user._id;
      }
    }
    if (!resolvedAssigneeId) {
      const currentUserId = currentUser?.id || currentUser?._id;
      if (mongoose.Types.ObjectId.isValid(String(currentUserId || ''))) {
        resolvedAssigneeId = currentUserId;
      }
    }

    const safePlanId = mongoose.Types.ObjectId.isValid(String(selectedSubscription?.planId || ''))
      ? selectedSubscription.planId
      : null;
    const normalizedPriority = normalizeClientTaskPriority(priority);

    const task = new Task({
      clientId,
      subscriptionId: selectedSubscription?._id || null,
      subscriptionNo: selectedSubscription?.subscriptionNo || null,
      planId: safePlanId,
      planName: selectedSubscription?.planName || '',
      service: String(matchedService).trim(),
      name: name.trim(),
      description: description || name.trim(),
      dueDate: effectiveDueDate,
      dueDateSource: parsedDueDate ? 'manual' : 'subscription',
      assignee: assignee || '',
      assigneeId: resolvedAssigneeId,
      priority: normalizedPriority,
      status: 'pending',
      completed: false,
      checkpoints: parseTaskCheckpoints(checkpoints),
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
    const isInputError = error?.name === 'ValidationError' || error?.name === 'CastError';
    res.status(isInputError ? 400 : 500).json({
      success: false,
      message: isInputError ? 'Invalid client task data' : 'Error adding task',
      error: error.message
    });
  }
};

const updateTask = async (req, res) => {
  try {
    const { taskId } = req.params;
    const updates = { ...(req.body || {}) };
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

    // `dueDateTime` is a client-side alias for `dueDate`; only persist the schema field.
    if (updates.dueDate === undefined && updates.dueDateTime !== undefined) {
      updates.dueDate = updates.dueDateTime;
    }
    delete updates.dueDateTime;

    const allowedKeys = new Set([
      'name',
      'status',
      'completed',
      'priority',
      'assignee',
      'assigneeId',
      'dueDate',
      'checkpoints',
      'description'
    ]);

    const changes = [];
    const previousCompleted = task.completed;
    const previousStatus = task.status;
    const now = new Date();
    const hasAssigneeIdUpdate = Object.prototype.hasOwnProperty.call(updates, 'assigneeId');
    const isValidAssigneeIdUpdate = mongoose.Types.ObjectId.isValid(String(updates.assigneeId || ''));

    if (hasAssigneeIdUpdate && !isValidAssigneeIdUpdate) {
      updates.assigneeId = null;
    }

    if (updates.assignee && !updates.assigneeId) {
      const client = await Client.findById(task.clientId).select('companyCode').lean();
      const user = await resolveAssigneeUser(updates.assignee, client?.companyCode);
      updates.assigneeId = user ? user._id : null;
    }

    if (
      (updates.status || updates.completed !== undefined) &&
      updates.status !== 'overdue' &&
      (previousStatus === 'overdue' || isClientTaskOverdue(task)) &&
      !isCompanyAllTaskEdit(req)
    ) {
      if (previousStatus !== 'overdue' && isClientTaskOverdue(task)) {
        task.status = 'overdue';
        task.completed = false;
        await task.save({ validateModifiedOnly: true });
      }
      return res.status(400).json({
        success: false,
        message: 'Cannot change status of an overdue task'
      });
    }
    
    
    for (const key of Object.keys(updates)) {
      if (!allowedKeys.has(key)) continue;

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
        const holdSeconds = applyClientTaskHoldTransition(task, oldValue, newValue, now);
        if (holdSeconds > 0) {
          changes.push(`on-hold paused for ${formatDuration(holdSeconds)}; due time resumed`);
        }
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
        const completedTargetStatus = task.completed ? 'completed' : 'pending';
        const holdSeconds = applyClientTaskHoldTransition(task, task.status, completedTargetStatus, now);
        if (holdSeconds > 0) {
          changes.push(`on-hold paused for ${formatDuration(holdSeconds)}; due time resumed`);
        }
        
        
        if (task.completed && task.status === 'in-progress' && task.inProgressSince) {
          const elapsed = Math.max(0, Math.floor((now - new Date(task.inProgressSince)) / 1000));
          task.timeSpent = (task.timeSpent || 0) + elapsed;
          task.inProgressSince = null;
          changes.push(`timer stopped (session duration: ${formatDuration(elapsed)}, total: ${formatDuration(task.timeSpent)})`);
        }
        
        task.status = completedTargetStatus;
      } else if (key === 'priority') {
        newValue = normalizeClientTaskPriority(newValue);
        if (oldValue !== newValue) {
          changes.push(`priority from "${oldValue}" to "${newValue}"`);
          task[key] = newValue;
        }
      } else if (key === 'assignee' && oldValue !== newValue) {
        changes.push(`assignee from "${oldValue}" to "${newValue}"`);
        task[key] = newValue;
        
        
        if (!updates.assigneeId) {
          const client = await Client.findById(task.clientId).select('companyCode').lean();
          const user = await resolveAssigneeUser(newValue, client?.companyCode);
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
        task.dueDateSource = 'manual';
      } else if (key === 'checkpoints') {
        const parsedCheckpoints = parseTaskCheckpoints(newValue);
        changes.push(`checkpoints updated`);
        task.checkpoints = parsedCheckpoints;
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

    await task.save({ validateModifiedOnly: true });

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
    const isInputError = error?.name === 'ValidationError' || error?.name === 'CastError';
    res.status(isInputError ? 400 : 500).json({
      success: false,
      message: isInputError ? 'Invalid client task data' : 'Error updating task',
      ...(isInputError ? { details: error.message } : {}),
      error: error.message
    });
  }
};

const toggleTaskCompletion = async (req, res) => {
  try {
    const { taskId } = req.params;
    const { clientId } = req.body || {};
    const currentUser = req.user;

    if (!mongoose.Types.ObjectId.isValid(taskId)) {
      return res.status(400).json({
        success: false,
        message: 'Valid task id is required'
      });
    }

    const task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    if (clientId && String(task.clientId) !== String(clientId)) {
      return res.status(409).json({
        success: false,
        message: 'Task does not belong to this client'
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
    const targetStatus = task.completed ? 'completed' : 'pending';
    const holdSeconds = applyClientTaskHoldTransition(task, previousStatus, targetStatus, now);
    task.status = targetStatus;
    
    const action = task.completed ? 'completed' : 'reopened';
    let logDescription = `Task ${action}`;
    if (elapsedSeconds > 0) {
      logDescription += ` (Timer stopped. Session duration: ${formatDuration(elapsedSeconds)}, Total time: ${formatDuration(task.timeSpent)})`;
    }
    if (holdSeconds > 0) {
      logDescription += ` (On hold paused for ${formatDuration(holdSeconds)}; due time resumed)`;
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

const updateTaskCheckpoint = async (req, res) => {
  try {
    const { taskId, checkpointId } = req.params;
    const { completed } = req.body;
    const currentUser = req.user;

    const task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }

    const isAssignedToUser =
      task.assigneeId?.toString() === currentUser.id?.toString() ||
      task.assigneeId?.toString() === currentUser._id?.toString() ||
      task.assignee === currentUser.id?.toString() ||
      task.assignee === currentUser._id?.toString() ||
      task.assignee === currentUser.name ||
      task.assignee === currentUser.email;

    if (!isAssignedToUser) {
      return res.status(403).json({ success: false, message: 'You are not authorized to update this task' });
    }

    const checkpoint = task.checkpoints.id(checkpointId);
    if (!checkpoint) {
      return res.status(404).json({ success: false, message: 'Checkpoint not found' });
    }

    const previousStatus = task.status;
    const previousCompleted = task.completed;
    const now = new Date();
    const isCompleted = completed !== false;

    checkpoint.completed = isCompleted;
    checkpoint.completedAt = isCompleted ? now : null;
    checkpoint.completedBy = isCompleted ? (currentUser?.id || currentUser?._id) : null;

    const allCompleted = task.checkpoints.length > 0 && task.checkpoints.every(item => item.completed);
    if (allCompleted) {
      task.completed = true;
      task.completedAt = task.completedAt || now;
      task.status = 'completed';
      task.inProgressSince = null;
    } else if (previousCompleted) {
      task.completed = false;
      task.completedAt = null;
      task.status = 'in-progress';
    } else if (previousStatus === 'pending' && isCompleted) {
      task.status = 'in-progress';
      task.inProgressSince = task.inProgressSince || now;
    }

    await addClientActivityLogHelper(task, {
      action: 'checkpoint_updated',
      description: `${isCompleted ? 'Completed' : 'Reopened'} checkpoint: ${checkpoint.title}`,
      oldValues: {status: previousStatus, completed: previousCompleted},
      newValues: {status: task.status, completed: task.completed, checkpointId, checkpointCompleted: isCompleted},
      user: currentUser?.id || currentUser?._id,
      userName: currentUser?.name || currentUser?.username || 'System'
    }, req);

    await task.save();

    if (!previousCompleted && task.completed) {
      await notifyClientTaskCompleted({task, actor: currentUser, req});
    }

    res.json({
      success: true,
      message: 'Checkpoint updated successfully',
      data: task
    });
  } catch (error) {
    console.error('Error updating task checkpoint:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating checkpoint',
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
    await syncExpiredSubscriptionClientTasks([clientId]);
    const overdueCutoff = getClientTaskOverdueCutoff();
    const openTaskExpression = [
      { $eq: ['$completed', false] },
      { $not: [{ $in: ['$status', CLIENT_TASK_OVERDUE_EXCLUDED_STATUSES] }] }
    ];
    const overdueExpression = [
      ...openTaskExpression,
      { $ne: ['$dueDate', null] },
      { $lt: ['$dueDate', overdueCutoff] }
    ];
    const notOverdueExpression = { $not: [{ $and: overdueExpression }] };

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
            $sum: {
              $cond: [
                {
                  $and: [
                    ...openTaskExpression,
                    { $ne: ['$status', 'in-progress'] },
                    notOverdueExpression
                  ]
                },
                1,
                0
              ]
            }
          },
          highPriorityTasks: {
            $sum: { $cond: [{ $eq: ['$priority', 'High'] }, 1, 0] }
          },
          overdueTasks: {
            $sum: { $cond: [{ $and: overdueExpression }, 1, 0] }
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
                    ...openTaskExpression,
                    { $ne: ['$status', 'in-progress'] },
                    notOverdueExpression
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
                    ...openTaskExpression,
                    { $eq: ['$status', 'in-progress'] },
                    notOverdueExpression
                  ]
                },
                1,
                0
              ]
            }
          },
          overdueTasks: {
            $sum: { $cond: [{ $and: overdueExpression }, 1, 0] }
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
  getClientTaskSummaries,
  addTask,
  updateTask,
  updateTaskCheckpoint,
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
