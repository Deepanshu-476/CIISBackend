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
  const filters = [];

  if (companyId) filters.push({ company: companyId });
  if (companyCode) filters.push({ companyCode });

  if (!filters.length) {
    const companyUserIds = await getCompanyUserIds(user);
    if (companyUserIds.length) {
      filters.push({
        company: { $exists: false },
        companyCode: { $exists: false },
        createdBy: { $in: companyUserIds }
      });
    }
  }

  return filters.length ? (filters.length === 1 ? filters[0] : { $or: filters }) : {};
};

const mergeQueries = (...queries) => {
  const parts = queries.filter(query => query && Object.keys(query).length);
  if (!parts.length) return {};
  if (parts.length === 1) return parts[0];
  return { $and: parts };
};

const normalizeRole = r => String(r || '').trim().toLowerCase().replace(/[\s-]+/g, '_');

const canViewCompanyAlerts = (role, companyRole, jobRole) => {
  const allowed = [
    'admin',
    'hr',
    'manager',
    'owner',
    'company_admin',
    'companyadmin',
    'company_owner',
    'companyowner',
    'superadmin',
    'super_admin',
  ];
  return [role, companyRole, jobRole].some(r => allowed.includes(normalizeRole(r)));
};

const assertAlertInCompany = async (alert, user) => {
  const role = normalizeRole(user?.role);
  const companyRole = normalizeRole(user?.companyRole);
  if (['superadmin', 'super_admin'].includes(role) || ['superadmin', 'super_admin'].includes(companyRole)) {
    return true;
  }

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

// An employee sees alerts addressed to them, to one of their groups, or broadcast alerts (no users and
// no groups). The old filter used "no users OR no groups", so an alert sent to specific users (groups
// empty) or to specific groups (users empty) was shown to every employee in the company.
const visibleToEmployeeQuery = (userId, userGroupIds) => ({
  $or: [
    { assignedUsers: { $in: [userId] } },
    { assignedGroups: { $in: userGroupIds } },
    { assignedUsers: { $size: 0 }, assignedGroups: { $size: 0 } },
  ],
});

// Same category rules as the web Alerts page (getAlertCategoryMeta), evaluated in MongoDB for paged lists.
const ALERT_TYPE = { $toLower: { $ifNull: ['$type', ''] } };
const ALERT_TEXT = { $toLower: { $concat: [{ $ifNull: ['$title', ''] }, ' ', { $ifNull: ['$message', ''] }] } };
const textHas = words => ({ $regexMatch: { input: ALERT_TEXT, regex: words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') } });
const typeIs = types => ({ $in: [ALERT_TYPE, types] });
const ALERT_CATEGORY_EXPR = {
  $switch: {
    branches: [
      { case: { $or: [typeIs(['announcement', 'holiday']), textHas(['holiday', 'remain closed', 'office closed', 'announcement'])] }, then: 'announcement' },
      { case: { $or: [typeIs(['report']), textHas(['report', 'monthly', 'submit'])] }, then: 'report' },
      { case: { $or: [typeIs(['policy']), textHas(['policy', 'hr policy', 'guidelines'])] }, then: 'policy' },
      { case: { $or: [typeIs(['meeting']), textHas(['meeting', 'rescheduled', 'call'])] }, then: 'meeting' },
      { case: { $or: [typeIs(['maintenance', 'error']), textHas(['maintenance', 'system', 'server'])] }, then: 'maintenance' },
      { case: textHas(['onboard', 'employee', 'joining', 'welcome']), then: 'onboarding' },
      { case: { $or: [textHas(['attendance', 'clock', 'late']), typeIs(['attendance'])] }, then: 'attendance' },
      { case: typeIs(['warning']), then: 'warning' }
    ],
    default: 'general'
  }
};

const getAlerts = async (req, res) => {
  try {
    const userId = req.user?._id;
    const isManager = canViewCompanyAlerts(req.user?.role, req.user?.companyRole, req.user?.jobRole);
    const companyQuery = await buildCompanyAlertQuery(req.user);
    
    let assignmentQuery = {};
    
    if (!isManager) {
      const userGroups = await Group.find({ members: userId }).select('_id');
      const userGroupIds = userGroups.map(group => group._id);
      
      assignmentQuery = visibleToEmployeeQuery(userId, userGroupIds);
    }
    
    const visibilityQuery = mergeQueries(companyQuery, assignmentQuery);

    // ?page / ?limit: one page plus whole-list stats (older clients still get the full list below).
    if (req.query.page !== undefined || req.query.limit !== undefined) {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
      const filters = [visibilityQuery];
      if (['info', 'warning', 'error'].includes(req.query.type)) filters.push({ type: req.query.type });
      if (req.query.category && req.query.category !== 'all') {
        const category = String(req.query.category).toLowerCase();
        filters.push({ $expr: { $or: [{ $eq: [ALERT_CATEGORY_EXPR, category] }, { $eq: [ALERT_TYPE, category] }] } });
      }
      if (req.query.search && String(req.query.search).trim()) {
        const pattern = new RegExp(String(req.query.search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        filters.push({ $or: [{ title: pattern }, { message: pattern }] });
      }
      if (req.query.view === 'unread') filters.push({ readBy: { $ne: userId } });
      if (req.query.view === 'read') filters.push({ readBy: userId });
      if (req.query.view === 'mine') {
        const groupIds = (await Group.find({ members: userId }).select('_id').lean()).map(group => group._id);
        filters.push(visibleToEmployeeQuery(userId, groupIds));
      }
      const pageQuery = mergeQueries(...filters);
      const [alerts, total, [facet = {}]] = await Promise.all([
        Alert.find(pageQuery)
          .populate('assignedUsers', 'name email')
          .populate('assignedGroups', 'name')
          .populate('createdBy', 'name email role department departmentName')
          .populate('company', 'companyName companyCode logo')
          .sort({ createdAt: req.query.sort === 'oldest' ? 1 : -1 })
          .skip((page - 1) * limit)
          .limit(limit),
        Alert.countDocuments(pageQuery),
        Alert.aggregate([
          { $match: Alert.find(visibilityQuery).cast(Alert, visibilityQuery) },
          { $facet: {
            byType: [{ $group: { _id: '$type', n: { $sum: 1 } } }],
            unread: [{ $match: { readBy: { $ne: userId } } }, { $count: 'n' }],
            thisWeek: [{ $match: { createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } }, { $count: 'n' }]
          } }
        ])
      ]);
      const byType = Object.fromEntries((facet.byType || []).map(row => [row._id, row.n]));
      return res.json({
        success: true,
        count: alerts.length,
        alerts,
        total,
        page,
        limit,
        pages: Math.max(1, Math.ceil(total / limit)),
        stats: {
          total: Object.values(byType).reduce((sum, n) => sum + n, 0),
          info: byType.info || 0,
          warning: byType.warning || 0,
          error: byType.error || 0,
          unread: facet.unread?.[0]?.n || 0,
          thisWeek: facet.thisWeek?.[0]?.n || 0
        }
      });
    }

    const alerts = await Alert.find(visibilityQuery)
      .populate('assignedUsers', 'name email')
      .populate('assignedGroups', 'name')
      .populate('createdBy', 'name email role department departmentName')
      .populate('company', 'companyName companyCode logo')
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
    const isManager = canViewCompanyAlerts(req.user?.role, req.user?.companyRole, req.user?.jobRole);
    const companyQuery = await buildCompanyAlertQuery(req.user);
    
    let query = mergeQueries(companyQuery, {
      readBy: { $ne: userId }
    });
    
    // ?mine=1: only alerts addressed to this user (sidebar badge), even for managers.
    const mineOnly = ['1', 'true'].includes(String(req.query?.mine || '').toLowerCase());
    if (!isManager || mineOnly) {
      const userGroups = await Group.find({ members: userId }).select('_id');
      const userGroupIds = userGroups.map(group => group._id);
      
      query = mergeQueries(query, visibleToEmployeeQuery(userId, userGroupIds));
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
    const company = req.body.company || getCompanyId(req.user);
    const companyCode = req.body.companyCode || getCompanyCode(req.user);
    
    
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
    await alert.populate('createdBy', 'name email role department departmentName');
    
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
    await alert.populate('createdBy', 'name email role department departmentName');
    
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
