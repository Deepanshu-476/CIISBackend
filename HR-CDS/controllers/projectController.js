const { Project, TASK_STATUS, PROJECT_STATUS, PRIORITY_LEVELS, NOTIFICATION_TYPES } = require("../models/Project");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const sharp = require("sharp");
const { notifyDirectUsers: sendDirectUserNotifications } = require("../utils/systemNotificationService");
const notifyDirectUsers = async options => {
  try { return await sendDirectUserNotifications(options); }
  catch (error) { console.error('Project notification delivery failed:', error.message); return []; }
};
const { enqueueCompletionJob, enqueueBackgroundJob } = require("../utils/backgroundJobQueue");
const { sendEmail } = require("../../utils/sendEmail");
const { normalizeTaskReminderSettings } = require("../utils/taskReminderSettings");
const User = require("../../models/User");
const Branch = require("../../models/Branch");
const mongoose = require("mongoose");
const { getPaginationOptions, buildPaginationMeta } = require("../../utils/pagination");

const PROJECT_USER_POPULATE_FIELDS = 'name email role jobRole companyRole profileImage avatar department branch assignedBranches';
const PROJECT_TASK_USER_POPULATE_FIELDS = 'name email role jobRole companyRole';

const normalizeIdList = (value) => {
  const input = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(input
    .map(item => {
      if (!item) return '';
      if (typeof item === 'object') return String(item._id || item.id || item.value || '').trim();
      return String(item).trim();
    })
    .filter(Boolean)
  )];
};

const canViewAllBranchData = (user = {}) => {
  const roleText = String(user.companyRole || user.jobRole || user.role || '').trim().toLowerCase();
  return ['owner', 'company_owner', 'companyowner', 'super_admin', 'superadmin'].includes(roleText);
};

const getUserBranchIds = (user = {}) => normalizeIdList([
  user.branch,
  user.branchId,
  user.branchDetails,
  ...(Array.isArray(user.assignedBranches) ? user.assignedBranches : [])
]);

const getBranchScopedCompanyUserIds = async (req, fallbackUserIds = []) => {
  const requestedBranch = req.query?.branch || req.query?.branchId;
  if (!requestedBranch || !mongoose.Types.ObjectId.isValid(requestedBranch)) return fallbackUserIds;

  const requestedBranchId = String(requestedBranch);
  const accessibleBranchIds = getUserBranchIds(req.user || {});
  if (!canViewAllBranchData(req.user) && !accessibleBranchIds.includes(requestedBranchId)) {
    return [];
  }

  const companyCode = getUserCompanyCode(req.user);
  const companyId = getUserCompanyId(req.user);
  const users = await User.find({
    ...(companyId ? { company: companyId } : companyCode ? { companyCode } : {}),
    $or: [
      { branch: requestedBranchId },
      { assignedBranches: requestedBranchId }
    ]
  }).select('_id').lean();

  return users.map(user => user._id);
};

const getRequestedBranchId = (req) => {
  const value = req.body?.branchId || req.body?.branch || req.query?.branchId || req.query?.branch;
  return value ? String(value).trim() : "";
};

const validateProjectBranchAccess = async (req, branchId) => {
  if (!branchId) return { branchId: null };
  if (!mongoose.Types.ObjectId.isValid(branchId)) {
    return { error: { status: 400, message: "Invalid branch selected" } };
  }

  const companyId = getUserCompanyId(req.user);
  const companyCode = getUserCompanyCode(req.user);
  const branch = await Branch.findOne({
    _id: branchId,
    isActive: { $ne: false },
    ...(companyId ? { company: companyId } : companyCode ? { companyCode } : {})
  }).select("_id branchCode company companyCode").lean();

  if (!branch) {
    return { error: { status: 403, message: "Selected branch is not available for this company" } };
  }

  const accessibleBranchIds = getUserBranchIds(req.user || {});
  if (!canViewAllBranchData(req.user) && !accessibleBranchIds.includes(branchId)) {
    return { error: { status: 403, message: "You do not have access to the selected branch" } };
  }

  return { branchId, branch };
};

const getBranchUserIds = async (req, branchId) => {
  if (!branchId) return (await getCompanyUserIds(req.user)).map(id => normalizeId(id));

  const companyId = getUserCompanyId(req.user);
  const companyCode = getUserCompanyCode(req.user);
  const users = await User.find({
    ...(companyId ? { company: companyId } : companyCode ? { companyCode } : {}),
    $or: [
      { branch: branchId },
      { assignedBranches: branchId }
    ]
  }).select("_id").lean();

  return users.map(user => normalizeId(user._id));
};

const getPrimaryBranchId = (value) => normalizeId(value?.branch || value?.branchId);

const getLegacyProjectBranchId = (project = {}) => {
  const savedBranchId = normalizeId(project.branch);
  if (savedBranchId) return savedBranchId;

  const creatorBranchId = getPrimaryBranchId(project.createdBy);
  if (creatorBranchId) return creatorBranchId;

  const userBranchIds = [...new Set((project.users || [])
    .map(getPrimaryBranchId)
    .filter(Boolean)
  )];

  return userBranchIds.length === 1 ? userBranchIds[0] : "";
};

const projectMatchesRequestedBranch = (project, branchId) => (
  !branchId || getLegacyProjectBranchId(project) === String(branchId)
);


const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = 'uploads/projects/';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});


const fileFilter = (req, file, cb) => {
  const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only PDF or image files are allowed'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }
});


const handleFileUpload = upload.single('pdfFile');




const normalizeRole = (value = "") => value.toString().trim().toLowerCase().replace(/[_\s]+/g, "-");

const normalizeTaskStatus = (value = "pending") => {
  const normalized = String(value || "pending").trim().toLowerCase();
  if (normalized === "in progress" || normalized === "inprogress") return "in-progress";
  if (normalized === "on hold" || normalized === "onhold") return "onhold";
  if (normalized === "re-open" || normalized === "re open") return "reopen";
  return normalized;
};

const toProjectTaskStatus = (value = "pending") => {
  const normalized = normalizeTaskStatus(value);
  if (normalized === "in-progress") return "in progress";
  if (normalized === "onhold") return "on hold";
  if (normalized === "reopen" || normalized === "re-open") return "reopen";
  return normalized;
};

const canChangeFromOnHold = (nextStatus) => {
  return ["in-progress", "completed"].includes(normalizeTaskStatus(nextStatus));
};

const isCompanyAllTaskEdit = (req) => (
  req.body?.allowCompanyAllTaskEdit === true ||
  req.body?.allowCompanyAllTaskEdit === "true" ||
  req.headers?.["x-company-all-task-edit"] === "true"
);

const parseTaskCheckpoints = value => {
  if (!value || value === "null") return [];
  const raw = typeof value === "string" ? JSON.parse(value) : value;
  if (!Array.isArray(raw)) return [];

  return raw
    .map(item => {
      const title = typeof item === "string" ? item : item?.title;
      const cleanTitle = String(title || "").trim();
      if (!cleanTitle) return null;

      const completed = Boolean(typeof item === "object" ? item.completed : false);
      return {
        title: cleanTitle,
        completed,
        completedAt: completed ? (item?.completedAt ? new Date(item.completedAt) : new Date()) : null,
        completedBy: item?.completedBy || null
      };
    })
    .filter(Boolean);
};

const isPendingTaskPastDue = (task = {}) => {
  if (normalizeTaskStatus(task.status) !== "pending" || !task.dueDate) return false;
  const dueDate = new Date(task.dueDate);
  return !Number.isNaN(dueDate.getTime()) && dueDate < new Date();
};

const syncTaskStatusWithDueDate = (task) => {
  if (!task?.dueDate) return;
  const dueDate = new Date(task.dueDate);
  if (Number.isNaN(dueDate.getTime())) return;

  const status = normalizeTaskStatus(task.status);
  if (!["pending", "overdue"].includes(status)) return;
  task.status = dueDate < new Date() ? "overdue" : "pending";
};

const isProjectAdmin = (user = {}) => {
  const roles = [user.role, user.jobRole, user.companyRole].map(normalizeRole);
  return roles.some(role => ["admin", "super-admin", "superadmin", "owner"].includes(role));
};

const getUserCompanyId = (user = {}) => {
  const company = user.company;
  if (!company) return user.companyId || null;
  return company._id || company.id || company;
};

const getUserCompanyCode = (user = {}) => String(
  user.companyCode || user.company?.companyCode || ""
).trim().toUpperCase();

const getProjectCompanyCode = (project = {}) => String(
  project.companyCode || project.company?.companyCode || ""
).trim().toUpperCase();

const normalizeId = (value) => {
  if (!value) return "";
  if (value._id && value._id !== value) return normalizeId(value._id);
  if (typeof value.toString === "function") return value.toString();
  return String(value);
};

const getCompanyUserIds = async (user = {}) => {
  const companyId = getUserCompanyId(user);
  const companyCode = getUserCompanyCode(user);
  const companyFilters = [];

  if (companyId) companyFilters.push({ company: companyId });
  if (companyCode) companyFilters.push({ companyCode });

  if (companyFilters.length === 0) return [user._id || user.id].filter(Boolean);

  const users = await User.find({ $or: companyFilters }).select("_id").lean();
  return users.map(item => item._id);
};

const projectBelongsToUserCompany = (project, user = {}) => {
  const userCompanyId = normalizeId(getUserCompanyId(user));
  const projectCompanyId = normalizeId(project?.company);
  const userCompanyCode = getUserCompanyCode(user);
  const projectCompanyCode = getProjectCompanyCode(project);

  if (projectCompanyId && userCompanyId) return projectCompanyId === userCompanyId;
  if (projectCompanyCode && userCompanyCode) return projectCompanyCode === userCompanyCode;



  return true;
};

const idsEqual = (left, right) => {
  if (!left || !right) return false;
  const leftId = left._id || left.id || left;
  const rightId = right._id || right.id || right;
  return leftId.toString() === rightId.toString();
};

