const mongoose = require("mongoose");

// Sub-schema for status history
const statusHistorySchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: [
        "pending",
        "in-progress",
        "completed",
        "approved",
        "rejected",
        "onhold",
        "reopen",
        "cancelled",
      ],
      required: true,
    },
    changedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    changedAt: {
      type: Date,
      default: Date.now,
    },
    remarks: String,
  },
  { _id: false }
);

// Sub-schema for remarks/comments
const remarkSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    text: {
      type: String,
      required: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    image: {String},
  },
  { _id: false }
);

// Sub-schema for status tracking by user
const statusSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    status: {
      type: String,
      enum: [
        "pending",
        "in-progress",
        "completed",
        "approved",
        "rejected",
        "onhold",
        "reopen",
        "cancelled",
      ],
      default: "pending",
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
    remarks: String,
  },
  { _id: false }
);

// Sub-schema for file attachments
const fileSchema = new mongoose.Schema(
  {
    filename: String,
    originalName: String,
    path: String,
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    uploadedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

// Sub-schema for voice note
const voiceNoteSchema = new mongoose.Schema(
  {
    filename: String,
    originalName: String,
    path: String,
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    uploadedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

// Main task schema
const taskSchema = new mongoose.Schema(
  {
    serialNo: {
      type: Number,
      required: false,
      default: null,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    dueDateTime: {
      type: Date,
      required: false,
    },
    whatsappNumber: {
      type: String,
      trim: true,
    },
    priorityDays: {
      type: String,
      enum: ["1", "2", "3", "4", "5", "6", "7"],
      default: "1",
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "medium",
    },
    assignedUsers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    assignedGroups: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Group",
      },
    ],
    statusByUser: [statusSchema],

    // New fields for notifications and activity tracking
    statusHistory: [statusHistorySchema],
    remarks: [remarkSchema],

    files: [fileSchema],
    voiceNote: voiceNoteSchema,
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },



    // Task status and tracking
    overallStatus: {
      type: String,
      enum: [
        "pending",
        "in-progress",
        "completed",
        "approved",
        "rejected",
        "onhold",
        "reopen",
        "cancelled",
      ],
      default: "pending",
    },
    completionDate: Date,

    // Activity tracking
    lastActivityAt: {
      type: Date,
      default: Date.now,
    },

    // Soft delete functionality
    isActive: {
      type: Boolean,
      default: true,
    },

    // Additional metadata
    tags: [
      {
        type: String,
        trim: true,
      },
    ],
    category: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes for better performance
taskSchema.index({ serialNo: 1 });
taskSchema.index({ dueDateTime: 1 });
taskSchema.index({ assignedUsers: 1 });
taskSchema.index({ createdBy: 1 });
taskSchema.index({ isRecurring: 1, nextOccurrence: 1 });
taskSchema.index({ parentTask: 1 });
taskSchema.index({ "statusByUser.user": 1, "statusByUser.status": 1 });
taskSchema.index({ overallStatus: 1 });
taskSchema.index({ isActive: 1 });
taskSchema.index({ lastActivityAt: -1 });
taskSchema.index({ "remarks.createdAt": -1 });
taskSchema.index({ "statusHistory.changedAt": -1 });

// Virtual for getting all users (direct + group members)
taskSchema.virtual("allAssignedUsers").get(function () {
  const directUsers = this.assignedUsers || [];
  const groupUsers = this.assignedGroups
    ? this.assignedGroups.reduce((users, group) => {
        return users.concat(group.members || []);
      }, [])
    : [];

  return [...new Set([...directUsers, ...groupUsers])];
});

// Virtual for checking if task is overdue
taskSchema.virtual("isOverdue").get(function () {
  if (!this.dueDateTime) return false;
  return (
    this.dueDateTime < new Date() &&
    !["completed", "approved", "cancelled"].includes(this.overallStatus)
  );
});

// Virtual for days until due
taskSchema.virtual("daysUntilDue").get(function () {
  if (!this.dueDateTime) return null;
  const today = new Date();
  const dueDate = new Date(this.dueDateTime);
  const diffTime = dueDate - today;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
});

// Virtual for task urgency
taskSchema.virtual("urgencyLevel").get(function () {
  if (this.isOverdue) return "overdue";

  const daysUntilDue = this.daysUntilDue;
  if (daysUntilDue === null) return "no-due-date";

  if (daysUntilDue <= 1) return "high";
  if (daysUntilDue <= 3) return "medium";
  return "low";
});

// Method to update user status with history tracking
taskSchema.methods.updateUserStatus = function (userId, status, remarks = "") {
  const existingStatus = this.statusByUser.find(
    (s) => s.user.toString() === userId.toString()
  );
  const oldStatus = existingStatus ? existingStatus.status : "pending";

  if (existingStatus) {
    existingStatus.status = status;
    existingStatus.updatedAt = new Date();
    if (remarks) {
      existingStatus.remarks = remarks;
    }
  } else {
    this.statusByUser.push({
      user: userId,
      status: status,
      updatedAt: new Date(),
      remarks: remarks,
    });
  }

  // Add to status history
  this.statusHistory.push({
    status: status,
    changedBy: userId,
    changedAt: new Date(),
    remarks: remarks || `Status changed from ${oldStatus} to ${status}`,
  });

  // Update last activity
  this.lastActivityAt = new Date();

  // Update overall status based on individual statuses
  this.updateOverallStatus();
};

// Method to update overall status
taskSchema.methods.updateOverallStatus = function () {
  if (this.statusByUser.length === 0) {
    this.overallStatus = "pending";
    return;
  }

  const allCompleted = this.statusByUser.every((s) => s.status === "completed");
  const allApproved = this.statusByUser.every((s) => s.status === "approved");

  const anyRejected = this.statusByUser.some((s) => s.status === "rejected");
  const anyInProgress = this.statusByUser.some(
    (s) => s.status === "in-progress"
  );
  const anyOnHold = this.statusByUser.some((s) => s.status === "onhold");
  const anyReopen = this.statusByUser.some((s) => s.status === "reopen");
  const anyCancelled = this.statusByUser.some((s) => s.status === "cancelled");

  if (allApproved) {
    this.overallStatus = "approved";
    this.completionDate = new Date();
  } else if (allCompleted) {
    this.overallStatus = "completed";
    this.completionDate = new Date();
  } else if (anyCancelled) {
    this.overallStatus = "cancelled";
  } else if (anyRejected) {
    this.overallStatus = "rejected";
  } else if (anyOnHold) {
    this.overallStatus = "onhold";
  } else if (anyReopen) {
    this.overallStatus = "reopen";
  } else if (anyInProgress) {
    this.overallStatus = "in-progress";
  } else {
    this.overallStatus = "pending";
  }
};

// Method to add remark
taskSchema.methods.addRemark = function (userId, text) {
  this.remarks.push({
    user: userId,
    text: text,
    createdAt: new Date(),
  });

  // Update last activity
  this.lastActivityAt = new Date();
};

// Method to get recent activity
taskSchema.methods.getRecentActivity = function (limit = 10) {
  const activities = [];

  // Add status changes
  this.statusHistory.slice(-limit).forEach((history) => {
    activities.push({
      type: "status_change",
      user: history.changedBy,
      description: `Status changed to ${history.status}`,
      remarks: history.remarks,
      timestamp: history.changedAt,
    });
  });

  // Add remarks
  this.remarks.slice(-limit).forEach((remark) => {
    activities.push({
      type: "remark",
      user: remark.user,
      description: "Added a remark",
      text: remark.text,
      timestamp: remark.createdAt,
    });
  });

  // Sort by timestamp and return limited results
  return activities.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
};

// Static method to get next serial number
taskSchema.statics.getNextSerialNo = async function () {
  const lastTask = await this.findOne().sort({ serialNo: -1 });
  return lastTask ? lastTask.serialNo + 1 : 1;
};

// Static method to find active tasks
taskSchema.statics.findActive = function () {
  return this.find({ isActive: true });
};

// Static method to find tasks by user with population
taskSchema.statics.findByUser = function (userId, options = {}) {
  const query = {
    isActive: true,
    $or: [{ assignedUsers: userId }, { createdBy: userId }],
  };

  if (options.status) {
    query.overallStatus = options.status;
  }

  return this.find(query)
    .populate("assignedUsers", "name email role")
    .populate("createdBy", "name email role")
    .populate("assignedGroups", "name description")
    .sort(options.sort || { createdAt: -1 });
};

// Pre-save middleware to set serial number and handle recurrence
taskSchema.pre("save", async function (next) {
  // Set serial number if not set
  if (this.isNew && !this.serialNo) {
    this.serialNo = await this.constructor.getNextSerialNo();
  }

  // Set isRecurring based on repeatPattern
  if (this.repeatPattern && this.repeatPattern !== "none") {
    this.isRecurring = true;
  } else {
    this.isRecurring = false;
  }

  // Calculate next occurrence for recurring tasks
  if (this.isRecurring && this.dueDateTime) {
    this.nextOccurrence = this.calculateNextOccurrence();
  }

  next();
});

// Method to calculate next occurrence - IMPROVED VERSION
taskSchema.methods.calculateNextOccurrence = function () {
  if (!this.dueDateTime || !this.isRecurring || this.repeatPattern === "none") {
    return null;
  }

  let nextDate = new Date(this.dueDateTime);

  switch (this.repeatPattern) {
    case "daily":
      nextDate.setDate(nextDate.getDate() + 1);
      break;

    case "weekly":
      if (this.repeatDays && this.repeatDays.length > 0) {
        const currentDay = nextDate.getDay();
        const dayNames = [
          "sunday",
          "monday",
          "tuesday",
          "wednesday",
          "thursday",
          "friday",
          "saturday",
        ];
        const currentDayName = dayNames[currentDay];

        let nextDayIndex = 0;
        let found = false;

        // Look for the next day in the same week
        for (let i = currentDay + 1; i < 7; i++) {
          if (this.repeatDays.includes(dayNames[i])) {
            nextDayIndex = i;
            found = true;
            break;
          }
        }

        // If not found in same week, take first day of next week
        if (!found && this.repeatDays.length > 0) {
          nextDayIndex = dayNames.indexOf(this.repeatDays[0]);
        }

        let daysToAdd = nextDayIndex - currentDay;
        if (daysToAdd <= 0) {
          daysToAdd += 7;
        }

        nextDate.setDate(nextDate.getDate() + daysToAdd);
      } else {
        nextDate.setDate(nextDate.getDate() + 7);
      }
      break;

    case "monthly":
      nextDate.setMonth(nextDate.getMonth() + 1);
      break;

    default:
      return null;
  }

  return nextDate;
};

// Method to generate next recurring task
taskSchema.methods.generateNextRecurringTask = async function () {
  if (!this.isRecurring || !this.nextOccurrence) return null;

  const nextOccurrence = this.calculateNextOccurrence();

  const newTaskData = {
    title: this.title,
    description: this.description,
    dueDateTime: this.nextOccurrence,
    assignedUsers: this.assignedUsers,
    assignedGroups: this.assignedGroups,
    createdBy: this.createdBy,
    priority: this.priority,
    priorityDays: this.priorityDays,
    whatsappNumber: this.whatsappNumber,
    repeatPattern: this.repeatPattern,
    repeatDays: this.repeatDays,
    isRecurring: true,
    taskFor: {  
      type: String,
      enum: ['self', 'others'],
      default: 'self',
      required: true
    },
    parentTask: this._id,
    files: this.files.map((file) => ({ ...file.toObject() })),
    voiceNote: this.voiceNote ? { ...this.voiceNote.toObject() } : null,
    statusHistory: [
      {
        status: "pending",
        changedBy: this.createdBy,
        remarks: "Recurring task generated automatically",
      },
    ],
  };

  const newTask = new this.constructor(newTaskData);
  await newTask.save();

  // Update current task's next occurrence
  this.nextOccurrence = nextOccurrence;
  this.recurrenceCount = (this.recurrenceCount || 0) + 1;
  await this.save();

  return newTask;
};

// Method to soft delete task
taskSchema.methods.softDelete = function () {
  this.isActive = false;
  return this.save();
};

// Method to restore soft deleted task
taskSchema.methods.restore = function () {
  this.isActive = true;
  return this.save();
};

module.exports = mongoose.model("Task", taskSchema);
