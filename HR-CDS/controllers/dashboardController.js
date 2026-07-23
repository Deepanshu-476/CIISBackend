const mongoose = require("mongoose");
const Attendance = require("../models/Attendance");
const Leave = require("../models/Leave");
const AssetRequest = require("../models/AssetRequest");
const Task = require("../models/ClientTask");
const EmployeeTask = require("../models/Task");
const Meeting = require("../models/Meeting");
const Holiday = require("../models/Holiday");
const User = require("../../models/User");
const Company = require("../../models/Company");
const Branch = require("../../models/Branch");
const JobRole = require("../../models/JobRole");

const formatIndiaTime = value => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  });
};

const getTodayRange = () => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return {start, end};
};

const getScopedCompanyId = user => {
  const company = user?.company;
  return company?._id || company || user?.companyId || null;
};

const getScopedBranchId = user => {
  const branch = user?.branch || user?.branchId;
  return branch?._id || branch || null;
};

const normalizeRoleForDashboard = role => ({
  _id: role._id || role.id || "employee",
  roleName: role.roleName || role.name || role.jobRole || role.title || "Employee",
  roleNumber: role.roleNumber || role.roleNo || role.code || "N/A",
});

const mapTaskActivity = task => ({
  type: "task",
  title: task.title || task.name || "Task",
  date: task.updatedAt || task.createdAt || task.dueDateTime,
  assignedTo: task.assignedUsers?.map(user => user.name).filter(Boolean).join(", ") || "",
  status: task.overallStatus || task.status || task.creatorStatus?.status || "pending",
});

