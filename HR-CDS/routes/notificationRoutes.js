const express = require('express');
const router = express.Router();
const NotificationController = require('../controllers/NotificationController');
const Device = require('../../models/Device');
const User = require('../../models/User');
const SidebarConfig = require('../../models/SidebarConfig');
const {protect} = require('../../middleware/authMiddleware');
const {getFirebasePushStatus} = require('../utils/firebasePushService');
const {notifyDirectUsers} = require('../utils/systemNotificationService');

const MANUAL_NOTIFICATION_PAGE_ID = 'manual-notifications';

const getId = value => {
  if (!value) return '';
  if (typeof value === 'object') return String(value._id || value.id || value);
  return String(value);
};

const normalize = value => String(value || '').trim().toLowerCase();

const isCompanyAdmin = user => {
  const role = normalize(user?.role);
  const companyRole = normalize(user?.companyRole);
  const jobRole = normalize(user?.jobRole);
  return ['admin', 'owner', 'company_admin', 'company admin', 'superadmin', 'super_admin'].includes(role) ||
    ['admin', 'owner', 'company_admin', 'company admin'].includes(companyRole) ||
    ['superadmin', 'super_admin'].includes(jobRole);
};

const menuMatchesManualNotificationPage = item => {
  const values = [
    item?.id,
    item?.path,
    item?.path?.split('/').filter(Boolean).pop(),
    item?.name,
  ].map(value => normalize(value).replace(/[^a-z0-9]+/g, '-'));
  return values.includes(MANUAL_NOTIFICATION_PAGE_ID) ||
    values.includes('send-notification') ||
    values.includes('send-notifications');
};

const getManualNotificationAccess = async user => {
  const companyId = getId(user?.company);
  if (!companyId) return {scope: 'none', branchIds: [], departmentIds: []};

  if (isCompanyAdmin(user)) {
    return {scope: 'company', branchIds: [], departmentIds: [], source: 'admin'};
  }

  const query = {
    companyId,
    role: getId(user?.jobRole) || user?.jobRole || user?.role,
    isActive: {$ne: false},
  };
  const departmentId = getId(user?.department);
  const branchId = getId(user?.branch);
  if (departmentId) query.departmentId = departmentId;
  if (branchId) query.branchId = branchId;

  const config = await SidebarConfig.findOne(query).lean();
  const manualMenu = (config?.menuItems || []).find(menuMatchesManualNotificationPage);
  if (!manualMenu) return {scope: 'none', branchIds: [], departmentIds: []};

  const access = manualMenu.notificationAccess || {};
  return {
    scope: ['company', 'branch', 'department'].includes(access.scope) ? access.scope : 'company',
    branchIds: (access.branchIds || []).map(getId).filter(Boolean),
    departmentIds: (access.departmentIds || []).map(getId).filter(Boolean),
    source: 'sidebar',
  };
};

const publicUserProjection = '_id name email phone employeeId company companyCode branch branchCode department jobRole companyRole isActive';

const formatUser = user => ({
  _id: getId(user._id),
  name: user.name,
  email: user.email,
  phone: user.phone,
  employeeId: user.employeeId,
  companyRole: user.companyRole,
  jobRole: user.jobRole,
  branch: user.branch ? {
    _id: getId(user.branch),
    name: user.branch.name || user.branchCode || getId(user.branch),
    branchCode: user.branch.branchCode || user.branchCode || '',
  } : null,
  department: user.department ? {
    _id: getId(user.department),
    name: user.department.name || getId(user.department),
  } : null,
});

const loadScopedUsers = async (req, requestedScope, ids = []) => {
  const companyId = getId(req.user?.company);
  const access = await getManualNotificationAccess(req.user);
  if (!companyId || access.scope === 'none') {
    return {access, users: [], query: null};
  }

  const query = {
    company: companyId,
    isActive: true,
    _id: {$ne: req.user._id},
  };

  if (requestedScope === 'branch') {
    const requested = ids.map(getId).filter(Boolean);
    const allowed = access.scope === 'company'
      ? requested
      : access.scope === 'branch'
        ? requested.filter(id => access.branchIds.includes(id))
        : [];
    const fallbackBranch = access.scope === 'branch' && !allowed.length ? access.branchIds : [];
    const branchIds = allowed.length ? allowed : fallbackBranch;
    if (!branchIds.length) return {access, users: [], query};
    query.branch = {$in: branchIds};
  } else if (requestedScope === 'department') {
    const requested = ids.map(getId).filter(Boolean);
    const allowed = access.scope === 'company'
      ? requested
      : access.scope === 'department'
        ? requested.filter(id => access.departmentIds.includes(id))
        : [];
    const fallbackDepartments = access.scope === 'department' && !allowed.length ? access.departmentIds : [];
    const departmentIds = allowed.length ? allowed : fallbackDepartments;
    if (!departmentIds.length) return {access, users: [], query};
    query.department = {$in: departmentIds};
  } else if (access.scope === 'branch') {
    if (!access.branchIds.length) return {access, users: [], query};
    query.branch = {$in: access.branchIds};
  } else if (access.scope === 'department') {
    if (!access.departmentIds.length) return {access, users: [], query};
    query.department = {$in: access.departmentIds};
  }

  const users = await User.find(query)
    .select(publicUserProjection)
    .populate('branch', 'name branchCode')
    .populate('department', 'name')
    .sort({name: 1})
    .lean();

  return {access, users, query};
};

