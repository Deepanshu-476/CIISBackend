const ExcelJS = require('exceljs');
const mongoose = require('mongoose');
const Attendance = require('../models/Attendance');
const Task = require('../models/Task');
const Project = require('../models/Project');
const Client = require('../models/Client');
const ClientTask = require('../models/ClientTask');
const ClientPlan = require('../models/ClientPlan');
const User = require('../../models/User');

const getEffectiveCompanyCode = (req) => {
  return String(req.user?.companyCode || req.user?.company?.companyCode || '').trim().toUpperCase();
};

const getEffectiveCompanyId = (req) => {
  return req.user?.company?._id || req.user?.company || null;
};

const isUserAdminOrHr = (req) => {
  const role = String(req.user?.role || req.user?.jobRole || '').toLowerCase();
  return (
    role.includes('admin') ||
    role.includes('hr') ||
    role.includes('manager') ||
    role.includes('superadmin') ||
    role.includes('director') ||
    role.includes('owner')
  );
};

const formatDate = (date) => {
  if (!date) return '-';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
};

const formatTime = (date) => {
  if (!date) return '-';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
};

const applyHeaderStyling = (worksheet, title, subtitle) => {
  worksheet.views = [{ showGridLines: true }];
  
  // Title row
  worksheet.mergeCells('A1', 'H1');
  const titleCell = worksheet.getCell('A1');
  titleCell.value = title;
  titleCell.font = { name: 'Arial', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
  titleCell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E3A8A' } // Deep Navy Blue
  };
  worksheet.getRow(1).height = 36;

  // Subtitle row
  worksheet.mergeCells('A2', 'H2');
  const subCell = worksheet.getCell('A2');
  subCell.value = subtitle;
  subCell.font = { name: 'Arial', size: 11, italic: true, color: { argb: 'FF374151' } };
  subCell.alignment = { vertical: 'middle', horizontal: 'center' };
  subCell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFF3F4F6' } // Light Gray
  };
  worksheet.getRow(2).height = 24;

  // Empty spacer row 3
  worksheet.getRow(3).height = 12;
};

const styleTableHeaders = (row) => {
  row.height = 26;
  row.eachCell((cell) => {
    cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF2563EB' } // Primary Blue
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
      left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
      bottom: { style: 'medium', color: { argb: 'FF1D4ED8' } },
      right: { style: 'thin', color: { argb: 'FFD1D5DB' } }
    };
  });
};

/**
 * 1. ATTENDANCE EXPORT (Self, Today, Monthly, Single User)
 */
