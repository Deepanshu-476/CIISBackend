
const Leave = require('../models/Leave');
const User = require('../../models/User');
const Company = require('../../models/Company');
const PagePermission = require('../../models/PagePermission');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');


const { 
  sendLeaveAppliedEmail, 
  sendLeaveStatusEmail,
  sendLeaveDeletedEmail 
} = require('../../utils/sendEmail');


const { emitLeaveEvents } = require('../socket/handlers/leaveHandlers');
const {notifyPageUsers, notifyDirectUsers} = require('../utils/systemNotificationService');

const APPROVAL_ROLES = ['manager', 'hr', 'owner'];

const normalizeRoleValue = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[\s_-]+/g, '');

const getApprovalRoleForUser = (user = {}) => {
  const companyRole = normalizeRoleValue(user.companyRole);
  const role = normalizeRoleValue(user.role);
  const jobRole = normalizeRoleValue(user.jobRole);
  const roles = [companyRole, role, jobRole];

  if (companyRole === 'owner' || role === 'companyowner' || jobRole === 'companyowner') {
    return 'owner';
  }

  if (roles.includes('hr') || roles.includes('humanresources')) {
    return 'hr';
  }

  if (roles.includes('manager')) {
    return 'manager';
  }

  return null;
};

const calculateFinalLeaveStatus = (approvals) => {
  const normalizedApprovals = Leave.normalizeApprovals(approvals);
  const statuses = APPROVAL_ROLES.map((role) => normalizedApprovals[role].status);

  if (statuses.includes('Rejected')) return 'Rejected';
  if (statuses.every((status) => status === 'Approved')) return 'Approved';
  return 'Pending';
};

const formatLeaveWithApprovals = (leave) => Leave.withApprovalDefaults(leave);

const writeLeaveDebugLog = (label, data) => {
  try {
    const logPath = path.join(__dirname, '../../leave-debug.log');
    fs.appendFileSync(
      logPath,
      `${new Date().toISOString()} ${label} ${JSON.stringify(data, null, 2)}\n`,
      'utf8'
    );
  } catch {
    
  }
};

const normalizeId = (value) => {
  if (!value) return '';
  if (value._id && value._id !== value) return normalizeId(value._id);
  if (typeof value.toString === 'function') return value.toString();
  return String(value);
};

const getUserCompanyId = (user = {}) => {
  const company = user.company;
  return company?._id || company || user.companyId || null;
};

const getUserCompanyCode = (user = {}) => {
  return String(user.companyCode || user.company?.companyCode || '').trim();
};

const getLeaveApprovalStepsForCompany = async (companyId) => {
  if (!companyId || !mongoose.isValidObjectId(companyId)) return [];

  const pagePermission = await PagePermission.findOne({
    company: companyId,
    path: '/ciisUser/emp-leaves'
  }).lean();

  const approverIds = (pagePermission?.approvers || [])
    .map(item => item.user)
    .filter(Boolean);

  if (approverIds.length === 0) return [];

  return [...new Set(approverIds.map(id => normalizeId(id)))]
    .filter(id => mongoose.isValidObjectId(id))
    .map(id => ({
      user: id,
      status: 'Pending',
      remarks: '',
      actionedAt: null
    }));
};


