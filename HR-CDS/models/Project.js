const mongoose = require("mongoose");
const { Schema } = mongoose;

/* ENUMS */
const TASK_STATUS = ["Pending", "In Progress", "Completed", "Rejected"];
const PROJECT_STATUS = ["Active", "OnHold", "Completed"];
const PRIORITY_LEVELS = ["Low", "Medium", "High"];

/* TASK SCHEMA */
const TaskSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    assignedTo: { type: Schema.Types.ObjectId, ref: "User", required: true },
    dueDate: { type: Date },
    priority: { type: String, enum: PRIORITY_LEVELS, default: "Medium" },
    remarks: { type: String, trim: true },
    status: { type: String, enum: TASK_STATUS, default: "Pending" },
    pdfFile: {
      filename: String,
      path: String,
    },
  },
  { timestamps: true }
);

/* PROJECT SCHEMA */
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

module.exports = mongoose.model("Project", ProjectSchema);
module.exports.TASK_STATUS = TASK_STATUS;
module.exports.PROJECT_STATUS = PROJECT_STATUS;
module.exports.PRIORITY_LEVELS = PRIORITY_LEVELS;
