const mongoose = require("mongoose");
const Attendance = require("../models/Attendance");
const Leave = require("../models/Leave");
const AssetRequest = require("../models/AssetRequest");
const Task = require("../models/ClientTask");
const Meeting = require("../models/Meeting");
const Holiday = require("../models/Holiday");
const User = require("../../models/User");

const getDashboardActivity = async (req, res) => {
  try {
    // ✅ USE companyRole instead of jobRole
    const { companyRole: role, _id: userId, companyCode } = req.user;

    console.log("📊 Dashboard Request:", { 
      role: role, 
      userId: userId, 
      companyCode: companyCode 
    });

    if (!companyCode) {
      return res.status(400).json({
        success: false,
        message: "Company code not found for user",
      });
    }

    let responseData = {};

    // ✅ Check role (case insensitive)
    const userRole = (role || "").toLowerCase();
    
    if (userRole === "employee") {
      console.log("✅ Fetching employee dashboard");
      responseData = await getEmployeeDashboard(userId, companyCode);
    } else if (userRole === "owner") {
      console.log("✅ Fetching owner dashboard");
      responseData = await getOwnerDashboard(companyCode, userId);
    } else if (userRole === "client") {
      console.log("✅ Fetching client dashboard");
      responseData = await getClientDashboard(userId, companyCode);
    } else {
      console.log("❌ Unknown role:", role);
      return res.status(403).json({
        success: false,
        message: `Invalid user role: ${role}. Valid roles: employee, owner, client`,
      });
    }

    res.status(200).json({
      success: true,
      role: role,
      data: responseData,
    });
  } catch (error) {
    console.error("Dashboard activity error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch dashboard activity",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

const getEmployeeDashboard = async (userId, companyCode) => {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Convert userId to ObjectId if it's a string
    const userObjectId = typeof userId === 'string' 
      ? new mongoose.Types.ObjectId(userId) 
      : userId;
    
    const [
      todayAttendance,
      leaveRequests,
      assetRequests,
      assignedTasks,
      meetings,
    ] = await Promise.all([
      Attendance.findOne({
        user: userId,
        companyCode: companyCode,
        date: { $gte: todayStart, $lte: todayEnd },
      })
        .select("status date inTime outTime")
        .lean(),

      Leave.find({
        user: userId,
        companyCode: companyCode,
      })
        .sort({ createdAt: -1 })
        .limit(10)
        .populate("user", "name email employeeId")
        .select("user startDate endDate type status reason createdAt")
        .lean(),

      AssetRequest.find({
        user: userId,
        companyCode: companyCode,
      })
        .sort({ createdAt: -1 })
        .limit(10)
        .populate("user", "name email employeeId")
        .select("user assetName requestType status reason adminComments createdAt")
        .lean(),

      // ✅ FIXED: Case insensitive taskFor with debug
      Task.find({
        assignedUsers: { $in: [userObjectId] },
        companyCode: companyCode,
        taskFor: { $in: ["others", "Others", "other", "Other"] }
      })
        .sort({ createdAt: -1 })
        .limit(10)
        .populate("assignedUsers", "name email")
        .populate("createdBy", "name email")
        .select("title description priority dueDateTime createdAt updatedAt assignedUsers createdBy overallStatus statusHistory taskFor isActive")
        .lean(),

      Meeting.find({
        companyCode: companyCode,
        attendees: userId, 
        date: { $gte: today }
      })
        .sort({ date: -1, time: -1 })
        .limit(10)
        .populate("createdBy", "name email")
        .select("title description date time status createdBy createdAt")
        .lean(),
    ]);

    // ✅ Debug log
    console.log("📊 Employee Tasks Found:", assignedTasks.length);
    console.log("📊 Employee Tasks Details:", assignedTasks.map(t => ({
      title: t.title,
      taskFor: t.taskFor,
      status: t.overallStatus,
      isActive: t.isActive,
      assignedUsers: t.assignedUsers
    })));

    const attendanceStatus = todayAttendance
      ? {
          status: todayAttendance.status,
          date: todayAttendance.date,
          inTime: todayAttendance.inTime,
          outTime: todayAttendance.outTime,
        }
      : {
          status: "NOT_CLOCKED_IN",
          date: new Date(),
          message: "No attendance record for today",
        };

    const recentActivity = formatEmployeeActivities(
      attendanceStatus,
      leaveRequests,
      assetRequests,
      assignedTasks,
      meetings
    );

    return {
      attendance: attendanceStatus,
      leaves: leaveRequests,
      assets: assetRequests,
      tasks: assignedTasks,
      meetings: meetings,
      recentActivity: recentActivity.slice(0, 10),
    };
  } catch (error) {
    console.error("Employee dashboard error:", error);
    throw error;
  }
};

const getOwnerDashboard = async (companyCode, ownerId) => {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const monthEnd = new Date();
    monthEnd.setMonth(monthEnd.getMonth() + 1);
    monthEnd.setDate(0);
    monthEnd.setHours(23, 59, 59, 999);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // 🔍 DEBUG: Check all tasks first
    const allTasksInCompany = await Task.find({
      companyCode: companyCode
    }).lean();
    
    console.log("🔍 ALL TASKS IN COMPANY:", allTasksInCompany.map(t => ({
      id: t._id,
      title: t.title,
      taskFor: t.taskFor,
      overallStatus: t.overallStatus,
      isActive: t.isActive,
      companyCode: t.companyCode
    })));
    
    const [
      allEmployees,
      todayAttendance,
      monthlyAttendance,
      leaveRequests,
      assetRequests,
      ownerTasks,
      meetings
    ] = await Promise.all([
    
      User.find({
        companyCode: companyCode,
        companyRole: "employee",
        isActive: true,
      }).select("_id name email employeeId companyRole"),

      Attendance.find({
        companyCode: companyCode,
        date: { $gte: todayStart, $lte: todayEnd },
      }).lean(),

      Attendance.aggregate([
        {
          $match: {
            companyCode: companyCode,
            date: { $gte: monthStart, $lte: monthEnd },
          },
        },
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
          },
        },
      ]),
      
      Leave.find({
        companyCode: companyCode,
        status: "Pending"
      })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate("user", "name email employeeId")
      .select("user startDate endDate type status reason createdAt approvedBy remarks")
      .lean(),

      AssetRequest.find({
        companyCode: companyCode,
        status: "pending"
      })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate("user", "name email employeeId")
      .populate("approvedBy", "name email")
      .select("user assetName asset assetType requestType status reason adminComments createdAt approvedBy")
      .lean(),

      // ✅ FIXED: Include isActive check and better filtering
      Task.find({
        companyCode: companyCode,
        taskFor: { $in: ["others", "Others", "other", "Other"] },
        isActive: { $ne: false } // Include if not explicitly false
      })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate("assignedUsers", "name email")
      .populate("createdBy", "name email")
      .select("title description priority dueDateTime createdAt updatedAt assignedUsers createdBy overallStatus statusHistory taskFor isActive")
      .lean(),

      Meeting.find({
        companyCode: companyCode,
        date: { $gte: today }
      })
      .sort({ date: -1, createdAt: -1 })
      .limit(10)
      .populate("createdBy", "name email")
      .populate("attendees", "name email")
      .select("title description date time status createdBy attendees createdAt")
      .lean(),
    ]);
    
    console.log("🔍 OWNER TASKS AFTER QUERY:", ownerTasks.length);
    console.log("🔍 OWNER TASKS DETAILS:", ownerTasks.map(t => ({
      title: t.title,
      taskFor: t.taskFor,
      overallStatus: t.overallStatus,
      isActive: t.isActive
    })));

    const presentCount = todayAttendance.filter((a) => a.status === "PRESENT").length;
    const lateCount = todayAttendance.filter((a) => a.status === "LATE").length;
    const absentCount = todayAttendance.filter((a) => a.status === "ABSENT").length;
    const halfDayCount = todayAttendance.filter((a) => a.status === "HALF DAY").length;

    const monthlyStats = {
      present: monthlyAttendance.find((m) => m._id === "PRESENT")?.count || 0,
      late: monthlyAttendance.find((m) => m._id === "LATE")?.count || 0,
      absent: monthlyAttendance.find((m) => m._id === "ABSENT")?.count || 0,
      halfDay: monthlyAttendance.find((m) => m._id === "HALF DAY")?.count || 0,
    };

    const attendanceSummary = {
      totalEmployees: allEmployees.length,
      today: {
        present: presentCount,
        late: lateCount,
        absent: absentCount,
        halfDay: halfDayCount,
        notClockedIn: allEmployees.length - (presentCount + lateCount + absentCount + halfDayCount),
      },
      monthly: monthlyStats,
    };

    console.log("📊 Owner Dashboard Data:", {
      leaveCount: leaveRequests.length,
      assetCount: assetRequests.length,
      taskCount: ownerTasks.length,
      meetingCount: meetings.length
    });

    const recentActivity = formatOwnerActivities(
      leaveRequests,
      assetRequests,
      ownerTasks,
      meetings
    );

    return {
      attendanceSummary,
      leaves: leaveRequests,
      assets: assetRequests,
      tasks: ownerTasks,
      meetings: meetings,
      recentActivity: recentActivity.slice(0, 10),
    };
  } catch (error) {
    console.error("Owner dashboard error:", error);
    throw error;
  }
};

