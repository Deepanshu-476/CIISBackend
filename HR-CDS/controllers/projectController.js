const mongoose = require("mongoose");
const nodemailer = require("nodemailer");
const { Project } = require("../models/Project");
const User = require("../../models/User"); 

const USER_SELECT = "name email role emailNotifications";

// Email transporter configuration
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Email service function
const sendTaskStatusEmail = async (userEmail, taskData, oldStatus, newStatus, performedBy) => {
  try {
    // Map status values for display
    const statusMap = {
      'pending': 'Pending',
      'in progress': 'In Progress', 
      'completed': 'Completed',
      'on hold': 'On Hold',
      'cancelled': 'Cancelled'
    };

    const displayOldStatus = statusMap[oldStatus] || oldStatus;
    const displayNewStatus = statusMap[newStatus] || newStatus;

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: userEmail,
      subject: `Task Status Updated: ${taskData.title}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #1976d2;">Task Status Update</h2>
          <div style="background: #f5f5f5; padding: 20px; border-radius: 8px;">
            <h3>${taskData.title}</h3>
            <p><strong>Project:</strong> ${taskData.projectName}</p>
            <p><strong>Status Changed:</strong> ${displayOldStatus} → ${displayNewStatus}</p>
            <p><strong>Updated By:</strong> ${performedBy}</p>
            <p><strong>Due Date:</strong> ${taskData.dueDate ? new Date(taskData.dueDate).toLocaleDateString() : 'Not set'}</p>
            <p><strong>Priority:</strong> ${taskData.priority}</p>
            ${taskData.description ? `<p><strong>Description:</strong> ${taskData.description}</p>` : ''}
          </div>
          <p style="margin-top: 20px;">
            <a href="${process.env.BASE_URL || 'http://localhost:3000'}/projects" style="background: #1976d2; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px;">
              View Task
            </a>
          </p>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log(`Status update email sent to ${userEmail}`);
  } catch (error) {
    console.error("Error sending email:", error);
  }
};

const sendTaskAssignmentEmail = async (userEmail, taskData, assignedBy) => {
  try {
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: userEmail,
      subject: `New Task Assigned: ${taskData.title}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #1976d2;">New Task Assigned</h2>
          <div style="background: #f5f5f5; padding: 20px; border-radius: 8px;">
            <h3>${taskData.title}</h3>
            <p><strong>Project:</strong> ${taskData.projectName}</p>
            <p><strong>Assigned By:</strong> ${assignedBy}</p>
            <p><strong>Due Date:</strong> ${taskData.dueDate ? new Date(taskData.dueDate).toLocaleDateString() : 'Not set'}</p>
            <p><strong>Priority:</strong> ${taskData.priority}</p>
            <p><strong>Status:</strong> ${taskData.status}</p>
            ${taskData.description ? `<p><strong>Description:</strong> ${taskData.description}</p>` : ''}
          </div>
          <p style="margin-top: 20px;">
            <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/projects" style="background: #1976d2; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px;">
              View Task
            </a>
          </p>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log(`Task assignment email sent to ${userEmail}`);
  } catch (error) {
    console.error("Error sending assignment email:", error);
  }
};

// =====================================================================
// 📌 NOTIFICATION FUNCTIONS (USING PROJECT MODEL)
// =====================================================================

/* =========================
 📌 CREATE NOTIFICATION IN PROJECT
========================= */
const createProjectNotification = async (projectId, userId, message, type, createdBy) => {
  try {
    await Project.findByIdAndUpdate(projectId, {
      $push: {
        notifications: {
          message,
          type,
          createdBy,
          read: false,
          createdAt: new Date(),
        },
      },
    });
  } catch (error) {
    console.error("Error creating project notification:", error);
  }
};

/* =========================
 📌 GET PROJECT NOTIFICATIONS FOR USER
========================= */
exports.getUserNotifications = async (req, res) => {
  try {
    const userId = req.user._id;
    
    // Find all projects where user is a member
    const projects = await Project.find({
      $or: [
        { users: userId },
        { "tasks.assignedTo": userId },
        { createdBy: userId }
      ]
    })
    .select("projectName notifications")
    .populate("notifications.createdBy", "name email")
    .sort({ "notifications.createdAt": -1 });

    // Combine all notifications from all projects
    const allNotifications = [];
    projects.forEach(project => {
      if (project.notifications && project.notifications.length > 0) {
        project.notifications.forEach(notification => {
          allNotifications.push({
            ...notification.toObject(),
            projectName: project.projectName,
            projectId: project._id
          });
        });
      }
    });

    // Sort by creation date (newest first)
    allNotifications.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({
      notifications: allNotifications,
      total: allNotifications.length,
      unread: allNotifications.filter(n => !n.read).length
    });
  } catch (err) {
    console.error("getUserNotifications error", err);
    res.status(500).json({ message: "Failed to get notifications" });
  }
};