const getTaskAssigneeIds = (task = {}) => {
  const assignees = Array.isArray(task.assignedUsers) ? [...task.assignedUsers] : [];
  if (task.assignedTo) assignees.push(task.assignedTo);
  return [...new Set(assignees.map(value => normalizeId(value)).filter(Boolean))];
};

const isTaskAssignedToUser = (task, userId) =>
  getTaskAssigneeIds(task).some(assigneeId => idsEqual(assigneeId, userId));

const hasProjectAccess = (project, userId, userRole, user = {}) => {
  if (!projectBelongsToUserCompany(project, user)) {
    return false;
  }

  if (isProjectAdmin({ ...user, role: userRole || user.role })) {
    return true;
  }

  const isUserInProject = Array.isArray(project.users) && project.users.some(u =>
    idsEqual(u, userId)
  );

  const isCreator = idsEqual(project.createdBy, userId);

  const hasAssignedTask = Array.isArray(project.tasks) && project.tasks.some(task =>
    isTaskAssignedToUser(task, userId)
  );

  const isManager = (project.managers || []).some(user => idsEqual(user, userId));
  return Boolean(isUserInProject || isCreator || isManager || hasAssignedTask);
};

const sendProjectTaskAssignmentEmail = async ({ user, actorName, taskTitle, projectName, dueDate }) => {
  if (!user?.email) return;

  const dueText = dueDate ? new Date(dueDate).toLocaleString("en-IN") : "No due date";
  const subject = `New Project Task Assigned: ${taskTitle}`;
  const html = `<div style="font-family: Arial, sans-serif; padding: 20px; color: #222;">
    <h2>New Project Task Assigned</h2>
    <p>Hello <strong>${user.name || "User"}</strong>,</p>
    <p><strong>${actorName || "Team"}</strong> assigned you a project task.</p>
    <p><strong>Project:</strong> ${projectName}</p>
    <p><strong>Task:</strong> ${taskTitle}</p>
    <p><strong>Due:</strong> ${dueText}</p>
  </div>`;

  try {
    await sendEmail(user.email, subject, html, { skipNotification: true });
  } catch (error) {
    console.error("Project task assignment email failed:", error.message);
  }
};

const getObjectIdTime = (id) => {
  const value = String(id || "");
  if (!/^[a-f\d]{24}$/i.test(value)) return 0;
  return parseInt(value.slice(0, 8), 16) * 1000;
};

const getTaskCreatedTime = (task = {}) => {
  const creationLog = Array.isArray(task.activityLogs)
    ? task.activityLogs.find(log => log?.type === "creation")
    : null;
  const date = new Date(
    task.createdAt ||
    task.createdDate ||
    creationLog?.performedAt ||
    creationLog?.createdAt ||
    0
  );
  const parsedTime = Number.isNaN(date.getTime()) ? 0 : date.getTime();
  if (parsedTime) return parsedTime;
  return getObjectIdTime(task._id || task.id);
};

const sortProjectTasksByCreatedAt = (tasks = []) => (
  Array.isArray(tasks)
    ? [...tasks].sort((a, b) => {
      const createdDiff = getTaskCreatedTime(b) - getTaskCreatedTime(a);
      if (createdDiff !== 0) return createdDiff;
      return new Date(b.updatedAt || b.dueDate || 0) - new Date(a.updatedAt || a.dueDate || 0);
    })
    : []
);

const sanitizeFileBaseName = (value, fallback = 'Document') => {
  const clean = String(value || '')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 60);
  return clean || fallback;
};

const getProjectDocumentName = (project, originalName = '') => {
  const safeName = sanitizeFileBaseName(project?.projectName || project?.name || 'Project');
  const ext = path.extname(originalName || project?.pdfFile?.filename || project?.pdfFile?.path || '.pdf') || '.pdf';
  return `${safeName}_Document${ext.toLowerCase()}`;
};

const getTaskDocumentName = (task, project = null, originalName = '') => {
  const safeTitle = sanitizeFileBaseName(task?.title || 'Task');
  const ext = path.extname(originalName || task?.pdfFile?.filename || task?.pdfFile?.path || '.pdf') || '.pdf';
  return `${safeTitle}_Document${ext.toLowerCase()}`;
};

const resolveProjectFilePath = (rawPath, filename) => {
  const cleanName = path.basename(String(rawPath || filename || "").replace(/\\/g, "/"));
  const normalizedRaw = rawPath ? String(rawPath).replace(/\\/g, "/") : "";

  const candidates = [
    rawPath ? path.resolve(rawPath) : null,
    rawPath ? path.resolve(process.cwd(), rawPath) : null,
    rawPath ? path.resolve(__dirname, "../../", rawPath) : null,
    rawPath ? path.resolve(__dirname, "../", rawPath) : null,
    normalizedRaw ? path.resolve(process.cwd(), normalizedRaw.replace(/^\/+/, "")) : null,
    cleanName ? path.resolve(process.cwd(), "uploads", "projects", cleanName) : null,
    cleanName ? path.resolve(process.cwd(), "HR-CDS", "uploads", "projects", cleanName) : null,
    cleanName ? path.resolve(__dirname, "../../uploads/projects", cleanName) : null,
    cleanName ? path.resolve(__dirname, "../uploads/projects", cleanName) : null,
    cleanName ? path.resolve("/var/www/app2/uploads/projects", cleanName) : null,
    cleanName ? path.resolve("/var/www/app1/uploads/projects", cleanName) : null,
    cleanName ? path.resolve("/var/www/app2/HR-CDS/uploads/projects", cleanName) : null,
    cleanName ? path.resolve("/var/www/app1/HR-CDS/uploads/projects", cleanName) : null,
    cleanName ? path.resolve("/var/www/backendruno/uploads/projects", cleanName) : null,
    cleanName ? path.resolve("/var/www/backendruno/HR-CDS/uploads/projects", cleanName) : null,
    cleanName ? path.resolve("/var/www/backendruno_backup_20261007/uploads/projects", cleanName) : null,
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch (_) {}
  }
  return null;
};

const normalizeProjectPdfFile = (project) => {
  const pdfFile = project?.pdfFile;
  const rawPath = String(pdfFile?.path || pdfFile?.url || '').trim();
  if (!pdfFile || !rawPath) return null;
  const original = pdfFile.originalName || pdfFile.filename || path.basename(rawPath);
  const resolved = resolveProjectFilePath(rawPath, original);
  if (!resolved && !String(rawPath).startsWith('http')) return null;
  return {
    ...pdfFile,
    filename: original,
    originalName: original,
    path: rawPath.replace(/\\/g, '/'),
  };
};

const normalizeTaskPdfFile = (task, project = null) => {
  const pdfFile = task?.pdfFile;
  const rawPath = String(pdfFile?.path || pdfFile?.url || '').trim();
  if (!pdfFile || !rawPath) return null;
  const original = pdfFile.originalName || pdfFile.filename || path.basename(rawPath);
  return {
    ...pdfFile,
    filename: original,
    originalName: original,
    path: rawPath.replace(/\\/g, '/'),
  };
};

const withSortedProjectTasks = (project) => {
  const plainProject = typeof project?.toObject === "function" ? project.toObject() : project;
  const sortedTasks = sortProjectTasksByCreatedAt(plainProject?.tasks);
  const normalizedTasks = sortedTasks.map(t => ({
    ...t,
    pdfFile: normalizeTaskPdfFile(t, plainProject),
  }));
  return {
    ...plainProject,
    pdfFile: normalizeProjectPdfFile(plainProject),
    tasks: normalizedTasks
  };
};

const withProjectSummary = (project) => {
  const plainProject = typeof project?.toObject === "function" ? project.toObject() : project;
  const taskCount = Array.isArray(plainProject?.tasks) ? plainProject.tasks.length : 0;
  const completedTaskCount = Array.isArray(plainProject?.tasks)
    ? plainProject.tasks.filter(task => String(task?.status || "").trim().toLowerCase() === "completed").length
    : 0;
  const { tasks, notifications, ...summary } = plainProject || {};

  return {
    ...summary,
    pdfFile: normalizeProjectPdfFile(plainProject),
    taskCount,
    completedTaskCount,
    taskProgress: taskCount ? Math.round((completedTaskCount / taskCount) * 100) : 0
  };
};

const sendProjectAttachment = (req, res, attachment, fallbackName = "document.pdf") => {
  const rawPath = attachment?.path || attachment?.url || attachment?.fileUrl;
  const rawFilename = attachment?.filename || attachment?.originalname || (rawPath ? path.basename(rawPath) : "") || fallbackName;

  if (!rawPath && !attachment?.filename) {
    return res.status(404).json({ success: false, message: "Document not found" });
  }

  const filePath = resolveProjectFilePath(rawPath, rawFilename);
  if (!filePath) {
    return res.status(404).json({ success: false, message: "Document file not found on server" });
  }

  const filename = attachment?.filename || attachment?.originalname || path.basename(filePath) || fallbackName;
  const isInline = ["true", "1", "inline", "yes"].includes(
    String(req.query?.view || req.query?.preview || req.query?.inline || "").toLowerCase()
  );

  const ext = path.extname(filename).toLowerCase();
  const mimeTypes = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
  };
  const contentType = mimeTypes[ext] || "application/octet-stream";

  if (isInline) {
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(filename)}"`);
    return res.sendFile(filePath);
  }

  return res.download(filePath, filename);
};

exports.downloadProjectDocument = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id).lean();
    if (!project) {
      return res.status(404).json({ success: false, message: "Project not found" });
    }

    if (!hasProjectAccess(project, req.user.id, req.user.role, req.user)) {
      return res.status(403).json({ success: false, message: "Access denied to download document" });
    }

    const documentName = getProjectDocumentName(project, project.pdfFile?.filename || project.pdfFile?.originalName);
    return sendProjectAttachment(req, res, { ...project.pdfFile, filename: documentName }, documentName);
  } catch (error) {
    console.error("❌ Error downloading project document:", error);
    return res.status(500).json({ success: false, message: "Error downloading project document" });
  }
};

