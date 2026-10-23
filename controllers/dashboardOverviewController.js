const mongoose = require("mongoose");
const Company = require("../models/Company");
const Plan = require("../models/Plan");
const User = require("../models/User");
const Department = require("../models/Department");
const JobRole = require("../models/JobRole");
const Branch = require("../models/Branch");
const CompanyAsset = require("../models/CompanyAsset");
const SupportTicket = require("../models/SupportTicket");
const PayrollRun = require("../models/PayrollRun");
const EmployeeSalary = require("../models/EmployeeSalary");

const Attendance = require("../HR-CDS/models/Attendance");
const Leave = require("../HR-CDS/models/Leave");
const Task = require("../HR-CDS/models/Task");
const { Project } = require("../HR-CDS/models/Project");
const Meeting = require("../HR-CDS/models/Meeting");
const ClientMeeting = require("../HR-CDS/models/ClientMeeting");
const AssetRequest = require("../HR-CDS/models/AssetRequest");
const Client = require("../HR-CDS/models/Client");
const Service = require("../HR-CDS/models/Service");
const ClientTask = require("../HR-CDS/models/ClientTask");
const ClientDocument = require("../HR-CDS/models/ClientDocument");
const ActivityLog = require("../HR-CDS/models/ActivityLog");
const Group = require("../HR-CDS/models/Group");
const Alert = require("../HR-CDS/models/alertModel");

const SECTION_METADATA = {
  employeesOverview: {
    key: "employeesOverview",
    group: "people",
    groupLabel: "PEOPLE",
    groupSubtitle: "Your workforce",
    title: "Employees Overview",
    description: "Total, active, inactive staff, department and role distributions.",
    route: "/ciisUser/emp-details",
    pageId: "emp-details",
    permission: "employee-view",
  },
  attendanceOverview: {
    key: "attendanceOverview",
    group: "people",
    groupLabel: "PEOPLE",
    groupSubtitle: "Your workforce",
    title: "Attendance Overview",
    description: "Daily present, absent, late check-ins, half-days, and punch logs.",
    route: "/ciisUser/emp-attendance",
    pageId: "emp-attendance",
    permission: "attendance-view",
  },
  leavesOverview: {
    key: "leavesOverview",
    group: "people",
    groupLabel: "PEOPLE",
    groupSubtitle: "Your workforce",
    title: "Leaves Overview",
    description: "Pending approvals, approved, rejected leaves, and staff on leave today.",
    route: "/ciisUser/emp-leaves",
    pageId: "emp-leaves",
    permission: "leave-view",
  },
  payrollOverview: {
    key: "payrollOverview",
    group: "people",
    groupLabel: "PEOPLE",
    groupSubtitle: "Your workforce",
    title: "Payroll Overview",
    description: "Total company payroll, processed runs, pending processing, and salary stats.",
    route: "/ciisUser/payroll-process",
    pageId: "payroll-process",
    permission: "payroll-view",
    isSensitive: true,
  },
  assetsOverview: {
    key: "assetsOverview",
    group: "people",
    groupLabel: "PEOPLE",
    groupSubtitle: "Your workforce",
    title: "Assets Overview",
    description: "Assigned assets, available inventory, maintenance, and pending employee requests.",
    route: "/ciisUser/company-assets",
    pageId: "company-assets",
    permission: "asset-view",
  },

  tasksOverview: {
    key: "tasksOverview",
    group: "work",
    groupLabel: "WORK",
    groupSubtitle: "Tasks and teams",
    title: "Tasks Overview",
    description: "Company tasks breakdown: pending, in-progress, completed, overdue, and rate.",
    route: "/ciisUser/company-all-task",
    pageId: "company-all-task",
    permission: "task-view",
  },
  projectsOverview: {
    key: "projectsOverview",
    group: "work",
    groupLabel: "WORK",
    groupSubtitle: "Tasks and teams",
    title: "Projects Overview",
    description: "Active projects, planning, completed, delayed, and milestone deadlines.",
    route: "/ciisUser/adminproject",
    pageId: "adminproject",
    permission: "project-view",
  },
  meetingsOverview: {
    key: "meetingsOverview",
    group: "work",
    groupLabel: "WORK",
    groupSubtitle: "Tasks and teams",
    title: "Meetings Overview",
    description: "Upcoming internal & client meetings, today's schedule, and attendees.",
    route: "/ciisUser/admin-meeting",
    pageId: "admin-meeting",
    permission: "meeting-view",
  },
  chatOverview: {
    key: "chatOverview",
    group: "work",
    groupLabel: "WORK",
    groupSubtitle: "Tasks and teams",
    title: "Chat Overview",
    description: "Active communication channels, team groups, and recent discussion hubs.",
    route: "/ciisUser/chat",
    pageId: "chat",
    permission: "chat-view",
  },
  alertsOverview: {
    key: "alertsOverview",
    group: "work",
    groupLabel: "WORK",
    groupSubtitle: "Tasks and teams",
    title: "Alerts Overview",
    description: "System alerts, notices, unread company announcements, and urgency categories.",
    route: "/ciisUser/alert",
    pageId: "alert",
    permission: "alert-view",
  },

  clientManagementOverview: {
    key: "clientManagementOverview",
    group: "clients",
    groupLabel: "CLIENTS",
    groupSubtitle: "Accounts and delivery",
    title: "Client Management Overview",
    description: "Active and inactive client accounts, new onboarding, and status distributions.",
    route: "/ciisUser/emp-client",
    pageId: "emp-client",
    permission: "client-view",
  },
  clientServicesOverview: {
    key: "clientServicesOverview",
    group: "clients",
    groupLabel: "CLIENTS",
    groupSubtitle: "Accounts and delivery",
    title: "Client Services Overview",
    description: "Contracted services, active client deliverables, and pending service tasks.",
    route: "/ciisUser/client-my-services",
    pageId: "client-my-services",
    permission: "client-service-view",
  },
  clientPortalOverview: {
    key: "clientPortalOverview",
    group: "clients",
    groupLabel: "CLIENTS",
    groupSubtitle: "Accounts and delivery",
    title: "Client Portal Overview",
    description: "Client portal activity, shared documents, pending reviews, and updates.",
    route: "/ciisUser/client-dashboard",
    pageId: "client-dashboard",
    permission: "client-portal-view",
  },
  supportOverview: {
    key: "supportOverview",
    group: "clients",
    groupLabel: "CLIENTS",
    groupSubtitle: "Accounts and delivery",
    title: "Support Overview",
    description: "Support ticket volume, open, in-progress, resolved, and SLA overdue tickets.",
    route: "/ciisUser/support-desk",
    pageId: "support-desk",
    permission: "support-view",
  },

  employeeActivityOverview: {
    key: "employeeActivityOverview",
    group: "insights",
    groupLabel: "INSIGHTS",
    groupSubtitle: "Performance and reports",
    title: "Employee Activity Overview",
    description: "Real-time timeline of employee task completions, updates, remarks, and actions.",
    route: "/ciisUser/user-dashboard",
    pageId: "user-dashboard",
    permission: "activity-view",
  },
  attendanceAnalyticsOverview: {
    key: "attendanceAnalyticsOverview",
    group: "insights",
    groupLabel: "INSIGHTS",
    groupSubtitle: "Performance and reports",
    title: "Attendance Analytics Overview",
    description: "7-day and monthly attendance trends, punctuality rate, and comparison analytics.",
    route: "/ciisUser/attendance",
    pageId: "attendance",
    permission: "attendance-analytics-view",
  },
  taskAnalyticsOverview: {
    key: "taskAnalyticsOverview",
    group: "insights",
    groupLabel: "INSIGHTS",
    groupSubtitle: "Performance and reports",
    title: "Task Analytics Overview",
    description: "Completion rates, priority breakdown, overdue trends, and workload velocity.",
    route: "/ciisUser/emp-task-details",
    pageId: "emp-task-details",
    permission: "task-analytics-view",
  },
  teamVisibilityOverview: {
    key: "teamVisibilityOverview",
    group: "insights",
    groupLabel: "INSIGHTS",
    groupSubtitle: "Performance and reports",
    title: "Team Visibility Overview",
    description: "Department capacity, branch breakdown, staff allocations, and team workload.",
    route: "/ciisUser/department",
    pageId: "department",
    permission: "department-view",
  },
  payrollReportsOverview: {
    key: "payrollReportsOverview",
    group: "insights",
    groupLabel: "INSIGHTS",
    groupSubtitle: "Performance and reports",
    title: "Payroll Reports Overview",
    description: "Historical salary summaries, run audit trends, deductions, and payroll periods.",
    route: "/ciisUser/payroll-reports",
    pageId: "payroll-reports",
    permission: "payroll-reports-view",
    isSensitive: true,
  },
};