exports.applyLeave = async (req, res) => {
  void 0;

  try {
    const { type, reason, startDate, endDate } = req.body;

    
    if (!type?.trim() || !reason?.trim() || !startDate || !endDate) {
      return res.status(400).json({ error: 'All fields are required.' });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (start > end) {
      return res.status(400).json({ error: 'Start date cannot be after end date.' });
    }

    if (start < today) {
      return res.status(400).json({ error: 'Start date cannot be in the past.' });
    }

    const days = Math.floor((end - start) / (1000 * 60 * 60 * 24)) + 1;

    
    const existingLeaves = await Leave.find({
      user: req.user._id,
      status: { $in: ['Pending', 'Approved'] },
      $or: [
        { startDate: { $lte: end }, endDate: { $gte: start } }
      ]
    });

    if (existingLeaves.length > 0) {
      return res.status(400).json({ 
        error: 'You already have a leave application for this period.' 
      });
    }

    
    
    const user = await User.findById(req.user._id)
      .select('name email department jobRole employeeId phone company companyCode')
      .populate('company', 'companyName companyCode isActive')
      .lean();

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User account was not found. Please login again.'
      });
    }

    let userCompanyId = getUserCompanyId(user) || getUserCompanyId(req.user);
    let userCompanyCode = getUserCompanyCode(user) || getUserCompanyCode(req.user);

    if (!userCompanyId) {
      const company = await Company.findOne({ companyCode: userCompanyCode }).select('_id').lean();
      userCompanyId = company?._id || null;
    }

    if (!userCompanyCode && userCompanyId) {
      const company = await Company.findById(userCompanyId).select('companyCode').lean();
      userCompanyCode = company?.companyCode || '';
    }

    if (!userCompanyId || !userCompanyCode) {
      return res.status(400).json({
        success: false,
        message: 'Company is not configured for this user. Please contact administrator.'
      });
    }

    const approvalSteps = await getLeaveApprovalStepsForCompany(userCompanyId);

    
    const leave = new Leave({
      user: req.user._id,
      type: type.trim(),
      reason: reason.trim(),
      startDate: start,
      endDate: end,
      days,
      status: 'Pending',
      approvals: Leave.defaultApprovals(),
      approvedBy: null,
      approvalSteps,
      approvalMode: approvalSteps.length > 0 ? 'all' : 'single',
      remarks: '',
      companyCode: userCompanyCode,
      history: [
        {
          action: 'applied',
          by: req.user._id,
          role: req.user.jobRole || 'user',
          remarks: '',
          at: new Date()
        }
      ]
    });

    await leave.save();

    const userInfo = {
      ...user,
      company: userCompanyId,
      companyId: userCompanyId
    };

    
    const populatedLeave = await Leave.findById(leave._id)
      .populate('user', 'name email jobRole department')
      .populate('approvalSteps.user', 'name email jobRole companyRole')
      .populate('history.by', 'name email');

    
    try {
      await sendLeaveAppliedEmail(
        userInfo.email,
        userInfo.name,
        leave._id.toString(),
        type,
        startDate,
        endDate,
        days
      );
      void 0;
    } catch (emailError) {
      console.error('❌ Failed to send application email:', emailError.message);
    }

    
    try {
      const approverIds = approvalSteps.map(step => step.user);
      if (approverIds.length > 0) {
        await notifyDirectUsers({
          userIds: approverIds,
          targetPath: '/ciisUser/emp-leaves',
          type: 'leave_applied',
          title: 'New Leave Approval Pending',
          message: `${userInfo.name} applied for ${type} leave`,
          actor: userInfo._id,
          company: userInfo.company || userInfo.companyId,
          data: {
            leaveId: leave._id,
            userId: userInfo._id,
            userName: userInfo.name,
            leaveType: type,
            startDate,
            endDate,
            days,
            reason
          },
          priority: 'high'
        });
      } else {
        await notifyPageUsers({
          companyId: userInfo.company || userInfo.companyId,
          targetPath: '/ciisUser/emp-leaves',
          excludeUserIds: [userInfo._id],
          type: 'leave_applied',
          title: 'New Leave Application',
          message: `${userInfo.name} applied for ${type} leave`,
          actor: userInfo._id,
          data: {
            leaveId: leave._id,
            userId: userInfo._id,
            userName: userInfo.name,
            leaveType: type,
            startDate,
            endDate,
            days,
            reason
          },
          priority: 'high'
        });
      }

      void 0;
    } catch (notifError) {
      console.error('❌ Failed to send notification to owners:', notifError.message);
    }

    
    try {
      if (global.io) {
        emitLeaveEvents.newLeaveApplied(global.io, {
          companyId: userInfo.company || userInfo.companyId,
          leave: populatedLeave.toObject ? populatedLeave.toObject() : populatedLeave
        });
        void 0;
      }
    } catch (socketError) {
      console.error('❌ Failed to emit socket event:', socketError.message);
    }

    res.status(201).json({ 
      success: true,
      message: 'Leave applied successfully.', 
      leave: formatLeaveWithApprovals(populatedLeave),
      userInfo: {
        id: userInfo._id,
        name: userInfo.name,
        email: userInfo.email,
        department: userInfo.department,
        jobRole: userInfo.jobRole,
        employeeId: userInfo.employeeId,
        phone: userInfo.phone
      }
    });

  } catch (err) {
    console.error("❌ Error in applyLeave controller:", err);
    writeLeaveDebugLog('applyLeave-error', {
      message: err.message,
      stack: err.stack,
      body: req.body,
      user: {
        id: req.user?._id,
        email: req.user?.email,
        company: req.user?.company,
        companyCode: req.user?.companyCode,
        jobRole: req.user?.jobRole,
        companyRole: req.user?.companyRole
      }
    });
    res.status(500).json({ 
      success: false,
      message: err.message || 'Server error while applying leave',
      error: 'Server error',
      details: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
};


exports.getUserLeaves = async (req, res) => {
  void 0;

  try {
    const userId = req.user._id;
    
    const leaves = await Leave.find({ user: userId })
      .populate('user', 'name email jobRole department')
      .populate('approvalSteps.user', 'name email jobRole companyRole')
      .populate('history.by', 'name email')
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({
      success: true,
      leaves: leaves.map(formatLeaveWithApprovals),
      total: leaves.length
    });

  } catch (err) {
    console.error("❌ Error in getUserLeaves controller:", err.message);
    res.status(500).json({ 
      success: false,
      error: 'Server error' 
    });
  }
};


exports.getAllLeaves = async (req, res) => {
  try {
    void 0;

    const { 
      date, 
      status, 
      type, 
      department, 
      search, 
      page = 1, 
      limit = 20 
    } = req.query;

    
    const filter = {};
    
    
    const userCompanyId = req.user.company || req.user.companyId;
    if (!userCompanyId) {
      return res.status(400).json({
        success: false,
        error: 'User does not belong to any company'
      });
    }

    void 0;

    
    const companyUsers = await User.find({ 
      $or: [
        { company: userCompanyId },
        { companyId: userCompanyId }
      ]
    }).select('_id');
    
    const companyUserIds = companyUsers.map(user => user._id);
    
    void 0;

    if (companyUserIds.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          leaves: [],
          pagination: {
            total: 0,
            page: 1,
            limit: parseInt(limit),
            pages: 0
          },
          filters: {
            date,
            status,
            type,
            department,
            search
          },
          company: userCompanyId
        }
      });
    }

    
    filter.user = { $in: companyUserIds };

    
    if (date) {
      const selectedDate = new Date(date);
      const startOfDay = new Date(selectedDate.setHours(0, 0, 0, 0));
      const endOfDay = new Date(selectedDate.setHours(23, 59, 59, 999));
      
      filter.$or = [
        {
          startDate: { $lte: endOfDay },
          endDate: { $gte: startOfDay }
        }
      ];
    }

    
    if (status && status !== 'All') {
      filter.status = status;
    }

    
    if (type && type !== 'all') {
      filter.type = type;
    }

    
    if (department) {
      const departmentUsers = await User.find({ 
        _id: { $in: companyUserIds },
        department: department 
      }).select('_id');
      
      const departmentUserIds = departmentUsers.map(user => user._id);
      
      if (departmentUserIds.length > 0) {
        filter.user = { $in: departmentUserIds };
        void 0;
      } else {
        return res.status(200).json({
          success: true,
          data: {
            leaves: [],
            pagination: {
              total: 0,
              page: 1,
              limit: parseInt(limit),
              pages: 0
            },
            filters: {
              date,
              status,
              type,
              department,
              search
            },
            company: userCompanyId
          }
        });
      }
    }

    
    if (search) {
      const userFilter = {
        _id: { $in: companyUserIds },
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } },
          { department: { $regex: search, $options: 'i' } },
          { employeeId: { $regex: search, $options: 'i' } }
        ]
      };

      const users = await User.find(userFilter).select('_id');
      const userIds = users.map(user => user._id);
      
      if (userIds.length > 0) {
        filter.user = { $in: userIds };
        void 0;
      } else {
        filter.$or = [
          { user: { $in: companyUserIds } },
          { reason: { $regex: search, $options: 'i' } }
        ];
      }
    }

    
    const skip = (page - 1) * limit;
    const total = await Leave.countDocuments(filter);

    
    const leaves = await Leave.find(filter)
      .populate({
        path: 'user',
        select: 'name email department phone employeeType jobRole employeeId',
        match: { _id: { $in: companyUserIds } },
        populate: {
          path: 'department',
          select: 'name'
        },
        transform: (doc) => {

          if (!doc) return null;
          return {
            id: doc._id || doc.id,
            _id: doc._id || doc.id,
            name: doc.name,
            email: doc.email,
            department: doc.department?.name || doc.department,
            phone: doc.phone,
            employeeType: doc.employeeType,
            jobRole: doc.jobRole,
            employeeId: doc.employeeId
          };
        }
      })
      .populate({
        path: 'approvedBy',
        select: 'name email',
        match: { _id: { $in: companyUserIds } },
        transform: (doc) => {
          if (!doc) return null;
          return {
            id: doc._id || doc.id,
            name: doc.name,
            email: doc.email
          };
        }
      })
      .populate({
        path: 'approvalSteps.user',
        select: 'name email jobRole companyRole',
        match: { _id: { $in: companyUserIds } },
        transform: (doc) => {
          if (!doc) return null;
          return {
            id: doc._id || doc.id,
            _id: doc._id || doc.id,
            name: doc.name,
            email: doc.email,
            jobRole: doc.jobRole,
            companyRole: doc.companyRole
          };
        }
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    
    const validLeaves = leaves.filter(leave => leave.user !== null && leave.user !== undefined);

    
    const formattedLeaves = validLeaves.map(leave => ({
      _id: leave._id,
      user: leave.user || {
        id: leave.user?._id || leave.user,
        name: 'Unknown User',
        email: 'N/A',
        department: 'N/A'
      },
      type: leave.type,
      reason: leave.reason,
      startDate: leave.startDate,
      endDate: leave.endDate,
      days: leave.days || 0,
      status: leave.status || 'Pending',
      approvals: Leave.normalizeApprovals(leave.approvals),
      remarks: leave.remarks || '',
      approvedBy: leave.approvedBy,
      approvalSteps: leave.approvalSteps || [],
      approvalMode: leave.approvalMode || 'single',
      history: leave.history || [],
      createdAt: leave.createdAt,
      updatedAt: leave.updatedAt,
      company: userCompanyId
    }));

    void 0;

    res.status(200).json({
      success: true,
      data: {
        leaves: formattedLeaves,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / limit)
        },
        filters: {
          date,
          status,
          type,
          department,
          search
        },
        company: userCompanyId,
        companyName: req.user.companyName || 'Your Company',
        userInfo: {
          id: req.user._id,
          name: req.user.name,
          role: req.user.jobRole || req.user.role,
          department: req.user.department
        }
      }
    });

  } catch (error) {
    console.error('❌ Error in getAllLeaves:', error);
    res.status(500).json({
      success: false,
      error: 'Server error while fetching leaves',
      details: error.message
    });
  }
};




