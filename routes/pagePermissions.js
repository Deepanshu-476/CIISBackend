const express = require('express');
const mongoose = require('mongoose');
const PagePermission = require('../models/PagePermission');
const User = require('../models/User');
const { protect, isCompanyOwner } = require('../middleware/authMiddleware');

const router = express.Router();

const APP_PAGES = [
  { pageKey: 'emp-details', name: 'Employee Details', path: '/ciisUser/emp-details', permissionPattern: 'viewEdit' },
  { pageKey: 'emp-leaves', name: 'Employee Leaves', path: '/ciisUser/emp-leaves', permissionPattern: 'approveReject' },
  { pageKey: 'emp-assets', name: 'Employee Assets', path: '/ciisUser/emp-assets', permissionPattern: 'approveReject' },
  { pageKey: 'emp-attendance', name: 'Employee Attendance', path: '/ciisUser/emp-attendance', permissionPattern: 'viewEdit' },
  { pageKey: 'department', name: 'Department Management', path: '/ciisUser/department', permissionPattern: 'viewEdit' },
  { pageKey: 'JobRoleManagement', name: 'Job Role Management', path: '/ciisUser/JobRoleManagement', permissionPattern: 'viewEdit' },
  { pageKey: 'admin-task-create', name: 'Admin Task Create', path: '/ciisUser/admin-task-create', permissionPattern: 'viewEdit' },
  { pageKey: 'manage-groups', name: 'Manage Groups', path: '/ciisUser/manage-groups', permissionPattern: 'viewEdit' },
  { pageKey: 'admin-meeting', name: 'Admin Meeting', path: '/ciisUser/admin-meeting', permissionPattern: 'viewEdit' },
  { pageKey: 'adminproject', name: 'Admin Project', path: '/ciisUser/adminproject', permissionPattern: 'viewEdit' },
  { pageKey: 'company-all-task', name: 'Company All Task', path: '/ciisUser/company-all-task', permissionPattern: 'viewEdit' },
  { pageKey: 'emp-client', name: 'Client Management', path: '/ciisUser/emp-client', permissionPattern: 'viewEdit' },
  { pageKey: 'active-clients', name: 'Active Clients', path: '/ciisUser/active-clients', permissionPattern: 'viewEdit' },
  { pageKey: 'client-dashboard', name: 'Client Dashboard', path: '/client/dashboard', permissionPattern: 'viewEdit' },
  { pageKey: 'client-my-services', name: 'My Services', path: '/client/my-services', permissionPattern: 'viewEdit' },
  { pageKey: 'client-tasks-updates', name: 'Tasks & Updates', path: '/client/tasks-updates', permissionPattern: 'viewEdit' },
  { pageKey: 'client-marketplace', name: 'Explore Services', path: '/client/marketplace', permissionPattern: 'viewEdit' },
  { pageKey: 'client-support-tickets', name: 'Meetings', path: '/client/support-tickets', permissionPattern: 'viewEdit' },
  { pageKey: 'client-documents', name: 'Documents', path: '/client/documents', permissionPattern: 'viewEdit' },
  { pageKey: 'client-payments', name: 'Payments', path: '/client/payments', permissionPattern: 'viewEdit' },
  { pageKey: 'alert', name: 'Alerts', path: '/ciisUser/alert', permissionPattern: 'viewEdit' },
  { pageKey: 'attendance', name: 'Attendance', path: '/ciisUser/attendance', permissionPattern: 'viewEdit' },
  { pageKey: 'my-assets', name: 'My Assets', path: '/ciisUser/my-assets', permissionPattern: 'viewEdit' },
  { pageKey: 'my-leaves', name: 'My Leaves', path: '/ciisUser/my-leaves', permissionPattern: 'viewEdit' },
  { pageKey: 'profile', name: 'Profile', path: '/ciisUser/profile', permissionPattern: 'viewEdit' },
  { pageKey: 'change-password', name: 'Change Password', path: '/ciisUser/change-password', permissionPattern: 'viewEdit' },
  { pageKey: 'user-dashboard', name: 'User Dashboard', path: '/ciisUser/user-dashboard', permissionPattern: 'viewEdit' },
  { pageKey: 'project', name: 'My Projects', path: '/ciisUser/project', permissionPattern: 'viewEdit' },
  { pageKey: 'task-management', name: 'Task Management', path: '/ciisUser/task-management', permissionPattern: 'viewEdit' },
  { pageKey: 'employee-meeting', name: 'Employee Meeting', path: '/ciisUser/employee-meeting', permissionPattern: 'viewEdit' },
  { pageKey: 'client-meeting', name: 'Client Meeting', path: '/ciisUser/client-meeting', permissionPattern: 'viewEdit' },
  { pageKey: 'create-user', name: 'Create User', path: '/ciisUser/create-user', permissionPattern: 'viewEdit' },
  { pageKey: 'SidebarManagement', name: 'Sidebar Management', path: '/ciisUser/SidebarManagement', permissionPattern: 'viewEdit' },
  { pageKey: 'create-alert', name: 'Create Alert', path: '/ciisUser/create-alert', permissionPattern: 'viewEdit' },
  { pageKey: 'chat', name: 'Chat', path: '/ciisUser/chat', permissionPattern: 'viewEdit' },
  { pageKey: 'support-desk', name: 'Support Desk', path: '/ciisUser/support-desk', permissionPattern: 'viewEdit' },
  { pageKey: 'support-operations', name: 'Support Operations', path: '/ciisUser/support-operations', permissionPattern: 'viewEdit' }
];

