const Alert = require('../models/alertModel');
const User = require('../../models/User');
const Group = require('../models/Group');

const getId = value => {
  if (!value) return null;
  if (value._id) return value._id;
  if (value.id) return value.id;
  return value;
};

const getCompanyId = user => getId(user?.company || user?.companyId || user?.companyDetails);
const getCompanyCode = user => user?.companyCode || user?.company?.companyCode || user?.companyDetails?.companyCode || '';

const getCompanyUserIds = async user => {
  const companyId = getCompanyId(user);
  const companyCode = getCompanyCode(user);
  const filters = [];
  if (companyId) filters.push({ company: companyId });
  if (companyCode) filters.push({ companyCode });
  if (!filters.length) return [];

  const users = await User.find(filters.length > 1 ? { $or: filters } : filters[0]).select('_id').lean();
  return users.map(item => item._id);
};

const buildCompanyAlertQuery = async user => {
  const companyId = getCompanyId(user);
  const companyCode = getCompanyCode(user);
  const companyUserIds = await getCompanyUserIds(user);
  const filters = [];

  if (companyId) filters.push({ company: companyId });
  if (companyCode) filters.push({ companyCode });
  if (companyUserIds.length) {
    filters.push({
      company: { $exists: false },
      companyCode: { $exists: false },
      createdBy: { $in: companyUserIds }
    });
  }

  return filters.length ? { $or: filters } : {};
};

const mergeQueries = (...queries) => {
  const parts = queries.filter(query => query && Object.keys(query).length);
  if (!parts.length) return {};
  if (parts.length === 1) return parts[0];
  return { $and: parts };
};

const canViewCompanyAlerts = role => ['admin', 'hr', 'manager', 'owner', 'company_admin', 'company admin'].includes(String(role || '').toLowerCase());

const assertAlertInCompany = async (alert, user) => {
  const companyId = String(getCompanyId(user) || '');
  const companyCode = String(getCompanyCode(user) || '');
  if (!companyId && !companyCode) return true;

  const alertCompanyId = String(getId(alert.company) || '');
  const alertCompanyCode = String(alert.companyCode || '');
  if ((companyId && alertCompanyId === companyId) || (companyCode && alertCompanyCode === companyCode)) return true;

  if (!alertCompanyId && !alertCompanyCode && alert.createdBy) {
    const creator = await User.findById(alert.createdBy).select('company companyCode').lean();
    return String(getId(creator?.company) || '') === companyId || String(creator?.companyCode || '') === companyCode;
  }

  return false;
};

const getAlerts = async (req, res) => {
  try {
    const userId = req.user?._id;
    const userRole = req.user?.role?.toLowerCase();
    const companyQuery = await buildCompanyAlertQuery(req.user);
    
    let assignmentQuery = {};
    
    
    if (userRole && !canViewCompanyAlerts(userRole)) {

      const userGroups = await Group.find({ members: userId }).select('_id');
      const userGroupIds = userGroups.map(group => group._id);
      
      assignmentQuery = {
        $or: [
          { assignedUsers: { $in: [userId] } },
          { assignedGroups: { $in: userGroupIds } },
          { assignedUsers: { $size: 0 } }, 
          { assignedGroups: { $size: 0 } }  
        ]
      };
    }
    
    const alerts = await Alert.find(mergeQueries(companyQuery, assignmentQuery))
      .populate('assignedUsers', 'name email')
      .populate('assignedGroups', 'name')
      .populate('createdBy', 'name email role department')
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
    const companyQuery = await buildCompanyAlertQuery(req.user);
    
    let query = mergeQueries(companyQuery, {
      readBy: { $ne: userId }
    });
    
    
    if (userRole && !canViewCompanyAlerts(userRole)) {
      
      const userGroups = await Group.find({ members: userId }).select('_id');
      const userGroupIds = userGroups.map(group => group._id);
      
      query = mergeQueries(query, {$or: [
        { assignedUsers: { $in: [userId] } },
        { assignedGroups: { $in: userGroupIds } },
        { assignedUsers: { $size: 0 } },
        { assignedGroups: { $size: 0 } }
      ]});
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
    const { title, type, message, assignedUsers = [], assignedGroups = [], attachments = [] } = req.body;
    const createdBy = req.user._id;
    const company = getCompanyId(req.user);
    const companyCode = getCompanyCode(req.user);
    
    
    if (!message || !message.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Alert message is required'
      });
    }
    
    
    const createdByName = req.user?.name || req.user?.username || '';
    
    const alert = new Alert({
      title: title ? String(title).trim() : '',
      type: type || 'info',
      message: message.trim(),
      assignedUsers: Array.isArray(assignedUsers) ? assignedUsers : [],
      assignedGroups: Array.isArray(assignedGroups) ? assignedGroups : [],
      attachments: Array.isArray(attachments) ? attachments : [],
      createdBy,
      createdByName,
      company,
      companyCode
    });
    
    await alert.save();
    await alert.populate('createdBy', 'name email role department');
    
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
    const { title, type, message, assignedUsers, assignedGroups, attachments } = req.body;
    
    
    const alert = await Alert.findById(id);
    if (!alert) {
      return res.status(404).json({
        success: false,
        message: 'Alert not found'
      });
    }
    if (!(await assertAlertInCompany(alert, req.user))) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized for this company alert'
      });
    }
    
    
    if (title !== undefined) alert.title = String(title).trim();
    if (type) alert.type = type;
    if (message) alert.message = message.trim();
    if (assignedUsers !== undefined) alert.assignedUsers = Array.isArray(assignedUsers) ? assignedUsers : [];
    if (assignedGroups !== undefined) alert.assignedGroups = Array.isArray(assignedGroups) ? assignedGroups : [];
    if (attachments !== undefined) alert.attachments = Array.isArray(attachments) ? attachments : [];
    
    await alert.save();
    await alert.populate('createdBy', 'name email role department');
    
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
    if (!(await assertAlertInCompany(alert, req.user))) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized for this company alert'
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
    if (!(await assertAlertInCompany(alert, req.user))) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized for this company alert'
      });
    }
    
    
    if (!alert.readBy.some(uId => String(uId) === String(userId))) {
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

const markAsUnread = async (req, res) => {
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
    if (!(await assertAlertInCompany(alert, req.user))) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized for this company alert'
      });
    }
    
    alert.readBy = alert.readBy.filter(uId => String(uId) !== String(userId));
    await alert.save();
    
    res.json({
      success: true,
      message: 'Alert marked as unread'
    });
  } catch (error) {
    console.error('Error marking alert as unread:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

const markAllAsRead = async (req, res) => {
  try {
    const userId = req.user._id;
    const companyQuery = await buildCompanyAlertQuery(req.user);
    
    await Alert.updateMany(
      mergeQueries(companyQuery, { readBy: { $ne: userId } }),
      { $addToSet: { readBy: userId } }
    );
    
    res.json({
      success: true,
      message: 'All alerts marked as read'
    });
  } catch (error) {
    console.error('Error marking all alerts as read:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

module.exports = {
  getAlerts,
  addAlert,
  updateAlert,
  deleteAlert,
  markAsRead,
  markAsUnread,
  markAllAsRead,
  getUnreadCount
};  