exports.updateLeaveApproval = async (req, res) => {
  try {
    const { leaveId } = req.params;
    const { decision, remarks = '' } = req.body;
    const currentUser = req.user;
    const approvalRole = getApprovalRoleForUser(currentUser);

    if (!approvalRole) {
      return res.status(403).json({
        success: false,
        error: 'Only Manager, HR, or Company Owner can approve or reject leave requests.'
      });
    }

    if (!['Approved', 'Rejected'].includes(decision)) {
      return res.status(400).json({
        success: false,
        error: 'Decision must be Approved or Rejected.'
      });
    }

    const leave = await Leave.findById(leaveId).populate('user', 'name email phone company companyId');

    if (!leave) {
      return res.status(404).json({
        success: false,
        error: 'Leave not found'
      });
    }

    const userCompanyId = currentUser.company?._id?.toString?.() || currentUser.company?.toString?.() || currentUser.companyId?.toString?.();
    const leaveCompanyId = leave.user?.company?._id?.toString?.() || leave.user?.company?.toString?.() || leave.user?.companyId?.toString?.();

    if (userCompanyId && leaveCompanyId && userCompanyId !== leaveCompanyId) {
      return res.status(403).json({
        success: false,
        error: 'You can only update leaves from your own company'
      });
    }

    leave.approvals = Leave.normalizeApprovals(leave.approvals);

    const existingDecisions = APPROVAL_ROLES.map((role) => leave.approvals[role]);
    const isLegacyTerminalLeave = ['Approved', 'Rejected'].includes(leave.status) &&
      existingDecisions.every((approval) => approval.status === 'Pending' && !approval.actedAt);

    if (isLegacyTerminalLeave) {
      return res.status(409).json({
        success: false,
        error: `This leave is already ${leave.status} from the previous approval flow. Create a new request or use the existing admin override flow to change it.`
      });
    }

    const roleApproval = leave.approvals[approvalRole];

    if (['Approved', 'Rejected'].includes(roleApproval.status)) {
      return res.status(409).json({
        success: false,
        error: `${approvalRole} approval has already been ${roleApproval.status.toLowerCase()} for this leave.`
      });
    }

    const oldStatus = leave.status || 'Pending';
    const actorName = currentUser.name || currentUser.email || approvalRole;
    const actedAt = new Date();

    leave.approvals[approvalRole] = {
      status: decision,
      approvedBy: decision === 'Approved' ? currentUser._id : null,
      rejectedBy: decision === 'Rejected' ? currentUser._id : null,
      approverName: actorName,
      remarks: remarks || '',
      actedAt
    };
    leave.markModified('approvals');

    leave.status = calculateFinalLeaveStatus(leave.approvals);
    leave.remarks = remarks || leave.remarks || '';
    leave.approvedBy = decision === 'Approved' ? currentUser._id : leave.approvedBy;

    leave.history = leave.history || [];
    leave.history.push({
      action: `${approvalRole}_${decision.toLowerCase()}`,
      by: currentUser._id,
      role: approvalRole,
      remarks: remarks || '',
      at: actedAt
    });

    await leave.save();

    await leave.populate('approvedBy', 'name email');
    await leave.populate('history.by', 'name email');

    const finalStatusChanged = oldStatus !== leave.status;
    const responseLeave = formatLeaveWithApprovals(leave);

    if (finalStatusChanged) {
      const statusMessage = leave.status === 'Approved' ? 'approved' :
                           leave.status === 'Rejected' ? 'rejected' : 'updated';

      try {
        await notifyDirectUsers({
          userIds: [leave.user._id],
          targetPath: '/ciisUser/my-leaves',
          type: 'leave_status_changed',
          title: `Leave ${leave.status}`,
          message: `${actorName} ${statusMessage} your ${leave.type} leave${remarks ? ': ' + remarks : ''}`,
          actor: currentUser._id,
          company: leave.user.company || leave.user.companyId,
          data: {
            leaveId: leave._id,
            userId: leave.user._id,
            oldStatus,
            newStatus: leave.status,
            approvals: responseLeave.approvals,
            leaveType: leave.type,
            startDate: leave.startDate,
            endDate: leave.endDate,
            days: leave.days,
            reason: leave.reason,
            remarks
          },
          priority: 'high'
        });
      } catch (notifError) {
        console.error('Failed to send final leave status notification:', notifError.message);
      }

      try {
        await sendLeaveStatusEmail(
          leave.user.email,
          leave.user.name,
          leave._id.toString(),
          leave.status,
          remarks || '',
          actorName
        );
      } catch (emailError) {
        console.error('Failed to send final leave status email:', emailError.message);
      }

      try {
        if (global.io) {
          emitLeaveEvents.leaveStatusChanged(global.io, {
            leave: responseLeave,
            oldStatus,
            newStatus: leave.status,
            updatedBy: currentUser,
            approvalRole,
            approvalDecision: decision
          });
        }
      } catch (socketError) {
        console.error('Failed to emit final leave status socket event:', socketError.message);
      }
    }

    try {
      if (global.io && emitLeaveEvents.leaveApprovalChanged) {
        emitLeaveEvents.leaveApprovalChanged(global.io, {
          leave: responseLeave,
          approvalRole,
          decision,
          updatedBy: currentUser
        });
      }
    } catch (socketError) {
      console.error('Failed to emit leave approval socket event:', socketError.message);
    }

    return res.status(200).json({
      success: true,
      message: `${approvalRole} ${decision.toLowerCase()} leave successfully`,
      data: {
        leave: responseLeave,
        finalStatusChanged,
        approvalRole,
        approval: responseLeave.approvals[approvalRole]
      }
    });
  } catch (error) {
    console.error('ERROR IN UPDATE LEAVE APPROVAL');
    console.error('Error:', error);
    console.error('Stack:', error.stack);

    return res.status(500).json({
      success: false,
      error: 'Server error while updating leave approval',
      details: error.message
    });
  }
};




