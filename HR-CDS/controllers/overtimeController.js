const mongoose = require('mongoose');
const OvertimeRequest = require('../models/OvertimeRequest');
const Attendance = require('../models/Attendance');
const User = require('../../models/User');
const { notifyPageUsers, notifyDirectUsers, getCompanyId } = require('../utils/systemNotificationService');

const INDIA_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const getIndiaDateKey = (dateInput) => {
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return '';
  const shifted = new Date(d.getTime() + INDIA_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const getMonthDateKeys = (yearMonthStr) => {
  const [yStr, mStr] = String(yearMonthStr || '').split('-');
  const year = parseInt(yStr, 10);
  const month = parseInt(mStr, 10);
  if (!year || !month) return [];
  const daysInMonth = new Date(year, month, 0).getDate();
  const keys = [];
  for (let day = 1; day <= daysInMonth; day++) {
    keys.push(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  }
  return keys;
};

const formatDuration = (ms) => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

/**
 * Check whether a user has an approved overtime request for a specific date
 */
const isOvertimeApprovedForUserDate = async (userId, date = new Date()) => {
  try {
    const dateKey = getIndiaDateKey(date);
    const monthKey = dateKey.slice(0, 7); // 'YYYY-MM'

    const approvedRequest = await OvertimeRequest.findOne({
      user: userId,
      status: 'Approved',
      $or: [
        { dateKeys: dateKey },
        { month: monthKey, requestType: 'FULL_MONTH' }
      ]
    }).lean();

    return Boolean(approvedRequest);
  } catch (error) {
    console.error('Error checking approved overtime:', error.message);
    return false;
  }
};

/**
 * POST /api/overtime/request
 * Employee submits an overtime request
 */
const createOvertimeRequest = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const companyCode = req.user.companyCode || (req.user.company ? req.user.company.companyCode : null);
    const company = req.user.company?._id || req.user.company;

    if (!companyCode) {
      return res.status(400).json({ success: false, message: 'User company code not found.' });
    }

    const { requestType = 'SINGLE_DAY', dates = [], month = '', reason = '' } = req.body;

    let computedDateKeys = [];
    let computedDates = [];
    let computedMonth = month;

    if (requestType === 'SINGLE_DAY') {
      const rawDate = dates[0] || req.body.date;
      if (!rawDate) {
        return res.status(400).json({ success: false, message: 'Date is required for single-day overtime request.' });
      }
      const key = getIndiaDateKey(rawDate);
      if (!key) {
        return res.status(400).json({ success: false, message: 'Invalid date provided.' });
      }
      computedDateKeys = [key];
      computedDates = [new Date(rawDate)];
      computedMonth = key.slice(0, 7);
    } else if (requestType === 'MULTIPLE_DAYS') {
      if (!Array.isArray(dates) || dates.length === 0) {
        return res.status(400).json({ success: false, message: 'At least one date is required for multiple-days request.' });
      }
      computedDateKeys = [...new Set(dates.map(d => getIndiaDateKey(d)).filter(Boolean))];
      computedDates = computedDateKeys.map(k => new Date(k));
      computedMonth = computedDateKeys[0]?.slice(0, 7) || '';
    } else if (requestType === 'FULL_MONTH') {
      if (!month || !/^\d{4}-\d{2}$/.test(month.trim())) {
        return res.status(400).json({ success: false, message: 'Valid month (YYYY-MM) is required for full-month request.' });
      }
      computedMonth = month.trim();
      computedDateKeys = getMonthDateKeys(computedMonth);
      computedDates = computedDateKeys.map(k => new Date(k));
    } else {
      return res.status(400).json({ success: false, message: 'Invalid request type.' });
    }

    // Check if an approved or pending request already exists for these dates
    const existingConflict = await OvertimeRequest.findOne({
      user: userId,
      status: { $in: ['Pending', 'Approved'] },
      $or: [
        { dateKeys: { $in: computedDateKeys } },
        { month: computedMonth, requestType: 'FULL_MONTH' }
      ]
    }).lean();

    if (existingConflict) {
      return res.status(400).json({
        success: false,
        message: `An overtime request for one or more selected dates already exists in ${existingConflict.status} status.`
      });
    }

    const overtimeRequest = new OvertimeRequest({
      user: userId,
      company,
      companyCode,
      requestType,
      dates: computedDates,
      dateKeys: computedDateKeys,
      month: computedMonth,
      reason: String(reason || '').trim(),
      status: 'Pending'
    });

    await overtimeRequest.save();

    // Send notification to Admin/HR
    try {
      const companyId = getCompanyId(req.user);
      if (companyId) {
        await notifyPageUsers({
          companyId,
          targetPath: '/ciisUser/emp-attendance',
          targetScreen: 'Employee Attendance',
          excludeUserIds: [userId],
          type: 'overtime_request',
          title: 'New Overtime Request',
          message: `${req.user.name || 'An employee'} submitted an overtime request for ${requestType.replace('_', ' ').toLowerCase()}`,
          actor: userId,
          data: {
            requestId: overtimeRequest._id,
            userId,
            userName: req.user.name,
            requestType,
            dates: computedDateKeys
          },
          priority: 'medium'
        });
      }
    } catch (notifErr) {
      console.error('Failed to notify admin of overtime request:', notifErr.message);
    }

    return res.status(201).json({
      success: true,
      message: 'Overtime request submitted successfully. Awaiting admin approval.',
      data: overtimeRequest
    });
  } catch (error) {
    console.error('Create Overtime Request Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to submit overtime request.', error: error.message });
  }
};

