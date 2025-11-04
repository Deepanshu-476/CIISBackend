const mongoose = require('mongoose');

// Sub-schema for status tracking by user
const statusSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  status: {
    type: String,
    enum: ['pending', 'in-progress', 'completed', 'rejected'],
    default: 'pending'
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

// Sub-schema for file attachments
const fileSchema = new mongoose.Schema({
  filename: String,
  originalName: String,
  path: String,
  uploadDate: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

// Sub-schema for voice note
const voiceNoteSchema = new mongoose.Schema({
  filename: String,
  originalName: String,
  path: String,
  uploadDate: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

// Main task schema
const taskSchema = new mongoose.Schema({
  serialNo: {
    type: Number,
    required: false,
    default: null
  },
  title: { 
    type: String, 
    required: true,
    trim: true
  },
  description: { 
    type: String,
    trim: true
  },
  dueDateTime: { 
    type: Date, 
    required: false 
  },
  whatsappNumber: { 
    type: String,
    trim: true
  },
  priorityDays: { 
    type: Number, 
    default: 1 
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium'
  },
  assignedUsers: [{ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' 
  }],
  assignedGroups: [{ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Group' 
  }],
  statusByUser: [statusSchema],
  files: [fileSchema],
  voiceNote: voiceNoteSchema,
  createdBy: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User',
    required: true
  },
  
  // Repeat functionality fields
  repeatPattern: {
    type: String,
    enum: ['none', 'daily', 'weekly', 'monthly'],
    default: 'none'
  },
  repeatDays: [{
    type: String,
    enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
  }],
  parentTask: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Task'
  },
  isRecurring: {
    type: Boolean,
    default: false
  },
  nextOccurrence: Date,
  recurrenceEndDate: Date,
  recurrenceCount: {
    type: Number,
    default: 0
  },
  
  // Task status and tracking
  overallStatus: {
    type: String,
    enum: ['pending', 'in-progress', 'completed', 'cancelled'],
    default: 'pending'
  },
  completionDate: Date,
  notes: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    note: String,
    createdAt: { type: Date, default: Date.now }
  }]
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for better performance
taskSchema.index({ serialNo: 1 });
taskSchema.index({ dueDateTime: 1 });
taskSchema.index({ assignedUsers: 1 });
taskSchema.index({ createdBy: 1 });
taskSchema.index({ isRecurring: 1, nextOccurrence: 1 });
taskSchema.index({ parentTask: 1 });
taskSchema.index({ 'statusByUser.user': 1, 'statusByUser.status': 1 });
taskSchema.index({ overallStatus: 1 });

// Virtual for getting all users (direct + group members)
taskSchema.virtual('allAssignedUsers').get(function() {
  const directUsers = this.assignedUsers || [];
  const groupUsers = this.assignedGroups ? 
    this.assignedGroups.reduce((users, group) => {
      return users.concat(group.members || []);
    }, []) : [];
  
  return [...new Set([...directUsers, ...groupUsers])];
});

// Virtual for checking if task is overdue
taskSchema.virtual('isOverdue').get(function() {
  if (!this.dueDateTime) return false;
  return this.dueDateTime < new Date() && this.overallStatus !== 'completed';
});

// Virtual for days until due
taskSchema.virtual('daysUntilDue').get(function() {
  if (!this.dueDateTime) return null;
  const today = new Date();
  const dueDate = new Date(this.dueDateTime);
  const diffTime = dueDate - today;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
});

// Method to update user status
taskSchema.methods.updateUserStatus = function(userId, status) {
  const existingStatus = this.statusByUser.find(s => s.user.toString() === userId.toString());
  
  if (existingStatus) {
    existingStatus.status = status;
    existingStatus.updatedAt = new Date();
  } else {
    this.statusByUser.push({
      user: userId,
      status: status,
      updatedAt: new Date()
    });
  }
  
  // Update overall status based on individual statuses
  this.updateOverallStatus();
};

// Method to update overall status
taskSchema.methods.updateOverallStatus = function() {
  if (this.statusByUser.length === 0) {
    this.overallStatus = 'pending';
    return;
  }

  const allCompleted = this.statusByUser.every(s => s.status === 'completed');
  const anyInProgress = this.statusByUser.some(s => s.status === 'in-progress');
  const anyRejected = this.statusByUser.some(s => s.status === 'rejected');

  if (allCompleted) {
    this.overallStatus = 'completed';
    this.completionDate = new Date();
  } else if (anyRejected) {
    this.overallStatus = 'cancelled';
  } else if (anyInProgress) {
    this.overallStatus = 'in-progress';
  } else {
    this.overallStatus = 'pending';
  }
};

// Static method to get next serial number
taskSchema.statics.getNextSerialNo = async function() {
  const lastTask = await this.findOne().sort({ serialNo: -1 });
  return lastTask ? lastTask.serialNo + 1 : 1;
};

// Pre-save middleware to set serial number and handle recurrence
taskSchema.pre('save', async function(next) {
  // Set serial number if not set
  if (this.isNew && !this.serialNo) {
    this.serialNo = await this.constructor.getNextSerialNo();
  }

  // Set isRecurring based on repeatPattern
  if (this.repeatPattern && this.repeatPattern !== 'none') {
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

// Method to calculate next occurrence
taskSchema.methods.calculateNextOccurrence = function() {
  if (!this.dueDateTime || !this.isRecurring) return null;

  let nextDate = new Date(this.dueDateTime);
  
  switch (this.repeatPattern) {
    case 'daily':
      nextDate.setDate(nextDate.getDate() + 1);
      break;
    
    case 'weekly':
      if (this.repeatDays && this.repeatDays.length > 0) {
        const currentDay = nextDate.getDay();
        const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const currentDayName = dayNames[currentDay];
        
        // Find the next scheduled day
        const currentIndex = this.repeatDays.indexOf(currentDayName);
        let nextDayIndex;
        
        if (currentIndex === -1 || currentIndex === this.repeatDays.length - 1) {
          nextDayIndex = 0;
        } else {
          nextDayIndex = currentIndex + 1;
        }
        
        const nextDayName = this.repeatDays[nextDayIndex];
        const targetDayIndex = dayNames.indexOf(nextDayName);
        let daysToAdd = targetDayIndex - currentDay;
        
        if (daysToAdd <= 0) {
          daysToAdd += 7;
        }
        
        nextDate.setDate(nextDate.getDate() + daysToAdd);
      } else {
        nextDate.setDate(nextDate.getDate() + 7);
      }
      break;
    
    case 'monthly':
      nextDate.setMonth(nextDate.getMonth() + 1);
      break;
    
    default:
      return null;
  }
  
  return nextDate;
};

// Method to generate next recurring task
taskSchema.methods.generateNextRecurringTask = async function() {
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
    parentTask: this._id,
    files: this.files.map(file => ({ ...file.toObject() })),
    voiceNote: this.voiceNote ? { ...this.voiceNote.toObject() } : null
  };

  const newTask = new this.constructor(newTaskData);
  await newTask.save();

  // Update current task's next occurrence
  this.nextOccurrence = nextOccurrence;
  this.recurrenceCount = (this.recurrenceCount || 0) + 1;
  await this.save();

  return newTask;
};

module.exports = mongoose.model('Task', taskSchema);