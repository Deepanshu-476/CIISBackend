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
    type: String,
    required: [true, 'Project manager is required'],
    enum: ['Jatin', 'Subhash', 'Rahul'],
    trim: true
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
clientSchema.index({ projectManager: 1 });
clientSchema.index({ createdAt: -1 });

// Virtual for progress percentage
clientSchema.virtual('progressPercentage').get(function() {
  const match = this.progress.match(/(\d+)%/);
  return match ? parseInt(match[1]) : 0;
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

// Instance method to update progress
clientSchema.methods.updateProgress = function(completed, total) {
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
  this.progress = `${completed}/${total} (${percentage}%)`;
  return this.save();
};

module.exports = mongoose.model('Client', clientSchema);