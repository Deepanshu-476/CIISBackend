const mongoose = require("mongoose");

/* ===============================
   CONSTANTS
================================= */
const SYSTEM_USER_ID = new mongoose.Types.ObjectId("000000000000000000000001");

/* ===============================
   STATUS HISTORY SCHEMA
================================= */
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
        "overdue",
      ],
      required: true,
    },
    changedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    changedByType: {
      type: String,
      enum: ["user", "system"],
      default: "user",
    },
    changedAt: {
      type: Date,
      default: Date.now,
    },
    remarks: String,
  },
  { _id: false }
);

/* ===============================
   REMARK SCHEMA
================================= */
const remarkSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    text: { type: String },
    createdAt: { type: Date, default: Date.now },
    image: String,
  },
  { _id: false }
);

/* ===============================
   STATUS BY USER SCHEMA
================================= */
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
        "overdue",
      ],
      default: "pending",
    },
    updatedAt: { type: Date, default: Date.now },
    remarks: String,
  },
  { _id: false }
);

/* ===============================
   FILE SCHEMA
================================= */
const fileSchema = new mongoose.Schema(
  {
    filename: String,
    originalName: String,
    path: String,
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

/* ===============================
   TASK SCHEMA
================================= */
const taskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: String,
    dueDateTime: Date,
    whatsappNumber: String,
    priorityDays: String,
    priority: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "medium",
    },
    
    assignedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    assignedGroups: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "Group"
    }],

    statusByUser: [statusSchema],
    statusHistory: [statusHistorySchema],
    remarks: [remarkSchema],

    files: [fileSchema],
    voiceNote: {
      filename: String,
      originalName: String,
      path: String,
      uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

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
        "overdue",
      ],
      default: "pending",
    },

    taskFor: {
      type: String,
      enum: ["self", "others"],
      default: "self"
    },

    isRecurring: { type: Boolean, default: false },
    recurringPattern: String,
    nextRecurringDate: Date,

    markedOverdueAt: Date,
    overdueReason: String,
    overdueNotified: { type: Boolean, default: false },
    completionDate: Date,

    lastActivityAt: { type: Date, default: Date.now },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

/* ===============================
   INDEXES
================================= */
taskSchema.index({ assignedUsers: 1, dueDateTime: 1 });
taskSchema.index({ overallStatus: 1, dueDateTime: 1 });
taskSchema.index({ createdBy: 1, createdAt: -1 });
taskSchema.index({ 'statusByUser.user': 1, 'statusByUser.status': 1 });

/* ===============================
   VIRTUAL FIELDS
================================= */
taskSchema.virtual('isPastDue').get(function() {
  if (!this.dueDateTime) return false;
  return new Date(this.dueDateTime) < new Date();
});

taskSchema.virtual('daysOverdue').get(function() {
  if (!this.dueDateTime || !this.markedOverdueAt) return 0;
  const overdueDate = this.markedOverdueAt || new Date();
  const dueDate = new Date(this.dueDateTime);
  const diffTime = Math.abs(overdueDate - dueDate);
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
});

/* ===============================
   METHODS
================================= */

// ✅ UPDATE USER STATUS
taskSchema.methods.updateUserStatus = function (userId, status, remarks = "") {
  const userStatusIndex = this.statusByUser.findIndex(
    (s) => s.user && s.user.toString() === userId.toString()
  );

  const oldStatus = userStatusIndex !== -1 
    ? this.statusByUser[userStatusIndex].status 
    : "pending";

  if (userStatusIndex === -1) {
    this.statusByUser.push({
      user: userId,
      status,
      updatedAt: new Date(),
      remarks,
    });
  } else {
    this.statusByUser[userStatusIndex].status = status;
    this.statusByUser[userStatusIndex].updatedAt = new Date();
    if (remarks) {
      this.statusByUser[userStatusIndex].remarks = remarks;
    }
  }

  this.statusHistory.push({
    status,
    changedBy: userId,
    changedByType: "user",
    remarks: remarks || `Status changed from ${oldStatus} to ${status}`,
  });

  this.lastActivityAt = new Date();
};

// ✅ CHECK AND MARK OVERDUE
taskSchema.methods.checkAndMarkOverdue = function () {
  if (!this.dueDateTime) return false;
  
  const now = new Date();
  const dueDate = new Date(this.dueDateTime);
  
  if (dueDate >= now) return false;
  
  let anyUserMarked = false;
  
  // Check each assigned user
  this.assignedUsers.forEach((userId) => {
    const userStatusIndex = this.statusByUser.findIndex(
      (s) => s.user && s.user.toString() === userId.toString()
    );
    
    if (userStatusIndex !== -1) {
      const currentStatus = this.statusByUser[userStatusIndex].status;
      
      if (['pending', 'in-progress', 'reopen', 'onhold'].includes(currentStatus)) {
        this.statusByUser[userStatusIndex].status = 'overdue';
        this.statusByUser[userStatusIndex].updatedAt = now;
        this.statusByUser[userStatusIndex].remarks = 'Automatically marked as overdue';
        anyUserMarked = true;
      }
    } else {
      // User doesn't have status entry
      this.statusByUser.push({
        user: userId,
        status: 'overdue',
        updatedAt: now,
        remarks: 'Automatically marked as overdue'
      });
      anyUserMarked = true;
    }
  });
  
  if (anyUserMarked) {
    const oldStatus = this.overallStatus;
    this.overallStatus = 'overdue';
    this.markedOverdueAt = now;
    this.overdueReason = 'Automatic overdue detection';
    
    this.statusHistory.push({
      status: 'overdue',
      changedBy: SYSTEM_USER_ID,
      changedByType: "system",
      remarks: `Task automatically marked overdue from ${oldStatus}`,
      changedAt: now
    });
    
    this.lastActivityAt = now;
    return true;
  }
  
  return false;
};

