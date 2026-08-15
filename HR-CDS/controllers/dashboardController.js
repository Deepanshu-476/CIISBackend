const mongoose = require("mongoose");
const Attendance = require("../models/Attendance");
const Leave = require("../models/Leave");
const AssetRequest = require("../models/AssetRequest");
const Task = require("../models/ClientTask");
const EmployeeTask = require("../models/Task");
const {Project} = require("../models/Project");
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

const INDIA_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const getTodayRange = (value = new Date()) => {
  const indiaTime = new Date(value.getTime() + INDIA_OFFSET_MS);
  const indiaYear = indiaTime.getUTCFullYear();
  const indiaMonth = indiaTime.getUTCMonth();
  const indiaDate = indiaTime.getUTCDate();
  const start = new Date(Date.UTC(indiaYear, indiaMonth, indiaDate) - INDIA_OFFSET_MS);
  const end = new Date(start.getTime() + (24 * 60 * 60 * 1000) - 1);
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
  shifts: role.shifts || [],
  shiftSettings: role.shiftSettings,
});

const normalizeShiftForDashboard = shift => {
  if (!shift) return null;
  return {
    shiftId: String(shift.shiftId || shift._id || shift.id || ""),
    shiftName: shift.shiftName || shift.name || "Assigned Shift",
    shiftType: shift.shiftType || "custom",
    shiftStart: shift.shiftStart || "09:00",
    shiftEnd: shift.shiftEnd || "19:00",
  };
};

const mapTaskActivity = task => ({
  type: "task",
  title: task.title || task.name || "Task",
  date: task.updatedAt || task.createdAt || task.dueDateTime,
  assignedTo: task.assignedUsers?.map(user => user.name).filter(Boolean).join(", ") || "",
  status: task.overallStatus || task.status || task.creatorStatus?.status || "pending",
});

const DAY_MS = 24 * 60 * 60 * 1000;
const startOfDay = value => { const date = new Date(value); date.setHours(0, 0, 0, 0); return date; };
const endOfDay = value => { const date = new Date(value); date.setHours(23, 59, 59, 999); return date; };
const dateKey = value => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const normalizeProductivityStatus = value => String(value || "").trim().toLowerCase().replace(/[_ ]+/g, "-");
const completedStatuses = new Set(["completed", "approved", "done"]);
const excludedTaskStatuses = new Set(["cancelled", "rejected"]);

const getProductivityRange = query => {
  const today = startOfDay(new Date());
  const period = String(query.period || "weekly");
  let start;
  let end = endOfDay(today);
  if (period === "custom") {
    start = startOfDay(query.from);
    end = endOfDay(query.to);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new Error("Please select a valid from and to date");
  } else if (period === "today") {
    start = startOfDay(today);
    end = new Date();
  } else if (period === "monthly") {
    start = new Date(today.getFullYear(), today.getMonth(), 1);
  } else if (period === "sixMonths") {
    start = new Date(today.getFullYear(), today.getMonth() - 5, 1);
  } else if (period === "yearly") {
    start = new Date(today.getFullYear(), today.getMonth() - 11, 1);
  } else {
    start = new Date(today.getTime() - (6 * DAY_MS));
  }
  if (start > end) throw new Error("From date cannot be after to date");
  if (end > endOfDay(today)) end = endOfDay(today);
  if ((end - start) / DAY_MS > 366) throw new Error("Date range cannot exceed 366 days");
  return {start, end, period};
};

const getTaskCompletionDate = (task, userId) => {
  const userStatus = (task.statusByUser || []).find(item => String(item.user) === String(userId));
  const status = normalizeProductivityStatus(userStatus?.status || task.overallStatus);
  if (!completedStatuses.has(status)) return null;
  const history = [...(task.statusHistory || [])].reverse().find(item => completedStatuses.has(normalizeProductivityStatus(item.status)));
  const value = userStatus?.updatedAt || task.completionDate || history?.changedAt || task.updatedAt;
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
};

