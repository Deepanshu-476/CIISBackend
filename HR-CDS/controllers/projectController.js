const mongoose = require("mongoose");
const { Project, TASK_STATUS, PROJECT_STATUS } = require("../models/Project");

const USER_SELECT = "name email role";

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
    const project = await Project.findById(req.params.id)
      .populate("users", USER_SELECT)
      .populate("tasks.assignedTo", USER_SELECT);

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
      .populate("tasks.assignedTo", USER_SELECT);

    if (!updated) return res.status(404).json({ message: "Project not found" });

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
      .populate("users", "name _id");

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

    project.tasks.push({
      title,
      description,
      assignedTo,
      dueDate,
      priority,
      remarks,
      status,
      pdfFile,
    });

    await project.save();

    const updated = await Project.findById(project._id)
      .populate("users", USER_SELECT)
      .populate("tasks.assignedTo", USER_SELECT);

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
      .populate("tasks.assignedTo", USER_SELECT);

    res.json(updated);
  } catch (err) {
    console.error("updateTask error", err);
    res.status(500).json({ message: "Failed to update task" });
  }
};


// ⭐ ADD REMARK TO TASK ⭐
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

    // ⭐ FIX: ensure remarks is an array
    if (!Array.isArray(task.remarks)) {
      task.remarks = [];
    }

    task.remarks.push({
      text,
      createdBy: req.user._id,
      createdAt: new Date(),
    });

    await project.save();

    const updated = await Project.findById(projectId)
      .populate("users", "name email")
      .populate("tasks.assignedTo", "name email")
      .populate("tasks.remarks.createdBy", "name");

    res.json(updated);

  } catch (err) {
    console.error("addRemark error", err);
    res.status(500).json({ message: "Failed to add remark" });
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