exports.downloadTaskDocument = async (req, res) => {
  try {
    const { id, taskId } = req.params;
    const project = await Project.findById(id).lean();
    if (!project) {
      return res.status(404).json({ success: false, message: "Project not found" });
    }

    if (!hasProjectAccess(project, req.user.id, req.user.role, req.user)) {
      return res.status(403).json({ success: false, message: "Access denied to download document" });
    }

    const task = (project.tasks || []).find(item => idsEqual(item._id, taskId));
    if (!task) {
      return res.status(404).json({ success: false, message: "Task not found" });
    }

    const documentName = getTaskDocumentName(task, project, task.pdfFile?.filename || task.pdfFile?.originalName);
    return sendProjectAttachment(req, res, { ...task.pdfFile, filename: documentName }, documentName);
  } catch (error) {
    console.error("❌ Error downloading task document:", error);
    return res.status(500).json({ success: false, message: "Error downloading task document" });
  }
};


exports.getUserNotifications = async (req, res) => {
  try {
    void 0;

    const projects = await Project.find({
      users: req.user.id
    }).populate('notifications.createdBy', 'name email');

    let allNotifications = [];
    projects.forEach(project => {
      project.notifications.forEach(notification => {
        allNotifications.push({
          ...notification.toObject(),
          projectName: project.projectName,
          projectId: project._id
        });
      });
    });


    allNotifications.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.status(200).json({
      success: true,
      count: allNotifications.length,
      notifications: allNotifications
    });
  } catch (error) {
    console.error("❌ Error fetching notifications:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching notifications"
    });
  }
};

exports.markNotificationAsRead = async (req, res) => {
  try {
    const { notificationId } = req.params;

    void 0;


    const project = await Project.findOne({
      'notifications._id': notificationId
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        message: "Notification not found"
      });
    }


    const notification = project.notifications.id(notificationId);
    if (notification) {
      notification.isRead = true;
      await project.save();
    }

    res.status(200).json({
      success: true,
      message: "Notification marked as read"
    });
  } catch (error) {
    console.error("❌ Error marking notification as read:", error);
    res.status(500).json({
      success: false,
      message: "Error marking notification as read"
    });
  }
};

exports.clearAllNotifications = async (req, res) => {
  try {
    void 0;

    await Project.updateMany(
      { users: req.user.id },
      { $set: { notifications: [] } }
    );

    res.status(200).json({
      success: true,
      message: "All notifications cleared"
    });
  } catch (error) {
    console.error("❌ Error clearing notifications:", error);
    res.status(500).json({
      success: false,
      message: "Error clearing notifications"
    });
  }
};




exports.listProjects = async (req, res) => {
  try {
    void 0;
    void 0;

    const companyId = getUserCompanyId(req.user);
    const companyCode = getUserCompanyCode(req.user);
    const requestedBranchId = getRequestedBranchId(req);
    const branchAccess = await validateProjectBranchAccess(req, requestedBranchId);
    if (branchAccess.error) {
      return res.status(branchAccess.error.status).json({
        success: false,
        message: branchAccess.error.message
      });
    }

    const companyUserIds = await getBranchScopedCompanyUserIds(req, await getCompanyUserIds(req.user));
    const companyUserFilter = {
      $or: [
        { users: { $in: companyUserIds } },
        { createdBy: { $in: companyUserIds } }
      ]
    };

    const companyFilters = [];
    if (companyId) companyFilters.push({ company: companyId });
    if (companyCode) companyFilters.push({ companyCode });
    companyFilters.push(companyUserFilter);

    const branchRequested = Boolean(requestedBranchId);
    let query = branchRequested
      ? {
        $and: [
          { $or: companyFilters },
          {
            $or: [
              { branch: requestedBranchId },
              { branch: { $exists: false }, ...companyUserFilter },
              { branch: null, ...companyUserFilter }
            ]
          }
        ]
      }
      : { $or: companyFilters };


    if (!isProjectAdmin(req.user)) {
      const userObjId = mongoose.Types.ObjectId.isValid(req.user.id) ? new mongoose.Types.ObjectId(req.user.id) : null;
      query = {
        $and: [
          query,
          {
            $or: [
              { users: req.user.id },
              { createdBy: req.user.id },
              { "tasks.assignedTo": req.user.id },
              { "tasks.assignedUsers": req.user.id },
              ...(userObjId ? [
                { users: userObjId },
                { createdBy: userObjId },
                { "tasks.assignedTo": userObjId },
                { "tasks.assignedUsers": userObjId },
              ] : [])
            ]
          }
        ]
      };
      void 0;
    } else {
      void 0;
    }

    const { page, limit, skip } = getPaginationOptions(req.query, { limit: 25, maxLimit: 100 });
    const summaryMode = ["1", "true", "yes"].includes(String(req.query.summary || "").toLowerCase());

    if (summaryMode) {
      const [summaryProjects, total] = await Promise.all([
        Project.find(query)
          .select('projectName description company companyCode branch status startDate endDate priority pdfFile createdBy createdAt updatedAt tasks._id tasks.status users')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Project.countDocuments(query)
      ]);

      const items = summaryProjects.map(project => ({
        ...project,
        pdfFile: normalizeProjectPdfFile(project),
        taskCount: Array.isArray(project.tasks) ? project.tasks.length : 0,
        completedTaskCount: Array.isArray(project.tasks)
          ? project.tasks.filter(task => String(task?.status || "").trim().toLowerCase() === "completed").length
          : 0,
        taskProgress: Array.isArray(project.tasks) && project.tasks.length
          ? Math.round((project.tasks.filter(task => String(task?.status || "").trim().toLowerCase() === "completed").length / project.tasks.length) * 100)
          : 0,
        userCount: Array.isArray(project.users) ? project.users.length : 0,
        tasks: undefined,
      }));

      return res.status(200).json({
        success: true,
        count: items.length,
        total,
        pagination: buildPaginationMeta({ page, limit, total }),
        items
      });
    }

    const projectQuery = Project.find(query)
      .populate('users', PROJECT_USER_POPULATE_FIELDS)
      .populate('branch', 'name branchCode')
      .populate('createdBy', PROJECT_USER_POPULATE_FIELDS)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    projectQuery
      .populate('tasks.assignedTo', PROJECT_TASK_USER_POPULATE_FIELDS)
      .populate('tasks.assignedUsers', PROJECT_TASK_USER_POPULATE_FIELDS)
      .populate('tasks.createdBy', PROJECT_TASK_USER_POPULATE_FIELDS);

    const [projects, total] = await Promise.all([
      projectQuery.lean(),
      Project.countDocuments(query)
    ]);

    const scopedProjects = projects
      .filter(project => projectBelongsToUserCompany(project, req.user))
      .filter(project => projectMatchesRequestedBranch(project, requestedBranchId))
      .map(summaryMode ? withProjectSummary : withSortedProjectTasks);

    void 0;

    res.status(200).json({
      success: true,
      count: scopedProjects.length,
      total,
      pagination: buildPaginationMeta({ page, limit, total }),
      items: scopedProjects
    });
  } catch (error) {
    console.error("❌ Error listing projects:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching projects"
    });
  }
};