const productivityBand = score => score >= 90 ? ["Excellent", "high"] : score >= 75 ? ["Very Good", "high"] : score >= 60 ? ["Good", "good"] : score >= 40 ? ["Needs Improvement", "warning"] : ["Poor", "danger"];

const calculateProductivityMetrics = ({start, end, attendance, tasks, excludedDates, userId}) => {
  const attendanceRows = attendance.filter(row => {
    const date = new Date(row.date || row.inTime || row.createdAt);
    return date >= start && date <= end && !excludedDates.has(dateKey(date));
  });
  const attendancePoints = attendanceRows.map(row => {
    const status = String(row.status || "").trim().toUpperCase().replace("HALFDAY", "HALF DAY");
    return status === "PRESENT" ? 100 : status === "LATE" || status === "SHORT LEAVE" ? 75 : status === "HALF DAY" ? 50 : status === "ABSENT" ? 0 : null;
  }).filter(Number.isFinite);
  const relevantTasks = tasks.filter(task => {
    const statusRow = (task.statusByUser || []).find(item => String(item.user) === String(userId));
    const status = normalizeProductivityStatus(statusRow?.status || task.overallStatus);
    if (excludedTaskStatuses.has(status)) return false;
    const created = new Date(task.createdAt);
    const due = task.dueDateTime ? new Date(task.dueDateTime) : null;
    const completed = getTaskCompletionDate(task, userId);
    const createdInRange = created >= start && created <= end;
    const completedInRange = completed && completed >= start && completed <= end;
    const dueByPeriodEnd = due && due <= end;
    const openDuringRange = !completed || completed >= start;

    // Upcoming work must not reduce the current period's productivity before
    // its due date. Keep completed, due/overdue, and undated current work.
    return completedInRange || (dueByPeriodEnd && openDuringRange) || (!due && createdInRange);
  });
  const completed = relevantTasks.filter(task => { const date = getTaskCompletionDate(task, userId); return date && date <= end; });
  const deliveryEligible = relevantTasks.filter(task => task.dueDateTime && (new Date(task.dueDateTime) <= end || getTaskCompletionDate(task, userId)));
  const onTime = deliveryEligible.filter(task => { const done = getTaskCompletionDate(task, userId); return done && done <= new Date(task.dueDateTime); });
  const components = [
    {key: "taskCompletion", score: relevantTasks.length ? completed.length / relevantTasks.length * 100 : null, weight: 50},
    {key: "onTimeDelivery", score: deliveryEligible.length ? onTime.length / deliveryEligible.length * 100 : null, weight: 25},
    {key: "attendance", score: attendancePoints.length ? attendancePoints.reduce((sum, value) => sum + value, 0) / attendancePoints.length : null, weight: 25},
  ];
  const available = components.filter(item => Number.isFinite(item.score));
  const weight = available.reduce((sum, item) => sum + item.weight, 0);
  const score = weight ? Math.round(available.reduce((sum, item) => sum + item.score * item.weight, 0) / weight) : 0;
  const breakdown = Object.fromEntries(components.map(item => [item.key, Number.isFinite(item.score) ? Math.round(item.score) : null]));
  return {score, hasData: available.length > 0, breakdown, counts: {attendanceDays: attendancePoints.length, tasks: relevantTasks.length, completed: completed.length, onTime: onTime.length, deliveryEligible: deliveryEligible.length}};
};