const DEFAULT_CONFIG = Object.keys(SECTION_METADATA).reduce((acc, key) => {
  acc[key] = { enabled: true };
  return acc;
}, {});

const canAccessSensitivePayroll = (user) => {
  if (!user) return false;
  const role = String(user.role || "").toLowerCase();
  const companyRole = String(user.companyRole || "").toLowerCase();
  return (
    role === "super_admin" ||
    role === "admin" ||
    role === "owner" ||
    companyRole.includes("admin") ||
    companyRole.includes("owner") ||
    companyRole.includes("hr") ||
    Boolean(user.isPlatformOwner)
  );
};

const resolveTargetCompany = async (req) => {
  let companyId = req.query.companyId || req.params.companyId || req.params.id;
  const user = req.user;

  // If Super Admin explicitly specified target company, load that company
  if (companyId && mongoose.Types.ObjectId.isValid(companyId) && (user?.role === "super_admin" || user?.isPlatformOwner)) {
    return await Company.findById(companyId).populate("selectedPlan").lean();
  }

  // Anchor to user's company context
  const userCompanyId = user?.company?._id || user?.company || user?.companyId;
  const rawCompanyCode = String(user?.companyCode || user?.company?.companyCode || "").trim();

  let query = null;
  if (userCompanyId && mongoose.Types.ObjectId.isValid(userCompanyId)) {
    query = { _id: userCompanyId };
  } else if (rawCompanyCode) {
    query = { companyCode: { $regex: new RegExp(`^${rawCompanyCode}$`, "i") } };
  }

  if (query) {
    const found = await Company.findOne(query).populate("selectedPlan").lean();
    if (found) return found;
  }

  if (companyId && mongoose.Types.ObjectId.isValid(companyId)) {
    return await Company.findById(companyId).populate("selectedPlan").lean();
  }

  if (user?.role === "super_admin" || user?.isPlatformOwner) {
    return await Company.findOne({}).populate("selectedPlan").lean();
  }

  return null;
};