/* =========================
 📌 MARK NOTIFICATION AS READ
========================= */
exports.markNotificationAsRead = async (req, res) => {
  try {
    const { projectId, notificationId } = req.params;

    const project = await Project.findOneAndUpdate(
      {
        _id: projectId,
        "notifications._id": notificationId,
      },
      {
        $set: {
          "notifications.$.read": true,
        },
      },
      { new: true }
    );

    if (!project) {
      return res.status(404).json({ message: "Notification not found" });
    }

    res.json({ message: "Notification marked as read" });
  } catch (err) {
    console.error("markNotificationAsRead error", err);
    res.status(500).json({ message: "Failed to update notification" });
  }
};

/* =========================
 📌 CLEAR ALL NOTIFICATIONS FOR USER
========================= */
exports.clearAllNotifications = async (req, res) => {
  try {
    const userId = req.user._id;
    
    // Find all projects where user is a member and clear their notifications
    const projects = await Project.find({
      $or: [
        { users: userId },
        { "tasks.assignedTo": userId },
        { createdBy: userId }
      ]
    });

    // Clear notifications for each project
    const updatePromises = projects.map(project => 
      Project.updateMany(
        { _id: project._id },
        { $set: { "notifications.$[].read": true } }
      )
    );

    await Promise.all(updatePromises);

    res.json({ message: "All notifications marked as read" });
  } catch (err) {
    console.error("clearAllNotifications error", err);
    res.status(500).json({ message: "Failed to clear notifications" });
  }
};

// =====================================================================
// 📌 LIST ALL PROJECTS
// =====================================================================
exports.listProjects = async (req, res) => {
  try {
    const page = parseInt(req.query.page || "1", 10);
    const limit = parseInt(req.query.limit || "10", 10);
    const skip = (page - 1) * limit;

    const filter = {};

    if (req.user?.role === "user") {
      const uid = new mongoose.Types.ObjectId(req.user._id);
      filter.$or = [
        { users: uid },
        { tasks: { $elemMatch: { assignedTo: uid } } }
      ];
    }

    const [items, total] = await Promise.all([
      Project.find(filter)
        .populate("users", USER_SELECT)
        .populate("tasks.assignedTo", USER_SELECT)
        .populate("notifications.createdBy", "name email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),

      Project.countDocuments(filter),
    ]);

    res.json({
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
      items,
    });
  } catch (err) {
    console.error("listProjects error", err);
    res.status(500).json({ message: "Failed to list projects" });
  }
};

// =====================================================================
// 📌 GET PROJECT BY ID
// =====================================================================
exports.getProjectById = async (req, res) => {
  try {
    const { id } = req.params;

    // Validate if it's a valid ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid project ID format" });
    }

    const project = await Project.findById(id)
      .populate("users", USER_SELECT)
      .populate("tasks.assignedTo", USER_SELECT)
      .populate("tasks.activityLogs.performedBy", "name")
      .populate("tasks.remarks.createdBy", "name")
      .populate("notifications.createdBy", "name email");

    if (!project) return res.status(404).json({ message: "Project not found" });

    if (req.user?.role === "user") {
      const uid = String(req.user._id);
      const involved =
        project.users.some((u) => String(u._id) === uid) ||
        project.tasks.some((t) => String(t.assignedTo?._id) === uid);

      if (!involved)
        return res.status(403).json({ message: "Access forbidden" });
    }

    res.json(project);
  } catch (err) {
    console.error("getProjectById error", err);
    res.status(500).json({ message: "Failed to get project" });
  }
};