exports.updateLeaveStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, remarks } = req.body;
    const currentUser = req.user;
    
    void 0;
    void 0;
    void 0;
    void 0;

    
    const leave = await Leave.findById(id)
      .populate('user', 'name email phone company companyId')
      .populate('approvalSteps.user', 'name email jobRole companyRole');
    
    if (!leave) {
      void 0;
      return res.status(404).json({ 
        success: false, 
        error: 'Leave not found' 
      });
    }

    void 0;

    
    const validStatuses = ['Pending', 'Approved', 'Rejected', 'Cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      });
    }

    
    const oldStatus = leave.status;
    const currentUserId = normalizeId(currentUser._id);
    const isOwner = String(currentUser.companyRole || '').toLowerCase() === 'owner';
    const hasApprovalSteps = Array.isArray(leave.approvalSteps) && leave.approvalSteps.length > 0;
    const approvalStepIndex = hasApprovalSteps
      ? leave.approvalSteps.findIndex(step => normalizeId(step.user) === currentUserId)
      : -1;

    const canUpdateStatus = hasApprovalSteps ? approvalStepIndex !== -1 : isOwner;

    if (!canUpdateStatus) {
      void 0;
      return res.status(403).json({
        success: false,
        error: hasApprovalSteps
          ? 'You are not selected as an approver for this leave.'
          : 'You do not have permission to update leave status. Please configure approvers in Page Management.'
      });
    }

    if (hasApprovalSteps) {
      leave.approvalSteps[approvalStepIndex].status = status === 'Approved' ? 'Approved' : status === 'Rejected' ? 'Rejected' : 'Pending';
      leave.approvalSteps[approvalStepIndex].remarks = remarks || '';
      leave.approvalSteps[approvalStepIndex].actionedAt = new Date();

      const hasRejected = leave.approvalSteps.some(step => step.status === 'Rejected');
      const allApproved = leave.approvalSteps.every(step => step.status === 'Approved');

      if (hasRejected) {
        leave.status = 'Rejected';
        leave.approvedBy = currentUser._id;
      } else if (allApproved) {
        leave.status = 'Approved';
        leave.approvedBy = currentUser._id;
      } else {
        leave.status = 'Pending';
      }
    } else {
      leave.status = status;
      leave.approvedBy = currentUser._id;
    }

    leave.remarks = remarks || leave.remarks;
    leave.updatedAt = new Date();

    
    leave.history = leave.history || [];
    leave.history.push({
      action: hasApprovalSteps && leave.status === 'Pending' ? `${status} by approver` : status,
      from: oldStatus,
      to: leave.status,
      by: currentUser._id,
      byName: currentUser.name || currentUser.email || 'Owner',
      byRole: currentUser.companyRole || currentUser.jobRole || 'Approver',
      remarks: remarks || '',
      at: new Date()
    });

    
    await leave.save();
    
    void 0;

    
    await leave.populate('approvedBy', 'name email');
    await leave.populate('approvalSteps.user', 'name email jobRole companyRole');
    const statusMessage = status === 'Approved' ? 'approved' :
                         status === 'Rejected' ? 'rejected' :
                         status === 'Cancelled' ? 'cancelled' : 'updated';

    
    try {
      await notifyDirectUsers({
        userIds: [leave.user._id],
        targetPath: '/ciisUser/my-leaves',
        type: 'leave_status_changed',
        title: `Leave ${leave.status}`,
        message: hasApprovalSteps && leave.status === 'Pending'
          ? `${currentUser.name || 'Approver'} approved your ${leave.type} leave. Waiting for remaining approvals.`
          : `${currentUser.name || 'Admin'} ${statusMessage} your ${leave.type} leave${remarks ? ': ' + remarks : ''}`,
        actor: currentUser._id,
        company: leave.user.company || leave.user.companyId,
        data: {
          leaveId: leave._id,
          userId: leave.user._id,
          oldStatus,
          newStatus: leave.status,
          requestedStatus: status,
          approvalSteps: leave.approvalSteps,
          leaveType: leave.type,
          startDate: leave.startDate,
          endDate: leave.endDate,
          days: leave.days,
          reason: leave.reason,
          remarks
        },
        priority: 'high'
      });

      void 0;
    } catch (notifError) {
      console.error('❌ Failed to send notification to user:', notifError.message);
    }

    
    try {
      await sendLeaveStatusEmail(
        leave.user.email,
        leave.user.name,
        leave._id.toString(),
        leave.type,
        leave.startDate,
        leave.endDate,
        leave.days,
        leave.status,
        remarks || ''
      );
      void 0;
    } catch (emailError) {
      console.error('❌ Failed to send status email:', emailError.message);
    }

    
    try {
      if (global.io) {
        emitLeaveEvents.leaveStatusChanged(global.io, {
          leave: leave.toObject ? leave.toObject() : leave,
          oldStatus,
          newStatus: leave.status,
          updatedBy: currentUser
        });
        void 0;
      }
    } catch (socketError) {
      console.error('❌ Failed to emit socket event:', socketError.message);
    }

    void 0;

    res.status(200).json({
      success: true,
      message: hasApprovalSteps && leave.status === 'Pending'
        ? 'Your approval has been saved. Leave is waiting for remaining approvals.'
        : `Leave ${leave.status.toLowerCase()} successfully`,
      data: {
        _id: leave._id,
        status: leave.status,
        remarks: leave.remarks,
        approvedBy: leave.approvedBy,
        approvalSteps: leave.approvalSteps,
        history: leave.history.slice(-1)[0]
      }
    });

  } catch (error) {
    console.error('❌❌❌ ERROR IN UPDATE LEAVE STATUS ❌❌❌');
    console.error('Error:', error);
    console.error('Stack:', error.stack);
    
    res.status(500).json({
      success: false,
      error: 'Server error while updating leave status',
      details: error.message
    });
  }
};