exports.exportAttendanceReport = async (req, res) => {
  try {
    const companyCode = getEffectiveCompanyCode(req);
    const isAdmin = isUserAdminOrHr(req);
    const requestedType = String(req.query.type || 'self').toLowerCase();
    const format = String(req.query.format || 'xlsx').toLowerCase();
    const queryDate = req.query.date; // e.g. 'today' or '2026-11-20'
    const targetUserId = req.query.userId;

    let filter = {};
    let subtitle = `Generated on: ${formatDate(new Date())}`;

    // Determine target users
    if (requestedType === 'self' || !isAdmin) {
      filter.user = req.user._id;
      subtitle = `Attendance for: ${req.user.name || 'Current User'} | ${subtitle}`;
    } else if (targetUserId) {
      filter.user = targetUserId;
      const targetUser = await User.findById(targetUserId).select('name email');
      subtitle = `Attendance for: ${targetUser?.name || targetUserId} | ${subtitle}`;
    } else {
      // Admin company-wide
      const companyUsers = await User.find({
        $or: [
          { companyCode },
          { company: getEffectiveCompanyId(req) }
        ]
      }).select('_id');
      const userIds = companyUsers.map(u => u._id);
      filter.user = { $in: userIds };
      subtitle = `Company-Wide Attendance (${companyCode}) | ${subtitle}`;
    }

    // Determine date range
    if (queryDate === 'today' || requestedType === 'today') {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date();
      endOfDay.setHours(23, 59, 59, 999);
      filter.date = { $gte: startOfDay, $lte: endOfDay };
      subtitle = `Today's Attendance (${formatDate(startOfDay)}) | ${subtitle}`;
    } else if (req.query.startDate && req.query.endDate) {
      const s = new Date(req.query.startDate);
      s.setHours(0, 0, 0, 0);
      const e = new Date(req.query.endDate);
      e.setHours(23, 59, 59, 999);
      filter.date = { $gte: s, $lte: e };
      subtitle = `Date Range: ${formatDate(s)} to ${formatDate(e)} | ${subtitle}`;
    } else if (requestedType === 'monthly' || req.query.month) {
      const now = new Date();
      const month = req.query.month ? parseInt(req.query.month, 10) - 1 : now.getMonth();
      const year = req.query.year ? parseInt(req.query.year, 10) : now.getFullYear();
      const s = new Date(year, month, 1, 0, 0, 0, 0);
      const e = new Date(year, month + 1, 0, 23, 59, 59, 999);
      filter.date = { $gte: s, $lte: e };
      subtitle = `Month: ${s.toLocaleString('default', { month: 'long', year: 'numeric' })} | ${subtitle}`;
    }

    const records = await Attendance.find(filter)
      .populate('user', 'name email employeeId department jobRole')
      .sort({ date: -1, 'user.name': 1 })
      .lean();

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'CIIS Network AI System';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Attendance Report');
    applyHeaderStyling(worksheet, 'CIIS NETWORK - ATTENDANCE REPORT', subtitle);

    const headers = [
      'Date',
      'Employee Code',
      'Employee Name',
      'Department',
      'In Time',
      'Out Time',
      'Status',
      'Late By',
      'Early Leave',
      'Overtime',
      'Clock Out Mode'
    ];

    const headerRow = worksheet.addRow(headers);
    styleTableHeaders(headerRow);

    records.forEach((rec) => {
      const user = rec.user || {};
      const row = worksheet.addRow([
        formatDate(rec.date),
        user.employeeId || '-',
        user.name || 'Unknown',
        user.department || '-',
        formatTime(rec.inTime),
        formatTime(rec.outTime),
        rec.status || 'ABSENT',
        rec.lateBy || '00:00:00',
        rec.earlyLeave || '00:00:00',
        rec.overTime || '00:00:00',
        rec.clockOutMode || '-'
      ]);

      // Row formatting
      row.height = 20;
      row.eachCell((cell, colNumber) => {
        cell.font = { name: 'Arial', size: 10 };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
        };
        if (colNumber === 7) {
          // Status column styling
          const st = String(cell.value || '').toUpperCase();
          if (st.includes('PRESENT')) {
            cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF16A34A' } };
          } else if (st.includes('ABSENT')) {
            cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFDC2626' } };
          } else if (st.includes('HALF') || st.includes('LATE')) {
            cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFD97706' } };
          }
        }
      });
    });

    // Auto-fit column widths
    worksheet.columns.forEach((column) => {
      let maxLen = 12;
      column.eachCell({ includeEmpty: true }, (cell) => {
        const val = cell.value ? String(cell.value) : '';
        if (val.length > maxLen) maxLen = Math.min(val.length + 3, 40);
      });
      column.width = maxLen;
    });

    const filename = `Attendance_Report_${new Date().toISOString().slice(0, 10)}.${format === 'csv' ? 'csv' : 'xlsx'}`;

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return await workbook.csv.write(res);
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await workbook.xlsx.write(res);
    return res.end();
  } catch (error) {
    console.error('[exportAttendanceReport] error:', error);
    return res.status(500).json({ success: false, message: 'Attendance report export failed', error: error.message });
  }
};

/**
 * 2. TASKS EXPORT (All Tasks, Single User Tasks, Today's Tasks, Filtered)
 */