exports.getProjectById = async (req, res) => {
  try {
    const projectId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(projectId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid project ID"
      });
    }

    const id = new mongoose.Types.ObjectId(projectId);
    const now = new Date();

    // Pagination & Filter params
    const isAllRequested = ['1', 'true', 'yes'].includes(String(req.query.all || '').toLowerCase());
    const rawPage = parseInt(req.query.page, 10);
    const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;

    const rawLimit = parseInt(req.query.limit, 10);
    const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(Math.max(rawLimit, 1), 100) : 10;
    const startIndex = (page - 1) * limit;

    // Build filter conditions for tasks
    const filterConds = [];

    const statusFilter = String(req.query.status || '').trim().toLowerCase();
    if (statusFilter && statusFilter !== 'all') {
      if (statusFilter === 'overdue') {
        filterConds.push({
          $or: [
            { $eq: [{ $toLower: { $ifNull: ["$$t.status", "pending"] } }, "overdue"] },
            {
              $and: [
                { $eq: [{ $toLower: { $ifNull: ["$$t.status", "pending"] } }, "pending"] },
                { $lt: ["$$t.dueDate", now] }
              ]
            }
          ]
        });
      } else if (statusFilter === 'high priority' || statusFilter === 'high-priority') {
        filterConds.push({
          $eq: [{ $toLower: { $ifNull: ["$$t.priority", "medium"] } }, "high"]
        });
      } else if (statusFilter === 'in-progress' || statusFilter === 'in progress') {
        filterConds.push({
          $in: [{ $toLower: { $ifNull: ["$$t.status", "pending"] } }, ["in-progress", "in progress", "inprogress"]]
        });
      } else if (statusFilter === 'onhold' || statusFilter === 'on hold') {
        filterConds.push({
          $in: [{ $toLower: { $ifNull: ["$$t.status", "pending"] } }, ["onhold", "on hold"]]
        });
      } else if (statusFilter === 'pending') {
        filterConds.push({
          $and: [
            { $eq: [{ $toLower: { $ifNull: ["$$t.status", "pending"] } }, "pending"] },
            {
              $or: [
                { $eq: [{ $ifNull: ["$$t.dueDate", null] }, null] },
                { $gte: ["$$t.dueDate", now] }
              ]
            }
          ]
        });
      } else {
        filterConds.push({
          $eq: [{ $toLower: { $ifNull: ["$$t.status", "pending"] } }, statusFilter]
        });
      }
    }

    const teamFilter = String(req.query.team || req.query.assignee || '').trim();
    if (teamFilter && teamFilter !== 'all') {
      if (teamFilter === 'unassigned') {
        filterConds.push({
          $and: [
            { $eq: [{ $ifNull: ["$$t.assignedTo", null] }, null] },
            { $eq: [{ $size: { $ifNull: ["$$t.assignedUsers", []] } }, 0] }
          ]
        });
      } else if (mongoose.Types.ObjectId.isValid(teamFilter)) {
        const teamObjId = new mongoose.Types.ObjectId(teamFilter);
        filterConds.push({
          $or: [
            { $eq: ["$$t.assignedTo", teamObjId] },
            { $in: [teamObjId, { $ifNull: ["$$t.assignedUsers", []] }] }
          ]
        });
      }
    }

    const searchTerm = String(req.query.search || '').trim();
    if (searchTerm) {
      filterConds.push({
        $or: [
          { $regexMatch: { input: { $ifNull: ["$$t.title", ""] }, regex: searchTerm, options: "i" } },
          { $regexMatch: { input: { $ifNull: ["$$t.description", ""] }, regex: searchTerm, options: "i" } }
        ]
      });
    }

    const taskFilterExpr = filterConds.length === 0
      ? { $ifNull: ["$tasks", []] }
      : {
          $filter: {
            input: { $ifNull: ["$tasks", []] },
            as: "t",
            cond: { $and: filterConds }
          }
        };

    // Run project metadata query and task aggregation in parallel
    const [project, aggResults] = await Promise.all([
      Project.findById(id)
        .select('projectName description company companyCode branch users status startDate endDate priority pdfFile createdBy createdAt updatedAt')
        .populate('users', PROJECT_USER_POPULATE_FIELDS)
        .populate('createdBy', PROJECT_USER_POPULATE_FIELDS)
        .populate('branch', 'name branchCode')
        .lean(),
      Project.aggregate([
        { $match: { _id: id } },
        {
          $project: {
            stats: {
              totalTasks: { $size: { $ifNull: ["$tasks", []] } },
              completedTasks: {
                $size: {
                  $filter: {
                    input: { $ifNull: ["$tasks", []] },
                    as: "t",
                    cond: { $eq: [{ $toLower: { $ifNull: ["$$t.status", "pending"] } }, "completed"] }
                  }
                }
              },
              inProgressTasks: {
                $size: {
                  $filter: {
                    input: { $ifNull: ["$tasks", []] },
                    as: "t",
                    cond: {
                      $in: [
                        { $toLower: { $ifNull: ["$$t.status", "pending"] } },
                        ["in-progress", "in progress", "inprogress"]
                      ]
                    }
                  }
                }
              },
              overdueTasks: {
                $size: {
                  $filter: {
                    input: { $ifNull: ["$tasks", []] },
                    as: "t",
                    cond: {
                      $or: [
                        { $eq: [{ $toLower: { $ifNull: ["$$t.status", "pending"] } }, "overdue"] },
                        {
                          $and: [
                            { $eq: [{ $toLower: { $ifNull: ["$$t.status", "pending"] } }, "pending"] },
                            { $lt: ["$$t.dueDate", now] }
                          ]
                        }
                      ]
                    }
                  }
                }
              },
              pendingTasks: {
                $size: {
                  $filter: {
                    input: { $ifNull: ["$tasks", []] },
                    as: "t",
                    cond: {
                      $and: [
                        { $eq: [{ $toLower: { $ifNull: ["$$t.status", "pending"] } }, "pending"] },
                        {
                          $or: [
                            { $eq: [{ $ifNull: ["$$t.dueDate", null] }, null] },
                            { $gte: ["$$t.dueDate", now] }
                          ]
                        }
                      ]
                    }
                  }
                }
              },
              onHoldTasks: {
                $size: {
                  $filter: {
                    input: { $ifNull: ["$tasks", []] },
                    as: "t",
                    cond: {
                      $in: [
                        { $toLower: { $ifNull: ["$$t.status", "pending"] } },
                        ["onhold", "on hold"]
                      ]
                    }
                  }
                }
              },
              cancelledTasks: {
                $size: {
                  $filter: {
                    input: { $ifNull: ["$tasks", []] },
                    as: "t",
                    cond: { $eq: [{ $toLower: { $ifNull: ["$$t.status", "pending"] } }, "cancelled"] }
                  }
                }
              },
              unassignedTasks: {
                $size: {
                  $filter: {
                    input: { $ifNull: ["$tasks", []] },
                    as: "t",
                    cond: {
                      $and: [
                        { $eq: [{ $ifNull: ["$$t.assignedTo", null] }, null] },
                        { $eq: [{ $size: { $ifNull: ["$$t.assignedUsers", []] } }, 0] }
                      ]
                    }
                  }
                }
              }
            },
            tasksSummary: {
              $map: {
                input: { $ifNull: ["$tasks", []] },
                as: "t",
                in: {
                  assignedTo: "$$t.assignedTo",
                  assignedUsers: "$$t.assignedUsers",
                  status: "$$t.status",
                  dueDate: "$$t.dueDate"
                }
              }
            },
            matchedTasks: {
              $sortArray: {
                input: taskFilterExpr,
                sortBy: { createdAt: -1 }
              }
            }
          }
        },
        {
          $project: {
            stats: {
              $mergeObjects: [
                "$stats",
                {
                  progress: {
                    $cond: [
                      { $gt: ["$stats.totalTasks", 0] },
                      { $round: [{ $multiply: [{ $divide: ["$stats.completedTasks", "$stats.totalTasks"] }, 100] }, 0] },
                      0
                    ]
                  }
                }
              ]
            },
            tasksSummary: 1,
            totalFiltered: { $size: "$matchedTasks" },
            // Omit activityLogs from slicedTasks for ultra-lightweight response (activity logs load on demand via /activity endpoint)
            slicedTasks: {
              $map: {
                input: isAllRequested
                  ? "$matchedTasks"
                  : { $slice: ["$matchedTasks", startIndex, limit] },
                as: "st",
                in: {
                  _id: "$$st._id",
                  title: "$$st.title",
                  description: "$$st.description",
                  assignedTo: "$$st.assignedTo",
                  assignedUsers: "$$st.assignedUsers",
                  dueDate: "$$st.dueDate",
                  dueDateTime: "$$st.dueDateTime",
                  onHoldReleasedAt: "$$st.onHoldReleasedAt",
                  completionDate: "$$st.completionDate",
                  priority: "$$st.priority",
                  status: "$$st.status",
                  pdfFile: "$$st.pdfFile",
                  checkpoints: "$$st.checkpoints",
                  reminderSettings: "$$st.reminderSettings",
                  remarks: "$$st.remarks",
                  createdBy: "$$st.createdBy",
                  createdAt: "$$st.createdAt",
                  updatedAt: "$$st.updatedAt"
                }
              }
            }
          }
        }
      ])
    ]);

    if (!project) {
      return res.status(404).json({
        success: false,
        message: "Project not found"
      });
    }

    const agg = aggResults[0] || {};
    const totalFiltered = agg.totalFiltered || 0;
    const totalPages = Math.max(1, Math.ceil(totalFiltered / limit));
    const safePage = Math.min(page, totalPages);
    const slicedTasks = agg.slicedTasks || [];
    const tasksSummary = agg.tasksSummary || [];

    // Access control check
    const isCompanyAdmin = isProjectAdmin(req.user);
    const isMember = Array.isArray(project.users) && project.users.some(u => idsEqual(u, req.user.id));
    const isCreator = idsEqual(project.createdBy, req.user.id);
    const hasAssignedTask = tasksSummary.some(t => {
      const assignees = [t.assignedTo, ...(t.assignedUsers || [])].filter(Boolean);
      return assignees.some(a => idsEqual(a, req.user.id));
    });

    if (!projectBelongsToUserCompany(project, req.user) || (!isCompanyAdmin && !isMember && !isCreator && !hasAssignedTask)) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You are not a member of this project.",
        details: {
          userId: req.user.id,
          userRole: req.user.role,
          projectId: project._id,
          projectUsers: (project.users || []).map(u => u._id || u)
        }
      });
    }

    // Populate user details on ONLY the sliced tasks (super fast!)
    if (slicedTasks.length > 0) {
      await Project.populate(slicedTasks, [
        { path: 'assignedTo', select: PROJECT_TASK_USER_POPULATE_FIELDS, model: 'User' },
        { path: 'assignedUsers', select: PROJECT_TASK_USER_POPULATE_FIELDS, model: 'User' },
        { path: 'createdBy', select: PROJECT_TASK_USER_POPULATE_FIELDS, model: 'User' },
        { path: 'remarks.createdBy', select: PROJECT_TASK_USER_POPULATE_FIELDS, model: 'User' }
      ]);
    }

    // Calculate user task summary over ALL tasks (in memory, ~1ms)
    const projectUsers = Array.isArray(project.users) ? project.users : [];
    const userTaskSummary = projectUsers.map(member => {
      const memberId = normalizeId(member._id || member.id || member);
      const memberTasks = tasksSummary.filter(t => {
        const assignees = [t.assignedTo, ...(t.assignedUsers || [])].filter(Boolean).map(a => normalizeId(a?._id || a?.id || a));
        return assignees.includes(memberId);
      });
      return {
        id: memberId,
        name: member?.name || member?.email || (memberId ? `User (${memberId.slice(-4)})` : 'Member'),
        email: member?.email || '',
        role: member?.role || member?.jobRole || member?.companyRole || '',
        total: memberTasks.length,
        completed: memberTasks.filter(t => normalizeTaskStatus(t.status) === 'completed').length,
        pending: memberTasks.filter(t => normalizeTaskStatus(t.status) === 'pending' && (!t.dueDate || new Date(t.dueDate) >= now)).length,
        inProgress: memberTasks.filter(t => ['in-progress', 'in progress'].includes(normalizeTaskStatus(t.status))).length,
      };
    });

    const unassignedTasksCount = agg.stats?.unassignedTasks || 0;
    if (unassignedTasksCount > 0 || userTaskSummary.length === 0) {
      const unassignedList = tasksSummary.filter(t => [t.assignedTo, ...(t.assignedUsers || [])].filter(Boolean).length === 0);
      userTaskSummary.push({
        id: 'unassigned',
        name: 'Unassigned',
        email: '',
        role: '',
        total: unassignedList.length,
        completed: unassignedList.filter(t => normalizeTaskStatus(t.status) === 'completed').length,
        pending: unassignedList.filter(t => normalizeTaskStatus(t.status) === 'pending' && (!t.dueDate || new Date(t.dueDate) >= now)).length,
        inProgress: unassignedList.filter(t => ['in-progress', 'in progress'].includes(normalizeTaskStatus(t.status))).length,
      });
    }

    const normalizedTasks = slicedTasks.map(t => ({
      ...t,
      pdfFile: normalizeTaskPdfFile(t, project),
    }));

    res.status(200).json({
      success: true,
      ...project,
      pdfFile: normalizeProjectPdfFile(project),
      tasks: normalizedTasks,
      stats: agg.stats || {
        totalTasks: 0,
        completedTasks: 0,
        pendingTasks: 0,
        inProgressTasks: 0,
        overdueTasks: 0,
        onHoldTasks: 0,
        cancelledTasks: 0,
        unassignedTasks: 0,
        progress: 0,
      },
      userTaskSummary,
      pagination: {
        total: totalFiltered,
        page: safePage,
        limit,
        totalPages,
        hasNextPage: safePage < totalPages,
        hasPrevPage: safePage > 1,
      },
      userHasAccess: true,
    });
  } catch (error) {
    console.error("❌ Error fetching project:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching project"
    });
  }
};