exports.deleteLeave = async (req, res) => {
  try {
    const { id } = req.params;
    
    const userId = req.headers['x-user-id'] || req.user?._id;
    const userCompanyRole = req.headers['x-user-company-role'] || req.user?.companyRole || req.user?.role || '';
    const userCompanyId = req.headers['x-user-company-id'];
    
    void 0;
    void 0;
    void 0;
    void 0;
    void 0;

    
    const leave = await Leave.findById(id).populate('user', 'email name phone company companyId');

    if (!leave) {
      return res.status(404).json({
        success: false,
        error: 'Leave not found'
      });
    }

    
    const requestCompanyId = normalizeId(userCompanyId);
    const leaveUserCompanyId = normalizeId(leave.user.company);
    const leaveUserCompanyIdAlt = normalizeId(leave.user.companyId);

    if (requestCompanyId && leaveUserCompanyId !== requestCompanyId && 
        leaveUserCompanyIdAlt !== requestCompanyId) {
      void 0;
      return res.status(403).json({
        success: false,
        error: 'You can only delete leaves from your own company'
      });
    }

    const currentUserId = normalizeId(req.user?._id || userId);
    const leaveCompanyId = leave.user.company || leave.user.companyId || getUserCompanyId(req.user);
    const pagePermission = await PagePermission.findOne({
      company: leaveCompanyId,
      path: '/ciisUser/emp-leaves'
    }).lean();
    const configuredDeleteUserIds = (pagePermission?.deleteUsers || [])
      .map(item => normalizeId(item.user))
      .filter(Boolean);

    const role = normalizeRoleValue(userCompanyRole);
    const jobRole = normalizeRoleValue(req.headers['x-user-job-role'] || req.user?.jobRole);
    const allowedRoles = ['owner', 'admin', 'hr', 'manager'];
    const fallbackAllowed = allowedRoles.includes(role) || jobRole === 'superadmin';
    const isConfiguredDeleteUser = configuredDeleteUserIds.includes(currentUserId);
    const isAllowed = configuredDeleteUserIds.length > 0 ? isConfiguredDeleteUser : fallbackAllowed;

    if (!isAllowed) {
      void 0;
      return res.status(403).json({
        success: false,
        error: configuredDeleteUserIds.length > 0
          ? 'You are not selected as a delete user for employee leaves.'
          : 'You do not have permission to delete leave.'
      });
    }

    
    try {
      await notifyDirectUsers({
        userIds: [leave.user._id],
        targetPath: '/ciisUser/my-leaves',
        type: 'leave_deleted',
        title: 'Leave Deleted',
        message: `Your ${leave.type} leave request from ${new Date(leave.startDate).toLocaleDateString()} to ${new Date(leave.endDate).toLocaleDateString()} has been deleted by ${req.user?.name || 'Owner'}`,
        actor: userId,
        company: leave.user.company || leave.user.companyId,
        data: {
          leaveId: leave._id,
          userId: leave.user._id,
          leaveType: leave.type,
          startDate: leave.startDate,
          endDate: leave.endDate,
          days: leave.days,
          reason: leave.reason,
          deletedBy: {
            id: userId,
            name: req.user?.name || 'Owner'
          }
        },
        priority: 'high'
      });
      
      void 0;
    } catch (notifError) {
      console.error('❌ Failed to send deletion notification:', notifError.message);
    }

    
    try {
      await sendLeaveDeletedEmail(
        leave.user.email,
        leave.user.name,
        leave._id.toString(),
        leave.type,
        leave.startDate,
        leave.endDate,
        leave.reason
      );
      void 0;
    } catch (emailError) {
      console.error('❌ Failed to send deletion email:', emailError);
    }

    
    try {
      if (global.io) {
        emitLeaveEvents.leaveDeleted(global.io, {
          leaveId: leave._id,
          userId: leave.user._id,
          deletedBy: req.user,
          leaveData: {
            type: leave.type,
            startDate: leave.startDate,
            endDate: leave.endDate,
            days: leave.days
          }
        });
        void 0;
      }
    } catch (socketError) {
      console.error('❌ Failed to emit socket event:', socketError.message);
    }

    
    await Leave.findByIdAndDelete(id);

    void 0;
    void 0;

    res.status(200).json({
      success: true,
      message: 'Leave deleted successfully'
    });

  } catch (error) {
    console.error('❌ Error deleting leave:', error);
    res.status(500).json({
      success: false,
      error: 'Server error while deleting leave'
    });
  }
};


