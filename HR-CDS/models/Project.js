const mongoose = require("mongoose");
const { Schema } = mongoose;

/* ENUMS - Fixed to match what you're actually using */
const TASK_STATUS = ["pending", "in progress", "completed", "cancelled", "on hold"];
const PROJECT_STATUS = ["active", "on hold", "completed", "planning", "cancelled"];
const PRIORITY_LEVELS = ["low", "medium", "high"];
const ACTIVITY_TYPES = ["assignment", "remark", "creation", "update", "status_change"];
const NOTIFICATION_TYPES = ["task_assigned", "status_changed", "remark_added", "deadline_approaching", "project_updated"];

/* =========================
      NOTIFICATION SCHEMA
========================= */
const NotificationSchema = new Schema(
  {
    title: { type: String, required: true },
    message: { type: String, required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    relatedTo: { type: String }, // 'task', 'project'
    referenceId: { type: Schema.Types.ObjectId },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    isRead: { type: Boolean, default: false },
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
    remark: { type: String }
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
  { _id: true }
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
    priority: { type: String, enum: PRIORITY_LEVELS, default: "medium" },
    status: { type: String, enum: TASK_STATUS, default: "pending" },
    pdfFile: {
      filename: String,
      path: String,
      uploadedAt: { type: Date, default: Date.now }
    },
    remarks: [RemarkSchema],
    activityLogs: [ActivityLogSchema],
    createdBy: { type: Schema.Types.ObjectId, ref: "User" }
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
    status: { type: String, enum: PROJECT_STATUS, default: "active" },
    startDate: { type: Date },
    endDate: { type: Date },
    priority: { type: String, enum: PRIORITY_LEVELS, default: "medium" },
    pdfFile: {
      filename: String,
      path: String,
      uploadedAt: { type: Date, default: Date.now }
    },
    tasks: [TaskSchema],
    notifications: [NotificationSchema],
    createdBy: { type: Schema.Types.ObjectId, ref: "User" }
  },
  { timestamps: true }
);

ProjectSchema.index({ projectName: "text" });
ProjectSchema.index({ status: 1 });
ProjectSchema.index({ priority: 1 });
ProjectSchema.index({ createdBy: 1 });

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
    });
  }
  
  next();
});

// Middleware for update operations
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
  
  if (update.$push && update.$push.tasks) {
    const task = update.$push.tasks.$each ? update.$push.tasks.$each[0] : update.$push.tasks;
    if (task.status) {
      task.status = task.status.toLowerCase();
    }
    if (task.priority) {
      task.priority = task.priority.toLowerCase();
    }
  }
  
  next();
});

// Virtual for formatted dates
ProjectSchema.virtual('formattedStartDate').get(function() {
  return this.startDate ? this.startDate.toISOString().split('T')[0] : null;
});

ProjectSchema.virtual('formattedEndDate').get(function() {
  return this.endDate ? this.endDate.toISOString().split('T')[0] : null;
});

// Method to add notification
ProjectSchema.methods.addNotification = function(notification) {
  this.notifications.push(notification);
  return this.save();
};

// Method to add task activity log
TaskSchema.methods.addActivityLog = function(activity) {
  this.activityLogs.push(activity);
  return this.save();
};

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
  NOTIFICATION_TYPES,
};