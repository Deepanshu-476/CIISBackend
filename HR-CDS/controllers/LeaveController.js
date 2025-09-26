const Leave = require('../models/Leave');

// 🔹 Apply for Leave (User)
exports.applyLeave = async (req, res) => {
  console.log("➡️ applyLeave controller called");

  try {
    const { type, reason, startDate, endDate } = req.body;
    console.log("📥 Received data:", { type, reason, startDate, endDate });

    if (!type?.trim() || !reason?.trim() || !startDate || !endDate) {
      console.warn("⚠️ Missing required fields");
      return res.status(400).json({ error: 'All fields are required.' });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (start > end) {
      console.warn("⚠️ Invalid date range: startDate is after endDate");
      return res.status(400).json({ error: 'Start date cannot be after end date.' });
    }

    const days = Math.floor((end - start) / (1000 * 60 * 60 * 24)) + 1;
    console.log("📆 Computed days:", days);

    const leave = new Leave({
      user: req.user._id,
      type: type.trim(),
      reason: reason.trim(),
      startDate: start,
      endDate: end,
      days,
      status: 'Pending'
    });

    console.log("📤 Saving leave to DB:", leave);
    await leave.save();

    console.log("✅ Leave saved successfully");
    res.status(201).json({ message: 'Leave applied successfully.', leave });

  } catch (err) {
    console.error("❌ Error in applyLeave controller:", err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

// 🔹 Get My Leaves (User)
exports.getMyLeaves = async (req, res) => {
  console.log("➡️ getMyLeaves controller called");

  try {
    const userId = req.user._id;
    console.log("🔍 Finding leaves for user:", userId);

    const leaves = await Leave.find({ user: userId }).sort({ createdAt: -1 });

    if (!leaves.length) {
      console.warn("ℹ️ No leaves found for this user.");
      return res.status(404).json({ message: 'No leave records found.' });
    }

    console.log(`✅ Found ${leaves.length} leave(s)`);
    res.status(200).json({ leaves });

  } catch (err) {
    console.error("❌ Error in getMyLeaves controller:", err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

// 🔹 Get All Leaves (Admin only, optional date filter)
// exports.getAllLeaves = async (req, res) => {
//   console.log("➡️ getAllLeaves controller called (admin)");

//   try {
//     const { date } = req.query;
//     const filter = {};

//     if (date) {
//       const targetDate = new Date(date);
//       targetDate.setHours(0, 0, 0, 0);
//       const nextDay = new Date(targetDate);
//       nextDay.setDate(targetDate.getDate() + 1);
//       filter.startDate = { $gte: targetDate, $lt: nextDay };
//     }

//     const leaves = await Leave.find(filter)
//       .populate('user', 'name email role')
//       .sort({ createdAt: -1 });

//     console.log(`✅ Found ${leaves.length} leave(s)`);
//     res.status(200).json({ leaves });

//   } catch (err) {
//     console.error("❌ Error in getAllLeaves controller:", err.message);
//     res.status(500).json({ error: 'Server error' });
//   }
// };

// 🔹 Get All Leaves (Admin only, optional date & status filter)
exports.getAllLeaves = async (req, res) => {
  console.log("➡️ getAllLeaves controller called (admin)");

  try {
    const { date, status } = req.query;
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
    if (status) {
      const normalizedStatus = status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
      const allowedStatuses = ['Pending', 'Approved', 'Rejected'];
      if (allowedStatuses.includes(normalizedStatus)) {
        filter.status = normalizedStatus;
      } else {
        console.warn("⚠️ Invalid status filter value");
        return res.status(400).json({ error: 'Invalid status filter value.' });
      }
    }

    const leaves = await Leave.find(filter)
      .populate('user', 'name email role')
      .sort({ createdAt: -1 });

    console.log(`✅ Found ${leaves.length} leave(s)`);
    res.status(200).json({ leaves });

  } catch (err) {
    console.error("❌ Error in getAllLeaves controller:", err.message);
    res.status(500).json({ error: 'Server error' });
  }
};


// 🔹 Delete Leave (Admin only)
exports.deleteLeave = async (req, res) => {
  console.log("➡️ deleteLeave controller called (admin)");

  try {
    const { id } = req.params;

    const leave = await Leave.findById(id);
    if (!leave) {
      console.warn("⚠️ Leave not found");
      return res.status(404).json({ error: 'Leave not found.' });
    }

    await leave.deleteOne();

    console.log("🗑️ Leave deleted successfully");
    res.status(200).json({ message: 'Leave deleted successfully.' });

  } catch (err) {
    console.error("❌ Error in deleteLeave controller:", err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

// 🔹 Update Leave Status (Admin only)
exports.updateLeaveStatus = async (req, res) => {
  console.log("➡️ updateLeaveStatus controller called (admin)");

  try {
    const { id } = req.params;
    const { status } = req.body;

    const allowedStatuses = ['Pending', 'Approved', 'Rejected'];
    const normalizedStatus = status?.charAt(0).toUpperCase() + status?.slice(1).toLowerCase();

    if (!allowedStatuses.includes(normalizedStatus)) {
      console.warn("⚠️ Invalid status value received");
      return res.status(400).json({ error: 'Invalid status value.' });
    }

    const leave = await Leave.findById(id);
    if (!leave) {
      console.warn("⚠️ Leave not found");
      return res.status(404).json({ error: 'Leave not found.' });
    }

    leave.status = normalizedStatus;
    await leave.save();

    console.log(`✅ Leave status updated to ${normalizedStatus}`);
    res.status(200).json({ message: 'Leave status updated.', leave });

  } catch (err) {
    console.error("❌ Error in updateLeaveStatus controller:", err.message);
    res.status(500).json({ error: 'Server error' });
  }
};