exports.getDynamicDashboardOverviewData = async (req, res) => {
  try {
    const company = await resolveTargetCompany(req);
    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Target company could not be resolved. Please log in or specify valid companyId.",
      });
    }

    const companyId = company._id;
    const rawCompanyCode = String(company.companyCode || "").trim();
    const companyCodeVariations = Array.from(
      new Set([rawCompanyCode, rawCompanyCode.toUpperCase(), rawCompanyCode.toLowerCase()].filter(Boolean))
    );

    const isSuperAdmin = req.user?.role === "super_admin";
    const hasPayrollPrivilege = canAccessSensitivePayroll(req.user);

    // Resolve company users
    const users = await User.find({
      $or: [
        { company: companyId },
        { companyCode: { $in: companyCodeVariations } },
      ],
    })
      .select("_id name email role companyRole jobRole department phone isActive createdAt avatar profileImage")
      .sort({ createdAt: -1 })
      .lean();

    const companyUserIds = users.map((u) => u._id);
    const activeUsers = users.filter((u) => u.isActive);
    const inactiveUsers = users.filter((u) => !u.isActive);

    // Date anchors for today & week
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Parallel aggregate queries across all 19 module domains
    const [
      departments,
      jobRoles,
      branches,
      todayAttendances,
      recentAttendances,
      leaves,
      assets,
      assetRequests,
      tasks,
      projects,
      meetings,
      clientMeetings,
      channels,
      alerts,
      clients,
      services,
      supportTickets,
      activityLogs,
      payrollRuns,
      employeeSalaries,
    ] = await Promise.all([
      Department.find({
        $or: [{ company: companyId }, { companyCode: { $in: companyCodeVariations } }],
        isActive: true,
      }).select("_id name departmentName").lean().catch(() => []),

      JobRole.find({
        $or: [{ company: companyId }, { companyCode: { $in: companyCodeVariations } }],
        isActive: true,
      }).select("_id name roleName department").lean().catch(() => []),

      Branch.find({
        $or: [{ company: companyId }, { companyCode: { $in: companyCodeVariations } }],
        isActive: true,
      }).select("_id name branchCode city").lean().catch(() => []),

      Attendance.find({
        $or: [
          { user: { $in: companyUserIds } },
          { companyCode: { $in: companyCodeVariations } },
        ],
        date: { $gte: startOfToday, $lte: endOfToday },
      }).lean().catch(() => []),

      Attendance.find({
        $or: [
          { user: { $in: companyUserIds } },
          { companyCode: { $in: companyCodeVariations } },
        ],
        date: { $gte: sevenDaysAgo },
      }).sort({ date: -1 }).limit(100).lean().catch(() => []),

      Leave.find({
        $or: [
          { user: { $in: companyUserIds } },
          { companyCode: { $in: companyCodeVariations } },
        ],
      }).sort({ createdAt: -1 }).limit(100).lean().catch(() => []),

      CompanyAsset.find({
        $or: [
          { company: companyId },
          { company: { $in: companyCodeVariations } },
          { companyCode: { $in: companyCodeVariations } },
          { assignedTo: { $in: companyUserIds } },
          { createdBy: { $in: companyUserIds } },
        ],
      }).select("name quantity status assignedTo assignedToName branch branchName createdAt").limit(200).lean().catch(() => []),

      AssetRequest.find({
        $or: [
          { user: { $in: companyUserIds } },
          { companyCode: { $in: companyCodeVariations } },
        ],
      }).select("assetName status requestType department reason createdAt").sort({ createdAt: -1 }).limit(20).lean().catch(() => []),

      Task.find({
        $or: [
          { companyCode: { $in: companyCodeVariations } },
          { createdBy: { $in: companyUserIds } },
          { assignedUsers: { $in: companyUserIds } },
        ],
      }).select("title priority dueDateTime overallStatus status createdAt").sort({ createdAt: -1 }).limit(500).lean().catch(() => []),

      Project.find({
        $or: [
          { company: companyId },
          { companyCode: { $in: companyCodeVariations } },
          { users: { $in: companyUserIds } },
          { managers: { $in: companyUserIds } },
          { createdBy: { $in: companyUserIds } },
        ],
      }).select("projectName status progress deadline endDate startDate createdAt").sort({ createdAt: -1 }).limit(100).lean().catch(() => []),

      Meeting.find({
        $or: [
          { companyCode: { $in: companyCodeVariations } },
          { createdBy: { $in: companyUserIds } },
          { attendees: { $in: companyUserIds } },
        ],
      }).select("date time status title link createdBy attendees").sort({ date: 1 }).limit(50).lean().catch(() => []),

      ClientMeeting.find({
        $or: [
          { company: companyId },
          { companyCode: { $in: companyCodeVariations } },
          { createdBy: { $in: companyUserIds } },
          { attendees: { $in: companyUserIds } },
        ],
      }).select("meetingDate meetingTime date status title link clientId createdBy attendees").sort({ meetingDate: 1 }).limit(50).lean().catch(() => []),

      Group.find({
        $or: [
          { company: companyId },
          { companyCode: { $in: companyCodeVariations } },
          { createdBy: { $in: companyUserIds } },
        ],
      }).select("_id name members").sort({ updatedAt: -1 }).limit(30).lean().catch(() => []),

      Alert.find({
        $or: [
          { company: companyId },
          { companyCode: { $in: companyCodeVariations } },
          { createdBy: { $in: companyUserIds } },
        ],
      }).select("title type message createdAt").sort({ createdAt: -1 }).limit(25).lean().catch(() => []),

      Client.find({
        $or: [
          { company: companyId },
          { companyCode: { $in: companyCodeVariations } },
        ],
      }).select("status createdAt name client company companyCode city portalAccess email").sort({ createdAt: -1 }).limit(100).lean().catch(() => []),

      Service.find({
        companyCode: { $in: companyCodeVariations },
      }).select("servicename status createdAt").limit(100).lean().catch(() => []),

      SupportTicket.find({
        $or: [
          { company: companyId },
          { companyCode: { $in: companyCodeVariations } },
          { requester: { $in: companyUserIds } },
        ],
      }).select("ticketNumber subject status priority createdAt").sort({ createdAt: -1 }).limit(100).lean().catch(() => []),

      ActivityLog.find({
        user: { $in: companyUserIds },
      }).select("action user createdAt").sort({ createdAt: -1 }).limit(25).populate("user", "name email avatar").lean().catch(() => []),

      hasPayrollPrivilege
        ? PayrollRun.find({ $or: [{ company: companyId }, { company: String(companyId) }] }).sort({ month: -1 }).limit(6).lean().catch(() => [])
        : Promise.resolve([]),

      hasPayrollPrivilege
        ? EmployeeSalary.find({ $or: [{ company: companyId }, { user: { $in: companyUserIds } }] }).select("monthlyGross monthlyNet annualCTC status user baseAmount").lean().catch(() => [])
        : Promise.resolve([]),
    ]);

    const companyClientIds = clients.map((c) => c._id);

    // Fetch Client Tasks & Documents linked to this company or its clients/staff
    const [clientTasks, clientDocuments] = await Promise.all([
      ClientTask.find({
        $or: [
          { clientId: { $in: companyClientIds } },
          { assigneeId: { $in: companyUserIds } },
        ],
      }).select("name status completed priority dueDate createdAt service").sort({ createdAt: -1 }).limit(100).lean().catch(() => []),

      ClientDocument.find({
        $or: [
          { companyCode: { $in: companyCodeVariations } },
          { client: { $in: companyClientIds } },
          { uploadedBy: { $in: companyUserIds } },
        ],
      }).select("originalName storedName title status category isVerified createdAt").sort({ createdAt: -1 }).limit(20).lean().catch(() => []),
    ]);

    // Build Department Distribution
    const deptCountMap = {};
    users.forEach((u) => {
      const d = String(u.department || "Unassigned").trim();
      deptCountMap[d] = (deptCountMap[d] || 0) + 1;
    });
    const departmentDistribution = Object.entries(deptCountMap).map(([name, count]) => ({
      name,
      count,
      percentage: users.length ? Math.round((count / users.length) * 100) : 0,
    }));

    // Build Role Distribution
    const roleCountMap = {};
    users.forEach((u) => {
      const r = String(u.companyRole || u.role || "Employee").trim();
      roleCountMap[r] = (roleCountMap[r] || 0) + 1;
    });
    const roleDistribution = Object.entries(roleCountMap).map(([role, count]) => ({
      role,
      count,
    }));

    // 1. Employees Overview
    const employeesOverview = {
      totalEmployees: users.length,
      activeEmployees: activeUsers.length,
      inactiveEmployees: inactiveUsers.length,
      departmentDistribution: departmentDistribution.slice(0, 6),
      roleDistribution: roleDistribution.slice(0, 5),
      recentEmployees: users.slice(0, 5).map((u) => ({
        id: u._id,
        name: u.name,
        email: u.email,
        role: u.companyRole || u.role,
        department: u.department || "General",
        joinedDate: u.createdAt,
      })),
    };

    // 2. Attendance Overview
    const presentCount = todayAttendances.filter((a) =>
      ["PRESENT", "HALFDAY", "HALF DAY", "LATE", "SHORT LEAVE"].includes(String(a.status || "").toUpperCase())
    ).length;
    const lateCount = todayAttendances.filter((a) =>
      String(a.status || "").toUpperCase() === "LATE" || (a.lateBy && a.lateBy !== "00:00:00")
    ).length;
    const halfDayCount = todayAttendances.filter((a) =>
      ["HALFDAY", "HALF DAY"].includes(String(a.status || "").toUpperCase())
    ).length;
    const absentCount = Math.max(0, activeUsers.length - presentCount);

    const attendanceOverview = {
      totalActive: activeUsers.length,
      presentToday: presentCount,
      absentToday: absentCount,
      lateArrivals: lateCount,
      halfDayToday: halfDayCount,
      attendanceRate: activeUsers.length ? Math.round((presentCount / activeUsers.length) * 100) : 0,
      recentPunches: todayAttendances.slice(0, 6).map((att) => {
        const matchedUser = users.find((u) => String(u._id) === String(att.user));
        return {
          id: att._id,
          userName: matchedUser ? matchedUser.name : "Employee",
          status: att.status || "PRESENT",
          inTime: att.inTime,
          outTime: att.outTime,
          lateBy: att.lateBy || "00:00:00",
        };
      }),
    };

    // 3. Leaves Overview
    const pendingLeaves = leaves.filter((l) => String(l.status || "").toLowerCase().includes("pending"));
    const approvedLeaves = leaves.filter((l) => String(l.status || "").toLowerCase().includes("approved"));
    const rejectedLeaves = leaves.filter((l) => String(l.status || "").toLowerCase().includes("rejected"));
    const onLeaveToday = approvedLeaves.filter((l) => {
      const start = new Date(l.startDate);
      const end = new Date(l.endDate);
      return now >= start && now <= end;
    });

    const leavesOverview = {
      pendingCount: pendingLeaves.length,
      approvedCount: approvedLeaves.length,
      rejectedCount: rejectedLeaves.length,
      onLeaveTodayCount: onLeaveToday.length,
      recentLeaves: leaves.slice(0, 5).map((l) => {
        const matchedUser = users.find((u) => String(u._id) === String(l.user));
        return {
          id: l._id,
          userName: matchedUser ? matchedUser.name : "Employee",
          type: l.type || "General Leave",
          days: l.days || 1,
          status: l.status || "Pending",
          startDate: l.startDate,
          endDate: l.endDate,
          reason: l.reason,
        };
      }),
    };

    // 4. Payroll Overview
    const latestPayroll = payrollRuns.length ? payrollRuns[0] : null;
    const totalSalaryRecords = Array.isArray(employeeSalaries) ? employeeSalaries.length : 0;
    const totalBaseSalary = Array.isArray(employeeSalaries)
      ? employeeSalaries.reduce((sum, s) => sum + (Number(s.monthlyGross) || Number(s.baseAmount) || 0), 0)
      : 0;

    const payrollOverview = hasPayrollPrivilege
      ? {
          authorized: true,
          latestMonth: latestPayroll?.month || "Current Period",
          status: latestPayroll?.status || (totalSalaryRecords > 0 ? "Active Salaries" : "In Preparation"),
          totalPayrollCost: latestPayroll?.totals?.net || latestPayroll?.totals?.earnings || totalBaseSalary || 0,
          processedEmployees: latestPayroll?.totals?.employees || totalSalaryRecords || 0,
          pendingEmployees: Math.max(0, activeUsers.length - (latestPayroll?.totals?.employees || totalSalaryRecords || 0)),
          deductionsTotal: latestPayroll?.totals?.deductions || 0,
          calculatedAt: latestPayroll?.calculatedAt || null,
        }
      : {
          authorized: false,
          restrictedMessage: "Payroll metrics are restricted to authorized salary administrators.",
        };

    // 5. Assets Overview
    const totalAssetsQty = assets.reduce((sum, a) => sum + (Number(a.quantity) || 1), 0);
    const assignedAssets = assets.filter((a) => a.status === "Assigned" || Boolean(a.assignedTo));
    const availableAssets = assets.filter((a) => a.status === "Available" && !a.assignedTo);
    const maintenanceAssets = assets.filter((a) => a.status === "Maintenance");
    const pendingAssetReqs = assetRequests.filter((r) => String(r.status || "").toLowerCase() === "pending");

    const assetsOverview = {
      totalAssetsCount: assets.length,
      totalQuantity: totalAssetsQty,
      assignedCount: assignedAssets.length,
      availableCount: availableAssets.length,
      maintenanceCount: maintenanceAssets.length,
      pendingRequestsCount: pendingAssetReqs.length,
      recentRequests: assetRequests.slice(0, 5).map((req) => ({
        id: req._id,
        assetName: req.assetName,
        requestType: req.requestType,
        status: req.status,
        department: req.department,
        reason: req.reason,
        createdAt: req.createdAt,
      })),
    };

    // 6. Tasks Overview
    const completedTasks = tasks.filter((t) => ["completed", "approved"].includes(String(t.overallStatus || t.status || "").toLowerCase()));
    const inProgressTasks = tasks.filter((t) => ["in-progress", "in progress", "reopen"].includes(String(t.overallStatus || t.status || "").toLowerCase()));
    const pendingTasksList = tasks.filter((t) => ["pending", "onhold", "on hold"].includes(String(t.overallStatus || t.status || "").toLowerCase()));
    const overdueTasks = tasks.filter((t) => {
      const s = String(t.overallStatus || t.status || "").toLowerCase();
      if (s === "overdue") return true;
      if (["completed", "approved", "cancelled"].includes(s)) return false;
      return t.dueDateTime && new Date(t.dueDateTime) < now;
    });

    const tasksOverview = {
      totalTasks: tasks.length,
      pendingCount: pendingTasksList.length,
      inProgressCount: inProgressTasks.length,
      completedCount: completedTasks.length,
      overdueCount: overdueTasks.length,
      completionRate: tasks.length ? Math.round((completedTasks.length / tasks.length) * 100) : 0,
      recentTasks: tasks.slice(0, 6).map((t) => ({
        id: t._id,
        title: t.title,
        priority: t.priority || "medium",
        status: t.overallStatus || t.status || "pending",
        dueDateTime: t.dueDateTime,
        createdAt: t.createdAt,
      })),
    };

    // 7. Projects Overview
    const activeProjects = projects.filter((p) => String(p.status || "").toLowerCase() === "active");
    const completedProjects = projects.filter((p) => String(p.status || "").toLowerCase() === "completed");
    const planningProjects = projects.filter((p) => ["planning", "on hold"].includes(String(p.status || "").toLowerCase()));
    const delayedProjects = projects.filter((p) => {
      const s = String(p.status || "").toLowerCase();
      if (s === "completed" || s === "cancelled") return false;
      return p.endDate && new Date(p.endDate) < now;
    });

    const projectsOverview = {
      totalProjects: projects.length,
      activeCount: activeProjects.length,
      completedCount: completedProjects.length,
      planningCount: planningProjects.length,
      delayedCount: delayedProjects.length,
      recentProjects: projects.slice(0, 5).map((p) => ({
        id: p._id,
        projectName: p.projectName,
        status: p.status || "active",
        priority: p.priority || "medium",
        taskCount: p.tasks ? p.tasks.length : 0,
        startDate: p.startDate,
        endDate: p.endDate,
      })),
    };

    // 8. Meetings Overview
    const normalizedMeetings = [
      ...meetings.map((m) => ({ ...m, date: m.date, time: m.time, isClient: false })),
      ...clientMeetings.map((cm) => ({ ...cm, date: cm.meetingDate || cm.date, time: cm.meetingTime || cm.time, isClient: true })),
    ];
    const todayMeetings = normalizedMeetings.filter((m) => {
      if (!m.date) return false;
      const mDate = new Date(m.date);
      return !isNaN(mDate.getTime()) && mDate >= startOfToday && mDate <= endOfToday;
    });
    const upcomingMeetings = normalizedMeetings.filter((m) => {
      if (!m.date) return true;
      const mDate = new Date(m.date);
      return isNaN(mDate.getTime()) || mDate >= startOfToday;
    });
    const completedMeetings = normalizedMeetings.filter((m) => {
      if (!m.date) return false;
      const mDate = new Date(m.date);
      return !isNaN(mDate.getTime()) && mDate < startOfToday;
    });

    const meetingsOverview = {
      totalMeetings: normalizedMeetings.length,
      todayCount: todayMeetings.length,
      upcomingCount: upcomingMeetings.length,
      completedCount: completedMeetings.length,
      recentMeetings: (upcomingMeetings.length ? upcomingMeetings : normalizedMeetings).slice(0, 5).map((m) => ({
        id: m._id,
        title: m.title || "Team Sync",
        date: m.date || new Date(),
        time: m.time || "Scheduled",
        attendeesCount: Array.isArray(m.attendees) ? m.attendees.length : (Array.isArray(m.attendeeUsers) ? m.attendeeUsers.length : 0),
        isClientMeeting: Boolean(m.isClient),
      })),
    };

    // 9. Chat Overview
    const chatOverview = {
      totalChannels: channels.length,
      activeChannelsCount: channels.filter((c) => c.members && c.members.length > 0).length,
      recentChannels: channels.slice(0, 5).map((c) => ({
        id: c._id,
        name: c.name,
        membersCount: Array.isArray(c.members) ? c.members.length : 0,
        description: c.description || "Active channel",
        updatedAt: c.updatedAt,
      })),
    };

    // 10. Alerts Overview
    const unreadAlerts = alerts.filter((a) => !a.isRead && !a.seen);
    const alertsOverview = {
      totalAlerts: alerts.length,
      unseenCount: unreadAlerts.length,
      recentAlerts: alerts.slice(0, 5).map((a) => ({
        id: a._id,
        title: a.title || "Company Alert",
        type: a.type || "info",
        message: a.message,
        createdAt: a.createdAt,
      })),
    };

    // 11. Client Management Overview
    const activeClients = clients.filter((c) => String(c.status || "").toLowerCase().includes("active"));
    const inactiveClients = clients.filter((c) => String(c.status || "").toLowerCase().includes("inactive"));
    const recentClientsList = clients.filter((c) => new Date(c.createdAt) >= sevenDaysAgo);

    const clientManagementOverview = {
      totalClients: clients.length,
      activeClients: activeClients.length,
      inactiveClients: inactiveClients.length,
      recentlyAddedClients: recentClientsList.length,
      recentClients: clients.slice(0, 5).map((c) => ({
        id: c._id,
        name: c.client || c.name || "Client Account",
        company: c.company || "Corporate",
        city: c.city,
        status: c.status || "Active",
        createdAt: c.createdAt,
      })),
    };

    // 12. Client Services Overview
    const clientServicesOverview = {
      totalServices: services.length,
      activeServicesCount: services.length,
      totalClientTasks: clientTasks.length,
      completedClientTasks: clientTasks.filter((ct) => String(ct.status || "").toLowerCase() === "completed").length,
      pendingClientTasks: clientTasks.filter((ct) => String(ct.status || "").toLowerCase() !== "completed").length,
      recentServices: services.slice(0, 5).map((s) => ({
        id: s._id,
        servicename: s.servicename,
        createdAt: s.createdAt,
      })),
    };

    // 13. Client Portal Overview
    const clientPortalOverview = {
      portalAccountsCount: clients.filter((c) => c.portalAccess || c.email).length,
      sharedDocumentsCount: clientDocuments.length,
      pendingDocumentsCount: clientDocuments.filter((d) => d.status === "pending" || !d.isVerified).length,
      recentDocuments: clientDocuments.slice(0, 5).map((doc) => ({
        id: doc._id,
        title: doc.title || doc.documentName || "Client Document",
        category: doc.category || "General",
        status: doc.status || "Shared",
        createdAt: doc.createdAt,
      })),
    };

    // 14. Support Overview
    const openTickets = supportTickets.filter((t) => ["open", "new"].includes(String(t.status || "").toLowerCase()));
    const inProgressTickets = supportTickets.filter((t) => ["in_progress", "in progress", "pending"].includes(String(t.status || "").toLowerCase()));
    const resolvedTickets = supportTickets.filter((t) => ["resolved", "closed"].includes(String(t.status || "").toLowerCase()));
    const overdueTickets = openTickets.filter((t) => {
      const created = new Date(t.createdAt);
      return now.getTime() - created.getTime() > 48 * 60 * 60 * 1000;
    });

    const supportOverview = {
      totalTickets: supportTickets.length,
      openCount: openTickets.length,
      inProgressCount: inProgressTickets.length,
      resolvedCount: resolvedTickets.length,
      overdueCount: overdueTickets.length,
      recentTickets: supportTickets.slice(0, 5).map((t) => ({
        id: t._id,
        ticketNumber: t.ticketNumber || `TKT-${String(t._id).slice(-4)}`,
        subject: t.subject,
        priority: t.priority || "medium",
        status: t.status || "open",
        createdAt: t.createdAt,
      })),
    };

    // 15. Employee Activity Overview
    const actionCounts = {};
    activityLogs.forEach((act) => {
      const a = act.action || "general_update";
      actionCounts[a] = (actionCounts[a] || 0) + 1;
    });

    const employeeActivityOverview = {
      totalActivities: activityLogs.length,
      todayActivitiesCount: activityLogs.filter((a) => new Date(a.createdAt) >= startOfToday).length,
      actionDistribution: Object.entries(actionCounts).map(([action, count]) => ({ action, count })),
      recentTimeline: activityLogs.slice(0, 8).map((act) => ({
        id: act._id,
        userName: act.user?.name || "Staff Member",
        userAvatar: act.user?.avatar || act.user?.profileImage || "",
        action: act.action,
        description: act.description,
        createdAt: act.createdAt,
      })),
    };

    // 16. Attendance Analytics Overview
    // Build 7-day attendance timeline
    const sevenDayTrends = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0);
      const dayEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
      const dayRecords = recentAttendances.filter((r) => {
        const rDate = new Date(r.date);
        return rDate >= dayStart && rDate <= dayEnd;
      });
      const dayPresent = dayRecords.filter((r) =>
        ["PRESENT", "HALFDAY", "HALF DAY", "LATE", "SHORT LEAVE"].includes(String(r.status || "").toUpperCase())
      ).length;
      const dayLate = dayRecords.filter((r) =>
        String(r.status || "").toUpperCase() === "LATE" || (r.lateBy && r.lateBy !== "00:00:00")
      ).length;

      sevenDayTrends.push({
        date: d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric" }),
        present: dayPresent,
        late: dayLate,
        absent: Math.max(0, activeUsers.length - dayPresent),
        rate: activeUsers.length ? Math.round((dayPresent / activeUsers.length) * 100) : 0,
      });
    }

    const attendanceAnalyticsOverview = {
      sevenDayTrends,
      averageRate: sevenDayTrends.length
        ? Math.round(sevenDayTrends.reduce((s, d) => s + d.rate, 0) / sevenDayTrends.length)
        : 0,
      punctualityRate: presentCount
        ? Math.round(((presentCount - lateCount) / presentCount) * 100)
        : 100,
    };

    // 17. Task Analytics Overview
    const priorityCounts = { high: 0, medium: 0, low: 0 };
    tasks.forEach((t) => {
      const p = String(t.priority || "medium").toLowerCase();
      if (priorityCounts[p] !== undefined) priorityCounts[p]++;
    });

    const taskAnalyticsOverview = {
      completionRate: tasks.length ? Math.round((completedTasks.length / tasks.length) * 100) : 0,
      overdueRate: tasks.length ? Math.round((overdueTasks.length / tasks.length) * 100) : 0,
      priorityDistribution: [
        { priority: "High", count: priorityCounts.high, color: "#ef4444" },
        { priority: "Medium", count: priorityCounts.medium, color: "#f59e0b" },
        { priority: "Low", count: priorityCounts.low, color: "#10b981" },
      ],
      statusBreakdown: [
        { status: "Completed", count: completedTasks.length, color: "#10b981" },
        { status: "In Progress", count: inProgressTasks.length, color: "#3b82f6" },
        { status: "Pending", count: pendingTasksList.length, color: "#6b7280" },
        { status: "Overdue", count: overdueTasks.length, color: "#ef4444" },
      ],
    };

    // 18. Team Visibility Overview
    const teamVisibilityOverview = {
      totalDepartmentsCount: departments.length,
      totalBranchesCount: branches.length,
      totalJobRolesCount: jobRoles.length,
      departments: departments.slice(0, 8).map((dept) => {
        const staffCount = users.filter((u) => String(u.department || "") === dept.name).length;
        return {
          id: dept._id,
          name: dept.name,
          employeeCount: staffCount,
        };
      }),
      branches: branches.slice(0, 6).map((b) => ({
        id: b._id,
        name: b.name,
        city: b.city || "Head Office",
      })),
    };

    // 19. Payroll Reports Overview
    const payrollReportsOverview = hasPayrollPrivilege
      ? {
          authorized: true,
          totalHistoricalRuns: payrollRuns.length,
          monthlySummaries: payrollRuns.map((pr) => ({
            month: pr.month,
            netPay: pr.totals?.net || 0,
            earnings: pr.totals?.earnings || 0,
            deductions: pr.totals?.deductions || 0,
            employees: pr.totals?.employees || 0,
            status: pr.status,
          })),
          latestReportPeriod: latestPayroll?.month || "N/A",
        }
      : {
          authorized: false,
          restrictedMessage: "Historical payroll reports restricted to company administration.",
        };

    // Collect all 19 section data blocks
    const sectionsData = {
      employeesOverview,
      attendanceOverview,
      leavesOverview,
      payrollOverview,
      assetsOverview,

      tasksOverview,
      projectsOverview,
      meetingsOverview,
      chatOverview,
      alertsOverview,

      clientManagementOverview,
      clientServicesOverview,
      clientPortalOverview,
      supportOverview,

      employeeActivityOverview,
      attendanceAnalyticsOverview,
      taskAnalyticsOverview,
      teamVisibilityOverview,
      payrollReportsOverview,
    };

    // Return full dynamic payload
    res.status(200).json({
      success: true,
      company: {
        id: company._id,
        companyName: company.companyName,
        companyCode: company.companyCode,
        logo: company.logo,
        selectedPlan: company.selectedPlan,
        allowedPages: company.allowedPages || [],
        allowedSuperAdminPages: company.allowedSuperAdminPages || [],
      },
      config: company.moduleDashboardConfig || DEFAULT_CONFIG,
      sectionsMetadata: SECTION_METADATA,
      sections: sectionsData,
      data: sectionsData,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("getDynamicDashboardOverviewData error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to generate dynamic dashboard overview data",
      error: error.message,
    });
  }
};

