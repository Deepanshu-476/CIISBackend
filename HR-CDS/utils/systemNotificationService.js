const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const User = require('../../models/User');
const SidebarConfig = require('../../models/SidebarConfig');
const {sendPushToUsers} = require('./firebasePushService');

const ROUTE_TARGETS = {
  '/ciisUser/user-dashboard': {screen: 'Dashboard', aliases: ['dashboard', 'user-dashboard']},
  '/ciisUser/emp-attendance': {screen: 'Employee Attendance', aliases: ['employee-attendance', 'emp-attendance']},
  '/ciisUser/my-leaves': {screen: 'My Leaves', aliases: ['my-leaves']},
  '/ciisUser/emp-leaves': {screen: 'Employee Leaves', aliases: ['employee-leaves', 'emp-leaves']},
  '/ciisUser/my-assets': {screen: 'My Assets', aliases: ['my-assets']},
  '/ciisUser/emp-assets': {screen: 'Employee Assets', aliases: ['employee-assets', 'emp-assets']},
  '/ciisUser/task-management': {screen: 'Task Management', aliases: ['task-management', 'create-task']},
  '/ciisUser/admin-task-create': {screen: 'Admin Task Create', aliases: ['admin-task-create', 'admin-create-task']},
  '/ciisUser/company-all-task': {screen: 'Company All Task', aliases: ['company-all-task', 'company_all_task']},
  '/ciisUser/admin-meeting': {screen: 'Admin Meeting', aliases: ['admin-meeting', 'create-employee-meeting']},
  '/ciisUser/employee-meeting': {screen: 'Meeting', aliases: ['employee-meeting', 'meeting', 'meetings']},
  '/ciisUser/client-meeting': {screen: 'Client Meeting', aliases: ['client-meeting']},
  '/ciisUser/emp-client': {screen: 'Client', aliases: ['emp-client', 'client-management']},
  '/ciisUser/chat': {screen: 'Chat', aliases: ['chat']},
  '/ciisUser/manage-groups': {screen: 'Manage Groups', aliases: ['manage-groups', 'groups']},
  '/ciisUser/project': {screen: 'Project', aliases: ['project', 'projects']},
  '/ciisUser/adminproject': {screen: 'Admin Project', aliases: ['admin-projects', 'adminproject']},
};

const normalize = value => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
const getId = value => {
  if (!value) return '';
  if (typeof value === 'object') return String(value._id || value.id || value);
  return String(value);
};

const getCompanyId = userOrCompany =>
  getId(userOrCompany?.company?._id || userOrCompany?.company || userOrCompany?.companyId || userOrCompany);

const getTarget = targetPath => ROUTE_TARGETS[targetPath] || {screen: '', aliases: [normalize(targetPath?.split('/').pop())]};

const menuMatchesTarget = (item, targetPath, target) => {
  const candidates = [
    item?.path,
    item?.id,
    item?.name,
    item?.path?.split('/').filter(Boolean).pop(),
  ].map(normalize);

  const expected = [targetPath, ...(target.aliases || [])].map(normalize);
  return candidates.some(candidate => expected.includes(candidate));
};

const logNotificationDebug = (label, payload = {}) => {
  console.log(`[NOTIFICATION DEBUG] ${label}`, {
    at: new Date().toISOString(),
    ...payload,
  });
};