exports.createProject = async (req, res) => {
  try {
    handleFileUpload(req, res, async (err) => {
      if (err) {
        return res.status(400).json({
          success: false,
          message: err.message
        });
      }

      const { projectName, description, startDate, endDate, priority, status, users } = req.body;
      const requestedBranchId = getRequestedBranchId(req);
      const branchAccess = await validateProjectBranchAccess(req, requestedBranchId);
      if (branchAccess.error) {
        return res.status(branchAccess.error.status).json({
          success: false,
          message: branchAccess.error.message
        });
      }

      void 0;
      void 0;
      void 0;
      void 0;

      let usersArray = [];
      try {
        usersArray = JSON.parse(users);
      } catch (parseError) {
        usersArray = Array.isArray(users) ? users : [];
      }


      usersArray = [...new Set(usersArray.filter(Boolean).map(id => String(id)))];
      const allowedUserIds = await getBranchUserIds(req, branchAccess.branchId);
      usersArray = usersArray.filter(id => allowedUserIds.includes(id));

      if (usersArray.length === 0) {
        return res.status(400).json({
          success: false,
          message: branchAccess.branchId
            ? "Select at least one member from the selected branch"
            : "Select at least one member"
        });
      }


      if (allowedUserIds.includes(String(req.user.id)) && !usersArray.includes(String(req.user.id))) {
        usersArray.push(String(req.user.id));
        void 0;
      }


      const projectData = {
        projectName,
        description,
        company: getUserCompanyId(req.user),
        companyCode: getUserCompanyCode(req.user),
        branch: branchAccess.branchId,
        users: usersArray,
        managers: parseMentionIds(req.body.managers).filter(value => allowedUserIds.includes(String(value))),
        startDate,
        endDate,
        priority: priority?.toLowerCase(),
        status: status?.toLowerCase(),
        createdBy: req.user.id
      };


      if (req.file) {
        const projectFileName = getProjectDocumentName(projectData, req.file.originalname || req.file.filename);
        projectData.pdfFile = {
          filename: projectFileName,
          originalName: projectFileName,
          path: req.file.path
        };
      }

      const project = new Project(projectData);
      await project.save();


      const notification = {
        title: "New Project Created",
        message: `${req.user.name} created project "${projectName}"`,
        type: "project_created",
        relatedTo: "project",
        referenceId: project._id,
        createdBy: req.user.id
      };

      await project.addNotification(notification);

      await notifyDirectUsers({
        userIds: usersArray.filter(userId => userId !== req.user.id),
        targetPath: '/ciisUser/project',
        type: 'project_created',
        title: 'New Project Created',
        message: `${req.user.name} added you to project "${projectName}"`,
        actor: req.user.id,
        data: {
          projectId: project._id,
          projectName,
        },
        priority: priority?.toLowerCase() || 'medium',
      });

      void 0;

      res.status(201).json({
        success: true,
        message: "Project created successfully",
        project
      });
    });
  } catch (error) {
    console.error("❌ Error creating project:", error);
    res.status(500).json({
      success: false,
      message: "Error creating project"
    });
  }
};

exports.updateProject = async (req, res) => {
  try {
    handleFileUpload(req, res, async (err) => {
      if (err) {
        return res.status(400).json({
          success: false,
          message: err.message
        });
      }

      const { id } = req.params;
      const { projectName, description, startDate, endDate, priority, status, users } = req.body;
      const requestedBranchId = getRequestedBranchId(req);

      void 0;
      void 0;


      const project = await Project.findById(id);
      if (!project) {
        return res.status(404).json({
          success: false,
          message: "Project not found"
        });
      }


      if (!hasProjectAccess(project, req.user.id, req.user.role, req.user)) {
        return res.status(403).json({
          success: false,
          message: "Access denied to update project"
        });
      }

      const branchAccess = await validateProjectBranchAccess(req, requestedBranchId || normalizeId(project.branch));
      if (branchAccess.error) {
        return res.status(branchAccess.error.status).json({
          success: false,
          message: branchAccess.error.message
        });
      }

      let usersArray = [];
      try {
        usersArray = JSON.parse(users);
      } catch (parseError) {
        usersArray = Array.isArray(users) ? users : [];
      }


      usersArray = [...new Set(usersArray.filter(Boolean).map(id => String(id)))];
      const allowedUserIds = await getBranchUserIds(req, branchAccess.branchId);
      usersArray = usersArray.filter(id => allowedUserIds.includes(id));

      if (usersArray.length === 0) {
        return res.status(400).json({
          success: false,
          message: branchAccess.branchId
            ? "Select at least one member from the selected branch"
            : "Select at least one member"
        });
      }


      project.projectName = projectName || project.projectName;
      project.description = description || project.description;
      project.branch = branchAccess.branchId || project.branch;
      project.users = usersArray;
      if (req.body.managers !== undefined) project.managers = parseMentionIds(req.body.managers).filter(value => allowedUserIds.includes(String(value)));
      project.startDate = startDate || project.startDate;
      project.endDate = endDate || project.endDate;
      project.priority = priority?.toLowerCase() || project.priority;
      project.status = status?.toLowerCase() || project.status;


      if (req.file) {

        if (project.pdfFile && project.pdfFile.path) {
          fs.unlink(project.pdfFile.path, (err) => {
            if (err) console.error("Error deleting old file:", err);
          });
        }

        const projectFileName = getProjectDocumentName(project, req.file.originalname || req.file.filename);
        project.pdfFile = {
          filename: projectFileName,
          originalName: projectFileName,
          path: req.file.path
        };
      }

      await project.save();


      const notification = {
        title: "Project Updated",
        message: `${req.user.name} updated project "${projectName}"`,
        type: "project_updated",
        relatedTo: "project",
        referenceId: project._id,
        createdBy: req.user.id
      };

      await project.addNotification(notification);

      void 0;

      res.status(200).json({
        success: true,
        message: "Project updated successfully",
        project
      });
    });
  } catch (error) {
    console.error("❌ Error updating project:", error);
    res.status(500).json({
      success: false,
      message: "Error updating project"
    });
  }
};

exports.deleteProject = async (req, res) => {
  try {
    void 0;
    void 0;

    const project = await Project.findById(req.params.id);

    if (!project) {
      return res.status(404).json({
        success: false,
        message: "Project not found"
      });
    }


    const canDelete = projectBelongsToUserCompany(project, req.user) && (
      isProjectAdmin(req.user) ||
      project.createdBy?.toString() === req.user.id
    );

    if (!canDelete) {
      return res.status(403).json({
        success: false,
        message: "Access denied to delete project"
      });
    }


    if (project.pdfFile && project.pdfFile.path) {
      fs.unlink(project.pdfFile.path, (err) => {
        if (err) console.error("Error deleting file:", err);
      });
    }


    project.tasks.forEach(task => {
      if (task.pdfFile && task.pdfFile.path) {
        fs.unlink(task.pdfFile.path, (err) => {
          if (err) console.error("Error deleting task file:", err);
        });
      }
    });

    await project.deleteOne();

    void 0;

    res.status(200).json({
      success: true,
      message: "Project deleted successfully"
    });
  } catch (error) {
    console.error("❌ Error deleting project:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting project"
    });
  }
};




exports.getProjectUsers = async (req, res) => {
  try {
    void 0;
    void 0;
    void 0;
    void 0;

    const project = await Project.findById(req.params.id)
      .select('users projectName createdBy')
      .populate('users', PROJECT_USER_POPULATE_FIELDS)
      .populate('createdBy', PROJECT_USER_POPULATE_FIELDS);

    if (!project) {
      return res.status(404).json({
        success: false,
        message: "Project not found"
      });
    }


    if (!hasProjectAccess(project, req.user.id, req.user.role, req.user)) {
      return res.status(403).json({
        success: false,
        message: "Access denied to view project users"
      });
    }

    res.status(200).json({
      success: true,
      projectName: project.projectName,
      createdBy: project.createdBy,
      users: project.users,
      totalUsers: project.users.length,
      hasAccess: hasProjectAccess(project, req.user.id, req.user.role, req.user)
    });
  } catch (error) {
    console.error("❌ Error fetching project users:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching project users"
    });
  }
};