exports.getDashboardConfiguration = async (req, res) => {
  try {
    const company = await resolveTargetCompany(req);
    if (!company) {
      return res.status(404).json({ success: false, message: "Company not found" });
    }

    res.status(200).json({
      success: true,
      companyId: company._id,
      companyName: company.companyName,
      config: company.moduleDashboardConfig || DEFAULT_CONFIG,
      sectionsMetadata: SECTION_METADATA,
      allowedPages: company.allowedPages || [],
      plan: company.selectedPlan || null,
    });
  } catch (error) {
    console.error("getDashboardConfiguration error:", error);
    res.status(500).json({ success: false, message: "Failed to load dashboard configuration" });
  }
};

exports.updateDashboardConfiguration = async (req, res) => {
  try {
    const company = await resolveTargetCompany(req);
    if (!company) {
      return res.status(404).json({ success: false, message: "Company not found" });
    }

    const requestedConfig = req.body.config || req.body;
    if (!requestedConfig || typeof requestedConfig !== "object") {
      return res.status(400).json({ success: false, message: "Invalid configuration payload" });
    }

    // Validate keys against strict allowlist of 19 sections
    const validatedConfig = {};
    const validKeys = Object.keys(SECTION_METADATA);

    validKeys.forEach((key) => {
      if (requestedConfig[key] !== undefined) {
        validatedConfig[key] = {
          enabled: Boolean(requestedConfig[key]?.enabled ?? requestedConfig[key]),
        };
      } else if (company.moduleDashboardConfig && company.moduleDashboardConfig[key]) {
        validatedConfig[key] = company.moduleDashboardConfig[key];
      } else {
        validatedConfig[key] = { enabled: true };
      }
    });

    validatedConfig.updatedAt = new Date();
    validatedConfig.updatedBy = req.user?._id || null;

    const updated = await Company.findByIdAndUpdate(
      company._id,
      { $set: { moduleDashboardConfig: validatedConfig } },
      { new: true }
    )
      .select("companyName companyCode moduleDashboardConfig")
      .lean();

    res.status(200).json({
      success: true,
      message: "Dashboard overview configuration updated successfully",
      config: updated.moduleDashboardConfig,
    });
  } catch (error) {
    console.error("updateDashboardConfiguration error:", error);
    res.status(500).json({ success: false, message: "Failed to update dashboard configuration" });
  }
};

exports.getAvailableCompaniesForPreview = async (req, res) => {
  try {
    const isSuper = req.user?.role === "super_admin" || req.user?.isPlatformOwner;
    let query = {};
    if (!isSuper) {
      const userCompanyId = req.user?.company?._id || req.user?.company || req.user?.companyId;
      query = userCompanyId ? { _id: userCompanyId } : { companyCode: req.user?.companyCode };
    }
    const companies = await Company.find(query)
      .select("_id companyName companyCode logo email subscriptionStatus selectedPlan")
      .populate("selectedPlan", "name")
      .sort({ companyName: 1 })
      .lean();
    res.status(200).json({ success: true, companies });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch companies" });
  }
};

