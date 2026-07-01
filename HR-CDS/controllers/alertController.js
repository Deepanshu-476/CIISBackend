const Alert = require('../models/alertModel');
const User = require('../../models/User');
const Group = require('../models/Group');


const getAlerts = async (req, res) => {
  try {
    const userId = req.user?._id;
    const userRole = req.user?.role?.toLowerCase();
    
    let query = {};
    
    
    if (userRole && !['admin', 'hr', 'manager'].includes(userRole)) {

      const userGroups = await Group.find({ members: userId }).select('_id');
      const userGroupIds = userGroups.map(group => group._id);
      
      query = {
        $or: [
          { assignedUsers: { $in: [userId] } },
          { assignedGroups: { $in: userGroupIds } },
          { assignedUsers: { $size: 0 } }, 
          { assignedGroups: { $size: 0 } }  
        ]
      };
    }
    
    const alerts = await Alert.find(query)
      .populate('assignedUsers', 'name email')
      .populate('assignedGroups', 'name')
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 });
    
    res.json({
      success: true,
      count: alerts.length,
      alerts
    });
  } catch (error) {
    console.error('Error fetching alerts:', error);
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
      readBy: { $ne: userId }
    };
    
    
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
    
    
    if (!message || !message.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Alert message is required'
      });
    }
    
    
    const alert = new Alert({
      type: type || 'info',
      message: message.trim(),
      assignedUsers: Array.isArray(assignedUsers) ? assignedUsers : [],
      assignedGroups: Array.isArray(assignedGroups) ? assignedGroups : [],
      createdBy
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




const updateAlert = async (req, res) => {
  try {
    const { id } = req.params;
    const { type, message, assignedUsers, assignedGroups } = req.body;
    
    
    const alert = await Alert.findById(id);
    if (!alert) {
      return res.status(404).json({
        success: false,
        message: 'Alert not found'
      });
    }
    
    
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
    
    
    if (!alert.readBy.includes(userId)) {
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
void 0;
module.exports = {
  getAlerts,
  addAlert,
  updateAlert,
  deleteAlert,
  markAsRead,
  getUnreadCount
};