exports.getLeavesWithStatus = async (req, res) => {
  void 0;

  try {
    const userId = req.user._id;
    const { status, type, date, year, month } = req.query;
    
    const filter = { user: userId };

    if (status && status !== 'All') {
      filter.status = status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
    }

    if (type && type !== 'all') {
      filter.type = type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
    }

    if (year && month) {
      const startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
      const endDate = new Date(parseInt(year), parseInt(month), 0);
      filter.startDate = { $gte: startDate, $lte: endDate };
    } else if (date) {
      const selectedDate = new Date(date);
      const startOfDay = new Date(selectedDate.setHours(0, 0, 0, 0));
      const endOfDay = new Date(selectedDate.setHours(23, 59, 59, 999));
      filter.startDate = { $gte: startOfDay, $lte: endOfDay };
    }

    const leaves = await Leave.find(filter)
      .populate('user', 'name email jobRole department')
      .populate('approvalSteps.user', 'name email jobRole companyRole')
      .populate('history.by', 'name email')
      .sort({ startDate: -1 })
      .lean();

    res.status(200).json({
      success: true,
      leaves: leaves.map(formatLeaveWithApprovals),
      total: leaves.length
    });

  } catch (err) {
    console.error("❌ Error in getLeavesWithStatus controller:", err.message);
    res.status(500).json({ 
      success: false,
      error: 'Server error' 
    });
  }
};


exports.syncLeaves = async (req, res) => {
  void 0;

  try {
    const { localLeaves = [], lastSync } = req.body;
    const userId = req.user._id;

    const result = {
      synced: [],
      conflicts: [],
      serverLeaves: []
    };

    
    const filter = { user: userId };
    if (lastSync) {
      filter.updatedAt = { $gte: new Date(lastSync) };
    }

    const serverLeaves = await Leave.find(filter)
      .populate('user', 'name email')
      .lean();

    result.serverLeaves = serverLeaves.map(formatLeaveWithApprovals);

    
    for (const localLeave of localLeaves) {
      try {
        if (localLeave._id && localLeave._id.startsWith('local_')) {
          
          const newLeave = new Leave({
            user: userId,
            type: localLeave.type,
            reason: localLeave.reason,
            startDate: localLeave.startDate,
            endDate: localLeave.endDate,
            days: localLeave.days,
            status: 'Pending',
            approvals: Leave.defaultApprovals(),
            history: [{
              action: 'applied',
              by: userId,
              role: req.user.jobRole || 'user',
              remarks: 'Applied offline',
              at: new Date()
            }],
            syncStatus: 'synced',
            deviceId: localLeave.deviceId
          });

          await newLeave.save();
          result.synced.push({
            localId: localLeave._id,
            serverId: newLeave._id,
            action: 'created'
          });
        } else if (localLeave._id) {
          
          const existingLeave = await Leave.findById(localLeave._id);
          
          if (existingLeave) {
            if (existingLeave.updatedAt > new Date(localLeave.updatedAt)) {
              result.conflicts.push({
                localId: localLeave._id,
                serverVersion: existingLeave,
                localVersion: localLeave,
                action: 'update'
              });
            } else {
              existingLeave.type = localLeave.type || existingLeave.type;
              existingLeave.reason = localLeave.reason || existingLeave.reason;
              existingLeave.startDate = localLeave.startDate || existingLeave.startDate;
              existingLeave.endDate = localLeave.endDate || existingLeave.endDate;
              existingLeave.days = localLeave.days || existingLeave.days;
              existingLeave.status = localLeave.status || existingLeave.status;
              existingLeave.syncStatus = 'synced';
              
              await existingLeave.save();
              result.synced.push({
                localId: localLeave._id,
                serverId: existingLeave._id,
                action: 'updated'
              });
            }
          }
        }
      } catch (syncError) {
        console.error(`Error syncing leave ${localLeave._id}:`, syncError);
      }
    }

    res.status(200).json({
      success: true,
      message: 'Leaves synchronized successfully',
      data: result,
      lastSynced: new Date()
    });

  } catch (err) {
    console.error("❌ Error in syncLeaves controller:", err.message);
    res.status(500).json({ 
      success: false,
      error: 'Server error during synchronization' 
    });
  }
};


exports.getLeaveStats = async (req, res) => {
  void 0;

  try {
    const userId = req.user._id;
    const userRole = req.user.jobRole?.toLowerCase();
    
    let stats = {};

    if (['admin', 'hr', 'manager'].includes(userRole)) {
      
      let filter = {};
      
      if (userRole === 'manager' && req.user.department) {
        const departmentUsers = await User.find({ 
          department: req.user.department 
        }, '_id');
        
        const userIds = departmentUsers.map(user => user._id);
        filter.user = { $in: userIds };
      }

      const allStats = await Leave.aggregate([
        { $match: filter },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            totalDays: { $sum: '$days' }
          }
        }
      ]);

      stats = {
        total: 0,
        approved: 0,
        pending: 0,
        rejected: 0,
        cancelled: 0,
        totalDays: 0
      };

      allStats.forEach(stat => {
        if (stat._id) {
          stats[stat._id.toLowerCase()] = stat.count;
          stats.total += stat.count;
          stats.totalDays += stat.totalDays || 0;
        }
      });

    } else {
      
      const userStats = await Leave.aggregate([
        { $match: { user: userId } },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            totalDays: { $sum: '$days' }
          }
        }
      ]);

      stats = {
        total: 0,
        approved: 0,
        pending: 0,
        rejected: 0,
        cancelled: 0,
        totalDays: 0
      };

      userStats.forEach(stat => {
        if (stat._id) {
          stats[stat._id.toLowerCase()] = stat.count;
          stats.total += stat.count;
          stats.totalDays += stat.totalDays || 0;
        }
      });
    }

    res.status(200).json({
      success: true,
      stats
    });

  } catch (err) {
    console.error("❌ Error in getLeaveStats controller:", err.message);
    res.status(500).json({ 
      success: false,
      error: 'Server error' 
    });
  }
};


