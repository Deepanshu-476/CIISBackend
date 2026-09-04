const mongoose = require('mongoose');
const Attendance = require('../models/Attendance');
const Leave = require('../models/Leave');
const AssetRequest = require('../models/AssetRequest');
const Task = require('../models/Task');
const Alert = require('../models/alertModel');
const User = require('../../models/User');
const Company = require('../../models/Company');
const SidebarConfig = require('../../models/SidebarConfig');
const Department = require('../../models/Department');
const JobRole = require('../../models/JobRole');

const INDIA_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const todayRange = () => {
  const shifted = new Date(Date.now() + INDIA_OFFSET_MS);
  const start = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - INDIA_OFFSET_MS);
  return { start, end: new Date(start.getTime() + 86400000 - 1) };
};

const normalize = value => String(value || '').trim().toLowerCase();
const isClientRole = value => normalize(value).replace(/[\s_-]/g, '') === 'client';
const isClientUser = user => [
  user?.companyRole,
  user?.jobRole?.name,
  user?.jobRole?.title,
  user?.jobRole?.roleName,
  user?.jobRole,
  user?.role
].some(isClientRole);
const initials = value => {
  const parts = String(value || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'U';
  return parts.slice(0, 2).map(part => part[0]).join('').toUpperCase();
};
const formatDate = value => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
};
const formatTime = value => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit'
  });
};
const roleAliases = user => [...new Set([
  user.jobRole,
  user.companyRole,
  user.role,
  user.jobRole?.name,
  user.department?.name
].map(normalize).filter(Boolean))];

