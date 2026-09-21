const mongoose = require('mongoose');
const OvertimeRequest = require('../models/OvertimeRequest');
const Attendance = require('../models/Attendance');
const User = require('../../models/User');
const EmployeeSalary = require('../../models/EmployeeSalary');
const { notifyPageUsers, notifyDirectUsers, getCompanyId } = require('../utils/systemNotificationService');
const { resolveShiftScheduleForUser } = require('../utils/shiftSchedule');

const INDIA_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const format12Hour = (timeStr) => {
  if (!timeStr) return '';
  if (/\b(AM|PM|am|pm)\b/.test(timeStr)) return timeStr;
  const [hStr, mStr] = String(timeStr).split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr || '0', 10);
  if (isNaN(h)) return timeStr;
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${period}`;
};

const isPrivilegedOtManager = async (user) => {
  if (!user) return false;
  if (user.isSuperAdmin === true || user.superAdmin === true || user.isCompanyOwner === true) return true;
  const roles = [user.companyRole, user.jobRole, user.jobRoleName, user.role, user.userType]
    .filter(Boolean)
    .map(r => String(r).trim().toLowerCase().replace(/[\s_-]+/g, "_"));
  const matched = roles.some(r => [
    'super_admin', 'superadmin',
    'owner', 'company_owner', 'companyowner',
    'admin', 'company_admin', 'companyadmin',
    'hr', 'hr_manager', 'manager'
  ].includes(r));
  if (matched) return true;

  try {
    const PagePermission = require('../../models/PagePermission');
    const company = user?.company?._id || user?.company || user?.companyCode;
    const userId = String(user?._id || user?.id || '');
    if (company && userId) {
      const page = await PagePermission.findOne({
        $or: [{ company }, { companyCode: company }],
        path: '/ciisUser/emp-attendance'
      }).lean();
      if (page) {
        const allowedIds = new Set([
          ...(page.viewUsers || []).map(u => String(u?.user?._id || u?.user || '')),
          ...(page.editUsers || []).map(u => String(u?.user?._id || u?.user || '')),
          ...(page.approvers || []).map(u => String(u?.user?._id || u?.user || ''))
        ]);
        if (allowedIds.has(userId)) return true;
      }
    }
  } catch (_) {}

  return false;
};

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

    const { 
      requestType = 'SINGLE_DAY', 
      dates = [], 
      month = '', 
      reason = '',
      calculationType = 'BY_HOURS',
      requestedHours = 0
    } = req.body;

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

    // Retrieve active salary assignment to compute calculated overtime amount
    let calculatedAmount = 0;
    try {
      const salaryDoc = await EmployeeSalary.findOne({ user: userId, status: 'active' }).lean();
      const monthlyGross = Number(salaryDoc?.monthlyGross || 0);
      const dailyWage = monthlyGross > 0 ? (monthlyGross / 30) : 0;
      const hourlyWage = dailyWage > 0 ? (dailyWage / 9) : 0;
      const totalDaysCount = computedDates.length;

      if (calculationType === 'FULL_DAY_PRESENT') {
        calculatedAmount = Math.round(dailyWage * totalDaysCount * 100) / 100;
      } else {
        calculatedAmount = Math.round(hourlyWage * Number(requestedHours || 0) * totalDaysCount * 100) / 100;
      }
    } catch (salErr) {
      console.error('Error fetching employee salary for overtime calculation:', salErr);
    }

    const overtimeRequest = new OvertimeRequest({
      user: userId,
      company,
      companyCode,
      requestType,
      dates: computedDates,
      dateKeys: computedDateKeys,
      month: computedMonth,
      calculationType: calculationType === 'FULL_DAY_PRESENT' ? 'FULL_DAY_PRESENT' : 'BY_HOURS',
      requestedHours: calculationType === 'FULL_DAY_PRESENT' ? 0 : Number(requestedHours || 0),
      calculatedAmount,
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

    const salaryDoc = await EmployeeSalary.findOne({ user: userId, status: 'active' }).lean();
    const monthlyGross = Number(salaryDoc?.monthlyGross || 0);
    const dailyWage = monthlyGross > 0 ? (monthlyGross / 30) : 0;
    const hourlyWage = dailyWage > 0 ? (dailyWage / 9) : 0;

    const enriched = requests.map(r => {
      const daysCount = (r.dateKeys || []).length || 1;
      let calcAmt = Number(r.calculatedAmount || 0);
      if (!calcAmt && monthlyGross > 0) {
        if (r.calculationType === 'FULL_DAY_PRESENT') {
          calcAmt = Math.round(dailyWage * daysCount * 100) / 100;
        } else if (Number(r.requestedHours || 0) > 0) {
          calcAmt = Math.round(hourlyWage * Number(r.requestedHours) * daysCount * 100) / 100;
        }
      }

      return {
        ...r,
        calculationType: r.calculationType || 'BY_HOURS',
        requestedHours: r.requestedHours || 0,
        calculatedAmount: calcAmt,
        isFullDayApproved: Boolean(r.isFullDayApproved),
        monthlySalary: monthlyGross,
        dailyWage: Math.round(dailyWage * 100) / 100,
        hourlyWage: Math.round(hourlyWage * 100) / 100
      };
    });

    return res.status(200).json({
      success: true,
      data: enriched,
      salaryInfo: {
        monthlyGross,
        dailyWage: Math.round(dailyWage * 100) / 100,
        hourlyWage: Math.round(hourlyWage * 100) / 100
      }
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
    const isAuthorized = await isPrivilegedOtManager(req.user);
    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only authorized Admin or HR can view company overtime requests.'
      });
    }

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

    const userIds = [...new Set(filtered.map(r => String(r.user?._id || r.user)).filter(Boolean))];
    const salaries = await EmployeeSalary.find({ user: { $in: userIds }, status: 'active' }).lean();
    const salaryMap = new Map(salaries.map(s => [String(s.user), s]));

    const enriched = filtered.map(r => {
      const uId = String(r.user?._id || r.user);
      const sal = salaryMap.get(uId);
      const monthlyGross = Number(sal?.monthlyGross || 0);
      const dailyWage = monthlyGross > 0 ? (monthlyGross / 30) : 0;
      const hourlyWage = dailyWage > 0 ? (dailyWage / 9) : 0;
      const daysCount = (r.dateKeys || []).length || 1;

      let calcAmt = Number(r.calculatedAmount || 0);
      if (!calcAmt && monthlyGross > 0) {
        if (r.calculationType === 'FULL_DAY_PRESENT') {
          calcAmt = Math.round(dailyWage * daysCount * 100) / 100;
        } else if (Number(r.requestedHours || 0) > 0) {
          calcAmt = Math.round(hourlyWage * Number(r.requestedHours) * daysCount * 100) / 100;
        }
      }

      return {
        ...r,
        calculationType: r.calculationType || 'BY_HOURS',
        requestedHours: r.requestedHours || 0,
        calculatedAmount: calcAmt,
        isFullDayApproved: Boolean(r.isFullDayApproved),
        monthlySalary: monthlyGross,
        dailyWage: Math.round(dailyWage * 100) / 100,
        hourlyWage: Math.round(hourlyWage * 100) / 100
      };
    });

    return res.status(200).json({
      success: true,
      data: enriched,
      count: enriched.length
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
    const isAuthorized = await isPrivilegedOtManager(req.user);
    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only authorized Admin or HR can review overtime requests.'
      });
    }

    const adminId = req.user._id || req.user.id;
    const companyCode = req.user.companyCode || (req.user.company ? req.user.company.companyCode : null);
    const { id } = req.params;
    const { action, rejectionReason = '', isFullDayApproved = false } = req.body;

    if (!['Approve', 'Reject'].includes(action)) {
      return res.status(400).json({ success: false, message: "Action must be either 'Approve' or 'Reject'." });
    }

    const request = await OvertimeRequest.findOne({ _id: id, companyCode });
    if (!request) {
      return res.status(404).json({ success: false, message: 'Overtime request not found.' });
    }

    if (String(request.user) === String(adminId)) {
      return res.status(403).json({
        success: false,
        message: 'You cannot approve or reject your own overtime request.'
      });
    }

    const newStatus = action === 'Approve' ? 'Approved' : 'Rejected';
    request.status = newStatus;
    request.approvedBy = adminId;
    request.approvedAt = new Date();
    if (action === 'Reject') {
      request.rejectionReason = String(rejectionReason || '').trim();
    } else if (action === 'Approve') {
      if (request.calculationType === 'FULL_DAY_PRESENT') {
        request.isFullDayApproved = isFullDayApproved !== undefined ? Boolean(isFullDayApproved) : true;
      }
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

          const matchedDateKeys = new Set();
          for (const att of matchingRecords) {
            const attKey = getIndiaDateKey(att.date);
            matchedDateKeys.add(attKey);
            att.hasOvertimeApproved = true;
            att.overtimeRequestId = request._id;

            if (request.calculationType === 'FULL_DAY_PRESENT') {
              if (request.isFullDayApproved) {
                att.overTime = 'Full Day';
                att.overTimeMinutes = 540;
                att.status = 'PRESENT';
              }
            } else {
              // BY_HOURS
              if (att.outTime && att.shiftEnd && att.clockOutMode !== 'AUTO') {
                const outD = new Date(att.outTime);
                const shiftEndD = new Date(att.shiftEnd);
                if (outD > shiftEndD) {
                  const otMs = Math.max(0, outD - shiftEndD);
                  att.overTime = formatDuration(otMs);
                  att.overTimeMinutes = Math.floor(otMs / (60 * 1000));
                } else if (Number(request.requestedHours || 0) > 0) {
                  att.overTime = formatDuration(Number(request.requestedHours) * 3600 * 1000);
                  att.overTimeMinutes = Number(request.requestedHours) * 60;
                }
              } else if (Number(request.requestedHours || 0) > 0) {
                att.overTime = formatDuration(Number(request.requestedHours) * 3600 * 1000);
                att.overTimeMinutes = Number(request.requestedHours) * 60;
              } else if (att.clockOutMode === 'AUTO') {
                att.overTime = '00:00:00';
                att.overTimeMinutes = 0;
              }
            }
            await att.save();
          }

          // If FULL_DAY_PRESENT and no attendance record existed on that date, create one marked as Present
          if (request.calculationType === 'FULL_DAY_PRESENT' && request.isFullDayApproved) {
            for (const dKey of (request.dateKeys || [])) {
              if (!matchedDateKeys.has(dKey)) {
                const recDate = new Date(`${dKey}T00:00:00.000+05:30`);
                const newAtt = new Attendance({
                  user: request.user,
                  company: request.company,
                  companyCode: request.companyCode,
                  date: recDate,
                  status: 'PRESENT',
                  hasOvertimeApproved: true,
                  overtimeRequestId: request._id,
                  overTime: 'Full Day',
                  overTimeMinutes: 540,
                  notes: 'Overtime approved as 1 Full Day Present'
                });
                await newAtt.save();
              }
            }
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
 * GET /api/overtime/today-session
 * Checks today's overtime status, shift end time, timer state, and if Start OT is allowed
 */
const getTodayOvertimeSession = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const now = new Date();
    const todayKey = getIndiaDateKey(now);
    const monthKey = todayKey.slice(0, 7);

    // 1. Check if user has an approved overtime request for today
    const approvedRequest = await OvertimeRequest.findOne({
      user: userId,
      status: 'Approved',
      $or: [
        { dateKeys: todayKey },
        { month: monthKey, requestType: 'FULL_MONTH' }
      ]
    }).lean();

    if (!approvedRequest) {
      return res.status(200).json({
        success: true,
        hasApprovedOt: false,
        message: 'No approved overtime request for today.'
      });
    }

    // 2. Fetch shift schedule to know shiftEnd
    const userDoc = await User.findById(userId).populate('jobRole').lean();
    const shiftInfo = await resolveShiftScheduleForUser(userDoc, now);

    let shiftEnd = shiftInfo?.schedule?.shiftEnd;
    let shiftEndStr = shiftInfo?.schedule?.shiftEndStr || '19:00';
    let shiftStartStr = shiftInfo?.schedule?.shiftStartStr || '10:00';

    // 3. Check today's Attendance document
    const startOfDay = new Date(`${todayKey}T00:00:00.000+05:30`);
    const endOfDay = new Date(`${todayKey}T23:59:59.999+05:30`);

    const att = await Attendance.findOne({
      user: userId,
      date: { $gte: startOfDay, $lte: endOfDay }
    }).lean();

    if (att && att.shiftEnd && !shiftInfo?.schedule) {
      shiftEndStr = att.shiftEnd;
    }

    // Determine if shift has ended
    let isShiftEnded = false;
    if (shiftEnd) {
      isShiftEnded = now >= shiftEnd;
    } else if (shiftEndStr) {
      const [seh, sem] = shiftEndStr.split(':').map(Number);
      const shiftedNow = new Date(now.getTime() + INDIA_OFFSET_MS);
      const nowH = shiftedNow.getUTCHours();
      const nowM = shiftedNow.getUTCMinutes();
      isShiftEnded = (nowH * 60 + nowM) >= (seh * 60 + (sem || 0));
    }

    const isOtRunning = Boolean(att?.isOtRunning);
    const otStartTime = att?.otStartTime || null;
    const otEndTime = att?.otEndTime || null;
    const overTime = att?.overTime || '00:00:00';
    const overTimeMinutes = Number(att?.overTimeMinutes || 0);
    const otCompleted = Boolean(!isOtRunning && otEndTime && overTimeMinutes > 0);

    // Calculate live earnings preview based on 9h workday
    const salaryDoc = await EmployeeSalary.findOne({ user: userId, status: 'active' }).lean();
    const monthlyGross = Number(salaryDoc?.monthlyGross || 0);
    const dailyWage = monthlyGross > 0 ? (monthlyGross / 30) : 0;
    const hourlyWage = dailyWage > 0 ? (dailyWage / 9) : 0;
    const earnedAmount = overTimeMinutes > 0 ? Math.round(((overTimeMinutes / 60) * hourlyWage) * 100) / 100 : 0;

    return res.status(200).json({
      success: true,
      hasApprovedOt: true,
      data: {
        todayKey,
        requestId: approvedRequest._id,
        calculationType: approvedRequest.calculationType || 'BY_HOURS',
        requestedHours: approvedRequest.requestedHours || 0,
        shiftStartStr,
        shiftEndStr,
        shiftEndFormatted: format12Hour(shiftEndStr),
        isShiftEnded,
        canStartOt: isShiftEnded && !isOtRunning && !otCompleted,
        isOtRunning,
        otStartTime,
        otEndTime,
        overTime,
        overTimeMinutes,
        otCompleted,
        monthlyGross,
        dailyWage: Math.round(dailyWage * 100) / 100,
        hourlyWage: Math.round(hourlyWage * 100) / 100,
        earnedAmount
      }
    });
  } catch (error) {
    console.error('Get Today Overtime Session Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to get today overtime session', error: error.message });
  }
};

/**
 * POST /api/overtime/start
 * Employee starts overtime after their regular shift ends
 */
const startOvertimeSession = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const companyCode = req.user.companyCode || (req.user.company ? req.user.company.companyCode : null);
    const now = new Date();
    const todayKey = getIndiaDateKey(now);
    const monthKey = todayKey.slice(0, 7);

    // 1. Verify approved request for today
    const approvedRequest = await OvertimeRequest.findOne({
      user: userId,
      status: 'Approved',
      $or: [
        { dateKeys: todayKey },
        { month: monthKey, requestType: 'FULL_MONTH' }
      ]
    });

    if (!approvedRequest) {
      return res.status(400).json({
        success: false,
        message: 'No approved overtime request found for today.'
      });
    }

    if (approvedRequest.companyCode && companyCode && approvedRequest.companyCode !== companyCode) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Cross-company overtime operation is forbidden.'
      });
    }

    // 2. Verify shift has ended
    const userDoc = await User.findById(userId).populate('jobRole').lean();
    const shiftInfo = await resolveShiftScheduleForUser(userDoc, now);

    let shiftEnd = shiftInfo?.schedule?.shiftEnd;
    let shiftEndStr = shiftInfo?.schedule?.shiftEndStr || '19:00';
    let isShiftEnded = false;

    if (shiftEnd) {
      isShiftEnded = now >= shiftEnd;
    } else if (shiftEndStr) {
      const [seh, sem] = shiftEndStr.split(':').map(Number);
      const shiftedNow = new Date(now.getTime() + INDIA_OFFSET_MS);
      const nowH = shiftedNow.getUTCHours();
      const nowM = shiftedNow.getUTCMinutes();
      isShiftEnded = (nowH * 60 + nowM) >= (seh * 60 + (sem || 0));
    }

    if (!isShiftEnded) {
      const formattedEnd = format12Hour(shiftEndStr);
      return res.status(400).json({
        success: false,
        message: `Your regular shift ends at ${formattedEnd}. Overtime can only be started after your regular shift ends.`
      });
    }

    // 3. Find or create today's Attendance document
    const startOfDay = new Date(`${todayKey}T00:00:00.000+05:30`);
    const endOfDay = new Date(`${todayKey}T23:59:59.999+05:30`);

    let att = await Attendance.findOne({
      user: userId,
      date: { $gte: startOfDay, $lte: endOfDay }
    });

    if (!att) {
      att = new Attendance({
        user: userId,
        company: approvedRequest.company,
        companyCode: companyCode || approvedRequest.companyCode,
        date: now,
        status: 'PRESENT',
        shiftStart: shiftInfo?.schedule?.shiftStartStr || '10:00',
        shiftEnd: shiftInfo?.schedule?.shiftEndStr || '19:00',
        shiftName: shiftInfo?.shiftSettings?.shiftName || 'General Shift',
        hasOvertimeApproved: true,
        overtimeRequestId: approvedRequest._id,
        notes: 'Overtime shift session'
      });
    }

    if (att.isOtRunning) {
      return res.status(200).json({
        success: true,
        message: 'Overtime is already running.',
        data: {
          otStartTime: att.otStartTime,
          isOtRunning: true,
          requestedHours: approvedRequest.requestedHours
        }
      });
    }

    if (att.otEndTime && !att.isOtRunning && att.overTimeMinutes > 0) {
      return res.status(400).json({
        success: false,
        message: 'Overtime session for today has already been completed and recorded.'
      });
    }

    att.otStartTime = now;
    att.otEndTime = null;
    att.isOtRunning = true;
    att.hasOvertimeApproved = true;
    att.overtimeRequestId = approvedRequest._id;
    if (att.status === 'ABSENT' || !att.status) {
      att.status = 'PRESENT';
    }

    await att.save();

    return res.status(200).json({
      success: true,
      message: 'Overtime started successfully. Timer is now running.',
      data: {
        otStartTime: att.otStartTime,
        isOtRunning: true,
        requestedHours: approvedRequest.requestedHours
      }
    });
  } catch (error) {
    console.error('Start Overtime Session Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to start overtime session', error: error.message });
  }
};

/**
 * POST /api/overtime/stop
 * Employee stops overtime; calculates actual duration and caps at approved requested hours
 */
const stopOvertimeSession = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const now = new Date();
    const todayKey = getIndiaDateKey(now);

    const startOfDay = new Date(`${todayKey}T00:00:00.000+05:30`);
    const endOfDay = new Date(`${todayKey}T23:59:59.999+05:30`);

    let att = await Attendance.findOne({
      user: userId,
      date: { $gte: startOfDay, $lte: endOfDay }
    });

    if (!att || !att.otStartTime) {
      return res.status(400).json({
        success: false,
        message: 'No active overtime session found to stop.'
      });
    }

    const otStartTime = new Date(att.otStartTime);
    const otEndTime = now;
    const elapsedMs = Math.max(0, otEndTime - otStartTime);
    const actualMinutes = Math.max(1, Math.floor(elapsedMs / 60000));

    // Get approved request to cap duration
    const monthKey = todayKey.slice(0, 7);
    const approvedRequest = await OvertimeRequest.findOne({
      user: userId,
      status: 'Approved',
      $or: [
        { dateKeys: todayKey },
        { month: monthKey, requestType: 'FULL_MONTH' }
      ]
    });
    if (att.companyCode && req.user.companyCode && att.companyCode !== req.user.companyCode) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Cross-company overtime operation is forbidden.'
      });
    };

    const approvedHours = Number(approvedRequest?.requestedHours || 0);
    let maxMinutes;
    if (approvedRequest?.calculationType === 'FULL_DAY_PRESENT') {
      maxMinutes = 540; // 9 hours max for full day
    } else if (approvedHours > 0) {
      maxMinutes = approvedHours * 60;
    } else {
      maxMinutes = 480; // Safe default max limit of 8 hours
    }

    // Cap at approved hours: if worked 2h 15m (135m) and approved is 2h (120m), count 120m.
    // If worked 1h 30m (90m), count 90m.
    const countedMinutes = Math.min(actualMinutes, maxMinutes);

    const finalHours = Math.floor(countedMinutes / 60);
    const finalRemMin = countedMinutes % 60;
    const formattedOt = `${String(finalHours).padStart(2, '0')}:${String(finalRemMin).padStart(2, '0')}:00`;

    att.otEndTime = otEndTime;
    att.isOtRunning = false;
    att.overTime = formattedOt;
    att.overTimeMinutes = countedMinutes;
    att.otActualMinutes = actualMinutes;
    att.hasOvertimeApproved = true;
    if (att.status === 'ABSENT' || !att.status) {
      att.status = 'PRESENT';
    }

    await att.save();

    // Calculate earned overtime pay (9-hour daily working time basis)
    const salaryDoc = await EmployeeSalary.findOne({ user: userId, status: 'active' }).lean();
    const monthlyGross = Number(salaryDoc?.monthlyGross || 0);
    const dailyWage = monthlyGross > 0 ? (monthlyGross / 30) : 0;
    const hourlyWage = dailyWage > 0 ? (dailyWage / 9) : 0;
    const earnedAmount = Math.round(((countedMinutes / 60) * hourlyWage) * 100) / 100;

    const actualHours = Math.floor(actualMinutes / 60);
    const actualRemMin = actualMinutes % 60;
    const actualFormatted = `${actualHours > 0 ? `${actualHours}h ` : ''}${actualRemMin}m`;
    const countedFormatted = `${finalHours > 0 ? `${finalHours}h ` : ''}${finalRemMin}m`;

    const isCapped = actualMinutes > maxMinutes;
    const summaryMsg = isCapped
      ? `Overtime recorded: ${actualFormatted} worked (Capped at approved limit: ${countedFormatted}). Earned: +₹${earnedAmount}`
      : `Overtime recorded: ${countedFormatted}. Earned: +₹${earnedAmount}`;

    return res.status(200).json({
      success: true,
      message: summaryMsg,
      data: {
        actualMinutes,
        actualFormatted,
        countedMinutes,
        countedFormatted,
        overTime: formattedOt,
        overTimeMinutes: countedMinutes,
        isCapped,
        earnedAmount,
        otStartTime: att.otStartTime,
        otEndTime: att.otEndTime
      }
    });
  } catch (error) {
    console.error('Stop Overtime Session Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to stop overtime session', error: error.message });
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
  getTodayOvertimeSession,
  startOvertimeSession,
  stopOvertimeSession,
  isOvertimeApprovedForUserDate,
  getIndiaDateKey
};