// =====================================================================
// 📌 CREATE PROJECT
// =====================================================================
exports.createProject = async (req, res) => {
  try {
    const {
      projectName,
      description,
      users,
      status,
      startDate,
      endDate,
      priority,
    } = req.body;

    let parsedUsers = [];
    if (Array.isArray(users)) parsedUsers = users;
    else if (typeof users === "string") parsedUsers = JSON.parse(users);

    let pdfFile = null;
    if (req.file) {
      pdfFile = {
        filename: req.file.filename,
        path: req.file.path,
      };
    }

    const project = await Project.create({
      projectName,
      description,
      users: parsedUsers,
      status,
      startDate,
      endDate,
      priority,
      pdfFile,
      createdBy: req.user?._id,
    });

    // Create notification for project creation
    await createProjectNotification(
      project._id,
      req.user._id,
      `Project "${projectName}" has been created`,
      "Project Creation",
      req.user._id
    );

    return res.status(201).json(project);
  } catch (error) {
    console.error("Create project error:", error);
    return res.status(500).json({ message: "Server error", error });
  }
};

// =====================================================================
// 📌 UPDATE PROJECT
// =====================================================================
exports.updateProject = async (req, res) => {
  try {
    const allowed = [
      "projectName",
      "description",
      "priority",
      "status",
      "users",
      "startDate",
      "endDate",
    ];

    const updates = {};

    allowed.forEach((key) => {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    });

    if (updates.users && typeof updates.users === "string") {
      updates.users = JSON.parse(updates.users);
    }

    if (req.file) {
      updates.pdfFile = {
        filename: req.file.filename,
        path: req.file.path,
      };
    }

    const updated = await Project.findByIdAndUpdate(req.params.id, updates, {
      new: true,
    })
      .populate("users", USER_SELECT)
      .populate("tasks.assignedTo", USER_SELECT)
      .populate("notifications.createdBy", "name email");

    if (!updated) return res.status(404).json({ message: "Project not found" });

    // Create notification for project update
    await createProjectNotification(
      updated._id,
      req.user._id,
      `Project "${updated.projectName}" has been updated`,
      "Project Update",
      req.user._id
    );

    res.json(updated);
  } catch (err) {
    console.error("updateProject error", err);
    res.status(500).json({ message: "Failed to update project" });
  }
};

// =====================================================================
// 📌 DELETE PROJECT
// =====================================================================
exports.deleteProject = async (req, res) => {
  try {
    const project = await Project.findByIdAndDelete(req.params.id);
    if (!project)
      return res.status(404).json({ message: "Project not found" });

    res.json({ message: "Project deleted successfully" });
  } catch (err) {
    console.error("deleteProject error", err);
    res.status(500).json({ message: "Failed to delete project" });
  }
};

// =====================================================================
// 📌 ADD TASK TO PROJECT
// =====================================================================
exports.addTask = async (req, res) => {
  try {
    const {
      title,
      description,
      assignedTo,
      dueDate,
      priority,
      remarks,
      status,
    } = req.body;

    const project = await Project.findById(req.params.id)
      .populate("users", "name email _id emailNotifications");

    if (!project)
      return res.status(404).json({ message: "Project not found" });

    const isMember = project.users.some(
      (u) => String(u._id) === String(assignedTo)
    );

    if (!isMember)
      return res.status(400).json({
        message: "Assigned user must be part of project.",
      });

    let pdfFile = null;
    if (req.file) {
      pdfFile = {
        filename: req.file.filename,
        path: req.file.path,
      };
    }

    const newTask = {
      title,
      description,
      assignedTo,
      dueDate,
      priority,
      remarks,
      status: status || "pending",
      pdfFile,
    };

    project.tasks.push(newTask);

    await project.save();

    const updated = await Project.findById(project._id)
      .populate("users", USER_SELECT)
      .populate("tasks.assignedTo", USER_SELECT)
      .populate("notifications.createdBy", "name email");

    // Send email notification for new task assignment
    try {
      const assignedUser = await User.findById(assignedTo);
      const assignedByUser = await User.findById(req.user._id);
      
      if (assignedUser && assignedUser.emailNotifications) {
        await sendTaskAssignmentEmail(
          assignedUser.email,
          {
            title,
            projectName: project.projectName,
            dueDate,
            priority,
            status: status || "pending",
            description,
          },
          assignedByUser.name
        );
      }
    } catch (emailError) {
      console.error("Failed to send assignment email:", emailError);
    }

    // Create notification in project for assigned user
    await createProjectNotification(
      project._id,
      assignedTo,
      `New task "${title}" assigned to you in project "${project.projectName}"`,
      "Task Assignment",
      req.user._id
    );

    res.json(updated);
  } catch (err) {
    console.error("addTask error", err);
    res.status(500).json({ message: "Failed to add task" });
  }
};