router.use(protect);

router.get('/', NotificationController.getMyNotifications);
router.get('/unread-count', NotificationController.getUnreadCount);
router.get('/manual/users/company', async (req, res) => {
  try {
    const {access, users} = await loadScopedUsers(req, 'company');
    res.json({success: true, access, data: users.map(formatUser)});
  } catch (error) {
    console.error('[MANUAL NOTIFICATION] company users failed:', error);
    res.status(500).json({success: false, message: 'Failed to load company users'});
  }
});

router.get('/manual/users/branch', async (req, res) => {
  try {
    const ids = String(req.query.branchIds || req.query.branchId || '')
      .split(',')
      .map(item => item.trim())
      .filter(Boolean);
    const {access, users} = await loadScopedUsers(req, 'branch', ids);
    res.json({success: true, access, data: users.map(formatUser)});
  } catch (error) {
    console.error('[MANUAL NOTIFICATION] branch users failed:', error);
    res.status(500).json({success: false, message: 'Failed to load branch users'});
  }
});

router.get('/manual/users/department', async (req, res) => {
  try {
    const ids = String(req.query.departmentIds || req.query.departmentId || '')
      .split(',')
      .map(item => item.trim())
      .filter(Boolean);
    const {access, users} = await loadScopedUsers(req, 'department', ids);
    res.json({success: true, access, data: users.map(formatUser)});
  } catch (error) {
    console.error('[MANUAL NOTIFICATION] department users failed:', error);
    res.status(500).json({success: false, message: 'Failed to load department users'});
  }
});

router.post('/manual/send', async (req, res) => {
  try {
    const title = String(req.body.title || '').trim();
    const message = String(req.body.message || '').trim();
    const requestedUserIds = Array.isArray(req.body.userIds) ? req.body.userIds.map(getId).filter(Boolean) : [];

    if (!title || !message) {
      return res.status(400).json({success: false, message: 'Title and message are required'});
    }
    if (!requestedUserIds.length) {
      return res.status(400).json({success: false, message: 'Select at least one user'});
    }

    const {users, access} = await loadScopedUsers(req, 'company');
    const allowedIds = new Set(users.map(user => getId(user._id)));
    const finalUserIds = [...new Set(requestedUserIds)].filter(id => allowedIds.has(id));

    if (!finalUserIds.length) {
      return res.status(403).json({success: false, message: 'Selected users are outside your notification access'});
    }

    const notifications = await notifyDirectUsers({
      userIds: finalUserIds,
      targetPath: '/ciisUser/notifications',
      targetScreen: 'Notifications',
      type: 'manual_notification',
      title,
      message,
      actor: req.user._id,
      company: getId(req.user.company),
      data: {
        source: 'manual_notification',
        senderId: getId(req.user._id),
        senderName: req.user.name,
      },
      priority: 'high',
      push: true,
    });

    res.status(201).json({
      success: true,
      message: `Notification sent to ${finalUserIds.length} user${finalUserIds.length === 1 ? '' : 's'}`,
      access,
      data: {
        sentCount: finalUserIds.length,
        notificationIds: notifications.map(notification => getId(notification._id)),
      },
    });
  } catch (error) {
    console.error('[MANUAL NOTIFICATION] send failed:', error);
    res.status(500).json({success: false, message: 'Failed to send notification'});
  }
});
router.get('/push-status', async (req, res) => {
  try {
    const [myDeviceCount, totalDeviceCount, recentDevices] = await Promise.all([
      Device.countDocuments({userId: req.user._id, deviceToken: {$exists: true, $ne: ''}}),
      Device.countDocuments({deviceToken: {$exists: true, $ne: ''}}),
      Device.find({deviceToken: {$exists: true, $ne: ''}})
        .sort({updatedAt: -1, createdAt: -1})
        .limit(5)
        .select('userId platform notificationPermission updatedAt createdAt deviceToken')
        .lean(),
    ]);

    res.json({
      success: true,
      firebase: getFirebasePushStatus(),
      devices: {
        currentUser: myDeviceCount,
        total: totalDeviceCount,
        recent: recentDevices.map(device => ({
          userId: String(device.userId || ''),
          platform: device.platform,
          notificationPermission: device.notificationPermission,
          updatedAt: device.updatedAt,
          createdAt: device.createdAt,
          tokenPreview: device.deviceToken
            ? `${String(device.deviceToken).slice(0, 12)}...${String(device.deviceToken).slice(-6)}`
            : null,
        })),
      },
    });
  } catch (error) {
    console.error('[FCM DEBUG] push-status:error', {
      at: new Date().toISOString(),
      userId: req.user?._id?.toString(),
      message: error.message,
      stack: error.stack,
    });
    res.status(500).json({success: false, message: 'Failed to load push status'});
  }
});
router.patch('/read-all', NotificationController.markAllAsRead);
router.patch('/:id/read', NotificationController.markAsRead);
router.delete('/:id', NotificationController.deleteNotification);