const buildProductivityBuckets = (start, end, period) => {
  const days = Math.floor((endOfDay(end) - startOfDay(start)) / DAY_MS) + 1;
  const buckets = [];
  if (period === "today") {
    const dayStart = startOfDay(start);
    const workdayStartHour = 9;
    const currentHour = end.getHours();
    if (currentHour < workdayStartHour) return {buckets, granularity: "hourly"};

    const workdayStart = new Date(dayStart);
    workdayStart.setHours(workdayStartHour, 0, 0, 0);
    const hourStep = Math.max(1, Math.ceil((currentHour - workdayStartHour + 1) / 7));
    for (let hour = workdayStartHour; hour <= currentHour; hour += hourStep) {
      const pointEnd = new Date(dayStart);
      pointEnd.setHours(hour, 59, 59, 999);
      const displayHour = hour % 12 || 12;
      buckets.push({start: workdayStart, end: pointEnd > end ? end : pointEnd, label: `${displayHour} ${hour < 12 ? "AM" : "PM"}`});
    }
    if (!buckets.length || buckets[buckets.length - 1].end < end) {
      const displayHour = currentHour % 12 || 12;
      buckets.push({start: workdayStart, end, label: `${displayHour} ${currentHour < 12 ? "AM" : "PM"}`});
    }
    return {buckets, granularity: "hourly"};
  }
  if (days <= 31) {
    for (let cursor = startOfDay(start); cursor <= end; cursor = new Date(cursor.getTime() + DAY_MS)) buckets.push({start: cursor, end: endOfDay(cursor), label: cursor.toLocaleDateString("en-US", {day: "numeric", month: "short"})});
  } else if (days <= 120) {
    for (let cursor = startOfDay(start); cursor <= end; cursor = new Date(cursor.getTime() + 7 * DAY_MS)) { const bucketEnd = endOfDay(new Date(Math.min(end.getTime(), cursor.getTime() + 6 * DAY_MS))); buckets.push({start: cursor, end: bucketEnd, label: cursor.toLocaleDateString("en-US", {day: "numeric", month: "short"})}); }
  } else {
    for (let cursor = new Date(start.getFullYear(), start.getMonth(), 1); cursor <= end; cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)) { const bucketStart = cursor < start ? start : cursor; const monthEnd = endOfDay(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0)); buckets.push({start: bucketStart, end: monthEnd > end ? end : monthEnd, label: cursor.toLocaleDateString("en-US", {month: "short", year: "2-digit"})}); }
  }
  return {buckets, granularity: days <= 31 ? "daily" : days <= 120 ? "weekly" : "monthly"};
};

