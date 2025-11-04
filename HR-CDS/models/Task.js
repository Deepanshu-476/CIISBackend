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
    required: false,
    default: null
  },
  title: { type: String, required: true },
  description: { type: String },
  // ✅ Store both date and time here
  dueDateTime: { type: Date, required: false },
  whatsappNumber: { type: String },
  priorityDays: { type: Number, default: 1 },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium'
  },
  assignedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  assignedGroups: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Group' }],
  statusByUser: [statusSchema],
  files: [String],
  voiceNote: { type: String },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

// Ensure no leftover unique index from before
taskSchema.index({ serialNo: 1 }, { unique: false });

// Virtual for getting all users (direct + group members)
taskSchema.virtual('allAssignedUsers').get(function() {
  const directUsers = this.assignedUsers || [];
  const groupUsers = this.assignedGroups ? 
    this.assignedGroups.reduce((users, group) => {
      return users.concat(group.members || []);
    }, []) : [];
  
  return [...new Set([...directUsers, ...groupUsers])];
});

module.exports = mongoose.model('Task', taskSchema);