const getClientDashboard = async (userId, companyCode) => {
  try {
    const clientTasks = await Task.find({
      clientId: userId,
      companyCode: companyCode,
      taskFor: { $in: ["others", "Others"] }
    })
      .sort({ updatedAt: -1 })
      .limit(10)
      .populate("createdBy", "name email")
      .populate("assignedUsers", "name email")
      .select(
        "title description priority overallStatus dueDateTime updatedAt createdAt createdBy assignedUsers taskFor"
      )
      .lean();

    const recentActivity = clientTasks.map((task) => ({
      type: "task_update",
      title: task.title,
      status: task.overallStatus,
      priority: task.priority,
      date: task.updatedAt || task.createdAt,
      description: task.description,
      createdBy: task.createdBy?.name,
      assignee: task.assignedUsers?.map(u => u.name).join(", "),
    }));

    return {
      tasks: clientTasks,
      recentActivity: recentActivity.slice(0, 10),
    };
  } catch (error) {
    console.error("Client dashboard error:", error);
    throw error;
  }
};

const formatEmployeeActivities = (
  attendance,
  leaves,
  assets,
  tasks,
  meetings
) => {
  const now = new Date();                  
  const TWELVE_HOURS = 12 * 60 * 60 * 1000;
  const activities = [];

  if (attendance && attendance.status !== "NOT_CLOCKED_IN") {
    activities.push({
      type: "attendance",
      title: `Attendance: ${attendance.status}`,
      status: attendance.status,
      date: attendance.date,
      details: attendance.inTime
        ? `Clocked in at ${new Date(attendance.inTime).toLocaleTimeString()}`
        : null,
    });
  }

  leaves.forEach((leave) => {
    if (
      leave.status.toLowerCase() === "approved" &&
      now - new Date(leave.createdAt) > TWELVE_HOURS
    ) {
      return;
    }
    if (leave.user) {
      activities.push({
        type: "leave",
        title: `Leave Request ${leave.status}`,
        status: leave.status,
        date: leave.createdAt,
        userName: leave.user.name,
        userEmail: leave.user.email,
        employeeId: leave.user.employeeId,
        details: `${leave.type} leave from ${new Date(
          leave.startDate
        ).toLocaleDateString()} to ${new Date(leave.endDate).toLocaleDateString()}`,
        reason: leave.reason,
      });
    }
  });

  assets.forEach((asset) => {
    if (
      asset.status.toLowerCase() === "approved" &&
      now - new Date(asset.createdAt) > TWELVE_HOURS
    ) {
      return;
    }
    if (asset.user) {
      activities.push({
        type: "asset",
        title: `Asset Request ${asset.status}`,
        status: asset.status,
        date: asset.createdAt,
        userName: asset.user.name,
        userEmail: asset.user.email,
        employeeId: asset.user.employeeId,
        details: `${asset.assetName} (${asset.requestType})`,
        reason: asset.reason,
      });
    }
  });

  tasks.forEach((task) => {
    // Skip completed tasks
    if (task.overallStatus === "completed") {
      return;
    }
    
    // Skip if task is inactive
    if (task.isActive === false) {
      return;
    }
    
    let dueDateText = "No due date";
    if (task.dueDateTime) {
      try {
        dueDateText = new Date(task.dueDateTime).toLocaleDateString();
      } catch(e) {
        dueDateText = "Invalid date";
      }
    }
    
    activities.push({
      type: "task",
      title: `Task: ${task.title}`,
      status: task.overallStatus,
      priority: task.priority,
      date: task.updatedAt || task.createdAt,
      details: `Due: ${dueDateText}`,
      assignedTo: task.assignedUsers?.map(u => u.name).join(", "),
      createdBy: task.createdBy?.name,
    });
  });

  meetings.forEach((meeting) => {
    activities.push({
      type: "meeting",
      title: `Meeting: ${meeting.title}`,
      date: meeting.date || meeting.createdAt,
      details: `${meeting.time}`,
      createdBy: meeting.createdBy?.name,
    });
  });

  return activities.sort((a, b) => new Date(b.date) - new Date(a.date));
};

