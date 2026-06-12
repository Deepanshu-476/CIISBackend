const { Project, TASK_STATUS, PROJECT_STATUS, PRIORITY_LEVELS, NOTIFICATION_TYPES } = require("../models/Project");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const sharp = require("sharp");
const {notifyDirectUsers} = require("../utils/systemNotificationService");
const { sendEmail } = require("../../utils/sendEmail");
const User = require("../../models/User");

// Configure storage for file uploads
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

// File filter
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
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Middleware for file upload
const handleFileUpload = upload.single('pdfFile');

// ==========================================
// 📌 HELPER FUNCTIONS
// ==========================================
const normalizeRole = (value = "") => value.toString().trim().toLowerCase().replace(/[_\s]+/g, "-");

const isProjectAdmin = (user = {}) => {
  const roles = [user.role, user.jobRole, user.companyRole].map(normalizeRole);
  return roles.some(role => ["admin", "super-admin", "superadmin", "owner"].includes(role));
};

const hasProjectAccess = (project, userId, userRole) => {
  // Super admin and admin have full access
  if (isProjectAdmin({ role: userRole })) {
    return true;
  }
  
  // Check if user is in project users array
  const isUserInProject = project.users.some(user => 
    idsEqual(user, userId)
  );
  
  // Check if user created the project
  const isCreator = idsEqual(project.createdBy, userId);
  
  return isUserInProject || isCreator;
};

const idsEqual = (left, right) => {
  if (!left || !right) return false;
  const leftId = left._id || left.id || left;
  const rightId = right._id || right.id || right;
  return leftId.toString() === rightId.toString();
};

const isTaskAssignedToUser = (task, userId) => idsEqual(task.assignedTo, userId);

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