/**
 * GET /api/overtime/my-requests
 * Employee views their own overtime requests
 */
const getMyOvertimeRequests = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const { status, month } = req.query;

    const filter = { user: userId };
    if (status && ['Pending', 'Approved', 'Rejected'].includes(status)) {
      filter.status = status;
    }
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      filter.month = month;
    }

    const requests = await OvertimeRequest.find(filter)
      .populate('approvedBy', 'name email')
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      data: requests
    });
  } catch (error) {
    console.error('Get My Overtime Requests Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch overtime requests.', error: error.message });
  }
};

/**
 * GET /api/overtime/admin-requests
 * Admin views employee overtime requests
 */
const getAdminOvertimeRequests = async (req, res) => {
  try {
    const companyCode = req.user.companyCode || (req.user.company ? req.user.company.companyCode : null);
    if (!companyCode) {
      return res.status(400).json({ success: false, message: 'Company code not found.' });
    }

    const { status, month, search } = req.query;
    const filter = { companyCode };

    if (status && status !== 'ALL' && ['Pending', 'Approved', 'Rejected'].includes(status)) {
      filter.status = status;
    }
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      filter.month = month;
    }

    let query = OvertimeRequest.find(filter)
      .populate({
        path: 'user',
        select: 'name email employeeId employeeType department jobRole profileImage',
        populate: [
          { path: 'department', select: 'name' },
          { path: 'jobRole', select: 'name' }
        ]
      })
      .populate('approvedBy', 'name email')
      .sort({ createdAt: -1 });

    const requests = await query.lean();

    let filtered = requests;
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      filtered = requests.filter(r => 
        r.user?.name?.toLowerCase().includes(q) ||
        r.user?.email?.toLowerCase().includes(q) ||
        r.user?.employeeId?.toLowerCase().includes(q)
      );
    }

    return res.status(200).json({
      success: true,
      data: filtered,
      count: filtered.length
    });
  } catch (error) {
    console.error('Get Admin Overtime Requests Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch overtime requests.', error: error.message });
  }
};

/**
 * PUT /api/overtime/admin-action/:id
 * Admin approves or rejects an overtime request
 */
