const { Project, TASK_STATUS, PROJECT_STATUS, PRIORITY_LEVELS, NOTIFICATION_TYPES } = require("../models/Project");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

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
  if (file.mimetype === 'application/pdf') {
    cb(null, true);
  } else {
    cb(new Error('Only PDF files are allowed'), false);
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
// 📌 NOTIFICATION CONTROLLERS
// ==========================================
exports.getUserNotifications = async (req, res) => {
  try {
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
    console.error("Error fetching notifications:", error);
    res.status(500).json({ 
      success: false, 
      message: "Error fetching notifications" 
    });
  }
};

exports.markNotificationAsRead = async (req, res) => {
  try {
    const { notificationId } = req.params;
    
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
    console.error("Error marking notification as read:", error);
    res.status(500).json({ 
      success: false, 
      message: "Error marking notification as read" 
    });
  }
};

exports.clearAllNotifications = async (req, res) => {
  try {
    await Project.updateMany(
      { users: req.user.id },
      { $set: { notifications: [] } }
    );

    res.status(200).json({
      success: true,
      message: "All notifications cleared"
    });
  } catch (error) {
    console.error("Error clearing notifications:", error);
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
    let query = {};
    
    // If not admin, only show projects user is part of
    if (req.user.role !== 'admin') {
      query.users = req.user.id;
    }

    const projects = await Project.find(query)
      .populate('users', 'name email role')
      .populate('createdBy', 'name email')
      .populate('tasks.assignedTo', 'name email')
      .populate('tasks.createdBy', 'name email')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: projects.length,
      items: projects
    });
  } catch (error) {
    console.error("Error listing projects:", error);
    res.status(500).json({ 
      success: false, 
      message: "Error fetching projects" 
    });
  }
};

exports.getProjectById = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id)
      .populate('users', 'name email role')
      .populate('createdBy', 'name email')
      .populate('tasks.assignedTo', 'name email')
      .populate('tasks.createdBy', 'name email')
      .populate('tasks.remarks.createdBy', 'name email')
      .populate('tasks.activityLogs.performedBy', 'name email');

    if (!project) {
      return res.status(404).json({ 
        success: false, 
        message: "Project not found" 
      });
    }

    // Check if user has access to this project
    if (req.user.role !== 'admin' && 
        !project.users.some(user => user._id.toString() === req.user.id)) {
      return res.status(403).json({ 
        success: false, 
        message: "Access denied" 
      });
    }

    res.status(200).json({
      success: true,
      ...project.toObject()
    });
  } catch (error) {
    console.error("Error fetching project:", error);
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
      
      let usersArray = [];
      try {
        usersArray = JSON.parse(users);
      } catch (parseError) {
        usersArray = Array.isArray(users) ? users : [];
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
        type: "project_updated",
        relatedTo: "project",
        referenceId: project._id,
        createdBy: req.user.id
      };

      await project.addNotification(notification);

      res.status(201).json({
        success: true,
        message: "Project created successfully",
        project
      });
    });
  } catch (error) {
    console.error("Error creating project:", error);
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
      
      let usersArray = [];
      try {
        usersArray = JSON.parse(users);
      } catch (parseError) {
        usersArray = Array.isArray(users) ? users : [];
      }

      // Find existing project
      const project = await Project.findById(id);
      if (!project) {
        return res.status(404).json({ 
          success: false, 
          message: "Project not found" 
        });
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

      res.status(200).json({
        success: true,
        message: "Project updated successfully",
        project
      });
    });
  } catch (error) {
    console.error("Error updating project:", error);
    res.status(500).json({ 
      success: false, 
      message: "Error updating project" 
    });
  }
};