const getEmployeeProductivity = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const companyCode = String(req.user.companyCode || req.user.company?.companyCode || "").trim();
    const {start, end, period} = getProductivityRange(req.query);
    const [attendance, employeeTasks, projects, leaves, holidays] = await Promise.all([
      Attendance.find({user: userId, companyCode, date: {$gte: start, $lte: end}}).lean(),
      EmployeeTask.find({companyCode, isActive: {$ne: false}, createdAt: {$lte: end}, $or: [{assignedUsers: userId}, {"statusByUser.user": userId}]}).select("createdAt updatedAt dueDateTime completionDate overallStatus statusByUser statusHistory").lean(),
      Project.aggregate([
        {$match: {tasks: {$elemMatch: {assignedTo: new mongoose.Types.ObjectId(userId), createdAt: {$lte: end}}}}},
        {$project: {
          tasks: {$filter: {
            input: "$tasks",
            as: "task",
            cond: {$and: [
              {$eq: ["$$task.assignedTo", new mongoose.Types.ObjectId(userId)]},
              {$lte: ["$$task.createdAt", end]},
            ]},
          }},
        }},
      ]),
      Leave.find({user: userId, status: /^approved$/i, startDate: {$lte: end}, endDate: {$gte: start}}).select("startDate endDate").lean(),
      Holiday.find({companyCode, isActive: true, date: {$gte: start, $lte: end}}).select("date").lean(),
    ]);
    const projectTasks = projects.flatMap(project => (project.tasks || [])
      .filter(task => String(task.assignedTo) === String(userId) && new Date(task.createdAt) <= end)
      .map(task => ({
        _id: task._id,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        dueDateTime: task.dueDate,
        overallStatus: task.status,
        completionDate: completedStatuses.has(normalizeProductivityStatus(task.status)) ? task.updatedAt : null,
        statusByUser: [],
        statusHistory: [],
      })));
    const tasks = [...employeeTasks, ...projectTasks];
    const excludedDates = new Set(holidays.map(item => dateKey(item.date)));
    leaves.forEach(leave => { for (let cursor = startOfDay(leave.startDate); cursor <= endOfDay(leave.endDate); cursor = new Date(cursor.getTime() + DAY_MS)) excludedDates.add(dateKey(cursor)); });
    const overall = calculateProductivityMetrics({start, end, attendance, tasks, excludedDates, userId});
    const {buckets, granularity} = buildProductivityBuckets(start, end, period);
    const series = buckets.map(bucket => ({...bucket, ...calculateProductivityMetrics({...bucket, attendance, tasks, excludedDates, userId})})).map(item => ({date: granularity === "hourly" ? item.end : item.start, label: item.label, score: item.score, hasData: item.hasData, breakdown: item.breakdown, counts: item.counts}));
    const [label, tone] = productivityBand(overall.score);
    return res.json({success: true, data: {period, from: dateKey(start), to: dateKey(end), granularity, score: overall.score, label, tone, hasData: overall.hasData, limitedData: [overall.breakdown.taskCompletion, overall.breakdown.onTimeDelivery, overall.breakdown.attendance].filter(Number.isFinite).length < 3, breakdown: overall.breakdown, counts: overall.counts, series}});
  } catch (error) {
    const clientError = /date|range/i.test(error.message);
    return res.status(clientError ? 400 : 500).json({success: false, message: error.message || "Unable to calculate productivity"});
  }
};

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
      currentUser,
      branch,
    ] = await Promise.all([
      companyId ? Company.findById(companyId).select("dashboardConfig officeLocation").lean() : null,
      JobRole.find({
        isActive: true,
        ...(companyId ? {company: companyId} : {companyCode}),
      }).select("_id name roleName roleNumber roleNo code jobRole title shiftSettings shifts department").lean(),
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
      User.findById(userId).select("_id name email employeeId jobRole department employeeType shiftId shiftName shiftType").lean(),
      branchId ? Branch.findById(branchId).select("dashboardConfig officeLocation").lean() : null,
    ]);
    const scopedDashboardConfig = branch?.dashboardConfig?.length ? branch.dashboardConfig : (company?.dashboardConfig || []);

    const userJobRole = String(currentUser?.jobRole || req.user.jobRole || "");
    const matchedJobRole = jobRoles.find(role =>
      String(role._id || "") === userJobRole ||
      role.name === userJobRole ||
      role.roleName === userJobRole ||
      role.jobRole === userJobRole ||
      role.roleNumber === userJobRole ||
      role.roleNo === userJobRole ||
      role.code === userJobRole
    );
    const roleShifts = Array.isArray(matchedJobRole?.shifts) && matchedJobRole.shifts.length
      ? matchedJobRole.shifts
      : (matchedJobRole?.shiftSettings ? [matchedJobRole.shiftSettings] : []);
    const selectedShift = roleShifts.find(shift =>
      String(shift.shiftId || shift._id || shift.id) === String(currentUser?.shiftId || req.user.shiftId || "")
    );
    const dashboardShift = normalizeShiftForDashboard(selectedShift)
      || (currentUser?.shiftName ? normalizeShiftForDashboard({
        shiftId: currentUser.shiftId,
        shiftName: currentUser.shiftName,
        shiftType: currentUser.shiftType,
      }) : null)
      || normalizeShiftForDashboard(roleShifts[0]);

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
        currentUser: {
          ...(currentUser || {}),
          shift: dashboardShift,
        },
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

    
    const [leaveCount, taskCount, assetCount] = await Promise.all([
      Leave.countDocuments({
        user: userId,
        companyCode: companyCode
      }),
      Task.countDocuments({
        assigneeId: userId,
        companyCode: companyCode
      }),
      AssetRequest.countDocuments({
        user: userId,
        companyCode: companyCode
      }),
    ]);
    
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
      }).select("_id name email employeeId companyRole").lean(),

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
  getEmployeeProductivity,
};
