const mongoose = require("mongoose");

 
const SYSTEM_USER_ID = new mongoose.Types.ObjectId("000000000000000000000001");
const OVERDUE_LOCKED_STATUSES = new Set(['onhold', 'on hold', 'completed', 'approved', 'rejected', 'cancelled', 'overdue']);
const ON_HOLD_OVERDUE_GRACE_MS = 24 * 60 * 60 * 1000;
const normalizeTaskStatus = status => String(status || 'pending').trim().toLowerCase();
const canMoveToOverdue = status => !OVERDUE_LOCKED_STATUSES.has(normalizeTaskStatus(status));

const getOverdueEligibilityDate = (task) => {
  if (!task?.dueDateTime) return null;
  const dueDate = new Date(task.dueDateTime);
  if (Number.isNaN(dueDate.getTime())) return null;

  if (task.taskFor === 'self' && task.onHoldReleasedAt) {
    const releasedAt = new Date(task.onHoldReleasedAt);
    if (!Number.isNaN(releasedAt.getTime()) && dueDate <= releasedAt) {
      return new Date(releasedAt.getTime() + ON_HOLD_OVERDUE_GRACE_MS);
    }
  }

  return dueDate;
};

 
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
    pendingDueReminderSentAt: Date,
    pendingDueReminderDueAt: Date,
  },
  { _id: false }
);

 
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

const checkpointSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    completed: { type: Boolean, default: false },
    completedAt: { type: Date, default: null },
    completedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    createdAt: { type: Date, default: Date.now },
  }
);

 
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
    

    
    companyCode: {
      type: String,
      required: true,
      index: true,
      default: ''
    },

    branch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      index: true,
      default: null
    },

    assignedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    assignedGroups: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "Group"
    }],

    statusByUser: [statusSchema],
    statusHistory: [statusHistorySchema],
    checkpoints: [checkpointSchema],
    remarks: [remarkSchema],
    snoozedUntil: {type: Date, default: null},
    isSnoozed: {
      type: Boolean,
      default: false
    }
,
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

    creatorStatus: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({
        status: "pending",
        updatedAt: new Date()
      })
    },

    taskFor: {
      type: String,
      
      default: "self"
    },

    isRecurring: { type: Boolean, default: false },
    recurringPattern: String,
    nextRecurringDate: Date,

    markedOverdueAt: Date,
    overdueReason: String,
    overdueNotified: { type: Boolean, default: false },
    onHoldReleasedAt: { type: Date, default: null },
    completionDate: Date,

    lastActivityAt: { type: Date, default: Date.now },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

 
taskSchema.index({ assignedUsers: 1, dueDateTime: 1 });
taskSchema.index({ overallStatus: 1, dueDateTime: 1 });
taskSchema.index({ createdBy: 1, createdAt: -1 });
taskSchema.index({ 'statusByUser.user': 1, 'statusByUser.status': 1 });

 
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


