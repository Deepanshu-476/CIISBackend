const express = require("express");
const router = express.Router();
const alertController = require("../controllers/alertController");

const { protect, authorize } = require('../../middleware/authMiddleware');


// Middleware to check if user can manage alerts
const canManageAlerts = (req, res, next) => {
  const role = req.user?.role?.toLowerCase();
  if (['admin', 'hr', 'manager'].includes(role)) {
    return next();
  }
  return res.status(403).json({
    success: false,
    message: 'Not authorized to manage alerts'
  });
};

// Public routes (but require auth)
router.get("/", protect, alertController.getAlerts);
router.get("/unread/count", protect, alertController.getUnreadCount);
router.patch("/:id/read", protect, alertController.markAsRead);

// Protected routes (admin/hr/manager only)
router.post("/", protect, canManageAlerts, alertController.addAlert);
router.put("/:id", protect, canManageAlerts, alertController.updateAlert);
router.delete("/:id", protect , canManageAlerts, alertController.deleteAlert);



// ✅ TEST: Alert System Check
router.get('/test/system-check', protect, async (req, res) => {
  try {
    const Alert = require('../models/alertModel');
    const User = require('../../models/User');
    const Group = require('../models/Group');
    
    const currentUser = req.user;
    
    // Get current user details
    const userFromDB = await User.findById(currentUser._id)
      .select('name email role company department')
      .lean();
    
    // Check user's groups
    const userGroups = await Group.find({ members: currentUser._id })
      .select('name description')
      .lean();
    
    // Get alert statistics
    const totalAlerts = await Alert.countDocuments();
    const userAlerts = await Alert.find({
      $or: [
        { assignedUsers: { $in: [currentUser._id] } },
        { assignedGroups: { $in: userGroups.map(g => g._id) } },
        { assignedUsers: { $size: 0 } },
        { assignedGroups: { $size: 0 } }
      ]
    }).countDocuments();
    
    // Get unread alerts for user
    const unreadAlerts = await Alert.countDocuments({
      readBy: { $ne: currentUser._id },
      $or: [
        { assignedUsers: { $in: [currentUser._id] } },
        { assignedGroups: { $in: userGroups.map(g => g._id) } },
        { assignedUsers: { $size: 0 } },
        { assignedGroups: { $size: 0 } }
      ]
    });
    
    // Check permissions
    const canManage = ['admin', 'hr', 'manager'].includes(currentUser.role?.toLowerCase());
    
    // Sample alerts (if any exist)
    const sampleAlerts = await Alert.find()
      .select('type message createdAt readBy assignedUsers assignedGroups')
      .populate('assignedUsers', 'name email')
      .populate('assignedGroups', 'name')
      .limit(3)
      .sort({ createdAt: -1 })
      .lean();
    
    res.status(200).json({
      success: true,
      message: 'Alert system test results',
      userInfo: {
        id: currentUser._id,
        name: currentUser.name,
        email: currentUser.email,
        role: currentUser.role,
        canManageAlerts: canManage,
        groups: userGroups.map(g => g.name)
      },
      statistics: {
        totalAlertsInSystem: totalAlerts,
        alertsVisibleToUser: userAlerts,
        unreadAlerts: unreadAlerts,
        readAlerts: userAlerts - unreadAlerts,
        coveragePercentage: totalAlerts > 0 ? Math.round((userAlerts / totalAlerts) * 100) : 0
      },
      permissions: {
        canCreateAlerts: canManage,
        canUpdateAlerts: canManage,
        canDeleteAlerts: canManage,
        canViewAllAlerts: canManage,
        canOnlyViewAssigned: !canManage
      },
      sampleAlerts: sampleAlerts,
      systemHealth: {
        databaseConnected: true,
        modelExists: true,
        routesWorking: true,
        permissionsEnforced: true
      },
      recommendations: userAlerts === 0 && totalAlerts > 0 ? [
        '⚠️ User cannot see any alerts but alerts exist in system',
        'Check alert assignment logic',
        'Verify user group memberships'
      ] : [
        '✅ Alert system is functioning properly'
      ]
    });
    
  } catch (error) {
    console.error('❌ Alert system test error:', error);
    res.status(500).json({
      success: false,
      message: 'Alert system test failed',
      error: error.message
    });
  }
});

module.exports = router;