exports.exportTasksReport = async (req, res) => {
  try {
    const companyCode = getEffectiveCompanyCode(req);
    const isAdmin = isUserAdminOrHr(req);
    const requestedType = String(req.query.type || (isAdmin ? 'all' : 'self')).toLowerCase();
    const format = String(req.query.format || 'xlsx').toLowerCase();
    const queryDate = req.query.date; // 'today' or YYYY-MM-DD
    const targetUserId = req.query.userId;
    const targetUserName = req.query.userName;

    let filter = {
      $or: [
        { companyCode },
        { company: getEffectiveCompanyId(req) }
      ]
    };
    let subtitle = `Generated on: ${formatDate(new Date())}`;

    // Target User Scoping
    if (requestedType === 'self' || (!isAdmin && !targetUserId)) {
      filter.$and = [
        {
          $or: [
            { assignedTo: req.user._id },
            { assignedUsers: req.user._id },
            { createdBy: req.user._id }
          ]
        }
      ];
      subtitle = `Tasks for: ${req.user.name || 'Current User'} | ${subtitle}`;
    } else if (targetUserId) {
      filter.$and = [
        {
          $or: [
            { assignedTo: targetUserId },
            { assignedUsers: targetUserId }
          ]
        }
      ];
      const u = await User.findById(targetUserId).select('name');
      subtitle = `Tasks for: ${u?.name || targetUserId} | ${subtitle}`;
    } else if (targetUserName) {
      const u = await User.findOne({
        name: { $regex: new RegExp(targetUserName, 'i') },
        companyCode
      }).select('_id name');
      if (u) {
        filter.$and = [
          {
            $or: [
              { assignedTo: u._id },
              { assignedUsers: u._id }
            ]
          }
        ];
        subtitle = `Tasks for: ${u.name} | ${subtitle}`;
      }
    } else {
      subtitle = `All Tasks Report (${companyCode}) | ${subtitle}`;
    }

    // Date filtering (today, range)
    if (queryDate === 'today') {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date();
      endOfDay.setHours(23, 59, 59, 999);
      filter.createdAt = { $gte: startOfDay, $lte: endOfDay };
      subtitle = `Today's Tasks (${formatDate(startOfDay)}) | ${subtitle}`;
    } else if (req.query.startDate && req.query.endDate) {
      const s = new Date(req.query.startDate);
      s.setHours(0, 0, 0, 0);
      const e = new Date(req.query.endDate);
      e.setHours(23, 59, 59, 999);
      filter.createdAt = { $gte: s, $lte: e };
      subtitle = `Date Range: ${formatDate(s)} to ${formatDate(e)} | ${subtitle}`;
    }

    if (req.query.status) {
      filter.status = new RegExp(req.query.status, 'i');
    }

    const tasks = await Task.find(filter)
      .populate('assignedTo', 'name email employeeId')
      .populate('assignedUsers', 'name email employeeId')
      .populate('createdBy', 'name')
      .sort({ createdAt: -1 })
      .lean();

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'CIIS Network AI System';
    worksheet = workbook.addWorksheet('Tasks Report');
    applyHeaderStyling(worksheet, 'CIIS NETWORK - TASKS REPORT', subtitle);

    const headers = [
      'Task Title',
      'Description',
      'Task Type',
      'Assigned To',
      'Created By',
      'Due Date',
      'Status',
      'Priority',
      'Created Date',
      'Completed Date'
    ];

    const headerRow = worksheet.addRow(headers);
    styleTableHeaders(headerRow);

    tasks.forEach((t) => {
      let assignees = [];
      if (t.assignedTo?.name) assignees.push(t.assignedTo.name);
      if (Array.isArray(t.assignedUsers)) {
        t.assignedUsers.forEach(u => {
          if (u?.name && !assignees.includes(u.name)) assignees.push(u.name);
        });
      }

      const row = worksheet.addRow([
        t.title || 'Untitled',
        t.description || '-',
        t.taskType || (t.projectId ? 'Project Task' : 'General Task'),
        assignees.join(', ') || 'Unassigned',
        t.createdBy?.name || '-',
        formatDate(t.dueDate || t.dueDateTime),
        (t.status || 'pending').toUpperCase(),
        (t.priority || 'medium').toUpperCase(),
        formatDate(t.createdAt),
        formatDate(t.completionDate)
      ]);

      row.height = 20;
      row.eachCell((cell, colNumber) => {
        cell.font = { name: 'Arial', size: 10 };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
        };
        if (colNumber === 7) {
          // Status color
          const st = String(cell.value || '').toUpperCase();
          if (st.includes('COMPLETED') || st.includes('APPROVED')) {
            cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF16A34A' } };
          } else if (st.includes('OVERDUE') || st.includes('REJECTED')) {
            cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFDC2626' } };
          } else {
            cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFD97706' } };
          }
        }
      });
    });

    worksheet.columns.forEach((column) => {
      let maxLen = 14;
      column.eachCell({ includeEmpty: true }, (cell) => {
        const val = cell.value ? String(cell.value) : '';
        if (val.length > maxLen) maxLen = Math.min(val.length + 3, 50);
      });
      column.width = maxLen;
    });

    const filename = `Tasks_Report_${new Date().toISOString().slice(0, 10)}.${format === 'csv' ? 'csv' : 'xlsx'}`;

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return await workbook.csv.write(res);
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await workbook.xlsx.write(res);
    return res.end();
  } catch (error) {
    console.error('[exportTasksReport] error:', error);
    return res.status(500).json({ success: false, message: 'Tasks report export failed', error: error.message });
  }
};

