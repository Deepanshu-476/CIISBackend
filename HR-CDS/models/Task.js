const mongoose = require("mongoose");

/* ===============================
   CONSTANTS
================================= */

// 🔥 SYSTEM USER (for auto actions)
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
    text: { type: String, required: true },
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

    assignedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    statusByUser: [statusSchema],

    statusHistory: [statusHistorySchema],
    remarks: [remarkSchema],

    files: [fileSchema],

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

    markedOverdueAt: Date,
    overdueReason: String,
    overdueNotified: { type: Boolean, default: false },

    lastActivityAt: { type: Date, default: Date.now },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

/* ===============================
   METHODS
================================= */

// ✅ USER STATUS UPDATE
taskSchema.methods.updateUserStatus = function (userId, status, remarks = "") {
  this.statusByUser.push({
    user: userId,
    status,
    updatedAt: new Date(),
    remarks,
  });

  this.statusHistory.push({
    status,
    changedBy: userId,
    changedByType: "user",
    remarks,
  });

  this.overallStatus = status;
  this.lastActivityAt = new Date();
};

// ✅ AUTO OVERDUE (SYSTEM SAFE)
taskSchema.methods.checkAndMarkOverdue = function () {
  if (!this.dueDateTime || this.overallStatus === "overdue") return false;

  if (this.dueDateTime < new Date()) {
    this.overallStatus = "overdue";
    this.markedOverdueAt = new Date();
    this.overdueReason = "Automatic overdue";

    this.statusHistory.push({
      status: "overdue",
      changedBy: SYSTEM_USER_ID,
      changedByType: "system",
      remarks: "Task automatically marked overdue",
    });

    this.lastActivityAt = new Date();
    return true;
  }

  return false;
};

/* ===============================
   PRE SAVE HOOK
================================= */
taskSchema.pre("save", function (next) {
  this.checkAndMarkOverdue();
  next();
});

/* ===============================
   EXPORT
================================= */
module.exports = mongoose.model("Task", taskSchema);
