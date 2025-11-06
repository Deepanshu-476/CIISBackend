const mongoose = require("mongoose");
const Project = require("../models/Project");
const { TASK_STATUS, PROJECT_STATUS } = require("../models/Project");

const USER_SELECT = "name employeeType role";

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

exports.getProjectById = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id)
      .populate("users", USER_SELECT)
      .populate("tasks.assignedTo", USER_SELECT);

    if (!project) return res.status(404).json({ message: "Project not found" });

    // If employee, ensure access only if involved
    if (req.user?.role === "user") {
      const uid = String(req.user._id);
      const involved =
        project.users.some((u) => String(u._id) === uid) ||
        project.tasks.some((t) => String(t.assignedTo?._id) === uid);

      if (!involved) return res.status(403).json({ message: "Forbidden" });
    }

    res.json(project);
  } catch (err) {
    console.error("getProjectById error", err);
    res.status(500).json({ message: "Failed to get project" });
  }
};

exports.createProject = async (req, res) => {
  try {
    const { projectName, users = [], status = "Active", startDate, endDate } = req.body;

    if (!projectName || !projectName.trim()) {
      return res.status(400).json({ message: "projectName is required" });
    }
    if (!PROJECT_STATUS.includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const project = await Project.create({
      projectName: projectName.trim(),
      users,
      status,
      startDate,
      endDate,
      createdBy: req.user?._id,
    });

    const populated = await project
      .populate("users", USER_SELECT)
      .populate("tasks.assignedTo", USER_SELECT);

    res.status(201).json(populated);
  } catch (err) {
    console.error("createProject error", err);
    res.status(500).json({ message: "Failed to create project" });
  }
};

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

    const project = await Project.findByIdAndUpdate(req.params.id, up, { new: true })
      .populate("users", USER_SELECT)
      .populate("tasks.assignedTo", USER_SELECT);

    if (!project) return res.status(404).json({ message: "Project not found" });

    res.json(project);
  } catch (err) {
    console.error("updateProject error", err);
    res.status(500).json({ message: "Failed to update project" });
  }
};

exports.deleteProject = async (req, res) => {
  try {
    const project = await Project.findByIdAndDelete(req.params.id);
    if (!project) return res.status(404).json({ message: "Project not found" });
    res.json({ message: "Deleted" });
  } catch (err) {
    console.error("deleteProject error", err);
    res.status(500).json({ message: "Failed to delete project" });
  }
};

// -------- TASKS --------

exports.addTask = async (req, res) => {
  try {
    const { taskName, assignedTo, status = "Pending" } = req.body;

    if (!taskName || !assignedTo) {
      return res.status(400).json({ message: "taskName & assignedTo required" });
    }
    if (!TASK_STATUS.includes(status)) {
      return res.status(400).json({ message: "Invalid task status" });
    }

    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ message: "Project not found" });

    project.tasks.push({ taskName, assignedTo, status });
    await project.save();

    const populated = await Project.findById(project._id)
      .populate("users", USER_SELECT)
      .populate("tasks.assignedTo", USER_SELECT);

    res.status(201).json(populated);
  } catch (err) {
    console.error("addTask error", err);
    res.status(500).json({ message: "Failed to add task" });
  }
};

exports.updateTask = async (req, res) => {
  try {
    const { taskName, assignedTo, status } = req.body;

    if (status && !TASK_STATUS.includes(status)) {
      return res.status(400).json({ message: "Invalid task status" });
    }

    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ message: "Project not found" });

    const t = project.tasks.id(req.params.taskId);
    if (!t) return res.status(404).json({ message: "Task not found" });

    // Employee can update only their own task status
    if (req.user?.role === "user") {
      const isOwn = String(t.assignedTo) === String(req.user._id);
      if (!isOwn) return res.status(403).json({ message: "Forbidden" });
    }

    if (taskName !== undefined) t.taskName = taskName;
    if (assignedTo !== undefined) t.assignedTo = assignedTo;
    if (status !== undefined) t.status = status;

    await project.save();

    const populated = await Project.findById(project._id)
      .populate("users", USER_SELECT)
      .populate("tasks.assignedTo", USER_SELECT);

    res.json(populated);
  } catch (err) {
    console.error("updateTask error", err);
    res.status(500).json({ message: "Failed to update task" });
  }
};

exports.deleteTask = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ message: "Project not found" });

    const t = project.tasks.id(req.params.taskId);
    if (!t) return res.status(404).json({ message: "Task not found" });

    // Employee cannot delete task
    if (req.user?.role === "user") {
      return res.status(403).json({ message: "Forbidden" });
    }

    t.deleteOne();
    await project.save();

    res.json({ message: "Task deleted" });
  } catch (err) {
    console.error("deleteTask error", err);
    res.status(500).json({ message: "Failed to delete task" });
  }
};