const getEmployeeDashboardSummary = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const companyId = getScopedCompanyId(req.user);
    const branchId = getScopedBranchId(req.user);
    const companyCode = String(req.user.companyCode || req.user.company?.companyCode || "").trim();

    if (!userId || !companyCode) {
      return res.status(400).json({
        success: false,
        message: "User or company context missing",
      });
    }

    const {start: todayStart, end: todayEnd} = getTodayRange();

    const [
      company,
      jobRoles,
      holidays,
      attendance,
      todayAttendance,
      leaves,
      tasks,
    ] = await Promise.all([
      companyId ? Company.findById(companyId).select("dashboardConfig officeLocation").lean() : null,
      JobRole.find({
        isActive: true,
        ...(companyId ? {company: companyId} : {companyCode}),
      }).select("_id name roleName roleNumber roleNo code jobRole title shiftSettings department").lean(),
      Holiday.find({
        isActive: true,
        $or: [
          {companyCode},
          ...(companyId ? [{company: companyId}] : []),
        ],
      }).sort({date: 1}).lean(),
      Attendance.find({user: userId, companyCode}).sort({date: -1}).lean(),
      Attendance.findOne({
        user: userId,
        companyCode,
        date: {$gte: todayStart, $lte: todayEnd},
      }).lean(),
      Leave.find({user: userId})
        .populate("user", "name email jobRole department")
        .populate("approvalSteps.user", "name email jobRole companyRole")
        .populate("history.by", "name email")
        .sort({startDate: -1})
        .lean(),
      EmployeeTask.find({
        companyCode,
        isActive: {$ne: false},
        $or: [
          {createdBy: userId},
          {assignedUsers: userId},
          {"statusByUser.user": userId},
        ],
      })
        .populate("assignedUsers", "name email")
        .sort({updatedAt: -1, createdAt: -1})
        .limit(8)
        .lean(),
    ]);
    const branch = branchId ? await Branch.findById(branchId).select("dashboardConfig officeLocation").lean() : null;
    const scopedDashboardConfig = branch?.dashboardConfig?.length ? branch.dashboardConfig : (company?.dashboardConfig || []);

    const attendanceStatus = todayAttendance
      ? {
          ...todayAttendance,
          login: formatIndiaTime(todayAttendance.inTime),
          logout: formatIndiaTime(todayAttendance.outTime),
          status: todayAttendance.status,
          isClockedIn: Boolean(todayAttendance.isClockedIn),
        }
      : {
          isClockedIn: false,
          message: "No attendance recorded yet",
        };

    return res.status(200).json({
      success: true,
      data: {
        dashboardConfig: scopedDashboardConfig,
        jobRoles: jobRoles.map(normalizeRoleForDashboard),
        holidays,
        attendance,
        attendanceStatus,
        leaves,
        recentTasks: tasks,
        recentActivity: tasks.map(mapTaskActivity),
      },
    });
  } catch (error) {
    console.error("Employee dashboard summary error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch dashboard summary",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

const getDashboardActivity = async (req, res) => {
  try {
    
    const { companyRole: role, _id: userId, companyCode } = req.user;

    void 0;

    if (!companyCode) {
      return res.status(400).json({
        success: false,
        message: "Company code not found for user",
      });
    }

    let responseData = {};

    
    const userRole = (role || "").toLowerCase();
    
    if (userRole === "employee") {
      void 0;
      responseData = await getEmployeeDashboard(userId, companyCode);
    } else if (userRole === "owner") {
      void 0;
      responseData = await getOwnerDashboard(companyCode, userId);
    } else if (userRole === "client") {
      void 0;
      responseData = await getClientDashboard(userId, companyCode);
    } else {
      void 0;
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

    
    const leaveCount = await Leave.countDocuments({ 
      user: userId, 
      companyCode: companyCode 
    });
    const taskCount = await Task.countDocuments({ 
      assigneeId: userId, 
      companyCode: companyCode 
    });
    const assetCount = await AssetRequest.countDocuments({ 
      user: userId, 
      companyCode: companyCode 
    });
    
    void 0;

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

      Task.find({
        assignedUsers: userId,
        companyCode: companyCode,
      })
        .sort({ createdAt: -1 })
        .limit(10)
        .populate("assignedUsers", "name email")
        .populate("createdBy", "name email")
        .select("name description priority status dueDate createdAt assigneeId createdBy")
        .lean(),

      Meeting.find({
        companyCode: companyCode,
        attendees: userId,
      })
        .sort({ date: -1, time: -1 })
        .limit(10)
        .populate("createdBy", "name email")
        .select("title description date time status createdBy createdAt")
        .lean(),
    ]);

    void 0;

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

      
      Task.find({
        companyCode: companyCode,
        $or: [
          { createdBy: ownerId },
          { assignedUsers: ownerId }
        ]
      })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate("assignedUsers", "name email")
      .populate("createdBy", "name email")
      .select("name description priority status dueDate assigneeId createdBy createdAt")
      .lean(),

      Meeting.find({
        companyCode: companyCode,
      })
      .sort({ date: -1, createdAt: -1 })
      .limit(10)
      .populate("createdBy", "name email")
      .populate("attendees", "name email")
      .select("title description date time status createdBy attendees createdAt")
      .lean(),
    ]);

    const presentCount = todayAttendance.filter((a) => a.status === "PRESENT").length;
    const lateCount = todayAttendance.filter((a) => a.status === "LATE").length;
    const absentCount = todayAttendance.filter((a) => a.status === "ABSENT").length;
    const halfDayCount = todayAttendance.filter((a) => ["HALF DAY", "HALFDAY"].includes(a.status)).length;

    const monthlyStats = {
      present: monthlyAttendance.find((m) => m._id === "PRESENT")?.count || 0,
      late: monthlyAttendance.find((m) => m._id === "LATE")?.count || 0,
      absent: monthlyAttendance.find((m) => m._id === "ABSENT")?.count || 0,
      halfDay: monthlyAttendance
        .filter((m) => ["HALF DAY", "HALFDAY"].includes(m._id))
        .reduce((total, item) => total + item.count, 0),
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

    void 0;

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
    })
      .sort({ updatedAt: -1 })
      .limit(10)
      .populate("createdBy", "name email")
      .populate("assignedUsers", "name email")
      .select(
        "name description priority status dueDate updatedAt createdAt createdBy assigneeId"
      )
      .lean();

    const recentActivity = clientTasks.map((task) => ({
      type: "task_update",
      title: task.name,
      status: task.status,
      priority: task.priority,
      date: task.updatedAt || task.createdAt,
      description: task.description,
      createdBy: task.createdBy?.name,
      assignee: task.assigneeId?.name,
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
  const activities = [];

  if (attendance && attendance.status !== "NOT_CLOCKED_IN") {
    activities.push({
      type: "attendance",
      title: `Attendance: ${attendance.status}`,
      status: attendance.status,
      date: attendance.date,
      details: attendance.inTime
        ? `Clocked in at ${formatIndiaTime(attendance.inTime)}`
        : null,
    });
  }

  leaves.forEach((leave) => {
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
    activities.push({
      type: "task",
      title: `Task: ${task.name}`,
      status: task.status,
      priority: task.priority,
      date: task.updatedAt || task.createdAt,
      details: `Due: ${
        task.dueDate ? new Date(task.dueDate).toLocaleDateString() : "No due date"
      }`,
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

  tasks.forEach((task) => {

  
  activities.push({
    type: "task",
    title: `Task: ${task.name}`,
    status: task.status,
    priority: task.priority,
    date: task.updatedAt || task.createdAt,   
    details: `Due: ${
      task.dueDate ? new Date(task.dueDate).toLocaleDateString() : "No due date"
    }`,
    assignedTo: task.assignedUsers?.map(u => u.name).join(", "),
    createdBy: task.createdBy?.name,
  });

  
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
  getEmployeeDashboardSummary,
};
