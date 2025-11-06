const mongoose = require("mongoose");
const { Schema } = mongoose;

const TASK_STATUS = ["Pending", "Active", "Done"];
const PROJECT_STATUS = ["Active", "OnHold", "Completed"];

const TaskSchema = new Schema(
  {
    taskName: { type: String, required: true, trim: true },
    assignedTo: { type: Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, enum: TASK_STATUS, default: "Pending" },
  },
  { _id: true, timestamps: true }
);

const ProjectSchema = new Schema(
  {
    projectName: { type: String, required: true, index: true, trim: true },
    users: [{ type: Schema.Types.ObjectId, ref: "User" }],
    status: { type: String, enum: PROJECT_STATUS, default: "Active", index: true },
    startDate: { type: Date },
    endDate: { type: Date },
    tasks: { type: [TaskSchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

// Text search on projectName
ProjectSchema.index({ projectName: "text" });

module.exports = mongoose.model("Project", ProjectSchema);
module.exports.TASK_STATUS = TASK_STATUS;
module.exports.PROJECT_STATUS = PROJECT_STATUS;
