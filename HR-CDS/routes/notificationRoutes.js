const express = require('express');
const router = express.Router();
const NotificationController = require('../controllers/NotificationController');
const Device = require('../../models/Device');
const {protect} = require('../../middleware/authMiddleware');
const {getFirebasePushStatus} = require('../utils/firebasePushService');

router.use(protect);

router.get('/', NotificationController.getMyNotifications);
router.get('/unread-count', NotificationController.getUnreadCount);
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