exports.getLeavesByDepartment = async (req, res) => {
  try {
    const { department } = req.params;
    const { status, type, date } = req.query;
    const userCompanyId = req.user.company || req.user.companyId;

    
    const departmentUsers = await User.find({ 
      company: userCompanyId,
      department: department 
    }).select('_id');
    
    const userIds = departmentUsers.map(user => user._id);

    if (userIds.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          leaves: [],
          department,
          company: userCompanyId,
          total: 0
        }
      });
    }

    const filter = { user: { $in: userIds } };

    
    if (date) {
      const selectedDate = new Date(date);
      const startOfDay = new Date(selectedDate.setHours(0, 0, 0, 0));
      const endOfDay = new Date(selectedDate.setHours(23, 59, 59, 999));
      
      filter.$or = [
        {
          startDate: { $lte: endOfDay },
          endDate: { $gte: startOfDay }
        }
      ];
    }

    
    if (status && status !== 'All') {
      filter.status = status;
    }

    
    if (type && type !== 'all') {
      filter.type = type;
    }

    const leaves = await Leave.find(filter)
      .populate({
        path: 'user',
        select: 'name email department phone',
        match: { _id: { $in: userIds } }
      })
      .populate('approvedBy', 'name email')
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({
      success: true,
      data: {
        leaves,
        department,
        company: userCompanyId,
        total: leaves.length
      }
    });

  } catch (error) {
    console.error('Department leaves error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Server error while fetching department leaves' 
    });
  }
};


exports.getCalendarView = async (req, res) => {
  try {
    const userId = req.user._id;
    const userCompanyId = req.user.company || req.user.companyId;
    const { month, year } = req.query;
    
    const currentDate = new Date();
    const targetMonth = month ? parseInt(month) : currentDate.getMonth() + 1;
    const targetYear = year ? parseInt(year) : currentDate.getFullYear();
    
    
    const startDate = new Date(targetYear, targetMonth - 1, 1);
    const endDate = new Date(targetYear, targetMonth, 0);
    
    
    const companyUsers = await User.find({ company: userCompanyId }).select('_id');
    const companyUserIds = companyUsers.map(user => user._id);
    
    const leaves = await Leave.find({
      user: { $in: companyUserIds },
      $or: [
        {
          startDate: { $lte: endDate },
          endDate: { $gte: startDate }
        }
      ]
    })
    .populate('user', 'name email')
    .sort({ startDate: 1 })
    .lean();
    
    
    const calendarData = leaves.map(leave => ({
      id: leave._id,
      title: `${leave.user?.name || 'User'} - ${leave.type} Leave`,
      start: new Date(leave.startDate).toISOString().split('T')[0],
      end: new Date(new Date(leave.endDate).getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      status: leave.status,
      color: leave.status === 'Approved' ? '#10b981' : 
             leave.status === 'Pending' ? '#f59e0b' : 
             leave.status === 'Rejected' ? '#ef4444' : '#6b7280',
      extendedProps: {
        userId: leave.user?._id,
        userName: leave.user?.name,
        type: leave.type,
        days: leave.days,
        reason: leave.reason
      }
    }));
    
    res.status(200).json({
      success: true,
      data: {
        calendarData,
        month: targetMonth,
        year: targetYear,
        total: leaves.length,
        company: userCompanyId
      }
    });
    
  } catch (error) {
    console.error('Calendar view error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Server error while fetching calendar data' 
    });
  }
};


exports.getDepartmentStats = async (req, res) => {
  try {
    const { department } = req.params;
    const year = req.query.year || new Date().getFullYear();
    const userCompanyId = req.user.company || req.user.companyId;
    
    void 0;
    
    
    const departmentUsers = await User.find({ 
      company: userCompanyId,
      department: department 
    }, '_id');
    
    const userIds = departmentUsers.map(user => user._id);
    
    if (userIds.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          department,
          year,
          company: userCompanyId,
          stats: {
            total: 0,
            approved: 0,
            pending: 0,
            rejected: 0,
            cancelled: 0,
            totalDays: 0,
            avgProcessingTime: 0
          },
          monthlyStats: Array.from({ length: 12 }, (_, i) => ({
            month: i + 1,
            total: 0,
            approved: 0,
            pending: 0,
            rejected: 0,
            cancelled: 0
          })),
          typeStats: {},
          employeeCount: 0
        }
      });
    }
    
    
    const startOfYear = new Date(year, 0, 1);
    const endOfYear = new Date(year, 11, 31);
    
    const leaves = await Leave.find({
      user: { $in: userIds },
      startDate: { $gte: startOfYear, $lte: endOfYear }
    })
    .populate('user', 'name department')
    .lean();
    
    
    const monthlyStats = Array.from({ length: 12 }, (_, i) => {
      const monthLeaves = leaves.filter(leave => 
        new Date(leave.startDate).getMonth() === i
      );
      return {
        month: i + 1,
        total: monthLeaves.length,
        approved: monthLeaves.filter(l => l.status === 'Approved').length,
        pending: monthLeaves.filter(l => l.status === 'Pending').length,
        rejected: monthLeaves.filter(l => l.status === 'Rejected').length,
        cancelled: monthLeaves.filter(l => l.status === 'Cancelled').length
      };
    });
    
    
    const typeStats = {};
    leaves.forEach(leave => {
      if (!typeStats[leave.type]) {
        typeStats[leave.type] = 0;
      }
      typeStats[leave.type]++;
    });
    
    
    const stats = {
      total: leaves.length,
      approved: leaves.filter(l => l.status === 'Approved').length,
      pending: leaves.filter(l => l.status === 'Pending').length,
      rejected: leaves.filter(l => l.status === 'Rejected').length,
      cancelled: leaves.filter(l => l.status === 'Cancelled').length,
      totalDays: leaves.reduce((sum, leave) => sum + (leave.days || 0), 0),
      avgProcessingTime: 2.5
    };
    
    res.status(200).json({
      success: true,
      data: {
        department,
        year,
        company: userCompanyId,
        stats,
        monthlyStats,
        typeStats,
        employeeCount: userIds.length
      }
    });
    
  } catch (error) {
    console.error('Department stats error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Server error while fetching department statistics' 
    });
  }
};