exports.deleteProject = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    
    if (!project) {
      return res.status(404).json({ 
        success: false, 
        message: "Project not found" 
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

    res.status(200).json({
      success: true,
      message: "Project deleted successfully"
    });
  } catch (error) {
    console.error("Error deleting project:", error);
    res.status(500).json({ 
      success: false, 
      message: "Error deleting project" 
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

      const project = await Project.findById(id);
      if (!project) {
        return res.status(404).json({ 
          success: false, 
          message: "Project not found" 
        });
      }

      // Create task
      const task = {
        title,
        description,
        assignedTo,
        dueDate,
        priority: priority?.toLowerCase(),
        status: status?.toLowerCase(),
        createdBy: req.user.id
      };

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
        description: `Task "${title}" was created`,
        performedBy: req.user.id
      };

      task.activityLogs = [activityLog];

      // Add task to project
      project.tasks.push(task);
      await project.save();

      // Add notification for assigned user
      const notification = {
        title: "New Task Assigned",
        message: `You have been assigned task "${title}" in project "${project.projectName}"`,
        type: "task_assigned",
        relatedTo: "task",
        referenceId: project.tasks[project.tasks.length - 1]._id,
        createdBy: req.user.id
      };

      await project.addNotification(notification);

      res.status(201).json({
        success: true,
        message: "Task added successfully",
        task: project.tasks[project.tasks.length - 1]
      });
    });
  } catch (error) {
    console.error("Error adding task:", error);
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

    const project = await Project.findById(id);
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

    // Update task fields
    Object.keys(updateData).forEach(key => {
      if (key === 'priority' || key === 'status') {
        task[key] = updateData[key].toLowerCase();
      } else if (key !== '_id') {
        task[key] = updateData[key];
      }
    });

    // Add activity log
    task.activityLogs.push({
      type: "update",
      description: `Task was updated`,
      performedBy: req.user.id
    });

    await project.save();

    res.status(200).json({
      success: true,
      message: "Task updated successfully",
      task
    });
  } catch (error) {
    console.error("Error updating task:", error);
    res.status(500).json({ 
      success: false, 
      message: "Error updating task" 
    });
  }
};

exports.deleteTask = async (req, res) => {
  try {
    const { id, taskId } = req.params;

    const project = await Project.findById(id);
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

    // Delete task file if exists
    if (task.pdfFile && task.pdfFile.path) {
      fs.unlink(task.pdfFile.path, (err) => {
        if (err) console.error("Error deleting task file:", err);
      });
    }

    // Remove task
    project.tasks.pull(taskId);
    await project.save();

    res.status(200).json({
      success: true,
      message: "Task deleted successfully"
    });
  } catch (error) {
    console.error("Error deleting task:", error);
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

    const oldStatus = task.status;
    task.status = status.toLowerCase();

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

    res.status(200).json({
      success: true,
      message: "Task status updated successfully",
      task
    });
  } catch (error) {
    console.error("Error updating task status:", error);
    res.status(500).json({ 
      success: false, 
      message: "Error updating task status" 
    });
  }
};

exports.getTaskActivityLogs = async (req, res) => {
  try {
    const { projectId, taskId } = req.params;

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

    // Populate activity logs
    await Project.populate(task, {
      path: 'activityLogs.performedBy',
      select: 'name email'
    });

    res.status(200).json({
      success: true,
      activityLogs: task.activityLogs
    });
  } catch (error) {
    console.error("Error fetching activity logs:", error);
    res.status(500).json({ 
      success: false, 
      message: "Error fetching activity logs" 
    });
  }
};

// ==========================================
// 📌 REMARKS CONTROLLERS
// ==========================================
exports.addRemark = async (req, res) => {
  try {
    const { projectId, taskId } = req.params;
    const { text } = req.body;

    if (!text || text.trim() === "") {
      return res.status(400).json({ 
        success: false, 
        message: "Remark text is required" 
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

    // Add remark
    task.remarks.push({
      text,
      createdBy: req.user.id
    });

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

    res.status(201).json({
      success: true,
      message: "Remark added successfully",
      remark: task.remarks[task.remarks.length - 1]
    });
  } catch (error) {
    console.error("Error adding remark:", error);
    res.status(500).json({ 
      success: false, 
      message: "Error adding remark" 
    });
  }
};