/**
 * 3. PROJECT TASKS EXPORT (All Tasks of a Specific Project, with Team Member Grouping)
 */
exports.exportProjectTasksReport = async (req, res) => {
  try {
    const companyCode = getEffectiveCompanyCode(req);
    const projectId = req.params.projectId || req.query.projectId;
    const format = String(req.query.format || 'xlsx').toLowerCase();

    if (!projectId) {
      return res.status(400).json({ success: false, message: 'Project ID is required' });
    }

    let project = null;
    if (mongoose.Types.ObjectId.isValid(projectId)) {
      project = await Project.findById(projectId)
        .populate('managers', 'name email')
        .populate('users', 'name email employeeId')
        .populate('tasks.assignedTo', 'name email')
        .populate('tasks.assignedUsers', 'name email')
        .populate('tasks.createdBy', 'name')
        .lean();
    } else {
      // Find by project name
      project = await Project.findOne({
        projectName: new RegExp(projectId, 'i'),
        companyCode
      })
        .populate('managers', 'name email')
        .populate('users', 'name email employeeId')
        .populate('tasks.assignedTo', 'name email')
        .populate('tasks.assignedUsers', 'name email')
        .populate('tasks.createdBy', 'name')
        .lean();
    }

    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    const tasks = project.tasks || [];
    const totalTasks = tasks.length;
    const completedTasks = tasks.filter(t => ['completed', 'approved'].includes(String(t.status || '').toLowerCase())).length;
    const progressRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'CIIS Network AI System';
    const worksheet = workbook.addWorksheet('Project Tasks');

    const subtitle = `Project: ${project.projectName} | Status: ${(project.status || 'active').toUpperCase()} | Progress: ${progressRate}% (${completedTasks}/${totalTasks}) | Deadline: ${formatDate(project.endDate)}`;
    applyHeaderStyling(worksheet, `PROJECT REPORT - ${project.projectName.toUpperCase()}`, subtitle);

    const headers = [
      'Task Title',
      'Description',
      'Assigned Team Members',
      'Priority',
      'Status',
      'Due Date',
      'Checkpoints Done / Total',
      'Remarks Count'
    ];

    const headerRow = worksheet.addRow(headers);
    styleTableHeaders(headerRow);

    tasks.forEach((t) => {
      let assignees = [];
      if (t.assignedTo?.name) assignees.push(t.assignedTo.name);
      if (Array.isArray(t.assignedUsers)) {
        t.assignedUsers.forEach(u => {
          if (u?.name && !assignees.includes(u.name)) assignees.push(u.name);
        });
      }

      const checkpoints = t.checkpoints || [];
      const cpDone = checkpoints.filter(c => c.completed).length;
      const cpStr = checkpoints.length > 0 ? `${cpDone} / ${checkpoints.length}` : '-';

      const row = worksheet.addRow([
        t.title || 'Untitled',
        t.description || '-',
        assignees.join(', ') || 'Team',
        (t.priority || 'medium').toUpperCase(),
        (t.status || 'pending').toUpperCase(),
        formatDate(t.dueDate || t.dueDateTime),
        cpStr,
        Array.isArray(t.remarks) ? t.remarks.length : 0
      ]);

      row.height = 20;
      row.eachCell((cell, colNumber) => {
        cell.font = { name: 'Arial', size: 10 };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
        };
        if (colNumber === 5) {
          const st = String(cell.value || '').toUpperCase();
          if (st.includes('COMPLETED')) {
            cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF16A34A' } };
          } else if (st.includes('OVERDUE')) {
            cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFDC2626' } };
          }
        }
      });
    });

    worksheet.columns.forEach((column) => {
      let maxLen = 14;
      column.eachCell({ includeEmpty: true }, (cell) => {
        const val = cell.value ? String(cell.value) : '';
        if (val.length > maxLen) maxLen = Math.min(val.length + 3, 50);
      });
      column.width = maxLen;
    });

    const safeName = project.projectName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `Project_${safeName}_Tasks_${new Date().toISOString().slice(0, 10)}.${format === 'csv' ? 'csv' : 'xlsx'}`;

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return await workbook.csv.write(res);
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await workbook.xlsx.write(res);
    return res.end();
  } catch (error) {
    console.error('[exportProjectTasksReport] error:', error);
    return res.status(500).json({ success: false, message: 'Project tasks export failed', error: error.message });
  }
};