// =====================================================================
// 📌 UPDATE TASK
// =====================================================================
exports.updateTask = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project)
      return res.status(404).json({ message: "Project not found" });

    const task = project.tasks.id(req.params.taskId);
    if (!task)
      return res.status(404).json({ message: "Task not found" });

    const fields = [
      "title",
      "description",
      "dueDate",
      "priority",
      "remarks",
      "status",
      "assignedTo",
    ];

    const oldAssignedTo = task.assignedTo?.toString();
    const oldStatus = task.status;
    
    fields.forEach((f) => {
      if (req.body[f] !== undefined) task[f] = req.body[f];
    });

    if (req.body.assignedTo) {
      const isMember = project.users.some(
        (u) => String(u._id) === String(req.body.assignedTo)
      );
      if (!isMember)
        return res.status(400).json({
          message: "Assigned user must be project member",
        });

      // If assigned user changed, send notification
      if (oldAssignedTo !== req.body.assignedTo) {
        await createProjectNotification(
          project._id,
          req.body.assignedTo,
          `Task "${task.title}" has been assigned to you`,
          "Task Assignment",
          req.user._id
        );
      }
    }

    // Add activity log for status change
    if (req.body.status && req.body.status !== oldStatus) {
      task.activityLogs.push({
        type: "status change",
        description: `Status changed from ${oldStatus} to ${req.body.status}`,
        performedBy: req.user._id,
        performedAt: new Date(),
      });

      // Send email notification for status change
      try {
        const assignedUser = await User.findById(task.assignedTo);
        const performedByUser = await User.findById(req.user._id);
        
        if (assignedUser && assignedUser.emailNotifications) {
          await sendTaskStatusEmail(
            assignedUser.email,
            {
              title: task.title,
              projectName: project.projectName,
              dueDate: task.dueDate,
              priority: task.priority,
              description: task.description,
            },
            oldStatus,
            req.body.status,
            performedByUser.name
          );
        }
      } catch (emailError) {
        console.error("Failed to send status email:", emailError);
      }

      // Create notification for status change
      if (task.assignedTo && task.assignedTo.toString() !== req.user._id.toString()) {
        await createProjectNotification(
          project._id,
          task.assignedTo,
          `Task "${task.title}" status changed from ${oldStatus} to ${req.body.status}`,
          "Status Update",
          req.user._id
        );
      }
    }

    if (req.file) {
      task.pdfFile = {
        filename: req.file.filename,
        path: req.file.path,
      };
    }

    await project.save();

    const updated = await Project.findById(project._id)
      .populate("users", USER_SELECT)
      .populate("tasks.assignedTo", USER_SELECT)
      .populate("notifications.createdBy", "name email");

    res.json(updated);
  } catch (err) {
    console.error("updateTask error", err);
    res.status(500).json({ message: "Failed to update task" });
  }
};

// =====================================================================
// 📌 UPDATE TASK STATUS
// =====================================================================
exports.updateTaskStatus = async (req, res) => {
  try {
    const { projectId, taskId } = req.params;
    const { status, remark } = req.body;
    const userId = req.user._id;

    // Validate status against allowed values
    const allowedStatuses = ['pending', 'in progress', 'completed', 'on hold', 'cancelled'];
    if (!status || !allowedStatuses.includes(status)) {
      return res.status(400).json({ 
        message: "Invalid status. Allowed values: " + allowedStatuses.join(', ')
      });
    }

    const project = await Project.findById(projectId)
      .populate("users", "name email emailNotifications");
    if (!project) return res.status(404).json({ message: "Project not found" });

    const task = project.tasks.id(taskId);
    if (!task) return res.status(404).json({ message: "Task not found" });

    // Check if user has permission to update this task
    const isInvolved = 
      project.users.some(u => String(u._id) === String(userId)) ||
      String(task.assignedTo) === String(userId);

    if (!isInvolved) {
      return res.status(403).json({ message: "Access forbidden" });
    }

    const oldStatus = task.status;
    task.status = status;

    // Add activity log
    task.activityLogs.push({
      type: "status change",
      description: `Status changed from ${oldStatus} to ${status}${remark ? ` - ${remark}` : ''}`,
      performedBy: userId,
      performedAt: new Date(),
    });

    // Add remark if provided
    if (remark && remark.trim() !== "") {
      if (!Array.isArray(task.remarks)) {
        task.remarks = [];
      }
      task.remarks.push({
        text: remark,
        createdBy: userId,
        createdAt: new Date(),
      });
    }

    await project.save();

    // Send email notification
    try {
      const assignedUser = await User.findById(task.assignedTo);
      const performedByUser = await User.findById(userId);
      
      if (assignedUser && assignedUser.emailNotifications && assignedUser._id.toString() !== userId.toString()) {
        await sendTaskStatusEmail(
          assignedUser.email,
          {
            title: task.title,
            projectName: project.projectName,
            dueDate: task.dueDate,
            priority: task.priority,
            description: task.description,
          },
          oldStatus,
          status,
          performedByUser.name
        );
      }
    } catch (emailError) {
      console.error("Failed to send status email:", emailError);
    }

    // Create notification for task owner if status updated by someone else
    if (String(task.assignedTo) !== String(userId)) {
      await createProjectNotification(
        projectId,
        task.assignedTo,
        `Task "${task.title}" status changed from ${oldStatus} to ${status}`,
        "Status Update",
        userId
      );
    }

    const updated = await Project.findById(projectId)
      .populate("users", USER_SELECT)
      .populate("tasks.assignedTo", USER_SELECT)
      .populate("tasks.activityLogs.performedBy", "name")
      .populate("tasks.remarks.createdBy", "name")
      .populate("notifications.createdBy", "name email");

    res.json(updated);
  } catch (err) {
    console.error("updateTaskStatus error", err);
    res.status(500).json({ message: "Failed to update task status" });
  }
};

