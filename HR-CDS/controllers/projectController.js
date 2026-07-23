const { Project, TASK_STATUS, PROJECT_STATUS, PRIORITY_LEVELS, NOTIFICATION_TYPES } = require("../models/Project");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const sharp = require("sharp");
const {notifyDirectUsers} = require("../utils/systemNotificationService");
const { sendEmail } = require("../../utils/sendEmail");
const User = require("../../models/User");
const mongoose = require("mongoose");
const { getPaginationOptions, buildPaginationMeta } = require("../../utils/pagination");


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
  return normalized;
};

const toProjectTaskStatus = (value = "pending") => {
  const normalized = normalizeTaskStatus(value);
  if (normalized === "in-progress") return "in progress";
  if (normalized === "onhold") return "on hold";
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

const hasProjectAccess = (project, userId, userRole, user = {}) => {
  if (!projectBelongsToUserCompany(project, user)) {
    return false;
  }

  
  if (isProjectAdmin({ role: userRole })) {
    return true;
  }
  
  
  const isUserInProject = project.users.some(user => 
    idsEqual(user, userId)
  );
  
  
  const isCreator = idsEqual(project.createdBy, userId);
  
  return isUserInProject || isCreator;
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

const withSortedProjectTasks = (project) => {
  const plainProject = typeof project?.toObject === "function" ? project.toObject() : project;
  return {
    ...plainProject,
    tasks: sortProjectTasksByCreatedAt(plainProject?.tasks)
  };
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
    const companyUserIds = await getCompanyUserIds(req.user);
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

    let query = { $or: companyFilters };

    
    if (!isProjectAdmin(req.user)) {
      query = {
        $and: [
          query,
          {
            $or: [
              { users: req.user.id },
              { createdBy: req.user.id }
            ]
          }
        ]
      };
      void 0;
    } else {
      void 0;
    }

    const { page, limit, skip } = getPaginationOptions(req.query, { limit: 25, maxLimit: 100 });
    const [projects, total] = await Promise.all([
      Project.find(query)
      .populate('users', 'name email role company companyCode')
      .populate('createdBy', 'name email')
      .populate('tasks.assignedTo', 'name email')
      .populate('tasks.assignedUsers', 'name email')
      .populate('tasks.createdBy', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Project.countDocuments(query)
    ]);

    const scopedProjects = projects
      .filter(project => projectBelongsToUserCompany(project, req.user))
      .map(withSortedProjectTasks);

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
    void 0;
    void 0;
    void 0;
    void 0;
    
    const project = await Project.findById(req.params.id)
      .populate('users', 'name email role _id')
      .populate('createdBy', 'name email _id')
      .populate('tasks.assignedTo', 'name email')
      .populate('tasks.assignedUsers', 'name email')
      .populate('tasks.createdBy', 'name email')
      .populate('tasks.remarks.createdBy', 'name email')
      .populate('tasks.activityLogs.performedBy', 'name email');

    if (!project) {
      void 0;
      return res.status(404).json({ 
        success: false, 
        message: "Project not found" 
      });
    }

    void 0;
    void 0;
    void 0;
    
    
    if (!hasProjectAccess(project, req.user.id, req.user.role, req.user)) {
      void 0;
      void 0;
      void 0;
      
      
      return res.status(403).json({ 
        success: false, 
        message: "Access denied. You are not a member of this project.",
        details: {
          userId: req.user.id,
          userRole: req.user.role,
          projectId: project._id,
          projectUsers: project.users.map(u => u._id)
        }
      });
    }

    void 0;

    res.status(200).json({
      success: true,
      ...withSortedProjectTasks(project),
      userHasAccess: true
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
      const companyUserIds = (await getCompanyUserIds(req.user)).map(id => normalizeId(id));
      usersArray = usersArray.filter(id => companyUserIds.includes(id));

      
      if (!usersArray.includes(String(req.user.id))) {
        usersArray.push(String(req.user.id));
        void 0;
      }

      
      const projectData = {
        projectName,
        description,
        company: getUserCompanyId(req.user),
        companyCode: getUserCompanyCode(req.user),
        users: usersArray,
        startDate,
        endDate,
        priority: priority?.toLowerCase(),
        status: status?.toLowerCase(),
        createdBy: req.user.id
      };

      
      if (req.file) {
        projectData.pdfFile = {
          filename: req.file.originalname,
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

      let usersArray = [];
      try {
        usersArray = JSON.parse(users);
      } catch (parseError) {
        usersArray = Array.isArray(users) ? users : [];
      }

      
      usersArray = [...new Set(usersArray.filter(Boolean).map(id => String(id)))];
      const companyUserIds = (await getCompanyUserIds(req.user)).map(id => normalizeId(id));
      usersArray = usersArray.filter(id => companyUserIds.includes(id));

      
      project.projectName = projectName || project.projectName;
      project.description = description || project.description;
      project.users = usersArray;
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
        
        project.pdfFile = {
          filename: req.file.originalname,
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
      .populate('users', 'name email role _id')
      .populate('createdBy', 'name email _id');
    
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

      
      const safeTitle = title?.trim() || "Untitled Task";
      const now = new Date();
      const task = {
        title: safeTitle,
        description: description?.trim() || "",
        priority: priority?.toLowerCase(),
        status: status?.toLowerCase() || 'pending',
        checkpoints: parseTaskCheckpoints(checkpoints),
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
        task.pdfFile = {
          filename: req.file.originalname,
          path: req.file.path
        };
      }

      
      const activityLog = {
        type: "creation",
        description: `Task "${safeTitle}" was created`,
        performedBy: req.user.id
      };

      task.activityLogs = [activityLog];

      
      project.tasks.push(task);
      await project.save();

      const createdTask = project.tasks[project.tasks.length - 1];

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

        await project.addNotification(notification);

        await notifyDirectUsers({
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
        });

        await Promise.allSettled(assignedUsers.map(user =>
          sendProjectTaskAssignmentEmail({
            user,
            actorName: req.user.name,
            taskTitle: safeTitle,
            projectName: project.projectName,
            dueDate: createdTask.dueDate
          })
        ));
      }

      void 0;

      res.status(201).json({
        success: true,
        message: "Task added successfully",
        task: createdTask
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
      if (key === '_id') return;

      if (key === 'assignedTo') {
        task.assignedTo = updateData[key] || undefined;
        return;
      }

      if (key === 'dueDate') {
        task.dueDate = updateData[key] || undefined;
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

      task[key] = updateData[key];
    });
    syncTaskStatusWithDueDate(task);
    task.updatedAt = new Date();

    
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

    if (nextStatus !== "overdue" && normalizedOldStatus === "overdue" && !allowCompanyAllEdit) {
      return res.status(400).json({
        success: false,
        message: "Cannot change status of an overdue task"
      });
    }

    if (!["overdue", "onhold"].includes(nextStatus) && isPendingTaskPastDue(task) && !allowCompanyAllEdit) {
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

    void 0;

    res.status(200).json({
      success: true,
      message: "Task status updated successfully",
      task
    });
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
        message: "Access denied to view activity logs" 
      });
    }

    const task = project.tasks.id(taskId);
    if (!task) {
      return res.status(404).json({ 
        success: false, 
        message: "Task not found" 
      });
    }

    
    await Project.populate(task, {
      path: 'activityLogs.performedBy',
      select: 'name email'
    });

    void 0;

    const activityLogs = (task.activityLogs || []).map((entry) => {
      const log = typeof entry.toObject === 'function' ? entry.toObject() : entry;
      const actor = log.performedBy && typeof log.performedBy === 'object'
        ? log.performedBy
        : null;

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
};``




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
        message: "Access denied to add remark" 
      });
    }

    const task = project.tasks.id(taskId);
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

      await sharp(req.file.buffer)
        .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toFile(savePath);
    }

    
    task.remarks.push({
      text: remarkText || (imgPath ? "Image attachment" : ""),
      createdBy: req.user.id,
      image: imgPath || undefined
    });
    task.updatedAt = new Date();

    
    task.activityLogs.push({
      type: "remark",
      description: `Remark added: "${(remarkText || (imgPath ? 'Image attachment' : '')).substring(0, 50)}${remarkText.length > 50 ? '...' : ''}"`,
      performedBy: req.user.id
    });

    await project.save();

    
    const notification = {
      title: "New Remark Added",
      message: `${req.user.name} added a remark to task "${task.title}"`,
      type: "remark_added",
      relatedTo: "task",
      referenceId: task._id,
      createdBy: req.user.id
    };

    await project.addNotification(notification);

    void 0;

    res.status(201).json({
      success: true,
      message: "Remark added successfully",
      remark: task.remarks[task.remarks.length - 1]
    });
  } catch (error) {
    console.error("❌ Error adding remark:", error);
    res.status(500).json({ 
      success: false, 
      message: "Error adding remark" 
    });
  }
};
void 0;
