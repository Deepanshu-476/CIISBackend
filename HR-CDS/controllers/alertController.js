const Alert = require('../models/alertModel');
const User = require('../../models/User');
const Group = require('../models/Group');

const getAlerts = async (req, res) => {
  try {
    const userId = req.user?._id;
    const userRole = req.user?.role?.toLowerCase();
    const companyId = req.user.company;

    let query = {
      company: companyId
    };
    
    // If user is not admin/hr/manager, show only assigned alerts
    if (userRole && !['admin', 'hr', 'manager'].includes(userRole)) {
      const userGroups = await Group.find({ members: userId }).select('_id');
      const userGroupIds = userGroups.map(group => group._id);
      
      query.$or = [
        { assignedUsers: { $in: [userId] } },
        { assignedGroups: { $in: userGroupIds } },
        { assignedUsers: { $size: 0 } },
        { assignedGroups: { $size: 0 } }
      ];
    }
    
    const alerts = await Alert.find(query)
      .populate('assignedUsers', 'name email')
      .populate('assignedGroups', 'name')
      .populate('createdBy', 'name email')
      .populate('readBy', 'name email') 
      .sort({ createdAt: -1 });

    // Get all users for seen/not seen status
    const users = await User.find({ company: companyId }).select('_id name email');

    const alertsWithStatus = alerts.map(alert => {
      const seenIds = alert.readBy.map(u => u._id.toString());

      const seen = [];
      const notSeen = [];

      users.forEach(user => {
        if (seenIds.includes(user._id.toString())) {
          seen.push(user);
        } else {
          notSeen.push(user);
        }
      });

      return {
        ...alert.toObject(),
        seenByUsers: seen,
        notSeenUsers: notSeen
      };
    });

    // Response
    res.json({
      success: true,
      count: alertsWithStatus.length,
      alerts: alertsWithStatus
    });
  } catch (error) {
    console.error('Error getting alerts:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

const getUnreadCount = async (req, res) => {
  try {
    const userId = req.user._id;
    const userRole = req.user?.role?.toLowerCase();
    
    let query = {
      company: req.user.company,
      readBy: { $ne: userId }
    };
    
    // If user is not admin/hr/manager, filter by assigned alerts
    if (userRole && !['admin', 'hr', 'manager'].includes(userRole)) {
      // Find groups where user is a member
      const userGroups = await Group.find({ members: userId }).select('_id');
      const userGroupIds = userGroups.map(group => group._id);
      
      query.$or = [
        { assignedUsers: { $in: [userId] } },
        { assignedGroups: { $in: userGroupIds } },
        { assignedUsers: { $size: 0 } },
        { assignedGroups: { $size: 0 } }
      ];
    }
    
    const count = await Alert.countDocuments(query);
    
    res.json({
      success: true,
      count
    });
  } catch (error) {
    console.error('Error getting unread count:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

const addAlert = async (req, res) => {
  try {
    const { type, message, assignedUsers = [], assignedGroups = [] } = req.body;

    const createdBy = req.user._id;
    const companyId = req.user.company;

    const alert = new Alert({
      type: type || 'info',
      message: message.trim(),
      assignedUsers,
      assignedGroups,
      createdBy,
      company: companyId
    });

    await alert.save();

    res.status(201).json({
      success: true,
      message: 'Alert created successfully',
      alert
    });
  } catch (error) {
    console.error('Error creating alert:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// @desc    Update an alert
// @route   PUT /api/alerts/:id
// @access  Private/Admin/HR/Manager
const updateAlert = async (req, res) => {
  try {
    const { id } = req.params;
    const { type, message, assignedUsers, assignedGroups } = req.body;
    
    // Find alert
    const alert = await Alert.findById(id);
    if (!alert) {
      return res.status(404).json({
        success: false,
        message: 'Alert not found'
      });
    }
    
    // Update alert
    if (type) alert.type = type;
    if (message) alert.message = message.trim();
    if (assignedUsers !== undefined) alert.assignedUsers = Array.isArray(assignedUsers) ? assignedUsers : [];
    if (assignedGroups !== undefined) alert.assignedGroups = Array.isArray(assignedGroups) ? assignedGroups : [];
    
    await alert.save();
    
    res.json({
      success: true,
      message: 'Alert updated successfully',
      alert
    });
  } catch (error) {
    console.error('Error updating alert:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// @desc    Delete an alert
// @route   DELETE /api/alerts/:id
// @access  Private/Admin/HR/Manager
const deleteAlert = async (req, res) => {
  try {
    const { id } = req.params;
    
    const alert = await Alert.findById(id);
    if (!alert) {
      return res.status(404).json({
        success: false,
        message: 'Alert not found'
      });
    }
    
    await alert.deleteOne();
    
    res.json({
      success: true,
      message: 'Alert deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting alert:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// @desc    Mark alert as read
// @route   PATCH /api/alerts/:id/read
// @access  Private
const markAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;
    
    const alert = await Alert.findById(id);
    if (!alert) {
      return res.status(404).json({
        success: false,
        message: 'Alert not found'
      });
    }
    
    // Check if user has already marked as read
    if (!alert.readBy.some(id => id.toString() === userId.toString())) {
      alert.readBy.push(userId);
      await alert.save();
    }

    res.json({
      success: true,
      message: 'Alert marked as read'
    });
  } catch (error) {
    console.error('Error marking alert as read:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

console.log("✅ alertController.js loaded successfully");

module.exports = {
  getAlerts,
  addAlert,
  updateAlert,
  deleteAlert,
  markAsRead,
  getUnreadCount
};