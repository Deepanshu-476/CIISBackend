const Leave = require('../models/Leave');
const User = require('../../models/User');
const { sendLeaveAppliedEmail, sendLeaveStatusEmail, sendLeaveDeletedEmail } = require('../../utils/sendEmail');

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

    // Send email notification
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

// 🔹 Update Leave Status
exports.updateLeaveStatus = async (req, res) => {
  console.log("➡️ updateLeaveStatus controller called");

  try {
    const { id } = req.params;
    const { status, remarks } = req.body;
    const userRole = req.user.jobRole?.toLowerCase();

    // Check permissions
    const allowedRoles = ['admin', 'hr','manager'];
    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({ 
        error: 'You do not have permission to update leave status.' 
      });
    }

    const allowedStatuses = ['Pending', 'Approved', 'Rejected', 'Cancelled'];
    const normalizedStatus = status?.charAt(0).toUpperCase() + status?.slice(1).toLowerCase();

    if (!allowedStatuses.includes(normalizedStatus)) {
      return res.status(400).json({ error: 'Invalid status value.' });
    }

    const leave = await Leave.findById(id)
      .populate('user', 'department email name phone jobRole');
    
    if (!leave) {
      return res.status(404).json({ error: 'Leave not found.' });
    }

    // Check if user is trying to update their own leave
    if (leave.user._id.toString() === req.user._id.toString()) {
      return res.status(403).json({ 
        error: 'You cannot update the status of your own leave.' 
      });
    }

    // Check manager permissions
    if (userRole === 'manager') {
      if (leave.user.department !== req.user.department) {
        return res.status(403).json({ 
          error: 'You can only update leaves from your department.' 
        });
      }
    }

    // Update leave
    leave.status = normalizedStatus;
    leave.approvedBy = req.user.name || "Unknown";
    leave.remarks = remarks?.trim() || '';

    // Add to history
    leave.history.push({
      action: normalizedStatus.toLowerCase(),
      by: req.user._id,
      role: userRole,
      remarks: remarks?.trim() || '',
      at: new Date()
    });

    await leave.save();

    // Get updated leave
    const updatedLeave = await Leave.findById(id)
      .populate('user', 'name email jobRole department')
      .populate('history.by', 'name email');

    // Send email notification
    try {
      await sendLeaveStatusEmail(
        leave.user.email,
        leave.user.name,
        leave._id.toString(),
        normalizedStatus,
        remarks?.trim() || '',
        req.user.name || "Administrator"
      );
      console.log(`✅ Email notification sent to ${leave.user.email}`);
    } catch (emailError) {
      console.error('❌ Failed to send email notification:', emailError.message);
    }

    res.status(200).json({ 
      success: true,
      message: 'Leave status updated successfully.', 
      leave: updatedLeave
    });

  } catch (err) {
    console.error("❌ Error in updateLeaveStatus controller:", err.message);
    res.status(500).json({ 
      success: false,
      error: 'Server error' 
    });
  }
};