// ==========================================
// 📌 NOTIFICATION CONTROLLERS
// ==========================================
exports.getUserNotifications = async (req, res) => {
  try {
    console.log("🔔 Fetching notifications for user:", req.user.id);
    
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

    // Sort by date (newest first)
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
    
    console.log("📌 Marking notification as read:", notificationId);
    
    // Find project containing this notification
    const project = await Project.findOne({
      'notifications._id': notificationId
    });

    if (!project) {
      return res.status(404).json({ 
        success: false, 
        message: "Notification not found" 
      });
    }

    // Mark notification as read
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
    console.log("🗑️ Clearing all notifications for user:", req.user.id);
    
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

// ==========================================
// 📌 PROJECT CRUD CONTROLLERS
// ==========================================
exports.listProjects = async (req, res) => {
  try {
    console.log("📋 Listing projects for user:", req.user.id);
    console.log("User role:", req.user.role);
    
    let query = {};
    
    // If not admin/super-admin, only show projects user is part of
    if (!isProjectAdmin(req.user)) {
      query.users = req.user.id;
      console.log("Non-admin query:", query);
    } else {
      console.log("Admin query: showing all projects");
    }

    const projects = await Project.find(query)
      .populate('users', 'name email role')
      .populate('createdBy', 'name email')
      .populate('tasks.assignedTo', 'name email')
      .populate('tasks.createdBy', 'name email')
      .sort({ createdAt: -1 });

    console.log(`Found ${projects.length} projects`);

    res.status(200).json({
      success: true,
      count: projects.length,
      items: projects
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
    console.log("🔍 Fetching project by ID");
    console.log("Project ID:", req.params.id);
    console.log("User ID:", req.user.id);
    console.log("User Role:", req.user.role);
    
    const project = await Project.findById(req.params.id)
      .populate('users', 'name email role _id')
      .populate('createdBy', 'name email _id')
      .populate('tasks.assignedTo', 'name email')
      .populate('tasks.createdBy', 'name email')
      .populate('tasks.remarks.createdBy', 'name email')
      .populate('tasks.activityLogs.performedBy', 'name email');

    if (!project) {
      console.log("❌ Project not found:", req.params.id);
      return res.status(404).json({ 
        success: false, 
        message: "Project not found" 
      });
    }

    console.log("Project found:", project.projectName);
    console.log("Project users:", project.users.map(u => ({id: u._id, name: u.name})));
    console.log("Project created by:", project.createdBy?._id);
    
    // Check if user has access to this project
    if (!hasProjectAccess(project, req.user.id, req.user.role)) {
      console.log("❌ Access denied for user:", req.user.id);
      console.log("User role:", req.user.role);
      console.log("Has admin role:", req.user.role === 'admin' || req.user.role === 'super-admin');
      
      // Return more informative error
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

    console.log("✅ Access granted, returning project data");

    res.status(200).json({
      success: true,
      ...project.toObject(),
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
      
      console.log("🆕 Creating new project");
      console.log("Created by:", req.user.id);
      console.log("Project name:", projectName);
      console.log("Users to add:", users);
      
      let usersArray = [];
      try {
        usersArray = JSON.parse(users);
      } catch (parseError) {
        usersArray = Array.isArray(users) ? users : [];
      }

      // Add creator to users array if not already included
      if (!usersArray.includes(req.user.id)) {
        usersArray.push(req.user.id);
        console.log("Added creator to users array");
      }

      // Prepare project data
      const projectData = {
        projectName,
        description,
        users: usersArray,
        startDate,
        endDate,
        priority: priority?.toLowerCase(),
        status: status?.toLowerCase(),
        createdBy: req.user.id
      };

      // Handle file upload
      if (req.file) {
        projectData.pdfFile = {
          filename: req.file.originalname,
          path: req.file.path
        };
      }

      const project = new Project(projectData);
      await project.save();

      // Add creation notification
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

      console.log("✅ Project created successfully:", project._id);

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
      
      console.log("✏️ Updating project:", id);
      console.log("Updated by:", req.user.id);
      
      // Find existing project
      const project = await Project.findById(id);
      if (!project) {
        return res.status(404).json({ 
          success: false, 
          message: "Project not found" 
        });
      }

      // Check access
      if (!hasProjectAccess(project, req.user.id, req.user.role)) {
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

      // Update fields
      project.projectName = projectName || project.projectName;
      project.description = description || project.description;
      project.users = usersArray;
      project.startDate = startDate || project.startDate;
      project.endDate = endDate || project.endDate;
      project.priority = priority?.toLowerCase() || project.priority;
      project.status = status?.toLowerCase() || project.status;

      // Handle file upload
      if (req.file) {
        // Delete old file if exists
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

      // Add update notification
      const notification = {
        title: "Project Updated",
        message: `${req.user.name} updated project "${projectName}"`,
        type: "project_updated",
        relatedTo: "project",
        referenceId: project._id,
        createdBy: req.user.id
      };

      await project.addNotification(notification);

      console.log("✅ Project updated successfully:", id);

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
    console.log("🗑️ Deleting project:", req.params.id);
    console.log("Deleted by:", req.user.id);
    
    const project = await Project.findById(req.params.id);
    
    if (!project) {
      return res.status(404).json({ 
        success: false, 
        message: "Project not found" 
      });
    }

    // Check access - only admin/super-admin or creator can delete
    const canDelete = isProjectAdmin(req.user) ||
                     project.createdBy?.toString() === req.user.id;
    
    if (!canDelete) {
      return res.status(403).json({ 
        success: false, 
        message: "Access denied to delete project" 
      });
    }

    // Delete associated file
    if (project.pdfFile && project.pdfFile.path) {
      fs.unlink(project.pdfFile.path, (err) => {
        if (err) console.error("Error deleting file:", err);
      });
    }

    // Delete task files
    project.tasks.forEach(task => {
      if (task.pdfFile && task.pdfFile.path) {
        fs.unlink(task.pdfFile.path, (err) => {
          if (err) console.error("Error deleting task file:", err);
        });
      }
    });

    await project.deleteOne();

    console.log("✅ Project deleted successfully:", req.params.id);

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

// ==========================================
// 📌 DEBUG/UTILITY CONTROLLERS
// ==========================================
exports.getProjectUsers = async (req, res) => {
  try {
    console.log("🔍 Debug - Fetching project users");
    console.log("Project ID:", req.params.id);
    console.log("User ID:", req.user.id);
    console.log("User Role:", req.user.role);
    
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
    
    // Check access
    if (!hasProjectAccess(project, req.user.id, req.user.role)) {
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
      hasAccess: hasProjectAccess(project, req.user.id, req.user.role)
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
    
    console.log("➕ Adding user to project");
    console.log("Project ID:", projectId);
    console.log("User ID to add:", userId);
    console.log("Requested by:", req.user.id);
    
    const project = await Project.findById(projectId);
    
    if (!project) {
      return res.status(404).json({ 
        success: false, 
        message: "Project not found" 
      });
    }
    
    // Check if requester has permission
    if (!hasProjectAccess(project, req.user.id, req.user.role)) {
      return res.status(403).json({ 
        success: false, 
        message: "Access denied to modify project" 
      });
    }
    
    // Check if user already exists
    const userExists = project.users.some(userIdObj => 
      userIdObj.toString() === userId
    );
    
    if (userExists) {
      return res.status(400).json({ 
        success: false, 
        message: "User already in project" 
      });
    }
    
    // Add user
    project.users.push(userId);
    await project.save();
    
    // Add notification
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

// ==========================================
// 📌 TASK CRUD CONTROLLERS
// ==========================================
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
      const { title, description, assignedTo, dueDate, priority, status } = req.body;

      console.log("➕ Adding task to project:", id);
      console.log("Task title:", title);
      console.log("Assigned to:", assignedTo);

      const project = await Project.findById(id);
      if (!project) {
        return res.status(404).json({ 
          success: false, 
          message: "Project not found" 
        });
      }

      // Check access
      if (!hasProjectAccess(project, req.user.id, req.user.role)) {
        return res.status(403).json({ 
          success: false, 
          message: "Access denied to add task" 
        });
      }

      // Create task
      const safeTitle = title?.trim() || "Untitled Task";
      const task = {
        title: safeTitle,
        description: description?.trim() || "",
        priority: priority?.toLowerCase(),
        status: status?.toLowerCase() || 'pending',
        createdBy: req.user.id
      };

      if (assignedTo) task.assignedTo = assignedTo;
      if (dueDate) task.dueDate = dueDate;

      // Handle file upload
      if (req.file) {
        task.pdfFile = {
          filename: req.file.originalname,
          path: req.file.path
        };
      }

      // Add activity log
      const activityLog = {
        type: "creation",
        description: `Task "${safeTitle}" was created`,
        performedBy: req.user.id
      };

      task.activityLogs = [activityLog];

      // Add task to project
      project.tasks.push(task);
      await project.save();

      const createdTask = project.tasks[project.tasks.length - 1];

      if (assignedTo) {
        const assignedUser = await User.findById(assignedTo).select("name email").lean();

        // Add notification for assigned user
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
          userIds: [assignedTo],
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

        await sendProjectTaskAssignmentEmail({
          user: assignedUser,
          actorName: req.user.name,
          taskTitle: safeTitle,
          projectName: project.projectName,
          dueDate: createdTask.dueDate
        });
      }

      console.log("✅ Task added successfully");

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

    console.log("✏️ Updating task:", taskId);
    console.log("In project:", id);
    console.log("Updated by:", req.user.id);

    const project = await Project.findById(id);
    if (!project) {
      return res.status(404).json({ 
        success: false, 
        message: "Project not found" 
      });
    }

    // Check project access
    if (!hasProjectAccess(project, req.user.id, req.user.role)) {
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

    // Update task fields
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

      task[key] = updateData[key];
    });
    task.updatedAt = new Date();

    // Add activity log
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

    console.log("✅ Task updated successfully");

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

    console.log("🗑️ Deleting task:", taskId);
    console.log("From project:", id);
    console.log("Deleted by:", req.user.id);

    const project = await Project.findById(id);
    if (!project) {
      return res.status(404).json({ 
        success: false, 
        message: "Project not found" 
      });
    }

    // Check project access
    if (!hasProjectAccess(project, req.user.id, req.user.role)) {
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

    // Delete task file if exists
    if (task.pdfFile && task.pdfFile.path) {
      fs.unlink(task.pdfFile.path, (err) => {
        if (err) console.error("Error deleting task file:", err);
      });
    }

    // Remove task
    project.tasks.pull(taskId);
    await project.save();

    console.log("✅ Task deleted successfully");

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

// ==========================================
// 📌 TASK STATUS & ACTIVITY CONTROLLERS
// ==========================================
exports.updateTaskStatus = async (req, res) => {
  try {
    const { projectId, taskId } = req.params;
    const { status, remark } = req.body;

    console.log("🔄 Updating task status");
    console.log("Project:", projectId);
    console.log("Task:", taskId);
    console.log("New status:", status);
    console.log("Updated by:", req.user.id);

    if (!TASK_STATUS.includes(status.toLowerCase())) {
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
    const hasAccessToProject = hasProjectAccess(project, req.user.id, req.user.role);
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
    task.status = status.toLowerCase();
    task.updatedAt = new Date();

    // Add activity log
    task.activityLogs.push({
      type: "status_change",
      description: `Status changed from ${oldStatus} to ${status}`,
      oldValue: oldStatus,
      newValue: status,
      performedBy: req.user.id,
      remark: remark
    });

    await project.save();

    // Add notification for status change
    const notification = {
      title: "Task Status Updated",
      message: `Task "${task.title}" status changed from ${oldStatus} to ${status}`,
      type: "status_changed",
      relatedTo: "task",
      referenceId: task._id,
      createdBy: req.user.id
    };

    await project.addNotification(notification);

    const statusNotificationUsers = [project.createdBy, task.assignedTo]
      .filter(userId => userId && !idsEqual(userId, req.user.id));

    await notifyDirectUsers({
      userIds: statusNotificationUsers,
      targetPath: '/ciisUser/task-management',
      type: 'project_task_status_changed',
      title: 'Project Task Updated',
      message: `${req.user.name} changed "${task.title}" status from ${oldStatus} to ${status}${remark ? ': ' + remark : ''}`,
      actor: req.user.id,
      data: {
        projectId: project._id,
        taskId: task._id,
        oldStatus,
        newStatus: status,
        remark,
      },
      priority: 'medium',
    });

    console.log("✅ Task status updated successfully");

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

exports.getTaskActivityLogs = async (req, res) => {
  try {
    const { projectId, taskId } = req.params;

    console.log("📊 Fetching task activity logs");
    console.log("Project:", projectId);
    console.log("Task:", taskId);
    console.log("Requested by:", req.user.id);

    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ 
        success: false, 
        message: "Project not found" 
      });
    }

    // Check project access
    if (!hasProjectAccess(project, req.user.id, req.user.role)) {
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

    // Populate activity logs
    await Project.populate(task, {
      path: 'activityLogs.performedBy',
      select: 'name email'
    });

    console.log(`✅ Found ${task.activityLogs.length} activity logs`);

    res.status(200).json({
      success: true,
      activityLogs: task.activityLogs,
      logs: task.activityLogs,
      data: task.activityLogs
    });
  } catch (error) {
    console.error("❌ Error fetching activity logs:", error);
    res.status(500).json({ 
      success: false, 
      message: "Error fetching activity logs" 
    });
  }
};

// ==========================================
// 📌 REMARKS CONTROLLERS
// ==========================================
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

    if (!hasProjectAccess(project, req.user.id, req.user.role)) {
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

    console.log("💬 Adding remark to task");
    console.log("Project:", projectId);
    console.log("Task:", taskId);
    console.log("Added by:", req.user.id);

    if ((!text || text.trim() === "") && !req.file) {
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

    // Check project access
    if (!hasProjectAccess(project, req.user.id, req.user.role)) {
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

    // Add remark
    task.remarks.push({
      text: text || "",
      createdBy: req.user.id,
      image: imgPath || undefined
    });
    task.updatedAt = new Date();

    // Add activity log
    task.activityLogs.push({
      type: "remark",
      description: `Remark added: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`,
      performedBy: req.user.id
    });

    await project.save();

    // Add notification for remark
    const notification = {
      title: "New Remark Added",
      message: `${req.user.name} added a remark to task "${task.title}"`,
      type: "remark_added",
      relatedTo: "task",
      referenceId: task._id,
      createdBy: req.user.id
    };

    await project.addNotification(notification);

    console.log("✅ Remark added successfully");

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
console.log("✅ projectController.js loaded successfully");