/**
 * 4. CLIENTS MASTER SHEET EXPORT
 * Full metrics: Client Name, Company, Subscription Plan, Subscription Status,
 * Expiry Date, Days Left / Overdue, Total Tasks, Completed Tasks, Pending Tasks, Active Services
 */
exports.exportClientsMasterReport = async (req, res) => {
  try {
    const companyCode = getEffectiveCompanyCode(req);
    const format = String(req.query.format || 'xlsx').toLowerCase();

    // Fetch all clients in company
    const clients = await Client.find({
      $or: [
        { companyCode },
        { companyId: getEffectiveCompanyId(req) }
      ]
    })
      .populate('activeClientPlan')
      .sort({ createdAt: -1 })
      .lean();

    // Fetch all client tasks to aggregate metrics per client
    const allClientTasks = await ClientTask.find({
      clientId: { $in: clients.map(c => c._id) }
    }).select('clientId status service').lean();

    // Group tasks by clientId
    const clientTaskMap = new Map();
    allClientTasks.forEach((task) => {
      const cId = String(task.clientId);
      if (!clientTaskMap.has(cId)) {
        clientTaskMap.set(cId, { total: 0, completed: 0, pending: 0, services: new Set() });
      }
      const stats = clientTaskMap.get(cId);
      stats.total += 1;
      const status = String(task.status || '').toLowerCase();
      if (['completed', 'approved'].includes(status)) {
        stats.completed += 1;
      } else {
        stats.pending += 1;
      }
      if (task.service) stats.services.add(task.service);
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'CIIS Network AI System';
    const worksheet = workbook.addWorksheet('Clients Master Report');

    const subtitle = `Total Clients: ${clients.length} | Generated on: ${formatDate(new Date())}`;
    applyHeaderStyling(worksheet, 'CIIS NETWORK - CLIENTS & SUBSCRIPTIONS MASTER REPORT', subtitle);

    const headers = [
      'Client Name',
      'Company Name',
      'Email',
      'Phone',
      'Active Plan Name',
      'Subscription Status',
      'Start Date',
      'Expiry Date (Valid Till)',
      'Validity Status',
      'Total Tasks',
      'Completed Tasks',
      'Pending Tasks',
      'Completion Rate (%)',
      'Active Services'
    ];

    const headerRow = worksheet.addRow(headers);
    styleTableHeaders(headerRow);

    const now = new Date();

    clients.forEach((c) => {
      const cId = String(c._id);
      const taskStats = clientTaskMap.get(cId) || { total: 0, completed: 0, pending: 0, services: new Set() };
      
      // Determine subscription info
      let activeSub = null;
      if (Array.isArray(c.subscription) && c.subscription.length > 0) {
        // Find newest or active subscription
        activeSub = c.subscription.find(s => s.status === 'Active') || c.subscription[c.subscription.length - 1];
      }

      const planName = activeSub?.planName || c.activeClientPlan?.name || 'Standard Plan';
      const startDate = activeSub?.startDate ? formatDate(activeSub.startDate) : '-';
      const endDate = activeSub?.endDate ? formatDate(activeSub.endDate) : '-';
      
      let subStatus = activeSub?.status || 'No Subscription';
      let validityNotice = '-';

      if (activeSub?.endDate) {
        const expDate = new Date(activeSub.endDate);
        const diffMs = expDate.getTime() - now.getTime();
        const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        if (diffDays > 0) {
          subStatus = 'Active';
          validityNotice = `${diffDays} days left`;
        } else {
          subStatus = 'Expired';
          validityNotice = `Expired ${Math.abs(diffDays)} days ago`;
        }
      }

      const completionRate = taskStats.total > 0 ? `${Math.round((taskStats.completed / taskStats.total) * 100)}%` : '0%';

      // Combine client services
      let serviceList = [];
      if (Array.isArray(c.services)) {
        serviceList = c.services.map(s => typeof s === 'string' ? s : s?.name || '').filter(Boolean);
      }
      taskStats.services.forEach(s => {
        if (!serviceList.includes(s)) serviceList.push(s);
      });

      const row = worksheet.addRow([
        c.client || 'Unnamed Client',
        c.company || '-',
        c.email || '-',
        c.phone || c.mobile || '-',
        planName,
        subStatus.toUpperCase(),
        startDate,
        endDate,
        validityNotice,
        taskStats.total,
        taskStats.completed,
        taskStats.pending,
        completionRate,
        serviceList.join(', ') || 'General'
      ]);

      row.height = 20;
      row.eachCell((cell, colNumber) => {
        cell.font = { name: 'Arial', size: 10 };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
        };
        // Color Subscription Status
        if (colNumber === 6) {
          const val = String(cell.value || '').toUpperCase();
          if (val === 'ACTIVE') {
            cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF16A34A' } };
          } else if (val === 'EXPIRED') {
            cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFDC2626' } };
          }
        }
      });
    });

    worksheet.columns.forEach((column) => {
      let maxLen = 14;
      column.eachCell({ includeEmpty: true }, (cell) => {
        const val = cell.value ? String(cell.value) : '';
        if (val.length > maxLen) maxLen = Math.min(val.length + 3, 50);
      });
      column.width = maxLen;
    });

    const filename = `Clients_Master_Report_${new Date().toISOString().slice(0, 10)}.${format === 'csv' ? 'csv' : 'xlsx'}`;

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return await workbook.csv.write(res);
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await workbook.xlsx.write(res);
    return res.end();
  } catch (error) {
    console.error('[exportClientsMasterReport] error:', error);
    return res.status(500).json({ success: false, message: 'Clients master report export failed', error: error.message });
  }
};

/**
 * 5. SPECIFIC CLIENT TASKS EXPORT
 */
exports.exportClientTasksReport = async (req, res) => {
  try {
    const clientId = req.params.clientId || req.query.clientId;
    const format = String(req.query.format || 'xlsx').toLowerCase();

    if (!clientId) {
      return res.status(400).json({ success: false, message: 'Client ID is required' });
    }

    const client = await Client.findById(clientId).lean();
    if (!client) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }

    const tasks = await ClientTask.find({ clientId })
      .populate('assignedTo', 'name email')
      .sort({ createdAt: -1 })
      .lean();

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'CIIS Network AI System';
    const worksheet = workbook.addWorksheet('Client Tasks');

    const subtitle = `Client: ${client.client} (${client.company}) | Total Tasks: ${tasks.length} | Generated: ${formatDate(new Date())}`;
    applyHeaderStyling(worksheet, `CLIENT TASKS - ${client.client.toUpperCase()}`, subtitle);

    const headers = [
      'Task Name',
      'Description',
      'Service Name',
      'Plan Name',
      'Assigned To',
      'Priority',
      'Status',
      'Due Date',
      'Created Date'
    ];

    const headerRow = worksheet.addRow(headers);
    styleTableHeaders(headerRow);

    tasks.forEach((t) => {
      const row = worksheet.addRow([
        t.title || t.name || 'Untitled Task',
        t.description || '-',
        t.service || 'General Service',
        t.planName || '-',
        t.assignedTo?.name || 'Unassigned',
        (t.priority || 'medium').toUpperCase(),
        (t.status || 'pending').toUpperCase(),
        formatDate(t.dueDate || t.dueDateTime),
        formatDate(t.createdAt)
      ]);

      row.height = 20;
      row.eachCell((cell, colNumber) => {
        cell.font = { name: 'Arial', size: 10 };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
        };
        if (colNumber === 7) {
          const st = String(cell.value || '').toUpperCase();
          if (st.includes('COMPLETED')) {
            cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF16A34A' } };
          }
        }
      });
    });

    worksheet.columns.forEach((column) => {
      let maxLen = 14;
      column.eachCell({ includeEmpty: true }, (cell) => {
        const val = cell.value ? String(cell.value) : '';
        if (val.length > maxLen) maxLen = Math.min(val.length + 3, 50);
      });
      column.width = maxLen;
    });

    const safeClient = (client.client || 'Client').replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `Client_${safeClient}_Tasks_${new Date().toISOString().slice(0, 10)}.${format === 'csv' ? 'csv' : 'xlsx'}`;

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return await workbook.csv.write(res);
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await workbook.xlsx.write(res);
    return res.end();
  } catch (error) {
    console.error('[exportClientTasksReport] error:', error);
    return res.status(500).json({ success: false, message: 'Client tasks export failed', error: error.message });
  }
};