const formatOwnerActivities = (leaves, assets, tasks, meetings) => {
  const activities = [];

  leaves.forEach((leave) => {
    if (leave.user) {
      activities.push({
        type: "leave_request",
        title: `Leave Request - ${leave.status}`,
        userName: leave.user.name,
        userEmail: leave.user.email,
        employeeId: leave.user.employeeId,
        status: leave.status,
        date: leave.createdAt,
        details: `${leave.type} leave from ${new Date(
          leave.startDate
        ).toLocaleDateString()} to ${new Date(leave.endDate).toLocaleDateString()}`,
        reason: leave.reason,
      });
    }
  });

  assets.forEach((asset) => {
    if (asset.user) {
      activities.push({
        type: "asset_request",
        title: `Asset Request - ${asset.status}`,
        userName: asset.user.name,
        userEmail: asset.user.email,
        employeeId: asset.user.employeeId,
        status: asset.status,
        date: asset.createdAt,
        details: `${asset.assetName} (${asset.requestType})`,
        reason: asset.reason,
      });
    }
  });

  const now = new Date();
  const TWELVE_HOURS = 12 * 60 * 60 * 1000;

  tasks.forEach((task) => {
    // Skip completed tasks older than 12 hours
    if (
      task.overallStatus === "completed" &&
      now - new Date(task.updatedAt || task.createdAt) > TWELVE_HOURS
    ) {
      return;
    }
    
    // Skip if task is inactive
    if (task.isActive === false) {
      return;
    }
    
    let dueDateText = "No due date";
    if (task.dueDateTime) {
      try {
        dueDateText = new Date(task.dueDateTime).toLocaleDateString();
      } catch(e) {
        dueDateText = "Invalid date";
      }
    }
    
    // Show task
    activities.push({
      type: "task",
      title: `Task: ${task.title}`,
      status: task.overallStatus,
      priority: task.priority,
      date: task.updatedAt || task.createdAt,
      details: `Due: ${dueDateText}`,
      assignedTo: task.assignedUsers?.map(u => u.name).join(", "),
      createdBy: task.createdBy?.name,
    });

    // Show status changes
    if (task.statusHistory && task.statusHistory.length > 0) {
      task.statusHistory.forEach((history) => {
        activities.push({
          type: "task_status",
          title: `Status Changed`,
          status: history.status,
          date: history.changedAt || history.createdAt,
          details: history.remarks || `Status changed to ${history.status}`,
        });
      });
    }
  });

  meetings.forEach((meeting) => {
    activities.push({
      type: "meeting",
      title: `Meeting: ${meeting.title}`,
      createdBy: meeting.createdBy?.name || "Unknown",
      date: meeting.date || meeting.createdAt,
      details: `${meeting.time}`,
    });
  });

  return activities.sort((a, b) => new Date(b.date) - new Date(a.date));
};

module.exports = {
  getDashboardActivity,
};