const hasDashboardAccess = async (user, company) => {
  const allowed = Array.isArray(company?.allowedPages) ? company.allowedPages.map(normalize) : [];
  if (allowed.length && !allowed.some(value => ['dashboard', 'user-dashboard', 'dashboard-1', '/ciisuser/dashboard-1'].includes(value))) return false;

  const departmentId = user.department?._id || user.department;
  const roleValues = roleAliases(user);
  if (!mongoose.Types.ObjectId.isValid(company._id) || !mongoose.Types.ObjectId.isValid(departmentId)) return { variant: 'dashboard-1' };
  const config = await SidebarConfig.findOne({
    companyId: company._id,
    departmentId,
    isActive: { $ne: false },
    role: { $in: roleValues.map(value => new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')) }
  }).sort({ updatedAt: -1 }).select('menuItems').lean();
  if (config && Array.isArray(config.menuItems) && !config.menuItems.some(item => ['dashboard-1', 'user-dashboard'].includes(normalize(item.id || item.path)))) return false;
  return { variant: 'dashboard-1' };
};

const mapUserCard = (person, fallbackUser = {}) => {
  const user = person?.user || fallbackUser;
  return {
    id: String(user?._id || person?._id || fallbackUser?._id || ''),
    name: user?.name || fallbackUser?.name || 'Employee',
    role: user?.jobRole?.name || user?.jobRole || user?.role || fallbackUser?.role || 'Team Member',
    avatar: user?.profileImage || fallbackUser?.avatar || '',
    initials: initials(user?.name || fallbackUser?.name || 'Employee'),
    task: person?.task?.title || '',
    taskColor: person?.task?.status === 'completed' ? '#10b981' : '#2563eb',
    lastUpdate: person?.lastUpdate || '',
    time: formatTime(person?.updatedAt),
    status: person?.task?.title || person?.lastUpdate ? 'On Task' : 'Not Updated',
    statusType: person?.task?.title || person?.lastUpdate ? 'success' : 'error',
    progress: person?.progress || '',
    updatedAt: person?.updatedAt || null
  };
};

const mapAbsentRow = (person, attendanceRecord = null) => {
  const role = person?.jobRole?.name || person?.jobRole || person?.role || 'Team Member';
  const department = person?.department?.name || person?.department?.title || person?.department || '';
  const attendanceStatus = attendanceRecord?.status || 'Absent';
  const attendanceNote = attendanceRecord
    ? (attendanceRecord.status || attendanceRecord.totalTime || attendanceRecord.inTime || attendanceRecord.outTime
      ? 'Attendance record found'
      : 'Attendance record incomplete')
    : 'No attendance record found today';

  const recordDetails = [
    attendanceRecord?.inTime ? `In ${formatTime(attendanceRecord.inTime)}` : '',
    attendanceRecord?.outTime ? `Out ${formatTime(attendanceRecord.outTime)}` : '',
    attendanceRecord?.totalTime ? `Worked ${attendanceRecord.totalTime}` : ''
  ].filter(Boolean).join(' • ');

  return {
    id: String(person?._id || ''),
    name: person?.name || 'Employee',
    avatar: person?.profileImage || '',
    initials: initials(person?.name || 'Employee'),
    role,
    department,
    email: person?.email || '',
    attendanceStatus,
    attendanceNote,
    recordDetails,
    hasAttendanceRecord: Boolean(attendanceRecord),
    statusType: attendanceRecord ? 'warning' : 'error'
  };
};

const mapLeaveRow = (leave) => {
  const user = leave?.user || {};
  const name = user?.name || 'Employee';
  return {
    id: String(leave?._id || ''),
    name,
    avatar: user?.profileImage || '',
    initials: initials(name),
    role: user?.jobRole?.name || user?.jobRole || user?.role || '',
    department: user?.department?.name || user?.department?.title || user?.department || '',
    leaveType: leave?.type || 'Leave',
    days: leave?.days || 1,
    from: formatDate(leave?.startDate),
    to: formatDate(leave?.endDate),
    reason: leave?.reason || '',
    appliedOn: formatDate(leave?.createdAt || leave?.updatedAt || leave?.startDate),
    priority: leave?.days >= 3 ? 'High' : 'Normal',
    status: leave?.status || 'Pending'
  };
};

const mapAssetRow = (request) => {
  const user = request?.user || {};
  const name = user?.name || 'Employee';
  return {
    id: String(request?._id || ''),
    name,
    avatar: user?.profileImage || '',
    initials: initials(name),
    role: user?.jobRole?.name || user?.jobRole || user?.role || '',
    department: request?.department || user?.department?.name || user?.department?.title || user?.department || '',
    assetType: request?.assetName || request?.requestType || 'Asset',
    specs: request?.assetStatus || request?.requestType || 'Requested',
    reason: request?.reason || '',
    priority: request?.requestType === 'maintenance' ? 'High' : request?.requestType === 'return' ? 'Important' : 'Normal',
    requestedOn: formatDate(request?.requestDate || request?.createdAt),
    status: request?.status || 'pending'
  };
};

const mapAlertRow = (alert) => {
  const type = alert?.type || 'info';
  return {
    id: String(alert?._id || ''),
    type,
    title: alert?.message || '',
    description: alert?.message || '',
    category: type === 'error' ? 'Critical Notice' : type === 'warning' ? 'Company Notice' : 'Information',
    priority: type === 'error' ? 'High' : type === 'warning' ? 'Important' : 'Normal',
    date: formatDate(alert?.createdAt),
    time: formatTime(alert?.createdAt)
  };
};

exports.getDashboardOverview = async (req, res) => {
  try {
    const user = req.user;
    const companyCode = String(user.companyCode || user.company?.companyCode || '').trim();
    if (!companyCode) return res.status(400).json({ success: false, message: 'Company context is missing' });
    const companyId = user.company?._id || user.company;
    const company = await Company.findById(companyId).select('allowedPages isActive').lean();
    if (!company) return res.status(403).json({ success: false, message: 'Company access is not available' });
    const access = await hasDashboardAccess(user, company);
    if (!access) return res.status(403).json({ success: false, message: 'Dashboard is not enabled for this company or role' });
    if (req.query.variant && req.query.variant !== access.variant) return res.status(403).json({ success: false, message: 'This dashboard is not assigned to your job role' });

    const { start, end } = todayRange();
    const companyUsers = await User.find({ companyCode, isActive: { $ne: false }, registrationStatus: { $ne: 'rejected' } })
      .select('_id name email profileImage role companyRole jobRole department')
      .lean();
    const departmentIds = companyUsers
      .map(person => person.department)
      .filter(value => mongoose.Types.ObjectId.isValid(value));
    const jobRoleIds = companyUsers
      .map(person => person.jobRole)
      .filter(value => mongoose.Types.ObjectId.isValid(value));
    const [departments, jobRoles] = await Promise.all([
      Department.find({ _id: { $in: departmentIds } }).select('_id name').lean(),
      JobRole.find({ _id: { $in: jobRoleIds } }).select('_id name').lean()
    ]);
    const departmentNames = new Map(departments.map(item => [String(item._id), item.name]));
    const jobRoleNames = new Map(jobRoles.map(item => [String(item._id), item.name]));
    const resolvedUsers = companyUsers.map(person => ({
      ...person,
      department: departmentNames.get(String(person.department)) || person.department || '',
      jobRole: jobRoleNames.get(String(person.jobRole)) || person.jobRole || ''
    }));
    const employeeUsers = resolvedUsers.filter(person => !isClientUser(person));
    const employeeUserIds = employeeUsers.map(person => person._id);
    const attendance = await Attendance.find({ companyCode, date: { $gte: start, $lte: end } })
      .select('user inTime outTime totalTime isClockedIn status createdAt updatedAt')
      .lean();
    const attendanceByUserId = new Map(attendance.map(item => [String(item.user), item]));
    const presentIds = new Set(attendance.filter(item => item.inTime || ['PRESENT', 'LATE', 'HALF DAY', 'HALFDAY', 'SHORT LEAVE'].includes(item.status)).map(item => String(item.user)));
    const presentUsers = employeeUsers.filter(item => presentIds.has(String(item._id)));
    const presentUserIds = presentUsers.map(item => item._id);
    const absentUsers = employeeUsers
      .filter(item => !presentIds.has(String(item._id)))
      .map(person => mapAbsentRow(person, attendanceByUserId.get(String(person._id)) || null));

    const [pendingLeavesCount, pendingAssetsCount, unseenAlerts, tasks, pendingLeaves, pendingAssets, alertRows] = await Promise.all([
      Leave.countDocuments({ companyCode, user: { $in: employeeUserIds }, status: { $regex: /^pending$/i } }),
      AssetRequest.countDocuments({ companyCode, user: { $in: employeeUserIds }, status: 'pending' }),
      Alert.countDocuments({ companyCode, readBy: { $ne: user._id } }),
      Task.find({ companyCode, isActive: { $ne: false }, assignedUsers: { $in: presentUserIds } })
        .sort({ lastActivityAt: -1, updatedAt: -1 }).limit(300)
        .select('title description assignedUsers statusByUser overallStatus lastActivityAt updatedAt').lean()
        ,
      Leave.find({ companyCode, user: { $in: employeeUserIds }, status: { $regex: /^pending$/i } })
        .sort({ createdAt: -1 })
        .limit(25)
        .populate({
          path: 'user',
          select: 'name profileImage role companyRole jobRole department',
          populate: [
            { path: 'jobRole', select: 'name' },
            { path: 'department', select: 'name' }
          ]
        })
        .lean(),
      AssetRequest.find({ companyCode, user: { $in: employeeUserIds }, status: 'pending' })
        .sort({ createdAt: -1 })
        .limit(25)
        .populate({
          path: 'user',
          select: 'name profileImage role companyRole jobRole department',
          populate: [
            { path: 'jobRole', select: 'name' },
            { path: 'department', select: 'name' }
          ]
        })
        .lean(),
      Alert.find({ companyCode })
        .sort({ createdAt: -1 })
        .limit(25)
        .select('_id type message createdAt')
        .lean()
    ]);

    const updates = presentUsers.map(person => {
      const personTasks = tasks.filter(task => task.assignedUsers?.some(id => String(id) === String(person._id)));
      const task = personTasks[0];
      const status = task?.statusByUser?.find(item => String(item.user) === String(person._id));
      return {
        user: person,
        task: task ? { id: task._id, title: task.title, status: status?.status || task.overallStatus } : null,
        progress: status?.status || task?.overallStatus || 'No update',
        lastUpdate: status?.remarks || task?.description || '',
        updatedAt: status?.updatedAt || task?.lastActivityAt || task?.updatedAt || null
      };
    });
    const currentAttendance = attendance.find(item => String(item.user) === String(user._id)) || null;
    const totalUsers = employeeUsers.length;
    const totalPresent = presentUsers.length;
    const totalAbsent = Math.max(0, totalUsers - totalPresent);
    const attendanceRate = totalUsers > 0 ? Math.round((totalPresent / totalUsers) * 100) : 0;
    return res.json({ success: true, data: {
      date: start.toISOString(),
      variant: access.variant,
      metrics: {
        totalUsers,
        totalPresent,
        totalAbsent,
        pendingLeaveRequests: pendingLeavesCount,
        pendingAssetRequests: pendingAssetsCount,
        unseenAlerts,
        onDuty: totalPresent,
        absentToday: totalAbsent,
        onLeave: pendingLeavesCount,
        assetRequests: pendingAssetsCount,
        unseenAlertCount: unseenAlerts,
        attendanceRate
      },
      presentUsers: updates,
      absentUsers,
      pendingLeaves: pendingLeaves.map(mapLeaveRow),
      pendingAssets: pendingAssets.map(mapAssetRow),
      alerts: alertRows.map(mapAlertRow),
      clock: currentAttendance,
      taskManagementAvailable: Array.isArray(company?.allowedPages) ? company.allowedPages.length === 0 || company.allowedPages.some(item => normalize(item).includes('task-management')) : true
    }});
  } catch (error) {
    console.error('Dashboard overview error:', error);
    return res.status(500).json({ success: false, message: 'Unable to load dashboard overview' });
  }
};