// ✅ MARK USER STATUS OVERDUE
taskSchema.methods.markUserStatusOverdue = function (userId, remarks = '') {
  const userStatusIndex = this.statusByUser.findIndex(
    (s) => s.user && s.user.toString() === userId.toString()
  );
  
  if (userStatusIndex === -1) {
    this.statusByUser.push({
      user: userId,
      status: 'overdue',
      updatedAt: new Date(),
      remarks: remarks || 'Marked as overdue'
    });
  } else {
    const oldStatus = this.statusByUser[userStatusIndex].status;
    if (oldStatus === 'overdue') return false;
    
    this.statusByUser[userStatusIndex].status = 'overdue';
    this.statusByUser[userStatusIndex].updatedAt = new Date();
    this.statusByUser[userStatusIndex].remarks = remarks || `Changed from ${oldStatus} to overdue`;
  }
  
  // Update overall status if needed
  const allUsersOverdue = this.assignedUsers.every(assignedUserId => {
    const userStatus = this.statusByUser.find(
      s => s.user && s.user.toString() === assignedUserId.toString()
    );
    return userStatus && userStatus.status === 'overdue';
  });
  
  if (allUsersOverdue && this.overallStatus !== 'overdue') {
    this.overallStatus = 'overdue';
    this.markedOverdueAt = new Date();
    this.overdueReason = remarks || 'All users overdue';
  }
  
  this.statusHistory.push({
    status: 'overdue',
    changedBy: userId,
    changedByType: 'user',
    remarks: remarks || 'Manually marked as overdue',
    changedAt: new Date()
  });
  
  this.lastActivityAt = new Date();
  return true;
};

/* ===============================
   STATIC METHODS
================================= */

// ✅ GET USER OVERDUE TASKS
taskSchema.statics.getUserOverdueTasks = async function (userId) {
  const now = new Date();
  
  return await this.find({
    assignedUsers: userId,
    dueDateTime: { $lt: now },
    isActive: true,
    $or: [
      { 
        'statusByUser': {
          $elemMatch: {
            user: userId,
            status: { $in: ['pending', 'in-progress', 'reopen', 'onhold'] }
          }
        }
      },
      { 
        'statusByUser.user': { $ne: userId },
        'overallStatus': { $in: ['pending', 'in-progress', 'reopen', 'onhold'] }
      }
    ]
  })
  .populate('assignedUsers', 'name email')
  .populate('createdBy', 'name email')
  .sort({ dueDateTime: 1 });
};

// ✅ UPDATE ALL OVERDUE TASKS (FOR CRON)
taskSchema.statics.updateAllOverdueTasks = async function () {
  const now = new Date();
  const overdueTasks = await this.find({
    dueDateTime: { $lt: now },
    isActive: true,
    $or: [
      { overallStatus: { $in: ['pending', 'in-progress', 'reopen', 'onhold'] } },
      { 
        'statusByUser.status': { $in: ['pending', 'in-progress', 'reopen', 'onhold'] }
      }
    ]
  });
  
  let updated = 0;
  let alreadyOverdue = 0;
  let skipped = 0;

  for (const task of overdueTasks) {
    try {
      const wasUpdated = task.checkAndMarkOverdue();
      if (wasUpdated) {
        await task.save();
        updated++;
      } else {
        if (task.overallStatus === 'overdue') {
          alreadyOverdue++;
        } else {
          skipped++;
        }
      }
    } catch (error) {
      console.error(`Error updating task ${task._id}:`, error);
    }
  }

  return { updated, alreadyOverdue, skipped, total: overdueTasks.length };
};

// ✅ GET TASK WITH USER STATUS
taskSchema.statics.getTaskWithUserStatus = async function (taskId, userId) {
  const task = await this.findById(taskId)
    .populate('assignedUsers', 'name email')
    .populate('createdBy', 'name email')
    .populate('assignedGroups', 'name description');
  
  if (!task) return null;
  
  const userStatus = task.statusByUser.find(
    s => s.user && s.user.toString() === userId.toString()
  );
  
  return {
    ...task.toObject(),
    userStatus: userStatus ? userStatus.status : 'pending',
    isOverdue: task.checkAndMarkOverdue()
  };
};

/* ===============================
   PRE SAVE HOOKS
================================= */
taskSchema.pre("save", function (next) {
  // Auto-mark overdue if due date passed
  if (this.dueDateTime && new Date(this.dueDateTime) < new Date()) {
    this.checkAndMarkOverdue();
  }
  
  // Update last activity
  this.lastActivityAt = new Date();
  
  next();
});

/* ===============================
   POST SAVE HOOKS
================================= */
taskSchema.post("save", function (doc) {
  // Emit event for real-time updates if needed
  if (process.env.NODE_ENV === 'development') {
    console.log(`Task ${doc._id} saved with status: ${doc.overallStatus}`);
  }
});

/* ===============================
   EXPORT
================================= */
module.exports = mongoose.model("Task", taskSchema);