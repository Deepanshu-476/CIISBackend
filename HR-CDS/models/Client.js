// models/Client.js
const mongoose = require('mongoose');

const clientSchema = new mongoose.Schema({
  client: {
    type: String,
    required: [true, 'Client name is required'],
    trim: true,
    maxlength: [100, 'Client name cannot exceed 100 characters']
  },
  company: {
    type: String,
    required: [true, 'Company name is required'],
    trim: true,
    maxlength: [100, 'Company name cannot exceed 100 characters']
  },
  city: {
    type: String,
    required: [true, 'City is required'],
    trim: true,
    maxlength: [50, 'City name cannot exceed 50 characters']
  },
  projectManager: {
    type: [String], // CHANGED: Array for multiple project managers
    required: [true, 'At least one project manager is required'],
    validate: {
      validator: function(v) {
        return Array.isArray(v) && v.length > 0 && v.every(name => name.trim().length > 0);
      },
      message: 'At least one project manager is required'
    }
  },
  services: [{
    type: String,
    trim: true
  }],
  status: {
    type: String,
    required: true,
    enum: ['Active', 'On Hold', 'Inactive'],
    default: 'Active'
  },
  progress: {
    type: String,
    default: '0/0 (0%)',
    validate: {
      validator: function(v) {
        return /^\d+\/\d+ \(\d+%\)$/.test(v);
      },
      message: 'Progress must be in format: completed/total (percentage)'
    }
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
  },
  phone: {
    type: String,
    trim: true
  },
  address: {
    type: String,
    trim: true,
    maxlength: [200, 'Address cannot exceed 200 characters']
  },
  description: { // NEW: Added description field
    type: String,
    trim: true,
    maxlength: [1000, 'Description cannot exceed 1000 characters']
  },
  notes: {
    type: String,
    trim: true,
    maxlength: [500, 'Notes cannot exceed 500 characters']
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Index for better query performance
clientSchema.index({ client: 1 });
clientSchema.index({ company: 1 });
clientSchema.index({ status: 1 });
clientSchema.index({ projectManager: 1 }); // This will work with arrays too
clientSchema.index({ createdAt: -1 });

// Virtual for progress percentage
clientSchema.virtual('progressPercentage').get(function() {
  const match = this.progress.match(/(\d+)%/);
  return match ? parseInt(match[1]) : 0;
});

// Virtual for display purposes - get first project manager for display
clientSchema.virtual('primaryProjectManager').get(function() {
  return this.projectManager && this.projectManager.length > 0 ? this.projectManager[0] : 'Not assigned';
});

// Static method to get client statistics
clientSchema.statics.getStats = async function() {
  const stats = await this.aggregate([
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        active: { 
          $sum: { 
            $cond: [{ $eq: ['$status', 'Active'] }, 1, 0] 
          } 
        },
        onHold: { 
          $sum: { 
            $cond: [{ $eq: ['$status', 'On Hold'] }, 1, 0] 
          } 
        },
        inactive: { 
          $sum: { 
            $cond: [{ $eq: ['$status', 'Inactive'] }, 1, 0] 
          } 
        }
      }
    }
  ]);
  
  return stats.length > 0 ? stats[0] : { total: 0, active: 0, onHold: 0, inactive: 0 };
};

// Static method to get project manager statistics
clientSchema.statics.getManagerStats = async function() {
  const stats = await this.aggregate([
    { $unwind: '$projectManager' },
    {
      $group: {
        _id: '$projectManager',
        count: { $sum: 1 }
      }
    },
    { $sort: { count: -1 } }
  ]);
  
  return stats;
};

// Instance method to update progress
clientSchema.methods.updateProgress = function(completed, total) {
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
  this.progress = `${completed}/${total} (${percentage}%)`;
  return this.save();
};

// Instance method to add project manager
clientSchema.methods.addProjectManager = function(managerName) {
  if (!this.projectManager.includes(managerName)) {
    this.projectManager.push(managerName);
  }
  return this.save();
};

// Instance method to remove project manager
clientSchema.methods.removeProjectManager = function(managerName) {
  this.projectManager = this.projectManager.filter(manager => manager !== managerName);
  return this.save();
};

// Pre-save middleware to ensure projectManager is always an array
clientSchema.pre('save', function(next) {
  if (this.projectManager && !Array.isArray(this.projectManager)) {
    this.projectManager = [this.projectManager];
  }
  next();
});

module.exports = mongoose.model('Client', clientSchema);