// LeaveController.js
const Leave = require('../models/Leave');
const User = require('../../models/User');
const Company = require('../../models/Company');
const nodemailer = require('nodemailer'); // ✅ Add this import

// ✅ IMPORT email functions from utils - SIRF EK BAAR
const { 
  sendLeaveAppliedEmail, 
  sendLeaveStatusEmail,  // ✅ This is imported, don't redefine!
  sendLeaveDeletedEmail 
} = require('../../utils/sendEmail');

// 🔹 Apply for Leave (User)
exports.applyLeave = async (req, res) => {
  console.log("➡️ applyLeave controller called");

  try {
    const { type, reason, startDate, endDate } = req.body;

    // Basic validation
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

    // Check for overlapping leaves
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

    // Create leave
    const leave = new Leave({
      user: req.user._id,
      type: type.trim(),
      reason: reason.trim(),
      startDate: start,
      endDate: end,
      days,
      status: 'Pending',
      approvedBy: null,
      remarks: '',
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

    // Get user basic info for response
    const user = await User.findById(req.user._id).select('name email department jobRole employeeId phone');

    // Populate leave for response
    const populatedLeave = await Leave.findById(leave._id)
      .populate('user', 'name email jobRole department')
      .populate('history.by', 'name email');

    // ✅ Send email notification - using IMPORTED function
    try {
      await sendLeaveAppliedEmail(
        user.email,
        user.name,
        leave._id.toString(),
        type,
        startDate,
        endDate,
        days
      );
      console.log(`✅ Leave application email sent to ${user.email}`);
    } catch (emailError) {
      console.error('❌ Failed to send application email:', emailError.message);
    }

    res.status(201).json({ 
      success: true,
      message: 'Leave applied successfully.', 
      leave: populatedLeave,
      userInfo: {
        id: user._id,
        name: user.name,
        email: user.email,
        department: user.department,
        jobRole: user.jobRole,
        employeeId: user.employeeId,
        phone: user.phone
      }
    });

  } catch (err) {
    console.error("❌ Error in applyLeave controller:", err);
    res.status(500).json({ 
      success: false,
      error: 'Server error' 
    });
  }
};

// 🔹 Get User Leaves
exports.getUserLeaves = async (req, res) => {
  console.log("➡️ getUserLeaves controller called");

  try {
    const userId = req.user._id;
    
    const leaves = await Leave.find({ user: userId })
      .populate('user', 'name email jobRole department')
      .populate('history.by', 'name email')
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({
      success: true,
      leaves: leaves,
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

// 🔹 Get All Leaves (with company filtering)
exports.getAllLeaves = async (req, res) => {
  try {
    console.log('📊 Getting all leaves for user:', {
      userId: req.user._id,
      name: req.user.name,
      companyId: req.user.company,
      company: req.user.companyName
    });

    const { 
      date, 
      status, 
      type, 
      department, 
      search, 
      page = 1, 
      limit = 20 
    } = req.query;

    // Build filter
    const filter = {};
    
    // Get the user's company ID
    const userCompanyId = req.user.company || req.user.companyId;
    if (!userCompanyId) {
      return res.status(400).json({
        success: false,
        error: 'User does not belong to any company'
      });
    }

    console.log(`👤 User's company ID: ${userCompanyId}`);

    // Find all users from the same company
    const companyUsers = await User.find({ 
      $or: [
        { company: userCompanyId },
        { companyId: userCompanyId }
      ]
    }).select('_id');
    
    const companyUserIds = companyUsers.map(user => user._id);
    
    console.log(`🏢 Found ${companyUserIds.length} users in the same company`);

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

    // Filter leaves by users from the same company
    filter.user = { $in: companyUserIds };

    // Date filter
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

    // Status filter
    if (status && status !== 'All') {
      filter.status = status;
    }

    // Type filter
    if (type && type !== 'all') {
      filter.type = type;
    }

    // Department filter
    if (department) {
      const departmentUsers = await User.find({ 
        _id: { $in: companyUserIds },
        department: department 
      }).select('_id');
      
      const departmentUserIds = departmentUsers.map(user => user._id);
      
      if (departmentUserIds.length > 0) {
        filter.user = { $in: departmentUserIds };
        console.log(`🔍 Filtering by department "${department}": ${departmentUserIds.length} users`);
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

    // Search filter
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
        console.log(`🔍 Search "${search}": found ${userIds.length} matching users`);
      } else {
        filter.$or = [
          { user: { $in: companyUserIds } },
          { reason: { $regex: search, $options: 'i' } }
        ];
      }
    }

    // Calculate pagination
    const skip = (page - 1) * limit;
    const total = await Leave.countDocuments(filter);

    // Get leaves with populated user data
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
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    // Filter out leaves where user population failed
    const validLeaves = leaves.filter(leave => leave.user !== null && leave.user !== undefined);

    // Format the response
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
      remarks: leave.remarks || '',
      approvedBy: leave.approvedBy,
      history: leave.history || [],
      createdAt: leave.createdAt,
      updatedAt: leave.updatedAt,
      company: userCompanyId
    }));

    console.log(`✅ Found ${formattedLeaves.length} leaves out of ${total} total for company ${userCompanyId}`);

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

// ============================================
// UPDATE LEAVE STATUS - ONLY OWNER
// ============================================
// ============================================
// UPDATE LEAVE STATUS - ONLY OWNER - SIMPLIFIED
// ============================================
exports.updateLeaveStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, remarks } = req.body;
    const currentUser = req.user;
    
    // 🔥 CRITICAL FIX #1: LOG FULL USER OBJECT TO DEBUG
    console.log('🔄 ========== UPDATE LEAVE STATUS ==========');
    console.log('📋 Leave ID:', id);
    console.log('📋 New Status:', status);
    console.log('👤 Current User (FULL):', {
      _id: currentUser._id,
      name: currentUser.name,
      email: currentUser.email,
      companyRole: currentUser.companyRole, 
      role: currentUser.role,
      company: currentUser.company,
      companyId: currentUser.companyId,
      companyCode: currentUser.companyCode
    });

    // 🔥 CRITICAL FIX #2: SIMPLE OWNER CHECK - NO COMPLEX LOGIC
    // Direct check - no fallbacks, no case conversion issues
    const isOwner = currentUser.companyRole === 'Owner';
    
    console.log('👑 Owner Check:', {
      companyRole: currentUser.companyRole,
      isOwner: isOwner
    });

    // 🔥 CRITICAL FIX #3: IF NOT OWNER, REJECT IMMEDIATELY
    if (!isOwner) {
      console.log('❌ ACCESS DENIED - User is not Owner. Role:', currentUser.companyRole);
      return res.status(403).json({
        success: false,
        error: 'You do not have permission to update leave status. Only Company Owner can perform this action.'
      });
    }

    console.log('👑✅ OWNER ACCESS GRANTED');

    // 🔥 CRITICAL FIX #4: FIND LEAVE WITHOUT COMPLEX POPULATE FIRST
    const leave = await Leave.findById(id);
    
    if (!leave) {
      console.log('❌ Leave not found:', id);
      return res.status(404).json({ 
        success: false, 
        error: 'Leave not found' 
      });
    }

    console.log('📋 Leave found:', {
      id: leave._id,
      currentStatus: leave.status,
      userId: leave.user
    });

    // ✅ Validate status
    const validStatuses = ['Pending', 'Approved', 'Rejected', 'Cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      });
    }

    // ✅ Store old status for history
    const oldStatus = leave.status;

    // ✅ Update the leave - OWNER CAN UPDATE ANY LEAVE
    leave.status = status;
    leave.remarks = remarks || leave.remarks;
    leave.approvedBy = currentUser._id;
    leave.updatedAt = new Date();

    // ✅ Add to history
    leave.history = leave.history || [];
    leave.history.push({
      action: status,
      from: oldStatus,
      to: status,
      by: currentUser._id,
      byName: currentUser.name || currentUser.email || 'Owner',
      byRole: 'Owner',
      remarks: remarks || '',
      at: new Date()
    });

    // ✅ Save the leave
    await leave.save();
    
    console.log('✅ Leave status updated in database');
    console.log(`📋 Status changed: ${oldStatus} → ${status}`);
    console.log('👤 Updated By:', currentUser.name, '(Owner)');

    // ✅ Populate user and approvedBy for response
    await leave.populate([
      { path: 'user', select: 'name email phone' },
      { path: 'approvedBy', select: 'name email' }
    ]);

    console.log('✅ ========== STATUS UPDATE SUCCESS ==========');

    res.status(200).json({
      success: true,
      message: `Leave ${status.toLowerCase()} successfully`,
      data: {
        _id: leave._id,
        status: leave.status,
        remarks: leave.remarks,
        approvedBy: leave.approvedBy,
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

// ============================================
// DELETE LEAVE - ONLY OWNER
// ============================================
exports.deleteLeave = async (req, res) => {
  try {
    const { id } = req.params;
    const currentUser = req.user;
    const userId = currentUser._id;
    const userRole = currentUser.companyRole || currentUser.role || '';
    const isOwner = currentUser.companyRole === 'Owner' || currentUser.companyRole === 'owner' || currentUser.companyRole === 'OWNER';

    console.log('🗑️ ========== DELETE LEAVE ==========');
    console.log('📋 Leave ID:', id);
    console.log('👤 Requested By:', userId);
    console.log('👑 Is Owner:', isOwner);

    // 🔥 🔥 🔥 CRITICAL: ONLY OWNER CAN DELETE LEAVES 🔥 🔥 🔥
    if (!isOwner) {
      console.log('❌ ACCESS DENIED - Not Owner. Role:', userRole);
      return res.status(403).json({
        success: false,
        error: 'You do not have permission to delete leave. Only Company Owner can perform this action.'
      });
    }

    console.log('👑 OWNER ACCESS GRANTED - Proceeding with deletion');

    // Find the leave
    const leave = await Leave.findById(id).populate('user', 'email name');

    if (!leave) {
      return res.status(404).json({
        success: false,
        error: 'Leave not found'
      });
    }

    // ✅ Send deletion email (optional)
    try {
      if (typeof sendLeaveDeletedEmail === 'function') {
        await sendLeaveDeletedEmail(
          leave.user.email,
          leave.user.name,
          leave._id.toString(),
          leave.type,
          leave.startDate,
          leave.endDate,
          leave.reason
        );
        console.log('📧 Leave deletion email sent');
      }
    } catch (emailError) {
      console.error('❌ Failed to send deletion email:', emailError);
    }

    // Delete the leave
    await Leave.findByIdAndDelete(id);

    console.log('✅ Leave deleted successfully:', id);
    console.log('🗑️ ========== DELETE COMPLETE ==========');

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

// 🔹 Get Leaves with Status Filter
exports.getLeavesWithStatus = async (req, res) => {
  console.log("➡️ getLeavesWithStatus controller called");

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
      .populate('history.by', 'name email')
      .sort({ startDate: -1 })
      .lean();

    res.status(200).json({
      success: true,
      leaves,
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

// 🔹 Sync Leaves
exports.syncLeaves = async (req, res) => {
  console.log("➡️ syncLeaves controller called");

  try {
    const { localLeaves = [], lastSync } = req.body;
    const userId = req.user._id;

    const result = {
      synced: [],
      conflicts: [],
      serverLeaves: []
    };

    // Get server leaves since last sync
    const filter = { user: userId };
    if (lastSync) {
      filter.updatedAt = { $gte: new Date(lastSync) };
    }

    const serverLeaves = await Leave.find(filter)
      .populate('user', 'name email')
      .lean();

    result.serverLeaves = serverLeaves;

    // Process local leaves
    for (const localLeave of localLeaves) {
      try {
        if (localLeave._id && localLeave._id.startsWith('local_')) {
          // New leave created offline
          const newLeave = new Leave({
            user: userId,
            type: localLeave.type,
            reason: localLeave.reason,
            startDate: localLeave.startDate,
            endDate: localLeave.endDate,
            days: localLeave.days,
            status: 'Pending',
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
          // Update existing leave
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

// 🔹 Get Leave Statistics
exports.getLeaveStats = async (req, res) => {
  console.log("➡️ getLeaveStats controller called");

  try {
    const userId = req.user._id;
    const userRole = req.user.jobRole?.toLowerCase();
    
    let stats = {};

    if (['admin', 'hr', 'manager'].includes(userRole)) {
      // Admin/Manager view
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
      // Regular user view
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

// 🔹 Get Leaves by Department
exports.getLeavesByDepartment = async (req, res) => {
  try {
    const { department } = req.params;
    const { status, type, date } = req.query;
    const userCompanyId = req.user.company || req.user.companyId;

    // Get users from the same company and specified department
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

    // Date filter
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

    // Status filter
    if (status && status !== 'All') {
      filter.status = status;
    }

    // Type filter
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

// 🔹 Get Calendar View
exports.getCalendarView = async (req, res) => {
  try {
    const userId = req.user._id;
    const userCompanyId = req.user.company || req.user.companyId;
    const { month, year } = req.query;
    
    const currentDate = new Date();
    const targetMonth = month ? parseInt(month) : currentDate.getMonth() + 1;
    const targetYear = year ? parseInt(year) : currentDate.getFullYear();
    
    // Calculate start and end of the month
    const startDate = new Date(targetYear, targetMonth - 1, 1);
    const endDate = new Date(targetYear, targetMonth, 0);
    
    // Get all users from same company
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
    
    // Format calendar data
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

// 🔹 Get Department Statistics
exports.getDepartmentStats = async (req, res) => {
  try {
    const { department } = req.params;
    const year = req.query.year || new Date().getFullYear();
    const userCompanyId = req.user.company || req.user.companyId;
    
    console.log(`📊 Getting department stats for: ${department}, year: ${year}, company: ${userCompanyId}`);
    
    // Get users from same company and department
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
    
    // Calculate yearly statistics
    const startOfYear = new Date(year, 0, 1);
    const endOfYear = new Date(year, 11, 31);
    
    const leaves = await Leave.find({
      user: { $in: userIds },
      startDate: { $gte: startOfYear, $lte: endOfYear }
    })
    .populate('user', 'name department')
    .lean();
    
    // Monthly breakdown
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
    
    // Type breakdown
    const typeStats = {};
    leaves.forEach(leave => {
      if (!typeStats[leave.type]) {
        typeStats[leave.type] = 0;
      }
      typeStats[leave.type]++;
    });
    
    // Overall statistics
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

// 🔹 Get Analytics
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
      // Default to current month
      const now = new Date();
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      dateFilter.startDate = { $gte: firstDay, $lte: lastDay };
    }
    
    // Get all users from same company
    const companyUsers = await User.find({ company: userCompanyId }).select('_id');
    const userIds = companyUsers.map(user => user._id);
    
    if (userIds.length > 0) {
      dateFilter.user = { $in: userIds };
    }
    
    // Get all leaves for the period
    const leaves = await Leave.find(dateFilter)
      .populate('user', 'name department')
      .lean();
    
    // Calculate analytics
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
    
    // Calculate department breakdown
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

// 🔹 Get Leave Balance
exports.getLeaveBalance = async (req, res) => {
  try {
    const userId = req.user._id;
    const currentYear = new Date().getFullYear();
    
    // Get user's leaves for current year
    const startOfYear = new Date(currentYear, 0, 1);
    const endOfYear = new Date(currentYear, 11, 31);
    
    const leaves = await Leave.find({
      user: userId,
      startDate: { $gte: startOfYear, $lte: endOfYear }
    }).lean();
    
    // Default leave policies
    const leavePolicies = {
      Casual: { maxDays: 12, description: 'For personal work' },
      Sick: { maxDays: 10, description: 'For health issues' },
      Paid: { maxDays: 20, description: 'Earned leave with pay' },
      Unpaid: { maxDays: 30, description: 'Leave without pay' },
      Other: { maxDays: 5, description: 'Other leave types' }
    };
    
    // Calculate used leaves by type
    const usedLeaves = {};
    leaves.forEach(leave => {
      if (leave.status === 'Approved') {
        if (!usedLeaves[leave.type]) {
          usedLeaves[leave.type] = 0;
        }
        usedLeaves[leave.type] += leave.days || 0;
      }
    });
    
    // Calculate balance
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
    
    // Calculate totals
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

// 🔹 Export Leaves
exports.exportLeaves = async (req, res) => {
  try {
    const { format = 'csv', startDate, endDate, department } = req.query;
    const userCompanyId = req.user.company || req.user.companyId;
    
    let filter = {};
    
    // Get all users from same company
    const companyUsers = await User.find({ company: userCompanyId }).select('_id');
    const userIds = companyUsers.map(user => user._id);
    
    filter.user = { $in: userIds };
    
    // Date filter
    if (startDate && endDate) {
      filter.startDate = { 
        $gte: new Date(startDate), 
        $lte: new Date(endDate) 
      };
    }
    
    // Department filter
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
    
    // Format data for export
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
    
    // Generate export based on format
    let exportContent, contentType, filename;
    
    if (format === 'csv') {
      // Convert to CSV
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
      // Default to JSON
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

console.log("✅ LeaveController.js loaded successfully");