const normalizePath = (path = '') => {
  const clean = String(path || '').trim();
  if (!clean) return '';
  return clean.startsWith('/') ? clean : `/ciisUser/${clean.replace(/^ciisUser\//, '')}`;
};

const getCompanyId = (req) => req.user?.company?._id || req.user?.company || req.user?.companyId;

const normalizePageUsers = (items = []) => {
  const uniqueIds = [...new Set(items.map(item => String(item)).filter(id => mongoose.Types.ObjectId.isValid(id)))];
  return uniqueIds.map(id => ({ user: id }));
};

const getPageUsers = (config, key) => (config?.[key] || []).map(item => item.user).filter(Boolean);

const uniqueUsers = (users = []) => {
  const seen = new Set();
  return users.filter(user => {
    const id = String(user?._id || user?.id || user || '');
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};

const getEffectiveViewUsers = (config) => uniqueUsers([
  ...getPageUsers(config, 'viewUsers'),
  ...getPageUsers(config, 'editUsers'),
  ...getPageUsers(config, 'approvers'),
  ...getPageUsers(config, 'deleteUsers')
]);

const decoratePages = async (companyId) => {
  const configs = await PagePermission.find({ company: companyId })
    .populate('approvers.user', 'name email jobRole companyRole department')
    .populate('viewUsers.user', 'name email jobRole companyRole department')
    .populate('editUsers.user', 'name email jobRole companyRole department')
    .populate('deleteUsers.user', 'name email jobRole companyRole department')
    .lean();
  const configMap = new Map(configs.map(config => [config.path, config]));

  return APP_PAGES.map(page => {
    const config = configMap.get(page.path);
    return {
      ...page,
      permissionPattern: page.permissionPattern || null,
      approvers: getPageUsers(config, 'approvers'),
      viewUsers: getPageUsers(config, 'viewUsers'),
      editUsers: getPageUsers(config, 'editUsers'),
      deleteUsers: getPageUsers(config, 'deleteUsers'),
      updatedAt: config?.updatedAt || null
    };
  });
};

router.use(protect);

router.get('/pages', async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    if (!companyId) {
      return res.status(400).json({ success: false, error: 'Company not found for current user' });
    }

    const pages = await decoratePages(companyId);
    res.json({ success: true, pages });
  } catch (error) {
    console.error('Page permissions list error:', error);
    res.status(500).json({ success: false, error: 'Failed to load page permissions' });
  }
});