exports.addUserToProject = async (req, res) => {
  try {
    const { projectId } = req.params;
    const { userId } = req.body;

    void 0;
    void 0;
    void 0;
    void 0;

    const project = await Project.findById(projectId);

    if (!project) {
      return res.status(404).json({
        success: false,
        message: "Project not found"
      });
    }


    if (!hasProjectAccess(project, req.user.id, req.user.role, req.user)) {
      return res.status(403).json({
        success: false,
        message: "Access denied to modify project"
      });
    }


    const userExists = project.users.some(userIdObj =>
      userIdObj.toString() === userId
    );

    if (userExists) {
      return res.status(400).json({
        success: false,
        message: "User already in project"
      });
    }


    project.users.push(userId);
    await project.save();


    const notification = {
      title: "User Added to Project",
      message: `${req.user.name} added a new user to project "${project.projectName}"`,
      type: "project_updated",
      relatedTo: "project",
      referenceId: project._id,
      createdBy: req.user.id
    };

    await project.addNotification(notification);

    res.status(200).json({
      success: true,
      message: "User added to project successfully",
      projectId: project._id,
      userId: userId
    });
  } catch (error) {
    console.error("❌ Error adding user to project:", error);
    res.status(500).json({
      success: false,
      message: "Error adding user to project"
    });
  }
};




exports.addTask = async (req, res) => {
  try {
    handleFileUpload(req, res, async (err) => {
      if (err) {
        return res.status(400).json({
          success: false,
          message: err.message
        });
      }

      const { id } = req.params;
      const { title, description, assignedTo, dueDate, priority, status, checkpoints } = req.body;
      void 0;
      void 0;
      void 0;

      const project = await Project.findById(id);
      if (!project) {
        return res.status(404).json({
          success: false,
          message: "Project not found"
        });
      }


      if (!hasProjectAccess(project, req.user.id, req.user.role, req.user)) {
        return res.status(403).json({
          success: false,
          message: "Access denied to add task"
        });
      }

      const rawAssignedUsers = req.body.assignedUsers;
      const requestedAssigneeIds = (
        Array.isArray(rawAssignedUsers)
          ? rawAssignedUsers
          : rawAssignedUsers
            ? [rawAssignedUsers]
            : assignedTo
              ? [assignedTo]
              : []
      )
        .flatMap(value => String(value).split(','))
        .map(value => value.trim())
        .filter(value => mongoose.isValidObjectId(value));
      const projectUserIds = project.users.map(user => normalizeId(user));
      const assignedUserIds = [...new Set(requestedAssigneeIds)]
        .filter(userId => projectUserIds.includes(userId));

      if (requestedAssigneeIds.length !== assignedUserIds.length) {
        return res.status(400).json({
          success: false,
          message: "Tasks can only be assigned to users added to this project"
        });
      }

      if (normalizeTaskStatus(status) === "in-progress" && assignedUserIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Assign at least one user before moving a task to In Progress"
        });
      }


      const safeTitle = title?.trim() || "Untitled Task";
      const now = new Date();
      const task = {
        _id: mutationId(req, `task:${id}`),
        title: safeTitle,
        mentions: require("../utils/projectChatEvents").ids(parseMentionIds(req.body.mentions)),
        description: description?.trim() || "",
        priority: priority?.toLowerCase(),
        status: status?.toLowerCase() || 'pending',
        checkpoints: parseTaskCheckpoints(checkpoints),
        reminderSettings: normalizeTaskReminderSettings(req.body),
        createdBy: req.user.id,
        createdAt: now,
        updatedAt: now
      };

      if (assignedUserIds.length) {
        task.assignedUsers = assignedUserIds;

        task.assignedTo = assignedUserIds[0];
      }
      if (dueDate) task.dueDate = dueDate;
      syncTaskStatusWithDueDate(task);


      if (req.file) {
        const taskFileName = getTaskDocumentName(task, project, req.file.originalname || req.file.filename);
        task.pdfFile = {
          filename: taskFileName,
          originalName: taskFileName,
          path: req.file.path
        };
      }


      const activityLog = {
        type: "creation",
        description: `Task "${safeTitle}" was created`,
        performedBy: req.user.id
      };

      task.activityLogs = [activityLog];


      const updateResult = await Project.updateOne(
        { _id: id, "tasks._id": { $ne: task._id } },
        {
          $push: { tasks: task },
          $set: { updatedAt: now }
        },
        { runValidators: true }
      );

      if (!updateResult.modifiedCount && req.headers['idempotency-key']) {
        const existing = await Project.findOne({ _id: id, 'tasks._id': task._id });
        if (existing) return res.status(200).json({ success: true, task: existing.tasks.id(task._id), message: 'Task already created' });
      }
      if (!updateResult.modifiedCount) {
        return res.status(500).json({
          success: false,
          message: "Task could not be added"
        });
      }

      const createdTask = task;

      if (assignedUserIds.length) {
        const assignedUsers = await User.find({ _id: { $in: assignedUserIds } })
          .select("name email")
          .lean();


        const notification = {
          title: "New Task Assigned",
          message: `You have been assigned task "${safeTitle}" in project "${project.projectName}"`,
          type: "task_assigned",
          relatedTo: "task",
          referenceId: createdTask._id,
          createdBy: req.user.id
        };

        enqueueBackgroundJob(async () => {
          const results = await Promise.allSettled([
            Project.updateOne(
              { _id: project._id },
              { $push: { notifications: notification } }
            ),
            notifyDirectUsers({
              userIds: assignedUserIds,
              targetPath: '/ciisUser/task-management',
              type: 'project_task_assigned',
              title: 'New Project Task',
              message: `${req.user.name} assigned you task "${safeTitle}" in project "${project.projectName}"`,
              actor: req.user.id,
              data: {
                projectId: project._id,
                taskId: createdTask._id,
                title: safeTitle,
                projectName: project.projectName,
              },
              priority: priority?.toLowerCase() || 'medium',
            }),
            ...assignedUsers.map(user =>
            sendProjectTaskAssignmentEmail({
              user,
              actorName: req.user.name,
              taskTitle: safeTitle,
              projectName: project.projectName,
              dueDate: createdTask.dueDate
            })
            )
          ]);

          results.forEach(result => {
            if (result.status === 'rejected') {
              console.error('Project task create background notification failed:', result.reason);
            }
          });
        });
      }

      void 0;

      res.status(201).json({
        success: true,
        message: "Task added successfully",
        task: {
          ...createdTask,
          pdfFile: normalizeTaskPdfFile(createdTask, project)
        }
      });
    });
  } catch (error) {
    console.error("❌ Error adding task:", error);
    res.status(500).json({
      success: false,
      message: "Error adding task"
    });
  }
};

exports.updateTask = async (req, res) => {
  try {
    const { id, taskId } = req.params;
    const updateData = req.body;

    void 0;
    void 0;
    void 0;

    const project = await Project.findById(id);
    if (!project) {
      return res.status(404).json({
        success: false,
        message: "Project not found"
      });
    }


    if (!hasProjectAccess(project, req.user.id, req.user.role, req.user)) {
      return res.status(403).json({
        success: false,
        message: "Access denied to update task"
      });
    }

    const task = project.tasks.id(taskId);
    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found"
      });
    }

    const hadAssignedToField = Object.prototype.hasOwnProperty.call(updateData, "assignedTo");
    const previousAssignedTo = task.assignedTo ? task.assignedTo.toString() : "";
    const nextAssignedTo = updateData.assignedTo ? updateData.assignedTo.toString() : "";
    const assignmentChanged = hadAssignedToField && nextAssignedTo && previousAssignedTo !== nextAssignedTo;
    const safeTitle = updateData.title?.trim() || task.title || "Untitled Task";
    let newlyAssignedUser = null;

    if (assignmentChanged) {
      newlyAssignedUser = await User.findById(nextAssignedTo).select("name email").lean();
    }


    Object.keys(updateData).forEach(key => {
      if (['_id', 'createdBy', 'activityLogs'].includes(key)) return;
      if (key === 'mentions') { task.mentions = require('../utils/projectChatEvents').ids(parseMentionIds(updateData[key])); return; }

      if (key === 'assignedTo') {
        task.assignedTo = updateData[key] || undefined;
        return;
      }

      if (key === 'dueDate') {
        if (!updateData[key]) {
          task.dueDate = undefined;
          return;
        }

        const nextDueDate = new Date(updateData[key]);
        if (Number.isNaN(nextDueDate.getTime())) {
          throw new Error("Invalid task due date");
        }
        task.dueDate = nextDueDate;
        return;
      }

      if (key === 'title') {
        task.title = updateData[key]?.trim() || "Untitled Task";
        return;
      }

      if (key === 'description') {
        task.description = updateData[key]?.trim() || "";
        return;
      }

      if (key === 'priority' || key === 'status') {
        if (updateData[key]) task[key] = updateData[key].toLowerCase();
        return;
      }

      if (key === 'checkpoints') {
        task.checkpoints = parseTaskCheckpoints(updateData[key]);
        return;
      }

      if (key === 'reminderSettings' || key === 'reminderEnabled' || key === 'reminderOptions') {
        task.reminderSettings = normalizeTaskReminderSettings(updateData);
        return;
      }

      task[key] = updateData[key];
    });
    syncTaskStatusWithDueDate(task);
    task.updatedAt = new Date();
    project.markModified("tasks");


    task.activityLogs.push({
      type: "update",
      description: `Task was updated`,
      performedBy: req.user.id
    });

    if (assignmentChanged) {
      const assigneeName = newlyAssignedUser?.name || "user";

      task.activityLogs.push({
        type: "assignment",
        description: `Task was assigned to ${assigneeName}`,
        performedBy: req.user.id,
        newValue: assigneeName
      });

      project.notifications.push({
        title: "New Task Assigned",
        message: `You have been assigned task "${safeTitle}" in project "${project.projectName}"`,
        type: "task_assigned",
        relatedTo: "task",
        referenceId: task._id,
        createdBy: req.user.id
      });
    }

    await project.save();

    if (assignmentChanged) {
      await notifyDirectUsers({
        userIds: [nextAssignedTo],
        targetPath: '/ciisUser/task-management',
        type: 'project_task_assigned',
        title: 'New Project Task',
        message: `${req.user.name} assigned you task "${safeTitle}" in project "${project.projectName}"`,
        actor: req.user.id,
        data: {
          projectId: project._id,
          taskId: task._id,
          title: safeTitle,
          projectName: project.projectName,
        },
        priority: task.priority || 'medium',
      });

      await sendProjectTaskAssignmentEmail({
        user: newlyAssignedUser,
        actorName: req.user.name,
        taskTitle: safeTitle,
        projectName: project.projectName,
        dueDate: task.dueDate
      });
    }

    void 0;

    res.status(200).json({
      success: true,
      message: "Task updated successfully",
      task
    });
  } catch (error) {
    console.error("❌ Error updating task:", error);
    res.status(500).json({
      success: false,
      message: "Error updating task"
    });
  }
};