exports.resolveUsersWithPageAccess = async ({companyId, targetPath, excludeUserIds = []}) => {
  const company = getId(companyId);
  if (!company || !targetPath) return [];

  const target = getTarget(targetPath);
  const configs = await SidebarConfig.find({
    companyId: company,
    isActive: {$ne: false},
    menuItems: {$elemMatch: {path: targetPath}},
  }).populate('departmentId', 'name');

  const matchingConfigs = configs.length
    ? configs
    : await SidebarConfig.find({companyId: company, isActive: {$ne: false}}).populate('departmentId', 'name');

  const allowedCombos = matchingConfigs
    .filter(config => (config.menuItems || []).some(item => menuMatchesTarget(item, targetPath, target)))
    .map(config => ({
      role: config.role,
      departmentId: getId(config.departmentId),
      departmentName: config.departmentId?.name,
    }));

  const excluded = excludeUserIds.map(getId).filter(Boolean);
  const users = await User.find({
    company,
    isActive: true,
    ...(excluded.length ? {_id: {$nin: excluded}} : {}),
  }).select('_id jobRole companyRole department name');

  const allPageAdmins = users.filter(user =>
    normalize(user.department) === normalize('Management') &&
    normalize(user.jobRole) === normalize('super_admin')
  );

  const pageAssignedUsers = users.filter(user => {
    const isSuperAdminWithManagement =
      normalize(user.department) === normalize('Management') &&
      normalize(user.jobRole) === normalize('super_admin');

    if (isSuperAdminWithManagement) return false;

    return allowedCombos.some(combo => {
      const roleMatches = !combo.role ||
        normalize(user.jobRole) === normalize(combo.role) ||
        normalize(user.companyRole) === normalize(combo.role);
      const departmentMatches = !combo.departmentId ||
        normalize(user.department) === normalize(combo.departmentId) ||
        normalize(user.department) === normalize(combo.departmentName);
      return roleMatches && departmentMatches;
    });
  });

  const matchedUsersById = new Map();
  [...allPageAdmins, ...pageAssignedUsers].forEach(user => {
    matchedUsersById.set(user._id.toString(), user);
  });
  const matchedUsers = [...matchedUsersById.values()];

  logNotificationDebug('page-access:resolved-users', {
    company,
    targetPath,
    sidebarConfigCount: matchingConfigs.length,
    allowedComboCount: allowedCombos.length,
    allPageAdminCount: allPageAdmins.length,
    pageAssignedUserCount: pageAssignedUsers.length,
    matchedCount: matchedUsers.length,
    matchedUsers: matchedUsers.map(user => ({
      userId: user._id.toString(),
      name: user.name,
      department: user.department,
      jobRole: user.jobRole,
      companyRole: user.companyRole,
      allPages: normalize(user.department) === normalize('Management') &&
        normalize(user.jobRole) === normalize('super_admin'),
    })),
  });

  return matchedUsers;
};