router.get('/by-path', async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const path = normalizePath(req.query.path);
    if (!companyId || !path) {
      return res.status(400).json({ success: false, error: 'Company and path are required' });
    }

    const config = await PagePermission.findOne({ company: companyId, path })
      .populate('approvers.user', 'name email jobRole companyRole department')
      .populate('viewUsers.user', 'name email jobRole companyRole department')
      .populate('editUsers.user', 'name email jobRole companyRole department')
      .populate('deleteUsers.user', 'name email jobRole companyRole department')
      .lean();

    res.json({
      success: true,
      page: config ? {
        pageKey: config.pageKey,
        name: config.name,
        path: config.path,
        permissionPattern: APP_PAGES.find(item => item.path === config.path)?.permissionPattern || null,
        approvers: getPageUsers(config, 'approvers'),
        viewUsers: getEffectiveViewUsers(config),
        editUsers: getPageUsers(config, 'editUsers'),
        deleteUsers: getPageUsers(config, 'deleteUsers')
      } : {
        path,
        permissionPattern: APP_PAGES.find(item => item.path === path)?.permissionPattern || null,
        approvers: [],
        viewUsers: [],
        editUsers: [],
        deleteUsers: []
      }
    });
  } catch (error) {
    console.error('Page permission by path error:', error);
    res.status(500).json({ success: false, error: 'Failed to load page permission' });
  }
});

router.put('/:pageKey', isCompanyOwner, async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const page = APP_PAGES.find(item => item.pageKey === req.params.pageKey);
    if (!companyId || !page) {
      return res.status(404).json({ success: false, error: 'Page not found' });
    }

    const approverIds = Array.isArray(req.body.approverIds) ? req.body.approverIds : [];
    const viewUserIds = Array.isArray(req.body.viewUserIds) ? req.body.viewUserIds : [];
    const editUserIds = Array.isArray(req.body.editUserIds) ? req.body.editUserIds : [];
    const deleteUserIds = Array.isArray(req.body.deleteUserIds) ? req.body.deleteUserIds : [];
    const uniqueApproverIds = [...new Set(approverIds.map(id => String(id)).filter(id => mongoose.Types.ObjectId.isValid(id)))];
    const uniqueViewUserIds = [...new Set(viewUserIds.map(id => String(id)).filter(id => mongoose.Types.ObjectId.isValid(id)))];
    const uniqueEditUserIds = [...new Set(editUserIds.map(id => String(id)).filter(id => mongoose.Types.ObjectId.isValid(id)))];
    const uniqueDeleteUserIds = [...new Set(deleteUserIds.map(id => String(id)).filter(id => mongoose.Types.ObjectId.isValid(id)))];
    const allUserIds = [...new Set([...uniqueApproverIds, ...uniqueViewUserIds, ...uniqueEditUserIds, ...uniqueDeleteUserIds])];

    const validUsers = await User.find({
      _id: { $in: allUserIds },
      $or: [
        { company: companyId },
        { companyId }
      ]
    }).select('_id');

    const validIdSet = new Set(validUsers.map(user => user._id.toString()));
    const approvers = normalizePageUsers(uniqueApproverIds.filter(id => validIdSet.has(id)));
    const viewUsers = normalizePageUsers(uniqueViewUserIds.filter(id => validIdSet.has(id)));
    const editUsers = normalizePageUsers(uniqueEditUserIds.filter(id => validIdSet.has(id)));
    const deleteUsers = normalizePageUsers(uniqueDeleteUserIds.filter(id => validIdSet.has(id)));

    const config = await PagePermission.findOneAndUpdate(
      { company: companyId, path: page.path },
      {
        company: companyId,
        companyCode: req.user.companyCode || '',
        pageKey: page.pageKey,
        name: page.name,
        path: page.path,
        approvers,
        viewUsers,
        editUsers,
        deleteUsers
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    )
      .populate('approvers.user', 'name email jobRole companyRole department')
      .populate('viewUsers.user', 'name email jobRole companyRole department')
      .populate('editUsers.user', 'name email jobRole companyRole department')
      .populate('deleteUsers.user', 'name email jobRole companyRole department');

    res.json({
      success: true,
      message: 'Page permissions updated successfully',
      page: {
        pageKey: config.pageKey,
        name: config.name,
        path: config.path,
        permissionPattern: page.permissionPattern || null,
        approvers: getPageUsers(config, 'approvers'),
        viewUsers: getPageUsers(config, 'viewUsers'),
        editUsers: getPageUsers(config, 'editUsers'),
        deleteUsers: getPageUsers(config, 'deleteUsers')
      }
    });
  } catch (error) {
    console.error('Page permissions save error:', error);
    res.status(500).json({ success: false, error: 'Failed to save page approvers' });
  }
});

module.exports = router;