exports.deleteTaskAttachment = async (req, res) => {
  try {
    const { id, taskId } = req.params;
    const project = await Project.findById(id);

    if (!project) {
      return res.status(404).json({ success: false, message: "Project not found" });
    }

    if (!hasProjectAccess(project, req.user.id, req.user.role, req.user)) {
      return res.status(403).json({ success: false, message: "Access denied to update task" });
    }

    const task = project.tasks.id(taskId);
    if (!task) {
      return res.status(404).json({ success: false, message: "Task not found" });
    }

    if (!task.pdfFile?.path) {
      return res.status(404).json({ success: false, message: "Task attachment not found" });
    }

    const attachmentPath = task.pdfFile.path;
    task.pdfFile = undefined;
    task.updatedAt = new Date();
    task.activityLogs.push({
      type: "update",
      description: "Task attachment was deleted",
      performedBy: req.user.id
    });
    await project.save();

    fs.unlink(attachmentPath, fileError => {
      if (fileError && fileError.code !== "ENOENT") {
        console.error("Error deleting task attachment file:", fileError);
      }
    });

    return res.status(200).json({
      success: true,
      message: "Task attachment deleted successfully",
      task
    });
  } catch (error) {
    console.error("Error deleting task attachment:", error);
    return res.status(500).json({ success: false, message: "Error deleting task attachment" });
  }
};

exports.deleteTask = async (req, res) => {
  try {
    const { id, taskId } = req.params;

    void 0;
    void 0;
    void 0;

    const project = await Project.findById(id);
    if (!project) {
      return res.status(404).json({
        success: false,
        message: "Project not found"
      });
    }


    if (!hasProjectAccess(project, req.user.id, req.user.role, req.user)) {
      return res.status(403).json({
        success: false,
        message: "Access denied to delete task"
      });
    }

    const task = project.tasks.id(taskId);
    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found"
      });
    }


    if (task.pdfFile && task.pdfFile.path) {
      fs.unlink(task.pdfFile.path, (err) => {
        if (err) console.error("Error deleting task file:", err);
      });
    }


    project.tasks.pull(taskId);
    await project.save();

    void 0;

    res.status(200).json({
      success: true,
      message: "Task deleted successfully"
    });
  } catch (error) {
    console.error("❌ Error deleting task:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting task"
    });
  }
};




exports.updateTaskStatus = async (req, res) => {
  try {
    const { projectId, taskId } = req.params;
    const { status, remark } = req.body;

    void 0;
    void 0;
    void 0;
    void 0;
    void 0;

    const nextStatus = normalizeTaskStatus(status);
    const nextProjectStatus = toProjectTaskStatus(status);

    if (!TASK_STATUS.includes(nextProjectStatus)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status value"
      });
    }

    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({
        success: false,
        message: "Project not found"
      });
    }

    const task = project.tasks.id(taskId);
    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found"
      });
    }

    if (nextStatus === "in-progress" && getTaskAssigneeIds(task).length === 0) {
      return res.status(400).json({
        success: false,
        message: "Assign at least one user before moving this task to In Progress"
      });
    }

    const isAssignedUser = isTaskAssignedToUser(task, req.user.id);
    const hasAccessToProject = hasProjectAccess(project, req.user.id, req.user.role, req.user);
    const canManageTaskStatus =
      isAssignedUser ||
      hasAccessToProject ||
      isProjectAdmin(req.user) ||
      idsEqual(project.createdBy, req.user.id);

    if (!hasAccessToProject && !isAssignedUser) {
      return res.status(403).json({
        success: false,
        message: "Access denied to update task status"
      });
    }

    if (!canManageTaskStatus) {
      return res.status(403).json({
        success: false,
        message: "Only project users can update this task status"
      });
    }

    const oldStatus = task.status;
    const normalizedOldStatus = normalizeTaskStatus(oldStatus);

    if (normalizedOldStatus === "onhold" && !canChangeFromOnHold(nextStatus)) {
      return res.status(400).json({
        success: false,
        message: "On hold tasks can only be changed to in-progress or completed"
      });
    }

    const allowCompanyAllEdit = isCompanyAllTaskEdit(req);
    const isOverdueTransitionAllowed = ['in-progress', 'completed', 'onhold', 'cancelled', 'rejected', 'reopen'].includes(nextStatus);

    if (nextStatus !== "overdue" && normalizedOldStatus === "overdue" && !allowCompanyAllEdit && !isOverdueTransitionAllowed) {
      return res.status(400).json({
        success: false,
        message: "Cannot change status of an overdue task"
      });
    }

    if (normalizedOldStatus === 'completed' && nextStatus !== 'completed' && nextStatus !== 'reopen' && !allowCompanyAllEdit) {
      return res.status(400).json({
        success: false,
        message: "Completed tasks can only be reopened."
      });
    }

    const isResumedFromHold = (normalizedOldStatus === "onhold" || normalizedOldStatus === "on hold") && nextStatus === "in-progress";

    if (!["overdue", "onhold", "reopen"].includes(nextStatus) && !isResumedFromHold && !isOverdueTransitionAllowed && isPendingTaskPastDue(task) && !allowCompanyAllEdit) {
      if (isPendingTaskPastDue(task)) {
        task.status = "overdue";
        task.updatedAt = new Date();
        task.activityLogs.push({
          type: "status_change",
          description: "Automatically marked overdue after due time passed",
          oldValue: oldStatus,
          newValue: "overdue",
          performedBy: req.user.id,
          remark: "Automatically marked overdue after due time passed"
        });
        await project.save();
      }
      return res.status(400).json({
        success: false,
        message: "Cannot change status of an overdue task"
      });
    }

    task.status = nextProjectStatus;
    task.updatedAt = new Date();

    if (isResumedFromHold) {
      const now = new Date();
      task.onHoldReleasedAt = now;
      task.dueDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      task.dueDateTime = task.dueDate;
    } else if (nextStatus === "onhold" || nextStatus === "on hold") {
      task.onHoldReleasedAt = null;
    }

    if (nextStatus === "completed") {
      task.completionDate = new Date();
    } else if (nextStatus !== "completed" && task.completionDate) {
      task.completionDate = null;
    }


    task.activityLogs.push({
      type: "status_change",
      description: `Status changed from ${oldStatus} to ${nextProjectStatus}`,
      oldValue: oldStatus,
      newValue: nextProjectStatus,
      performedBy: req.user.id,
      remark: remark
    });

    await project.save();

    const notification = {
      title: "Task Status Updated",
      message: `Task "${task.title}" status changed from ${oldStatus} to ${nextProjectStatus}`,
      type: "status_changed",
      relatedTo: "task",
      referenceId: task._id,
      createdBy: req.user.id
    };

    res.status(200).json({
      success: true,
      message: "Task status updated successfully",
      task
    });

    const runStatusPostProcessing = async () => {
      await project.addNotification(notification);

      const statusNotificationUsers = [project.createdBy, ...getTaskAssigneeIds(task)]
        .filter(userId => userId && !idsEqual(userId, req.user.id));

      await notifyDirectUsers({
        userIds: statusNotificationUsers,
        targetPath: '/ciisUser/task-management',
        type: 'project_task_status_changed',
        title: 'Project Task Updated',
        message: `${req.user.name} changed "${task.title}" status from ${oldStatus} to ${nextProjectStatus}${remark ? ': ' + remark : ''}`,
        actor: req.user.id,
        data: {
          projectId: project._id,
          taskId: task._id,
          oldStatus,
          newStatus: nextProjectStatus,
          remark,
        },
        priority: 'medium',
      });
    };

    if (nextProjectStatus === 'completed') {
      enqueueCompletionJob(async () => {
        try {
          await runStatusPostProcessing();
        } catch (asyncErr) {
          console.error('❌ Background project task post-processing failed:', asyncErr);
        }
      });
    } else {
      void (async () => {
        try {
          await runStatusPostProcessing();
        } catch (asyncErr) {
          console.error('❌ Background project task post-processing failed:', asyncErr);
        }
      })();
    }
  } catch (error) {
    console.error("❌ Error updating task status:", error);
    res.status(500).json({
      success: false,
      message: "Error updating task status"
    });
  }
};