// 🔹 Get All Leaves
exports.getAllLeaves = async (req, res) => {
  console.log("➡️ getAllLeaves controller called");

  try {
    const { date, status, type, department, page = 1, limit = 20 } = req.query;
    const filter = {};
    
    const userRole = req.user.jobRole?.toLowerCase();
    const allowedRoles = ['admin', 'hr',  'manager'];

    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({ 
        error: 'You do not have permission to view all leaves.' 
      });
    }

    // Department Filter for Managers
    if (userRole === 'manager' && req.user.department) {
      const departmentUsers = await User.find({ 
        department: req.user.department 
      }, '_id');
      
      const userIds = departmentUsers.map(user => user._id);
      filter.user = { $in: userIds };
    }

    // Other filters
    if (status && status !== 'All') {
      filter.status = status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
    }

    if (type && type !== 'all') {
      filter.type = type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
    }

    if (department && department !== 'all' && userRole !== 'manager') {
      const departmentUsers = await User.find({ department }, '_id');
      const userIds = departmentUsers.map(user => user._id);
      filter.user = { $in: userIds };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const total = await Leave.countDocuments(filter);

    const leaves = await Leave.find(filter)
      .populate('user', 'name email jobRole department employeeId phone')
      .populate('history.by', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    res.status(200).json({ 
      success: true,
      leaves,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit))
    });

  } catch (err) {
    console.error("❌ Error in getAllLeaves controller:", err.message);
    res.status(500).json({ 
      success: false,
      error: 'Server error' 
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

// 🔹 Delete Leave
exports.deleteLeave = async (req, res) => {
  console.log("➡️ deleteLeave controller called");

  try {
    const { id } = req.params;
    const userRole = req.user.jobRole?.toLowerCase();

    // Check permissions
    const allowedRoles = ['admin', 'hr', 'manager'];
    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({ 
        error: 'You do not have permission to delete leaves.' 
      });
    }

    const leave = await Leave.findById(id).populate('user', 'department email name jobRole');
    
    if (!leave) {
      return res.status(404).json({ error: 'Leave not found.' });
    }

    // Check manager permissions
    if (userRole === 'manager') {
      if (leave.user.department !== req.user.department) {
        return res.status(403).json({ 
          error: 'You can only delete leaves from your department.' 
        });
      }
    }

    // Send deletion email
    try {
      await sendLeaveDeletedEmail(
        leave.user.email,
        leave.user.name,
        leave._id.toString(),
        leave.type,
        leave.startDate,
        leave.endDate
      );
      console.log(`✅ Deletion notification sent to ${leave.user.email}`);
    } catch (emailError) {
      console.error('❌ Failed to send deletion email:', emailError.message);
    }

    await leave.deleteOne();

    res.status(200).json({ 
      success: true,
      message: 'Leave deleted successfully.'
    });
    
  } catch (err) {
    console.error("❌ Error in deleteLeave controller:", err.message);
    res.status(500).json({ 
      success: false,
      error: 'Server error' 
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

// 🔹 Sync Leaves (for offline functionality)
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
            // Check for conflicts
            if (existingLeave.updatedAt > new Date(localLeave.updatedAt)) {
              result.conflicts.push({
                localId: localLeave._id,
                serverVersion: existingLeave,
                localVersion: localLeave,
                action: 'update'
              });
            } else {
              // Update leave
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

// 🔹 Get Leave Statistics (for dashboard)
exports.getLeaveStatistics = async (req, res) => {
  console.log("➡️ getLeaveStatistics controller called");
  
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
    console.error("❌ Error in getLeaveStatistics controller:", err.message);
    res.status(500).json({ 
      success: false,
      error: 'Server error' 
    });
  }
};

// 🔹 Get Leaves by Department
exports.getLeavesByDepartment = async (req, res) => {
  console.log("➡️ getLeavesByDepartment controller called");

  try {
    const { department } = req.params;
    const { status, type, date } = req.query;
    const userRole = req.user.jobRole?.toLowerCase();

    // Check permissions
    const allowedRoles = ['admin', 'hr',  'manager'];
    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({ 
        error: 'You do not have permission to view department leaves.' 
      });
    }

    // Check if manager is trying to access another department
    if (userRole === 'manager' && department !== req.user.department) {
      return res.status(403).json({ 
        error: 'You can only view leaves from your own department.' 
      });
    }

    // Get users from the department
    const departmentUsers = await User.find({ department }, '_id');
    const userIds = departmentUsers.map(user => user._id);

    const filter = { user: { $in: userIds } };

    if (status && status !== 'All') {
      filter.status = status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
    }

    if (type && type !== 'all') {
      filter.type = type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
    }

    if (date) {
      const selectedDate = new Date(date);
      const startOfDay = new Date(selectedDate.setHours(0, 0, 0, 0));
      const endOfDay = new Date(selectedDate.setHours(23, 59, 59, 999));
      filter.startDate = { $gte: startOfDay, $lte: endOfDay };
    }

    const leaves = await Leave.find(filter)
      .populate('user', 'name email jobRole department employeeId phone')
      .populate('history.by', 'name email')
      .sort({ startDate: -1 })
      .lean();

    res.status(200).json({
      success: true,
      department,
      leaves,
      total: leaves.length,
      employeeCount: userIds.length
    });

  } catch (err) {
    console.error("❌ Error in getLeavesByDepartment controller:", err.message);
    res.status(500).json({ 
      success: false,
      error: 'Server error' 
    });
  }
};