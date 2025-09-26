const mongoose = require('mongoose');

// Sub-schema for status tracking by user
const statusSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  status: {
    type: String,
    enum: ['pending', 'in-progress', 'completed', 'rejected'],
    default: 'pending'
  }
}, { _id: false });

// Main task schema
const taskSchema = new mongoose.Schema({
  serialNo: {
    type: Number,
    required: false, // Ensure it's not required
    default: null     // Prevent null duplicate key error
  },
  title: { type: String, required: true },
  description: { type: String },
  dueDate: { type: Date },
  whatsappNumber: { type: String },
  priorityDays: { type: Number, default: 1 },
  assignedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  statusByUser: [statusSchema],
  files: [String],      // file URLs or paths
  voiceNote: { type: String },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

// Ensure no leftover unique index from before
taskSchema.index({ serialNo: 1 }, { unique: false });

module.exports = mongoose.model('Task', taskSchema);