exports.getAnalytics = async (req, res) => {
  try {
    const { period = 'monthly', startDate, endDate } = req.query;
    const userCompanyId = req.user.company || req.user.companyId;
    
    let dateFilter = {};
    if (startDate && endDate) {
      dateFilter.startDate = { 
        $gte: new Date(startDate), 
        $lte: new Date(endDate) 
      };
    } else {
      
      const now = new Date();
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      dateFilter.startDate = { $gte: firstDay, $lte: lastDay };
    }
    
    
    const companyUsers = await User.find({ company: userCompanyId }).select('_id');
    const userIds = companyUsers.map(user => user._id);
    
    if (userIds.length > 0) {
      dateFilter.user = { $in: userIds };
    }
    
    
    const leaves = await Leave.find(dateFilter)
      .populate('user', 'name department')
      .lean();
    
    
    const analytics = {
      period,
      company: userCompanyId,
      totalLeaves: leaves.length,
      approvalRate: leaves.length > 0 ? 
        (leaves.filter(l => l.status === 'Approved').length / leaves.length * 100).toFixed(1) : 0,
      avgProcessingTime: 2.5,
      peakMonth: 'January',
      mostCommonType: 'Casual',
      departmentBreakdown: {},
      trendData: []
    };
    
    
    leaves.forEach(leave => {
      const dept = leave.user?.department || 'Unknown';
      if (!analytics.departmentBreakdown[dept]) {
        analytics.departmentBreakdown[dept] = 0;
      }
      analytics.departmentBreakdown[dept]++;
    });
    
    res.status(200).json({
      success: true,
      data: analytics
    });
    
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Server error while fetching analytics' 
    });
  }
};


exports.getLeaveBalance = async (req, res) => {
  try {
    const userId = req.user._id;
    const currentYear = new Date().getFullYear();
    
    
    const startOfYear = new Date(currentYear, 0, 1);
    const endOfYear = new Date(currentYear, 11, 31);
    
    const leaves = await Leave.find({
      user: userId,
      startDate: { $gte: startOfYear, $lte: endOfYear }
    }).lean();
    
    
    const leavePolicies = {
      Casual: { maxDays: 12, description: 'For personal work' },
      Sick: { maxDays: 10, description: 'For health issues' },
      Paid: { maxDays: 20, description: 'Earned leave with pay' },
      Unpaid: { maxDays: 30, description: 'Leave without pay' },
      Halfday: { maxDays: 1, description: 'Half day leave' },
      Other: { maxDays: 5, description: 'Other leave types' }
    };
    
    
    const usedLeaves = {};
    leaves.forEach(leave => {
      if (leave.status === 'Approved') {
        if (!usedLeaves[leave.type]) {
          usedLeaves[leave.type] = 0;
        }
        usedLeaves[leave.type] += leave.days || 0;
      }
    });
    
    
    const balance = {};
    Object.keys(leavePolicies).forEach(type => {
      const policy = leavePolicies[type];
      const used = usedLeaves[type] || 0;
      balance[type] = {
        allocated: policy.maxDays,
        used: used,
        remaining: Math.max(0, policy.maxDays - used),
        description: policy.description
      };
    });
    
    
    const totalAllocated = Object.values(balance).reduce((sum, b) => sum + b.allocated, 0);
    const totalUsed = Object.values(balance).reduce((sum, b) => sum + b.used, 0);
    const totalRemaining = Object.values(balance).reduce((sum, b) => sum + b.remaining, 0);
    
    res.status(200).json({
      success: true,
      data: {
        year: currentYear,
        balance,
        summary: {
          totalAllocated,
          totalUsed,
          totalRemaining,
          utilizationRate: totalAllocated > 0 ? (totalUsed / totalAllocated * 100).toFixed(1) : 0
        }
      }
    });
    
  } catch (error) {
    console.error('Leave balance error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Server error while fetching leave balance' 
    });
  }
};


exports.exportLeaves = async (req, res) => {
  try {
    const { format = 'csv', startDate, endDate, department } = req.query;
    const userCompanyId = req.user.company || req.user.companyId;
    
    let filter = {};
    
    
    const companyUsers = await User.find({ company: userCompanyId }).select('_id');
    const userIds = companyUsers.map(user => user._id);
    
    filter.user = { $in: userIds };
    
    
    if (startDate && endDate) {
      filter.startDate = { 
        $gte: new Date(startDate), 
        $lte: new Date(endDate) 
      };
    }
    
    
    if (department) {
      const departmentUsers = await User.find({ 
        company: userCompanyId,
        department: department 
      }).select('_id');
      
      const departmentUserIds = departmentUsers.map(user => user._id);
      filter.user = { $in: departmentUserIds };
    }
    
    const leaves = await Leave.find(filter)
      .populate({
        path: 'user',
        select: 'name email department jobRole',
        transform: (doc) => {
          if (!doc) return null;
          return {
            id: doc._id || doc.id,
            name: doc.name,
            email: doc.email,
            department: doc.department,
            jobRole: doc.jobRole
          };
        }
      })
      .sort({ startDate: -1 })
      .lean();
    
    
    const exportData = leaves.map(leave => ({
      'Leave ID': leave._id,
      'Employee Name': leave.user?.name || 'N/A',
      'Employee Email': leave.user?.email || 'N/A',
      'Department': leave.user?.department || 'N/A',
      'Leave Type': leave.type,
      'Start Date': new Date(leave.startDate).toLocaleDateString(),
      'End Date': new Date(leave.endDate).toLocaleDateString(),
      'Days': leave.days,
      'Reason': leave.reason,
      'Status': leave.status,
      'Applied On': new Date(leave.createdAt).toLocaleDateString(),
      'Approved By': leave.approvedBy || 'N/A',
      'Remarks': leave.remarks || 'N/A'
    }));
    
    
    let exportContent, contentType, filename;
    
    if (format === 'csv') {
      
      const headers = Object.keys(exportData[0] || {}).join(',');
      const rows = exportData.map(row => 
        Object.values(row).map(value => 
          `"${String(value).replace(/"/g, '""')}"`
        ).join(',')
      );
      exportContent = [headers, ...rows].join('\n');
      contentType = 'text/csv';
      filename = `leaves_export_${new Date().toISOString().split('T')[0]}.csv`;
    } else {
      
      exportContent = JSON.stringify(exportData, null, 2);
      contentType = 'application/json';
      filename = `leaves_export_${new Date().toISOString().split('T')[0]}.json`;
    }
    
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    
    res.status(200).send(exportContent);
    
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Server error while exporting data' 
    });
  }
};

void 0;
