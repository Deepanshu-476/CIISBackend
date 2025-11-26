// models/Project.js
const mongoose = require("mongoose");
const { Schema } = mongoose;

/* ENUMS - Fixed to match what you're actually using */
const TASK_STATUS = ["pending", "in progress", "completed", "rejected", "on hold", "reopened"];
const PROJECT_STATUS = ["Active", "On Hold", "Completed", "Planning", "Cancelled"];
const PRIORITY_LEVELS = ["Low", "Medium", "High", "Critical"];
const ACTIVITY_TYPES = [ "Assignment", "Remark", "Creation", "Updatecd"];

/* =========================
      NOTIFICATION SCHEMA
========================= */
const NotificationSchema = new Schema(
  {
    message: { type: String, required: true },
    type: { type: String, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    read: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
  },
  { _id: true }
);

/* =========================
      ACTIVITY LOG SCHEMA
========================= */
const ActivityLogSchema = new Schema(
  {
    type: { type: String, enum: ACTIVITY_TYPES, required: true },
    description: { type: String, required: true },
    oldValue: { type: String },
    newValue: { type: String },
    performedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    performedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

/* =========================
      REMARK SCHEMA
========================= */
const RemarkSchema = new Schema(
  {
    text: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { _id: false }
);

/* =========================
      TASK SCHEMA - FIXED DEFAULTS
========================= */
const TaskSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    assignedTo: { type: Schema.Types.ObjectId, ref: "User", required: true },
    dueDate: { type: Date },
    priority: { type: String, enum: PRIORITY_LEVELS, default: "medium" }, // Fixed: lowercase
    status: { type: String, enum: TASK_STATUS, default: "pending" }, // Fixed: lowercase
    pdfFile: {
      filename: String,
      path: String,
    },
    remarks: {
      type: [RemarkSchema],
      default: [],
    },
    activityLogs: {
      type: [ActivityLogSchema],
      default: [],
    },
  },
  { timestamps: true }
);

/* =========================
      PROJECT SCHEMA - FIXED DEFAULTS
========================= */
const ProjectSchema = new Schema(
  {
    projectName: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    users: [{ type: Schema.Types.ObjectId, ref: "User" }],
    status: { type: String, enum: PROJECT_STATUS, default: "active" }, // Fixed: lowercase
    startDate: { type: Date },
    endDate: { type: Date },
    priority: { type: String, enum: PRIORITY_LEVELS, default: "medium" }, // Fixed: lowercase
    pdfFile: {
      filename: String,
      path: String,
    },
    tasks: [TaskSchema],
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    // ADDED NOTIFICATIONS ARRAY
    notifications: {
      type: [NotificationSchema],
      default: []
    }
  },
  { timestamps: true }
);

ProjectSchema.index({ projectName: "text" });

/* =========================
      DATA NORMALIZATION MIDDLEWARE
========================= */
ProjectSchema.pre('save', function(next) {
  // Normalize status and priority to lowercase
  if (this.status) {
    this.status = this.status.toLowerCase();
  }
  if (this.priority) {
    this.priority = this.priority.toLowerCase();
  }
  
  // Normalize task fields
  if (this.tasks && this.tasks.length > 0) {
    this.tasks.forEach(task => {
      if (task.status) {
        task.status = task.status.toLowerCase();
      }
      if (task.priority) {
        task.priority = task.priority.toLowerCase();
      }
      if (task.activityLogs && task.activityLogs.length > 0) {
        task.activityLogs.forEach(log => {
          if (log.type) {
            log.type = log.type.toLowerCase();
          }
        });
      }
    });
  }
  
  next();
});

// Also add for update operations
ProjectSchema.pre('findOneAndUpdate', function(next) {
  const update = this.getUpdate();
  
  if (update.$set) {
    if (update.$set.status) {
      update.$set.status = update.$set.status.toLowerCase();
    }
    if (update.$set.priority) {
      update.$set.priority = update.$set.priority.toLowerCase();
    }
  }
  
  next();
});

/* =========================
      FINAL EXPORTS
========================= */
const Project = mongoose.model("Project", ProjectSchema);

module.exports = {
  Project,
  TASK_STATUS,
  PROJECT_STATUS,
  PRIORITY_LEVELS,
  ACTIVITY_TYPES,
};