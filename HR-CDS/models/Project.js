const mongoose = require("mongoose");
const { Schema } = mongoose;

/* ENUMS */
const TASK_STATUS = ["Pending", "In Progress", "Completed", "Rejected"];
const PROJECT_STATUS = ["Active", "OnHold", "Completed"];
const PRIORITY_LEVELS = ["Low", "Medium", "High"];

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
      TASK SCHEMA
========================= */
const TaskSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },

    assignedTo: { type: Schema.Types.ObjectId, ref: "User", required: true },

    dueDate: { type: Date },

    priority: { type: String, enum: PRIORITY_LEVELS, default: "Medium" },
    status: { type: String, enum: TASK_STATUS, default: "Pending" },

    pdfFile: {
      filename: String,
      path: String,
    },

    // ⭐ FINAL remark array (CORRECT)
    remarks: {
      type: [RemarkSchema],
      default: [],
    },
  },
  { timestamps: true }
);

/* =========================
      PROJECT SCHEMA
========================= */
const ProjectSchema = new Schema(
  {
    projectName: { type: String, required: true, trim: true },
    description: { type: String, trim: true },

    users: [{ type: Schema.Types.ObjectId, ref: "User" }],

    status: { type: String, enum: PROJECT_STATUS, default: "Active" },
    startDate: { type: Date },
    endDate: { type: Date },
    priority: { type: String, enum: PRIORITY_LEVELS, default: "Medium" },

    pdfFile: {
      filename: String,
      path: String,
    },

    tasks: [TaskSchema],

    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

ProjectSchema.index({ projectName: "text" });

/* =========================
      FINAL EXPORT (NO ERRORS)
========================= */
const Project = mongoose.model("Project", ProjectSchema);

module.exports = {
  Project,
  TASK_STATUS,
  PROJECT_STATUS,
  PRIORITY_LEVELS,
};