exports.updateTaskCheckpoint = async (req, res) => {
  try {
    const { projectId, taskId, checkpointId } = req.params;
    const { completed } = req.body;

    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ success: false, message: "Project not found" });
    }

    const task = project.tasks.id(taskId);
    if (!task) {
      return res.status(404).json({ success: false, message: "Task not found" });
    }

    const isAssignedUser = isTaskAssignedToUser(task, req.user.id);
    const hasAccessToProject = hasProjectAccess(project, req.user.id, req.user.role, req.user);
    if (!hasAccessToProject && !isAssignedUser) {
      return res.status(403).json({ success: false, message: "Access denied to update checkpoint" });
    }

    const checkpoint = task.checkpoints.id(checkpointId);
    if (!checkpoint) {
      return res.status(404).json({ success: false, message: "Checkpoint not found" });
    }

    const oldStatus = task.status || "pending";
    const isCompleted = completed !== false;
    const now = new Date();

    checkpoint.completed = isCompleted;
    checkpoint.completedAt = isCompleted ? now : null;
    checkpoint.completedBy = isCompleted ? req.user.id : null;

    const allCompleted = task.checkpoints.length > 0 && task.checkpoints.every(item => item.completed);
    if (allCompleted) {
      task.status = "completed";
    } else if (normalizeTaskStatus(oldStatus) === "completed") {
      task.status = "in progress";
    } else if (normalizeTaskStatus(oldStatus) === "pending" && isCompleted) {
      task.status = "in progress";
    }
    task.updatedAt = now;

    task.activityLogs.push({
      type: "status_change",
      description: `${isCompleted ? "Completed" : "Reopened"} checkpoint: ${checkpoint.title}`,
      oldValue: oldStatus,
      newValue: task.status,
      performedBy: req.user.id,
      remark: `Checkpoint ${isCompleted ? "completed" : "reopened"}`
    });

    await project.save();

    res.status(200).json({
      success: true,
      message: "Checkpoint updated successfully",
      task
    });
  } catch (error) {
    console.error("❌ Error updating project task checkpoint:", error);
    res.status(500).json({
      success: false,
      message: "Error updating checkpoint"
    });
  }
};

exports.getTaskActivityLogs = async (req, res) => {
  try {
    const { projectId, taskId } = req.params;

    const project = await Project.findOne(
      { _id: projectId, "tasks._id": taskId },
      {
        projectName: 1,
        company: 1,
        companyCode: 1,
        users: 1,
        createdBy: 1,
        tasks: { $elemMatch: { _id: taskId } }
      }
    ).lean();
    if (!project) {
      return res.status(404).json({
        success: false,
        message: "Project not found"
      });
    }


    if (!hasProjectAccess(project, req.user.id, req.user.role, req.user)) {
      return res.status(403).json({
        success: false,
        message: "Access denied to view activity logs"
      });
    }

    const task = Array.isArray(project.tasks) ? project.tasks[0] : null;
    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found"
      });
    }

    const performerIds = [...new Set((task.activityLogs || [])
      .map(entry => normalizeId(entry.performedBy))
      .filter(Boolean))];
    const performers = performerIds.length
      ? await User.find({ _id: { $in: performerIds } }).select('name email').lean()
      : [];
    const performersById = new Map(performers.map(user => [String(user._id), user]));

    const activityLogs = (task.activityLogs || []).map((entry) => {
      const log = entry || {};
      const actor = performersById.get(normalizeId(log.performedBy)) || null;

      return {
        ...log,
        user: actor,
        userName: actor?.name || 'Unknown User',
        action: log.type || 'update',
        createdAt: log.performedAt || log.createdAt || null
      };
    });

    res.status(200).json({
      success: true,
      activityLogs,
      logs: activityLogs,
      data: activityLogs
    });
  } catch (error) {
    console.error("❌ Error fetching activity logs:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching activity logs"
    });
  }
}; ``




exports.getTaskRemarks = async (req, res) => {
  try {
    const { projectId, taskId } = req.params;

    const project = await Project.findById(projectId)
      .populate('tasks.remarks.createdBy', 'name email');

    if (!project) {
      return res.status(404).json({
        success: false,
        message: "Project not found"
      });
    }

    if (!hasProjectAccess(project, req.user.id, req.user.role, req.user)) {
      return res.status(403).json({
        success: false,
        message: "Access denied to view remarks"
      });
    }

    const task = project.tasks.id(taskId);
    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found"
      });
    }

    res.status(200).json({
      success: true,
      remarks: task.remarks || [],
      data: task.remarks || []
    });
  } catch (error) {
    console.error("❌ Error fetching project task remarks:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching remarks"
    });
  }
};

exports.addRemark = async (req, res) => {
  try {
    const { projectId, taskId } = req.params;
    const { text } = req.body;
    const remarkText = String(text || "").trim();

    void 0;
    void 0;
    void 0;
    void 0;

    if (!remarkText && !req.file) {
      return res.status(400).json({
        success: false,
        message: "Remark text or image is required"
      });
    }

    const project = await Project.findOne({
      _id: projectId,
      "tasks._id": taskId
    })
      .select("company companyCode users createdBy tasks.$")
      .lean();

    if (!project) {
      return res.status(404).json({
        success: false,
        message: "Project or task not found"
      });
    }


    if (!hasProjectAccess(project, req.user.id, req.user.role, req.user)) {
      return res.status(403).json({
        success: false,
        message: "Access denied to add remark"
      });
    }

    const task = project.tasks?.[0];
    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found"
      });
    }

    let imgPath = null;
    if (req.file) {
      const uploadDir = path.join(__dirname, '../../uploads/remarks');
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
      const filename = `remark_${Date.now()}_${req.user.id}.jpg`;
      const savePath = path.join(uploadDir, filename);
      imgPath = `remarks/${filename}`;

      try {
        await sharp(req.file.buffer)
          .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 80 })
          .toFile(savePath);
      } catch (sharpErr) {
        console.warn('Sharp compression failed in projectController.addRemark, saving raw buffer:', sharpErr.message);
        fs.writeFileSync(savePath, req.file.buffer);
      }
    }


    const now = new Date();
    const remark = {
      _id: mutationId(req, `remark:${projectId}:${taskId}`),
      mentions: require("../utils/projectChatEvents").ids(parseMentionIds(req.body.mentions)),
      text: remarkText || (imgPath ? "Image attachment" : ""),
      createdBy: req.user.id,
      image: imgPath || undefined,
      createdAt: now
    };

    const activityLog = {
      _id: new mongoose.Types.ObjectId(),
      type: "remark",
      description: `Remark added: "${(remarkText || (imgPath ? 'Image attachment' : '')).substring(0, 50)}${remarkText.length > 50 ? '...' : ''}"`,
      performedBy: req.user.id,
      performedAt: now
    };

    const notification = {
      _id: new mongoose.Types.ObjectId(),
      title: "New Remark Added",
      message: `${req.user.name} added a remark to task "${task.title}"`,
      type: "remark_added",
      relatedTo: "task",
      referenceId: task._id,
      createdBy: req.user.id,
      createdAt: now,
      isRead: false
    };

    const updateResult = await Project.updateOne(
      { _id: projectId, tasks: { $elemMatch: { _id: taskId, "remarks._id": { $ne: remark._id } } } },
      {
        $push: {
          "tasks.$.remarks": remark,
          "tasks.$.activityLogs": activityLog,
          notifications: notification
        },
        $set: {
          "tasks.$.updatedAt": now,
          updatedAt: now
        }
      }
    );

    if (updateResult.matchedCount === 0 && req.headers['idempotency-key']) {
      const existing = await Project.findOne({ _id: projectId, 'tasks._id': taskId });
      const saved = existing?.tasks.id(taskId)?.remarks.id(remark._id);
      if (saved) return res.status(200).json({ success: true, remark: saved });
    }
    if (updateResult.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Project or task not found"
      });
    }

    const savedRemark = {
      ...remark,
      createdBy: {
        _id: req.user.id,
        name: req.user.name,
        email: req.user.email
      }
    };

    res.status(201).json({
      success: true,
      message: "Remark added successfully",
      remark: savedRemark
    });
  } catch (error) {
    console.error("❌ Error adding remark:", error);
    res.status(500).json({
      success: false,
      message: "Error adding remark"
    });
  }
};

exports.updateTaskReminder = async (req, res) => {
  try {
    const { id, projectId, taskId } = req.params;
    const targetProjectId = projectId || id;
    const project = await Project.findById(targetProjectId);
    if (!project) {
      return res.status(404).json({ success: false, message: "Project not found" });
    }
    const task = project.tasks.id(taskId);
    if (!task) {
      return res.status(404).json({ success: false, message: "Task not found" });
    }

    const isAssignee = idsEqual(task.assignedTo, req.user.id);
    const hasAccess = hasProjectAccess(project, req.user.id, req.user.role, req.user);
    if (!hasAccess && !isAssignee) {
      return res.status(403).json({ success: false, message: "Access denied to update task reminder" });
    }

    task.reminderSettings = normalizeTaskReminderSettings(req.body);
    project.markModified("tasks");
    await project.save();

    return res.status(200).json({
      success: true,
      message: "Project task reminder updated successfully",
      task,
      reminderSettings: task.reminderSettings
    });
  } catch (error) {
    console.error("❌ Error updating project task reminder:", error);
    return res.status(500).json({
      success: false,
      message: "Error updating task reminder",
      error: error.message
    });
  }
};

// All route aliases use this shared controller and retain the authenticated actor.
function parseMentionIds(value) {
  if (Array.isArray(value)) return value;
  try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}
for (const [name, handler] of Object.entries(exports)) {
  if (typeof handler !== 'function') continue;
  exports[name] = (req, res, ...rest) => require('../utils/projectChatEvents').context.run(
    { actor: req.user?.id || req.user?._id }, () => handler(req, res, ...rest)
  );
}

function mutationId(req, scope) {
  const key = req.headers['idempotency-key'];
  if (!key) return new mongoose.Types.ObjectId();
  const digest = require('node:crypto').createHash('sha256').update(`${req.user.id}:${scope}:${String(key).slice(0, 200)}`).digest('hex');
  return new mongoose.Types.ObjectId(digest.slice(0, 24));
}
