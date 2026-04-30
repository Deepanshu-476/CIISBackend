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

    // ✅ Check role (case insensitive - "employee", "Owner", "client")
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

    const [
      todayAttendance,
      leaveRequests,
      assetRequests,
      assignedTasks,
      meetings,
      holidays,
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
        .select("startDate endDate type status reason createdAt")
        .lean(),

      AssetRequest.find({
        user: userId,
        companyCode: companyCode,
      })
        .sort({ createdAt: -1 })
        .limit(10)
        .select("assetName requestType status reason adminComments createdAt")
        .lean(),

      Task.find({
        assigneeId: userId,
        companyCode: companyCode,
      })
        .sort({ createdAt: -1 })
        .limit(10)
        .select("name description priority status dueDate createdAt")
        .lean(),

      Meeting.find({
        companyCode: companyCode,
        attendees: userId,
      })
        .sort({ date: -1, time: -1 })
        .limit(10)
        .select("title description date time status createdBy createdAt")
        .lean(),

      Holiday.find({
        companyCode: companyCode,
        date: { $gte: new Date(new Date().setMonth(new Date().getMonth() - 1)) },
      })
        .sort({ date: 1 })
        .limit(20)
        .select("title date description")
        .lean(),
    ]);

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
      meetings,
      holidays
    );

    return {
      attendance: attendanceStatus,
      leaves: leaveRequests,
      assets: assetRequests,
      tasks: assignedTasks,
      meetings: meetings,
      holidays: holidays,
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

    const [
      allEmployees,
      todayAttendance,
      monthlyAttendance,
      leaveRequests,
      assetRequests,
      ownerTasks,
      meetings,
      holidays,
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
      })
        .sort({ createdAt: -1 })
        .limit(10)
        .populate("user", "name email employeeId")
        .select("user startDate endDate type status reason createdAt")
        .lean(),

      AssetRequest.find({
        companyCode: companyCode,
      })
        .sort({ createdAt: -1 })
        .limit(10)
        .populate("user", "name email employeeId")
        .select("user assetName requestType status reason adminComments createdAt")
        .lean(),

      Task.find({
        createdBy: ownerId,
        companyCode: companyCode,
      })
        .sort({ createdAt: -1 })
        .limit(10)
        .populate("assigneeId", "name email")
        .select("name description priority status dueDate assigneeId createdAt")
        .lean(),

      Meeting.find({
        companyCode: companyCode,
      })
        .sort({ date: -1, createdAt: -1 })
        .limit(10)
        .populate("createdBy", "name email")
        .select("title description date time status createdBy attendees createdAt")
        .lean(),

      Holiday.find({
        companyCode: companyCode,
        date: { $gte: new Date(new Date().setMonth(new Date().getMonth() - 1)) },
      })
        .sort({ date: 1 })
        .limit(20)
        .select("title date description")
        .lean(),
    ]);

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

    const recentActivity = formatOwnerActivities(
      leaveRequests,
      assetRequests,
      ownerTasks,
      meetings,
      holidays
    );

    return {
      attendanceSummary,
      leaves: leaveRequests,
      assets: assetRequests,
      tasks: ownerTasks,
      meetings: meetings,
      holidays: holidays,
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
    })
      .sort({ updatedAt: -1 })
      .limit(10)
      .populate("createdBy", "name email")
      .select(
        "name description priority status dueDate updatedAt createdAt createdBy"
      )
      .lean();

    const recentActivity = clientTasks.map((task) => ({
      type: "task_update",
      title: task.name,
      status: task.status,
      priority: task.priority,
      date: task.updatedAt || task.createdAt,
      description: task.description,
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
  meetings,
  holidays
) => {
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
    activities.push({
      type: "leave",
      title: `Leave Request ${leave.status}`,
      status: leave.status,
      date: leave.createdAt,
      details: `${leave.type} leave from ${new Date(
        leave.startDate
      ).toLocaleDateString()} to ${new Date(leave.endDate).toLocaleDateString()}`,
    });
  });

  assets.forEach((asset) => {
    activities.push({
      type: "asset",
      title: `Asset Request ${asset.status}`,
      status: asset.status,
      date: asset.createdAt,
      details: `${asset.assetName} (${asset.requestType})`,
    });
  });

  tasks.forEach((task) => {
    activities.push({
      type: "task",
      title: `Task: ${task.name}`,
      status: task.status,
      priority: task.priority,
      date: task.createdAt,
      details: `Due: ${
        task.dueDate ? new Date(task.dueDate).toLocaleDateString() : "No due date"
      }`,
    });
  });

  meetings.forEach((meeting) => {
    activities.push({
      type: "meeting",
      title: `Meeting: ${meeting.title}`,
      date: meeting.date || meeting.createdAt,
      details: `${meeting.time}`,
    });
  });

  holidays.forEach((holiday) => {
    activities.push({
      type: "holiday",
      title: `Holiday: ${holiday.title}`,
      date: holiday.date,
      details: holiday.description,
    });
  });

  return activities.sort((a, b) => new Date(b.date) - new Date(a.date));
};

const formatOwnerActivities = (leaves, assets, tasks, meetings, holidays) => {
  const activities = [];

  leaves.forEach((leave) => {
    activities.push({
      type: "leave_request",
      title: `Leave Request - ${leave.status}`,
      user: leave.user?.name || "Unknown",
      status: leave.status,
      date: leave.createdAt,
      details: `${leave.type} leave request`,
    });
  });

  assets.forEach((asset) => {
    activities.push({
      type: "asset_request",
      title: `Asset Request - ${asset.status}`,
      user: asset.user?.name || "Unknown",
      status: asset.status,
      date: asset.createdAt,
      details: `${asset.assetName} request`,
    });
  });

  tasks.forEach((task) => {
    activities.push({
      type: "task_created",
      title: `Task Created: ${task.name}`,
      assignedTo: task.assigneeId?.name || "Unassigned",
      status: task.status,
      date: task.createdAt,
      details: `Priority: ${task.priority}`,
    });
  });

  meetings.forEach((meeting) => {
    activities.push({
      type: "meeting_scheduled",
      title: `Meeting Scheduled: ${meeting.title}`,
      createdBy: meeting.createdBy?.name || "Unknown",
      date: meeting.createdAt,
      details: `${new Date(meeting.date).toLocaleDateString()} at ${meeting.time}`,
    });
  });

  holidays.forEach((holiday) => {
    activities.push({
      type: "holiday",
      title: `Upcoming Holiday: ${holiday.title}`,
      date: holiday.date,
      details: holiday.description,
    });
  });

  return activities.sort((a, b) => new Date(b.date) - new Date(a.date));
};

module.exports = {
  getDashboardActivity,
};