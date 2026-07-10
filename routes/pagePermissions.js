const express = require('express');
const mongoose = require('mongoose');
const PagePermission = require('../models/PagePermission');
const User = require('../models/User');
const { protect, isCompanyOwner } = require('../middleware/authMiddleware');

const router = express.Router();

const APP_PAGES = [
  { pageKey: 'emp-details', name: 'Employee Details', path: '/ciisUser/emp-details' },
  { pageKey: 'emp-leaves', name: 'Employee Leaves', path: '/ciisUser/emp-leaves' },
  { pageKey: 'emp-assets', name: 'Employee Assets', path: '/ciisUser/emp-assets' },
  { pageKey: 'emp-attendance', name: 'Employee Attendance', path: '/ciisUser/emp-attendance' },
  { pageKey: 'department', name: 'Department Management', path: '/ciisUser/department' },
  { pageKey: 'JobRoleManagement', name: 'Job Role Management', path: '/ciisUser/JobRoleManagement' },
  { pageKey: 'admin-task-create', name: 'Admin Task Create', path: '/ciisUser/admin-task-create' },
  { pageKey: 'manage-groups', name: 'Manage Groups', path: '/ciisUser/manage-groups' },
  { pageKey: 'admin-meeting', name: 'Admin Meeting', path: '/ciisUser/admin-meeting' },
  { pageKey: 'adminproject', name: 'Admin Project', path: '/ciisUser/adminproject' },
  { pageKey: 'company-all-task', name: 'Company All Task', path: '/ciisUser/company-all-task' },
  { pageKey: 'emp-client', name: 'Client Management', path: '/ciisUser/emp-client' },
  { pageKey: 'active-clients', name: 'Active Clients', path: '/ciisUser/active-clients' },
  { pageKey: 'alert', name: 'Alerts', path: '/ciisUser/alert' },
  { pageKey: 'attendance', name: 'Attendance', path: '/ciisUser/attendance' },
  { pageKey: 'my-assets', name: 'My Assets', path: '/ciisUser/my-assets' },
  { pageKey: 'my-leaves', name: 'My Leaves', path: '/ciisUser/my-leaves' },
  { pageKey: 'profile', name: 'Profile', path: '/ciisUser/profile' },
  { pageKey: 'user-dashboard', name: 'User Dashboard', path: '/ciisUser/user-dashboard' },
  { pageKey: 'project', name: 'Project', path: '/ciisUser/project' },
  { pageKey: 'task-management', name: 'Task Management', path: '/ciisUser/task-management' },
  { pageKey: 'employee-meeting', name: 'Employee Meeting', path: '/ciisUser/employee-meeting' },
  { pageKey: 'client-meeting', name: 'Client Meeting', path: '/ciisUser/client-meeting' },
  { pageKey: 'create-user', name: 'Create User', path: '/ciisUser/create-user' },
  { pageKey: 'SidebarManagement', name: 'Sidebar Management', path: '/ciisUser/SidebarManagement' },
  { pageKey: 'create-alert', name: 'Create Alert', path: '/ciisUser/create-alert' },
  { pageKey: 'chat', name: 'Chat', path: '/ciisUser/chat' },
  { pageKey: 'support-desk', name: 'Support Desk', path: '/ciisUser/support-desk' },
  { pageKey: 'support-operations', name: 'Support Operations', path: '/ciisUser/support-operations' }
];

const normalizePath = (path = '') => {
  const clean = String(path || '').trim();
  if (!clean) return '';
  return clean.startsWith('/') ? clean : `/ciisUser/${clean.replace(/^ciisUser\//, '')}`;
};

const getCompanyId = (req) => req.user?.company?._id || req.user?.company || req.user?.companyId;

const decoratePages = async (companyId) => {
  const configs = await PagePermission.find({ company: companyId })
    .populate('approvers.user', 'name email jobRole companyRole department')
    .populate('deleteUsers.user', 'name email jobRole companyRole department')
    .lean();
  const configMap = new Map(configs.map(config => [config.path, config]));

  return APP_PAGES.map(page => {
    const config = configMap.get(page.path);
    return {
      ...page,
      approvers: config?.approvers?.map(item => item.user).filter(Boolean) || [],
      deleteUsers: config?.deleteUsers?.map(item => item.user).filter(Boolean) || [],
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
      .populate('deleteUsers.user', 'name email jobRole companyRole department')
      .lean();

    res.json({
      success: true,
      page: config ? {
        pageKey: config.pageKey,
        name: config.name,
        path: config.path,
        approvers: config.approvers.map(item => item.user).filter(Boolean),
        deleteUsers: (config.deleteUsers || []).map(item => item.user).filter(Boolean)
      } : {
        path,
        approvers: [],
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
    const deleteUserIds = Array.isArray(req.body.deleteUserIds) ? req.body.deleteUserIds : [];
    const uniqueApproverIds = [...new Set(approverIds.map(id => String(id)).filter(id => mongoose.Types.ObjectId.isValid(id)))];
    const uniqueDeleteUserIds = [...new Set(deleteUserIds.map(id => String(id)).filter(id => mongoose.Types.ObjectId.isValid(id)))];
    const allUserIds = [...new Set([...uniqueApproverIds, ...uniqueDeleteUserIds])];

    const validUsers = await User.find({
      _id: { $in: allUserIds },
      $or: [
        { company: companyId },
        { companyId }
      ]
    }).select('_id');

    const validIdSet = new Set(validUsers.map(user => user._id.toString()));
    const approvers = uniqueApproverIds.filter(id => validIdSet.has(id)).map(id => ({ user: id }));
    const deleteUsers = uniqueDeleteUserIds.filter(id => validIdSet.has(id)).map(id => ({ user: id }));

    const config = await PagePermission.findOneAndUpdate(
      { company: companyId, path: page.path },
      {
        company: companyId,
        companyCode: req.user.companyCode || '',
        pageKey: page.pageKey,
        name: page.name,
        path: page.path,
        approvers,
        deleteUsers
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    )
      .populate('approvers.user', 'name email jobRole companyRole department')
      .populate('deleteUsers.user', 'name email jobRole companyRole department');

    res.json({
      success: true,
      message: 'Page permissions updated successfully',
      page: {
        pageKey: config.pageKey,
        name: config.name,
        path: config.path,
        approvers: config.approvers.map(item => item.user).filter(Boolean),
        deleteUsers: (config.deleteUsers || []).map(item => item.user).filter(Boolean)
      }
    });
  } catch (error) {
    console.error('Page permissions save error:', error);
    res.status(500).json({ success: false, error: 'Failed to save page approvers' });
  }
});

module.exports = router;
