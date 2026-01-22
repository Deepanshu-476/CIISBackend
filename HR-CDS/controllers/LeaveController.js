const Leave = require('../models/Leave');
const User = require('../../models/User');
const { sendLeaveStatusEmail } = require('../../utils/sendEmail');
// 🔹 Apply for Leave (User)
exports.applyLeave = async (req, res) => {
  console.log("➡️ applyLeave controller called");

  try {
    const { type, reason, startDate, endDate } = req.body;

    if (!type?.trim() || !reason?.trim() || !startDate || !endDate) {
      return res.status(400).json({ error: 'All fields are required.' });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (start > end) {
      return res.status(400).json({ error: 'Start date cannot be after end date.' });
    }

    const days = Math.floor((end - start) / (1000 * 60 * 60 * 24)) + 1;

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
          role: req.user.jobRole || 'employee',
          remarks: '',
          at: new Date()
        }
      ]
    });

    await leave.save();
    res.status(201).json({ message: 'Leave applied successfully.', leave });

  } catch (err) {
    console.error("❌ Error in applyLeave controller:", err);
    res.status(500).json({ error: 'Server error' });
  }
};

// 🔹 Get My Leaves (User)
exports.getMyLeaves = async (req, res) => {
  console.log("➡️ getMyLeaves controller called");

  try {
    const userId = req.user._id;
    const leaves = await Leave.find({ user: userId }).sort({ createdAt: -1 });

    res.status(200).json({ leaves });

  } catch (err) {
    console.error("❌ Error in getMyLeaves controller:", err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

// 🔹 Get All Leaves with department filter for managers
exports.getAllLeaves = async (req, res) => {
  console.log(" getAllLeaves controller called");

  try {
    const { date, status, type, department } = req.query;
    const filter = {};

    // 🔸 Date Filter
    if (date) {
      const targetDate = new Date(date);
      targetDate.setHours(0, 0, 0, 0);
      const nextDay = new Date(targetDate);
      nextDay.setDate(targetDate.getDate() + 1);
      filter.startDate = { $gte: targetDate, $lt: nextDay };
    }

    // 🔸 Status Filter
    if (status && status !== 'All') {
      const normalizedStatus = status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
      const allowedStatuses = ['Pending', 'Approved', 'Rejected'];
      if (allowedStatuses.includes(normalizedStatus)) {
        filter.status = normalizedStatus;
      }
    }

    // 🔸 Type Filter
    if (type && type !== 'all') {
      filter.type = type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
    }

    // 🔸 Department Filter for Managers
    const userRole = req.user.jobRole?.toLowerCase();
    if (userRole === 'manager' && req.user.department) {
      // First get all users from manager's department
      const departmentUsers = await User.find({ 
        department: req.user.department 
      }, '_id');
      
      const userIds = departmentUsers.map(user => user._id);
      filter.user = { $in: userIds };
    }

    const leaves = await Leave.find(filter)
      .populate('user', 'name email role department phone')
      .sort({ createdAt: -1 });

    console.log(`✅ Found ${leaves.length} leave(s)`);
    res.status(200).json({ leaves });

  } catch (err) {
    console.error("❌ Error in getAllLeaves controller:", err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

// 🔹 Delete Leave (Admin/HR/Manager can delete)
exports.deleteLeave = async (req, res) => {
  console.log("deleteLeave controller called");

  try {
    const { id } = req.params;
    const userRole = req.user.jobRole?.toLowerCase();

    const leave = await Leave.findById(id).populate('user', 'department');
    
    if (!leave) {
      return res.status(404).json({ error: 'Leave not found.' });
    }

    // Check permissions
    if (userRole === 'manager') {
      // Manager can only delete leaves from their department
      if (leave.user.department !== req.user.department) {
        return res.status(403).json({ 
          error: 'You can only delete leaves from your department.' 
        });
      }
    }

    await leave.deleteOne();
    console.log(" Leave deleted successfully");
    res.status(200).json({ message: 'Leave deleted successfully.' });
    
  } catch (err) {
    console.error("❌ Error in deleteLeave controller:", err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

// 🔹 Update Leave Status (Admin/HR/Manager can update)
exports.updateLeaveStatus = async (req, res) => {
  console.log(" updateLeaveStatus controller called");

  try {
    const { id } = req.params;
    const { status, remarks } = req.body;
    const userRole = req.user.jobRole?.toLowerCase();

    const allowedStatuses = ['Pending', 'Approved', 'Rejected'];
    const normalizedStatus = status?.charAt(0).toUpperCase() + status?.slice(1).toLowerCase();

    if (!allowedStatuses.includes(normalizedStatus)) {
      return res.status(400).json({ error: 'Invalid status value.' });
    }

    const leave = await Leave.findById(id).populate('user', 'department');
    if (!leave) return res.status(404).json({ error: 'Leave not found.' });

    // Check if user is trying to update their own leave
    if (leave.user._id.toString() === req.user._id.toString()) {
      return res.status(403).json({ 
        error: 'You cannot update the status of your own leave.' 
      });
    }

    // Check manager permissions
    if (userRole === 'manager') {
      // Manager can only update leaves from their department
      if (leave.user.department !== req.user.department) {
        return res.status(403).json({ 
          error: 'You can only update leaves from your department.' 
        });
      }
    }

    // Check if user has permission to update status
    const allowedRoles = ['admin', 'hr', 'superadmin', 'manager'];
    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({ 
        error: 'You do not have permission to update leave status.' 
      });
    }

    // Update main record
    leave.status = normalizedStatus;
    leave.approvedBy = req.user.name || "Unknown";
    leave.remarks = remarks?.trim() || '';

    // Push to history array
    leave.history.push({
      action: normalizedStatus.toLowerCase(),
      by: req.user._id,
      role: userRole,
      remarks: remarks?.trim() || '',
      at: new Date()
    });

    await leave.save();

    console.log(`✅ Leave status updated to ${normalizedStatus}`);
    res.status(200).json({ 
      message: 'Leave status updated.', 
      leave,
      userEmail: leave.user.email,
      userName: leave.user.name,
      userPhone: leave.user.phone
    });

  } catch (err) {
    console.error("❌ Error in updateLeaveStatus controller:", err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

// 🔹 Get Leaves by Department (for managers)
exports.getLeavesByDepartment = async (req, res) => {
  console.log("getLeavesByDepartment controller called");

  try {
    const { department } = req.params;
    const userRole = req.user.jobRole?.toLowerCase();

    // Check if user is manager of this department
    if (userRole === 'manager' && req.user.department !== department) {
      return res.status(403).json({ 
        error: 'You can only view leaves from your department.' 
      });
    }

    // Get users from department
    const departmentUsers = await User.find({ department }, '_id');
    const userIds = departmentUsers.map(user => user._id);

    const leaves = await Leave.find({ user: { $in: userIds } })
      .populate('user', 'name email role department phone')
      .sort({ createdAt: -1 });

    res.status(200).json({ leaves });

  } catch (err) {
    console.error("❌ Error in getLeavesByDepartment controller:", err.message);
    res.status(500).json({ error: 'Server error' });
  }
};exports.updateLeaveStatus = async (req, res) => {
  console.log(" updateLeaveStatus controller called");

  try {
    const { id } = req.params;
    const { status, remarks } = req.body;
    const userRole = req.user.jobRole?.toLowerCase();

    const allowedStatuses = ['Pending', 'Approved', 'Rejected'];
    const normalizedStatus = status?.charAt(0).toUpperCase() + status?.slice(1).toLowerCase();

    if (!allowedStatuses.includes(normalizedStatus)) {
      return res.status(400).json({ error: 'Invalid status value.' });
    }

    const leave = await Leave.findById(id).populate('user', 'department email name phone');
    if (!leave) return res.status(404).json({ error: 'Leave not found.' });

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

    // Check if user has permission to update status
    const allowedRoles = ['admin', 'hr', 'superadmin', 'manager'];
    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({ 
        error: 'You do not have permission to update leave status.' 
      });
    }

    // Update main record
    leave.status = normalizedStatus;
    leave.approvedBy = req.user.name || "Unknown";
    leave.remarks = remarks?.trim() || '';

    // Push to history array
    leave.history.push({
      action: normalizedStatus.toLowerCase(),
      by: req.user._id,
      role: userRole,
      remarks: remarks?.trim() || '',
      at: new Date()
    });

    await leave.save();

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
      // Don't fail the whole request if email fails
    }

    console.log(`✅ Leave status updated to ${normalizedStatus}`);
    res.status(200).json({ 
      message: 'Leave status updated.', 
      leave,
      userEmail: leave.user.email,
      userName: leave.user.name,
      userPhone: leave.user.phone,
      emailSent: true
    });

  } catch (err) {
    console.error("❌ Error in updateLeaveStatus controller:", err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

// 🔹 Apply for Leave with email notification
exports.applyLeave = async (req, res) => {
  console.log("➡️ applyLeave controller called");

  try {
    const { type, reason, startDate, endDate } = req.body;

    if (!type?.trim() || !reason?.trim() || !startDate || !endDate) {
      return res.status(400).json({ error: 'All fields are required.' });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (start > end) {
      return res.status(400).json({ error: 'Start date cannot be after end date.' });
    }

    const days = Math.floor((end - start) / (1000 * 60 * 60 * 24)) + 1;

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
          role: req.user.role || 'employee',
          remarks: '',
          at: new Date()
        }
      ]
    });

    await leave.save();

    // Send confirmation email to user
    try {
      await sendLeaveAppliedEmail(
        req.user.email,
        req.user.name,
        leave._id.toString(),
        type,
        startDate,
        endDate
      );
      console.log(`✅ Leave application email sent to ${req.user.email}`);
    } catch (emailError) {
      console.error('❌ Failed to send application email:', emailError.message);
    }

    res.status(201).json({ 
      message: 'Leave applied successfully.', 
      leave 
    });

  } catch (err) {
    console.error("❌ Error in applyLeave controller:", err);
    res.status(500).json({ error: 'Server error' });
  }
};

// 🔹 Delete Leave with email notification
exports.deleteLeave = async (req, res) => {
  console.log("deleteLeave controller called");

  try {
    const { id } = req.params;
    const userRole = req.user.jobRole?.toLowerCase();

    const leave = await Leave.findById(id).populate('user', 'department email name');
    
    if (!leave) {
      return res.status(404).json({ error: 'Leave not found.' });
    }

    // Check permissions
    if (userRole === 'manager') {
      if (leave.user.department !== req.user.department) {
        return res.status(403).json({ 
          error: 'You can only delete leaves from your department.' 
        });
      }
    }

    // Send notification email before deleting
    try {
      await sendLeaveDeletedEmail(
        leave.user.email,
        leave.user.name,
        leave._id.toString()
      );
      console.log(`✅ Deletion notification sent to ${leave.user.email}`);
    } catch (emailError) {
      console.error('❌ Failed to send deletion email:', emailError.message);
    }

    await leave.deleteOne();
    console.log(" Leave deleted successfully");
    
    res.status(200).json({ 
      message: 'Leave deleted successfully.',
      emailSent: true
    });
    
  } catch (err) {
    console.error("❌ Error in deleteLeave controller:", err.message);
    res.status(500).json({ error: 'Server error' });
  }
};