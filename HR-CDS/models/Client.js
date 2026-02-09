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
  companyCode: {
    type: String,
    required: [true, 'Company code is required'],
    uppercase: true,
    trim: true
  },
  projectManager: {
    type: [String],
    required: [true, 'At least one project manager is required'],
    validate: {
      validator: function(v) {
        return Array.isArray(v) && v.length > 0 && v.every(name => name && typeof name === 'string' && name.trim().length > 0);
      },
      message: 'At least one valid project manager is required'
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
    default: '0/0 (0%)'
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
    sparse: true
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
  description: {
    type: String,
    trim: true,
    maxlength: [1000, 'Description cannot exceed 1000 characters'],
    default: ''
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

// Indexes for better query performance
clientSchema.index({ client: 1, companyCode: 1 }, { unique: true }); // Unique client per company
clientSchema.index({ companyCode: 1 });
clientSchema.index({ status: 1 });
clientSchema.index({ city: 1 });
clientSchema.index({ 'projectManager': 1 });
clientSchema.index({ 'services': 1 });
clientSchema.index({ createdAt: -1 });

// Text index for search functionality
clientSchema.index({
  client: 'text',
  company: 'text',
  city: 'text',
  email: 'text',
  description: 'text',
  notes: 'text'
});

// Virtual for progress percentage
clientSchema.virtual('progressPercentage').get(function() {
  if (!this.progress) return 0;
  const match = this.progress.match(/\((\d+)%\)/);
  return match ? parseInt(match[1]) : 0;
});

// Virtual for display purposes
clientSchema.virtual('primaryProjectManager').get(function() {
  return this.projectManager && this.projectManager.length > 0 ? this.projectManager[0] : 'Not assigned';
});

// Static method to get client statistics with companyCode filter
clientSchema.statics.getStats = async function(companyCode = null) {
  const matchStage = companyCode ? { companyCode } : {};
  
  const stats = await this.aggregate([
    { $match: matchStage },
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
        },
        avgProgress: {
          $avg: {
            $let: {
              vars: {
                progressMatch: { $regexFind: { input: "$progress", regex: /\\((\d+)%\\)/ } }
              },
              in: {
                $cond: [
                  { $ne: ["$$progressMatch", null] },
                  { $toInt: "$$progressMatch.captures.0" },
                  0
                ]
              }
            }
          }
        }
      }
    }
  ]);
  
  return stats.length > 0 ? stats[0] : { 
    total: 0, 
    active: 0, 
    onHold: 0, 
    inactive: 0, 
    avgProgress: 0 
  };
};

// Static method to get project manager statistics with companyCode filter
clientSchema.statics.getManagerStats = async function(companyCode = null) {
  const matchStage = companyCode ? { companyCode } : {};
  
  const stats = await this.aggregate([
    { $match: matchStage },
    { $unwind: '$projectManager' },
    {
      $group: {
        _id: '$projectManager',
        clientCount: { $sum: 1 },
        avgProgress: {
          $avg: {
            $let: {
              vars: {
                progressMatch: { $regexFind: { input: "$progress", regex: /\\((\d+)%\\)/ } }
              },
              in: {
                $cond: [
                  { $ne: ["$$progressMatch", null] },
                  { $toInt: "$$progressMatch.captures.0" },
                  0
                ]
              }
            }
          }
        }
      }
    },
    { $sort: { clientCount: -1, _id: 1 } }
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
  const index = this.projectManager.indexOf(managerName);
  if (index > -1) {
    this.projectManager.splice(index, 1);
  }
  return this.save();
};

// Pre-save middleware
clientSchema.pre('save', function(next) {
  // Convert companyCode to uppercase
  if (this.companyCode) {
    this.companyCode = this.companyCode.trim().toUpperCase();
  }
  
  // Ensure projectManager is always an array with valid strings
  if (this.projectManager) {
    if (!Array.isArray(this.projectManager)) {
      this.projectManager = [this.projectManager];
    }
    
    // Clean projectManager array - remove null, undefined, empty strings
    this.projectManager = this.projectManager
      .filter(manager => manager && typeof manager === 'string' && manager.trim().length > 0)
      .map(manager => manager.trim());
    
    // Remove duplicates
    this.projectManager = [...new Set(this.projectManager)];
    
    // Ensure projectManager has at least one valid entry
    if (this.projectManager.length === 0) {
      const error = new Error('At least one valid project manager is required');
      error.name = 'ValidationError';
      return next(error);
    }
  }
  
  // Ensure services is always an array
  if (this.services && !Array.isArray(this.services)) {
    this.services = [this.services];
  }
  
  // Clean services array
  if (this.services && Array.isArray(this.services)) {
    this.services = this.services
      .filter(service => service && typeof service === 'string' && service.trim().length > 0)
      .map(service => service.trim());
  }
  
  // Default progress if not provided
  if (!this.progress) {
    this.progress = '0/0 (0%)';
  }
  
  next();
});

// Pre-update middleware for findByIdAndUpdate
clientSchema.pre('findOneAndUpdate', function(next) {
  const update = this.getUpdate();
  
  // Convert companyCode to uppercase if being updated
  if (update.companyCode) {
    update.companyCode = update.companyCode.trim().toUpperCase();
  }
  
  // Handle projectManager in updates
  if (update.projectManager) {
    if (!Array.isArray(update.projectManager)) {
      update.projectManager = [update.projectManager];
    }
    
    // Clean projectManager array
    update.projectManager = update.projectManager
      .filter(manager => manager && typeof manager === 'string' && manager.trim().length > 0)
      .map(manager => manager.trim());
    
    // Remove duplicates
    update.projectManager = [...new Set(update.projectManager)];
    
    // Ensure projectManager has at least one valid entry
    if (update.projectManager.length === 0) {
      const error = new Error('At least one valid project manager is required');
      error.name = 'ValidationError';
      return next(error);
    }
  }
  
  next();
});

module.exports = mongoose.model('Client', clientSchema);