taskSchema.methods.checkAndMarkOverdue = function () {
  if (!this.dueDateTime) return false;
  if (!canMoveToOverdue(this.overallStatus)) return false;
  
  const now = new Date();
  const dueDate = getOverdueEligibilityDate(this);
  
  if (!dueDate || dueDate >= now) return false;
  
  let anyUserMarked = false;
  
  
  this.assignedUsers.forEach((userId) => {
    const userStatusIndex = this.statusByUser.findIndex(
      (s) => s.user && s.user.toString() === userId.toString()
    );
    
    if (userStatusIndex !== -1) {
      const currentStatus = this.statusByUser[userStatusIndex].status;
      
      if (canMoveToOverdue(currentStatus)) {
        this.statusByUser[userStatusIndex].status = 'overdue';
        this.statusByUser[userStatusIndex].updatedAt = now;
        this.statusByUser[userStatusIndex].remarks = 'Automatically marked as overdue';
        anyUserMarked = true;
      }
    } else {
      if (canMoveToOverdue(this.overallStatus)) {
        this.statusByUser.push({
          user: userId,
          status: 'overdue',
          updatedAt: now,
          remarks: 'Automatically marked as overdue'
        });
        anyUserMarked = true;
      }
    }
  });
  
  const allUsersOverdue = this.assignedUsers.length > 0 && this.assignedUsers.every((assignedUserId) => {
    const userStatus = this.statusByUser.find(
      s => s.user && s.user.toString() === assignedUserId.toString()
    );
    return userStatus && userStatus.status === 'overdue';
  });

  if (anyUserMarked) {
    const oldStatus = this.overallStatus;
    if (allUsersOverdue) {
      this.overallStatus = 'overdue';
      this.markedOverdueAt = now;
      this.overdueReason = 'Automatic overdue detection';
    }
    
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


taskSchema.methods.markUserStatusOverdue = function (userId, remarks = '') {
  if (!canMoveToOverdue(this.overallStatus)) return false;

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
    if (!canMoveToOverdue(oldStatus)) return false;
    
    this.statusByUser[userStatusIndex].status = 'overdue';
    this.statusByUser[userStatusIndex].updatedAt = new Date();
    this.statusByUser[userStatusIndex].remarks = remarks || `Changed from ${oldStatus} to overdue`;
  }
  
  
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

 


taskSchema.statics.getUserOverdueTasks = async function (userId) {
  const now = new Date();
  const lockedStatuses = Array.from(OVERDUE_LOCKED_STATUSES);
  
  return await this.find({
    assignedUsers: userId,
    dueDateTime: { $lt: now },
    isActive: true,
    overallStatus: { $nin: lockedStatuses },
    $or: [
      { 
        'statusByUser': {
          $elemMatch: {
            user: userId,
            status: { $nin: lockedStatuses }
          }
        }
      },
      { 
        'statusByUser.user': { $ne: userId },
        'overallStatus': { $nin: lockedStatuses }
      }
    ]
  })
  .populate('assignedUsers', 'name email')
  .populate('createdBy', 'name email')
  .sort({ dueDateTime: 1 });
};


taskSchema.statics.updateAllOverdueTasks = async function () {
  const now = new Date();
  const lockedStatuses = Array.from(OVERDUE_LOCKED_STATUSES);
  const overdueTasks = await this.find({
    dueDateTime: { $lt: now },
    isActive: true,
    overallStatus: { $nin: lockedStatuses },
    $or: [
      { overallStatus: { $nin: lockedStatuses } },
      { 
        'statusByUser.status': { $nin: lockedStatuses }
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

 
taskSchema.pre("save", function (next) {
  
  if (this.dueDateTime) {
    const now = new Date();
    const dueDate = getOverdueEligibilityDate(this);
    
    if (dueDate && dueDate < now) {
      this.checkAndMarkOverdue();
    } else if (this.taskFor !== 'self') {
      
      if (this.overallStatus === 'overdue') {
        let hasInProgress = false;
        let hasPending = false;
        let hasCompleted = false;

        this.statusByUser.forEach(s => {
          if (s.status === 'overdue') {
            s.status = 'pending';
            s.updatedAt = now;
            s.remarks = 'Reset from overdue because due date was extended';
          }
          if (['in-progress', 'reopen', 'onhold'].includes(s.status)) hasInProgress = true;
          if (s.status === 'pending') hasPending = true;
          if (['completed', 'approved'].includes(s.status)) hasCompleted = true;
        });

        if (hasInProgress) {
          this.overallStatus = 'in-progress';
        } else if (hasPending) {
          this.overallStatus = 'pending';
        } else if (hasCompleted) {
          this.overallStatus = 'completed';
        } else {
          this.overallStatus = 'pending';
        }

        this.overdueReason = undefined;
        this.markedOverdueAt = undefined;
      }
    }
  }
  
  
  this.lastActivityAt = new Date();
  
  next();
});

 
taskSchema.post("save", function (doc) {
  
  if (process.env.NODE_ENV === 'development') {
    void 0;
  }
});

 
module.exports = mongoose.model("Task", taskSchema);