// =====================================================================
// 📌 ADD REMARK TO TASK
// =====================================================================
exports.addRemark = async (req, res) => {
  try {
    const { projectId, taskId } = req.params;
    const { text } = req.body;

    if (!text || text.trim() === "") {
      return res.status(400).json({ message: "Remark text required" });
    }

    const project = await Project.findById(projectId);
    if (!project) return res.status(404).json({ message: "Project not found" });

    const task = project.tasks.id(taskId);
    if (!task) return res.status(404).json({ message: "Task not found" });

    // Ensure remarks is an array
    if (!Array.isArray(task.remarks)) {
      task.remarks = [];
    }

    task.remarks.push({
      text,
      createdBy: req.user._id,
      createdAt: new Date(),
    });

    // Add activity log for remark
    task.activityLogs.push({
      type: "remark",
      description: `New remark added: ${text.substring(0, 50)}...`,
      performedBy: req.user._id,
      performedAt: new Date(),
    });

    await project.save();

    const updated = await Project.findById(projectId)
      .populate("users", "name email")
      .populate("tasks.assignedTo", "name email")
      .populate("tasks.remarks.createdBy", "name")
      .populate("tasks.activityLogs.performedBy", "name")
      .populate("notifications.createdBy", "name email");

    // Create notification for task owner
    if (task.assignedTo && task.assignedTo.toString() !== req.user._id.toString()) {
      await createProjectNotification(
        projectId,
        task.assignedTo,
        `New remark added to your task "${task.title}"`,
        "Remark",
        req.user._id
      );
    }

    res.json(updated);

  } catch (err) {
    console.error("addRemark error", err);
    res.status(500).json({ message: "Failed to add remark" });
  }
};

// =====================================================================
// 📌 GET TASK ACTIVITY LOGS
// =====================================================================
exports.getTaskActivityLogs = async (req, res) => {
  try {
    const { projectId, taskId } = req.params;

    const project = await Project.findById(projectId)
      .populate("tasks.activityLogs.performedBy", "name email");

    if (!project) return res.status(404).json({ message: "Project not found" });

    const task = project.tasks.id(taskId);
    if (!task) return res.status(404).json({ message: "Task not found" });

    res.json({
      activityLogs: task.activityLogs || [],
    });

  } catch (err) {
    console.error("getTaskActivityLogs error", err);
    res.status(500).json({ message: "Failed to get activity logs" });
  }
};

// =====================================================================
// 📌 DELETE TASK
// =====================================================================
exports.deleteTask = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project)
      return res.status(404).json({ message: "Project not found" });

    const task = project.tasks.id(req.params.taskId);
    if (!task)
      return res.status(404).json({ message: "Task not found" });

    task.deleteOne();
    await project.save();

    res.json({ message: "Task deleted successfully" });
  } catch (err) {
    console.error("deleteTask error", err);
    res.status(500).json({ message: "Failed to delete task" });
  }
};