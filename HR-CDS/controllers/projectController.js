const mongoose = require("mongoose");
const Project = require("../models/Project");
const { TASK_STATUS, PROJECT_STATUS } = require("../models/Project");

const USER_SELECT = "name email role employeeType";

// -------------------------------------------------------------------
// 📦 LIST ALL PROJECTS
// -------------------------------------------------------------------
exports.listProjects = async (req, res) => {
  try {
    const page = parseInt(req.query.page || "1", 10);
    const limit = parseInt(req.query.limit || "10", 10);
    const skip = (page - 1) * limit;

    const filter = {};

    // If employee, show only assigned projects
    if (req.user?.role === "user") {
      const uid = new mongoose.Types.ObjectId(req.user._id);
      filter.$or = [
        { users: uid },
        { tasks: { $elemMatch: { assignedTo: uid } } },
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
      items,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error("listProjects error", err);
    res.status(500).json({ message: "Failed to list projects" });
  }
};

// -------------------------------------------------------------------
// 📦 GET PROJECT BY ID
// -------------------------------------------------------------------
exports.getProjectById = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id)
      .populate("users", USER_SELECT)
      .populate("tasks.assignedTo", USER_SELECT);

    if (!project) return res.status(404).json({ message: "Project not found" });

    // Employee can access only if part of project
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

// -------------------------------------------------------------------
// 🏗️ CREATE PROJECT
// -------------------------------------------------------------------
exports.createProject = async (req, res) => {
  try {
    const { projectName, users, status, startDate, endDate } = req.body;

    const project = await Project.create({
      projectName,
      users: Array.isArray(users)
        ? users.map((id) => new mongoose.Types.ObjectId(id))
        : [],
      status,
      startDate,
      endDate,
    });

    res.status(201).json(project);
  } catch (error) {
    console.error("Create project error:", error);
    res.status(500).json({ message: "Server error", error });
  }
};

// -------------------------------------------------------------------
// ✏️ UPDATE PROJECT
// -------------------------------------------------------------------
exports.updateProject = async (req, res) => {
  try {
    const up = {};
    const allowed = ["projectName", "users", "status", "startDate", "endDate"];

    for (const key of allowed) {
      if (key in req.body) up[key] = req.body[key];
    }

    if (up.status && !PROJECT_STATUS.includes(up.status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    if (up.projectName) up.projectName = String(up.projectName).trim();

    if (up.users && Array.isArray(up.users)) {
      up.users = up.users.filter((u) => mongoose.isValidObjectId(u));
    }

    const project = await Project.findByIdAndUpdate(req.params.id, up, {
      new: true,
    })
      .populate("users", USER_SELECT)
      .populate("tasks.assignedTo", USER_SELECT);

    if (!project) return res.status(404).json({ message: "Project not found" });

    res.json(project);
  } catch (err) {
    console.error("updateProject error", err);
    res.status(500).json({ message: "Failed to update project" });
  }
};

// -------------------------------------------------------------------
// 🗑️ DELETE PROJECT
// -------------------------------------------------------------------
exports.deleteProject = async (req, res) => {
  try {
    const project = await Project.findByIdAndDelete(req.params.id);
    if (!project) return res.status(404).json({ message: "Project not found" });
    res.json({ message: "Deleted successfully" });
  } catch (err) {
    console.error("deleteProject error", err);
    res.status(500).json({ message: "Failed to delete project" });
  }
};

// -------------------------------------------------------------------
// ✅ TASK OPERATIONS
// -------------------------------------------------------------------

// 🟢 Add Task
// ✅ Add Task Controller (Fixed)
// 🟢 Add Task
exports.addTask = async (req, res) => {
  try {
    const projectId = req.params.id;
    const { title, assignedTo, status } = req.body; // ✅ renamed taskName -> title

    if (!title || !assignedTo)
      return res
        .status(400)
        .json({ message: "title and assignedTo are required" });

    const project = await Project.findById(projectId).populate(
      "users",
      "name _id"
    );
    if (!project) return res.status(404).json({ message: "Project not found" });

    // ✅ Only project members can be assigned
    const isMember = project.users.some(
      (u) => u._id.toString() === assignedTo.toString()
    );
    if (!isMember)
      return res
        .status(400)
        .json({ message: "Assigned user is not part of this project" });

    // ✅ Handle PDF
    let pdfFile = null;
    if (req.file) {
      pdfFile = {
        path: req.file.path,
        filename: req.file.filename,
      };
    }

    // ✅ Push new task
    const newTask = {
      title, // ✅ changed from taskName
      assignedTo,
      status: status || "Pending",
      pdfFile,
    };

    project.tasks.push(newTask);
    await project.save();

    const updated = await Project.findById(projectId)
      .populate("users", "name _id")
      .populate("tasks.assignedTo", "name");

    return res.status(200).json(updated);
  } catch (error) {
    console.error("addTask error:", error);
    return res.status(500).json({ message: "Server error", error });
  }
};


// 🟢 Update Task (Now includes reassign restriction)
// 🟢 Update Task (uses "title" instead of "taskName")
exports.updateTask = async (req, res) => {
  try {
    const { title, assignedTo, status } = req.body;

    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ message: "Project not found" });

    const t = project.tasks.id(req.params.taskId);
    if (!t) return res.status(404).json({ message: "Task not found" });

    // ✅ Check if reassignment is within project users
    if (assignedTo) {
      const isMember = project.users.some(
        (u) => String(u._id || u) === String(assignedTo)
      );
      if (!isMember) {
        return res
          .status(400)
          .json({ message: "Assigned user must be part of project" });
      }
    }

    if (title !== undefined) t.title = title; // ✅ changed field
    if (assignedTo !== undefined) t.assignedTo = assignedTo;
    if (status !== undefined) t.status = status;

    await project.save();

    const populated = await Project.findById(project._id)
      .populate("users", "name email")
      .populate("tasks.assignedTo", "name email");

    res.json(populated);
  } catch (err) {
    console.error("updateTask error", err);
    res.status(500).json({ message: "Failed to update task" });
  }
};


// 🟢 Delete Task
exports.deleteTask = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ message: "Project not found" });

    const t = project.tasks.id(req.params.taskId);
    if (!t) return res.status(404).json({ message: "Task not found" });

    if (req.user?.role === "user") {
      return res.status(403).json({ message: "Forbidden" });
    }

    t.deleteOne();
    await project.save();

    res.json({ message: "Task deleted successfully" });
  } catch (err) {
    console.error("deleteTask error", err);
    res.status(500).json({ message: "Failed to delete task" });
  }
};