exports.sendSystemNotification = async ({
  recipients = [],
  targetPath = '',
  targetScreen = '',
  type = 'system',
  title,
  message,
  actor = null,
  company = null,
  data = {},
  priority = 'medium',
  push = true,
}) => {
  const recipientIds = [...new Set(recipients.map(getId).filter(Boolean))];
  logNotificationDebug('sendSystemNotification:start', {
    recipientCount: recipientIds.length,
    recipients: recipientIds,
    type,
    title,
    targetPath,
    targetScreen,
    push,
  });

  if (!recipientIds.length) {
    logNotificationDebug('sendSystemNotification:skip-no-recipients', {type, title});
    return [];
  }

  const finalScreen = targetScreen || getTarget(targetPath).screen;
  const actorId = getId(actor) || null;
  const companyId = getId(company) || null;

  const docs = recipientIds.map(recipient => ({
    recipient,
    type,
    title,
    message,
    data,
    targetPath,
    targetScreen: finalScreen,
    actor: actorId && mongoose.Types.ObjectId.isValid(actorId) ? actorId : null,
    company: companyId && mongoose.Types.ObjectId.isValid(companyId) ? companyId : null,
    priority,
    isRead: false,
  }));

  const notifications = await Notification.insertMany(docs);
  logNotificationDebug('notifications:created', {
    count: notifications.length,
    ids: notifications.map(notification => notification._id.toString()),
  });

  // Fetch user preferences for these recipients to decide push / web notify
  const users = await User.find({_id: {$in: recipientIds}}).select('_id notificationPreferences name');
  const prefsById = users.reduce((acc, u) => {
    acc[String(u._id)] = u.notificationPreferences || {};
    return acc;
  }, {});

  // Helper: determine channel key from type
  const typeToChannel = t => {
    // Normalize known types
    const map = {
      'task_assigned': 'taskAssigned',
      'task_client': 'taskClient',
      'status_updated': 'taskAssigned', // treat status updates under taskAssigned channel by default
      'task_remark_added': 'taskAssigned', // remarks mapped to taskAssigned channel
      'leave': 'leave',
      'asset': 'assets',
      'project': 'projects',
      'chat': 'chats',
      'attendance': 'attendance',
    };
    return map[t] || null;
  };

  const channelKey = typeToChannel(type);

  const pushRecipients = [];
  const webRecipients = [];

  const now = new Date();
  const inQuietHours = (pref) => {
    try {
      const q = pref?.quietHours || {};
      if (!q || !q.start || !q.end) return false;
      const pad = s => s && s.length === 4 ? '0'+s : s;
      const [sh, sm] = (pad(q.start)).split(':').map(Number);
      const [eh, em] = (pad(q.end)).split(':').map(Number);
      const start = new Date(now);
      start.setHours(sh, sm || 0, 0, 0);
      const end = new Date(now);
      end.setHours(eh, em || 0, 0, 0);
      if (start <= end) {
        return now >= start && now <= end;
      }
      // overnight (e.g., 22:00 - 07:00)
      return now >= start || now <= end;
    } catch (err) {
      return false;
    }
  };

  notifications.forEach(notification => {
    const rid = String(notification.recipient);
    const pref = prefsById[rid] || {};

    // Web (socket) recipients — only if user enabled web notifications
    if (pref.web !== false) {
      webRecipients.push(notification.recipient);
    }

    // Push recipients: requires push enabled and channel enabled and not in quiet hours
    const pushEnabled = pref.push !== false;
    const channelEnabled = channelKey ? (pref.channels ? pref.channels[channelKey] !== false : true) : true;
    const suppressedByQuiet = inQuietHours(pref);

    if (push && pushEnabled && channelEnabled && !suppressedByQuiet) {
      pushRecipients.push(notification.recipient);
    }

    logNotificationDebug('recipient:preferences', {
      recipient: rid,
      webEnabled: pref.web !== false,
      pushEnabled,
      channelKey,
      channelEnabled,
      suppressedByQuiet,
      willPush: push && pushEnabled && channelEnabled && !suppressedByQuiet,
      willSocket: Boolean(global.io && pref.web !== false),
    });

    // Emit socket events for web recipients
    if (global.io && pref.web !== false) {
      global.io.to(`user:${notification.recipient}`).emit('notification:new', notification);
      global.io.to(`user_${notification.recipient}`).emit('new_notification', notification);
      logNotificationDebug('socket:notification-emitted', {
        recipient: rid,
        notificationId: notification._id.toString(),
        rooms: [`user:${rid}`, `user_${rid}`],
      });
    } else {
      logNotificationDebug('socket:notification-skipped', {
        recipient: rid,
        hasGlobalIo: Boolean(global.io),
        webEnabled: pref.web !== false,
      });
    }
  });

  if (global.io && webRecipients.length) {
    await Promise.all(webRecipients.map(async recipient => {
      const count = await Notification.countDocuments({
        recipient,
        isRead: false,
      });

      global.io.to(`user:${recipient}`).emit('notification:unread_count', count);
      global.io.to(`user_${recipient}`).emit('notification:unread_count', count);
      logNotificationDebug('socket:unread-count-emitted', {
        recipient: getId(recipient),
        count,
      });
    }));
  }

  // Send push only to filtered recipients
  if (push && pushRecipients.length) {
    logNotificationDebug('push:dispatch', {
      pushRecipientCount: pushRecipients.length,
      pushRecipients: pushRecipients.map(getId),
      title,
      type,
    });
    sendPushToUsers({
      userIds: pushRecipients,
      title,
      body: message,
      data: {
        notificationId: notifications[0]?._id,
        type,
        targetPath,
        targetScreen: finalScreen,
        ...data,
      },
    })
      .then(result => logNotificationDebug('push:result', result))
      .catch(error => console.error('[NOTIFICATION DEBUG] push:error', {
        at: new Date().toISOString(),
        message: error.message,
        stack: error.stack,
      }));
  } else {
    logNotificationDebug('push:skipped', {
      push,
      pushRecipientCount: pushRecipients.length,
      reason: push ? 'no eligible push recipients' : 'push disabled for call',
    });
  }

  return notifications;
};

exports.notifyPageUsers = async ({
  companyId,
  targetPath,
  excludeUserIds = [],
  ...notification
}) => {
  const users = await exports.resolveUsersWithPageAccess({companyId, targetPath, excludeUserIds});
  return exports.sendSystemNotification({
    recipients: users.map(user => user._id),
    targetPath,
    company: companyId,
    ...notification,
  });
};

exports.notifyDirectUsers = async ({userIds, ...notification}) =>
  exports.sendSystemNotification({
    recipients: userIds,
    ...notification,
  });

exports.getCompanyId = getCompanyId;