router.post('/devices', async (req, res) => {
  try {
    const {deviceToken, platform, userAgent, notificationPermission} = req.body;
    console.log('[FCM DEBUG] device-register:request', {
      at: new Date().toISOString(),
      userId: req.user?._id?.toString(),
      platform,
      notificationPermission,
      hasDeviceToken: Boolean(deviceToken),
      tokenPreview: deviceToken ? `${String(deviceToken).slice(0, 12)}...${String(deviceToken).slice(-6)}` : null,
      userAgent: userAgent || req.get('user-agent'),
      ipAddress: req.ip,
    });

    if (!deviceToken) {
      console.warn('[FCM DEBUG] device-register:missing-token', {
        at: new Date().toISOString(),
        userId: req.user?._id?.toString(),
      });
      return res.status(400).json({success: false, message: 'deviceToken is required'});
    }

    const device = await Device.findOneAndUpdate(
      {deviceToken},
      {
        userId: req.user._id,
        deviceToken,
        platform,
        notificationPermission,
        userAgent: userAgent || req.get('user-agent'),
        ipAddress: req.ip,
        updatedAt: new Date(),
      },
      {new: true, upsert: true, setDefaultsOnInsert: true}
    );

    console.log('[FCM DEBUG] device-register:success', {
      at: new Date().toISOString(),
      userId: req.user?._id?.toString(),
      deviceId: device._id?.toString(),
      platform: device.platform,
      notificationPermission: device.notificationPermission,
      tokenPreview: `${String(device.deviceToken).slice(0, 12)}...${String(device.deviceToken).slice(-6)}`,
    });

    res.status(200).json({success: true, data: device});
  } catch (error) {
    console.error('[FCM DEBUG] device-register:error', {
      at: new Date().toISOString(),
      userId: req.user?._id?.toString(),
      message: error.message,
      stack: error.stack,
    });
    res.status(500).json({success: false, message: 'Device registration failed'});
  }
});

router.delete('/devices/:deviceToken', async (req, res) => {
  try {
    const result = await Device.deleteOne({userId: req.user._id, deviceToken: req.params.deviceToken});
    console.log('[FCM DEBUG] device-delete', {
      at: new Date().toISOString(),
      userId: req.user?._id?.toString(),
      deletedCount: result.deletedCount,
      tokenPreview: `${String(req.params.deviceToken).slice(0, 12)}...${String(req.params.deviceToken).slice(-6)}`,
    });
    res.json({success: true});
  } catch (error) {
    console.error('[FCM DEBUG] device-delete:error', {
      at: new Date().toISOString(),
      userId: req.user?._id?.toString(),
      message: error.message,
    });
    res.status(500).json({success: false, message: 'Device removal failed'});
  }
});

// Get current user's notification preferences
router.get('/preferences', async (req, res) => {
  try {
    const user = await req.user.populate('notificationPreferences').execPopulate?.() || req.user;
    // send full preference object from DB
    const prefs = (await require('../../models/User').findById(req.user._id).select('notificationPreferences')).notificationPreferences;
    res.json({success: true, data: prefs});
  } catch (error) {
    console.error('Failed to get preferences:', error);
    res.status(500).json({success: false, message: 'Failed to get preferences'});
  }
});

// Update current user's notification preferences
router.put('/preferences', async (req, res) => {
  try {
    const updates = req.body || {};
    // Only allow notificationPreferences updates
    const allowed = { 'notificationPreferences': updates.notificationPreferences };
    const user = await require('../../models/User').findByIdAndUpdate(req.user._id, allowed, {new: true}).select('notificationPreferences');
    res.json({success: true, data: user.notificationPreferences});
  } catch (error) {
    console.error('Failed to update preferences:', error);
    res.status(500).json({success: false, message: 'Failed to update preferences'});
  }
});

module.exports = router;