const reviewOvertimeRequest = async (req, res) => {
  try {
    const adminId = req.user._id || req.user.id;
    const companyCode = req.user.companyCode || (req.user.company ? req.user.company.companyCode : null);
    const { id } = req.params;
    const { action, rejectionReason = '' } = req.body;

    if (!['Approve', 'Reject'].includes(action)) {
      return res.status(400).json({ success: false, message: "Action must be either 'Approve' or 'Reject'." });
    }

    const request = await OvertimeRequest.findOne({ _id: id, companyCode });
    if (!request) {
      return res.status(404).json({ success: false, message: 'Overtime request not found.' });
    }

    const newStatus = action === 'Approve' ? 'Approved' : 'Rejected';
    request.status = newStatus;
    request.approvedBy = adminId;
    request.approvedAt = new Date();
    if (action === 'Reject') {
      request.rejectionReason = String(rejectionReason || '').trim();
    }

    await request.save();

    // If approved, update attendance records for this user across requested dates
    if (newStatus === 'Approved') {
      try {
        const dateKeyQueries = (request.dateKeys || []).map(k => {
          const start = new Date(`${k}T00:00:00.000+05:30`);
          const end = new Date(`${k}T23:59:59.999+05:30`);
          return { date: { $gte: start, $lte: end } };
        });

        const orFilters = [...dateKeyQueries];
        if (request.requestType === 'FULL_MONTH' && request.month) {
          const mStart = new Date(`${request.month}-01T00:00:00.000+05:30`);
          const [y, m] = request.month.split('-').map(Number);
          const nextM = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
          const mEnd = new Date(`${nextM}-01T00:00:00.000+05:30`);
          orFilters.push({ date: { $gte: mStart, $lt: mEnd } });
        }

        if (orFilters.length > 0) {
          const matchingRecords = await Attendance.find({
            user: request.user,
            $or: orFilters
          });

          for (const att of matchingRecords) {
            att.hasOvertimeApproved = true;
            att.overtimeRequestId = request._id;
            // If already clocked out manually and worked past shift end, recalculate overtime
            if (att.outTime && att.shiftEnd && att.clockOutMode !== 'AUTO') {
              const outD = new Date(att.outTime);
              const shiftEndD = new Date(att.shiftEnd);
              if (outD > shiftEndD) {
                const otMs = Math.max(0, outD - shiftEndD);
                att.overTime = formatDuration(otMs);
                att.overTimeMinutes = Math.floor(otMs / (60 * 1000));
              }
            } else if (att.clockOutMode === 'AUTO') {
              att.overTime = '00:00:00';
              att.overTimeMinutes = 0;
            }
            await att.save();
          }
        }
      } catch (attSyncErr) {
        console.error('Error syncing approved overtime to attendance:', attSyncErr.message);
      }
    } else if (newStatus === 'Rejected') {
      try {
        await Attendance.updateMany(
          { overtimeRequestId: request._id },
          {
            $set: {
              hasOvertimeApproved: false,
              overTime: '00:00:00',
              overTimeMinutes: 0,
              overtimeRequestId: null
            }
          }
        );
      } catch (attSyncErr) {
        console.error('Error resetting rejected overtime on attendance:', attSyncErr.message);
      }
    }

    // Notify employee of approval/rejection
    try {
      await notifyDirectUsers({
        userIds: [request.user],
        targetPath: '/ciisUser/attendance',
        type: 'overtime_status_update',
        title: `Overtime Request ${newStatus}`,
        message: `Your overtime request for ${request.requestType.replace('_', ' ').toLowerCase()} has been ${newStatus.toLowerCase()} by admin.`,
        actor: adminId,
        data: {
          requestId: request._id,
          status: newStatus,
          rejectionReason: request.rejectionReason
        },
        priority: 'high'
      });
    } catch (notifErr) {
      console.error('Failed to notify employee of overtime status:', notifErr.message);
    }

    const updated = await OvertimeRequest.findById(id)
      .populate('user', 'name email employeeId')
      .populate('approvedBy', 'name email');

    return res.status(200).json({
      success: true,
      message: `Overtime request ${newStatus.toLowerCase()} successfully.`,
      data: updated
    });
  } catch (error) {
    console.error('Review Overtime Request Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to review overtime request.', error: error.message });
  }
};

/**
 * DELETE /api/overtime/request/:id
 * Employee cancels their own pending overtime request
 */
const deleteOvertimeRequest = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const { id } = req.params;

    const request = await OvertimeRequest.findOne({ _id: id, user: userId });
    if (!request) {
      return res.status(404).json({ success: false, message: 'Overtime request not found.' });
    }

    if (request.status !== 'Pending') {
      return res.status(400).json({ success: false, message: 'Only Pending requests can be cancelled.' });
    }

    await OvertimeRequest.deleteOne({ _id: id });
    return res.status(200).json({ success: true, message: 'Overtime request cancelled successfully.' });
  } catch (error) {
    console.error('Delete Overtime Request Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to cancel overtime request.', error: error.message });
  }
};

module.exports = {
  createOvertimeRequest,
  getMyOvertimeRequests,
  getAdminOvertimeRequests,
  reviewOvertimeRequest,
  deleteOvertimeRequest,
  isOvertimeApprovedForUserDate,
  getIndiaDateKey
};

