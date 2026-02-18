const mongoose = require('mongoose');

const assetSchema = new mongoose.Schema({
  // Basic Information
  name: {
    type: String,
    required: [true, 'Asset name is required'],
    trim: true
  },
  category: {
    type: String,
    required: [true, 'Asset category is required'],
    enum: ['electronics', 'furniture', 'vehicles', 'machinery', 'software', 'office_equipment', 'it_equipment', 'other'],
    default: 'other'
  },
  model: {
    type: String,
    trim: true
  },
  serialNumber: {
    type: String,
    required: [true, 'Serial number is required'],
    unique: true,
    trim: true
  },
  assetTag: {
    type: String,
    unique: true,
    sparse: true,
    trim: true
  },

  // Purchase Information
  purchaseDate: {
    type: Date
  },
  purchaseCost: {
    type: Number,
    min: 0
  },
  warrantyExpiry: {
    type: Date
  },
  supplier: {
    type: String,
    trim: true
  },
  manufacturer: {
    type: String,
    trim: true
  },

  // Status and Condition
  condition: {
    type: String,
    enum: ['new', 'excellent', 'good', 'fair', 'poor'],
    default: 'good'
  },
  status: {
    type: String,
    enum: ['available', 'assigned', 'maintenance', 'damaged', 'retired', 'reserved'],
    default: 'available'
  },

  // Assignment Information
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  assignedDate: {
    type: Date
  },
  expectedReturnDate: {
    type: Date
  },
  department: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department'
  },

  // Location
  location: {
    type: String,
    trim: true
  },

  // Description and Notes
  description: {
    type: String,
    trim: true
  },
  notes: {
    type: String,
    trim: true
  },

  // Company Association
  company: {
    type: String,
    required: true
  },
  companyCode: {
    type: String,
    required: true
  },

  // History Tracking
  history: [{
    action: {
      type: String,
      enum: ['created', 'assigned', 'returned', 'maintenance', 'updated', 'status_changed', 'retired']
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    date: {
      type: Date,
      default: Date.now
    },
    description: String,
    details: mongoose.Schema.Types.Mixed
  }],

  // Maintenance Records
  maintenanceRecords: [{
    type: {
      type: String,
      enum: ['scheduled', 'repair', 'inspection', 'calibration']
    },
    scheduledDate: Date,
    completedDate: Date,
    description: String,
    cost: Number,
    vendor: String,
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    notes: String
  }],

  // Metadata
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Indexes for better query performance
assetSchema.index({ company: 1, status: 1 });
assetSchema.index({ serialNumber: 1 }, { unique: true });
assetSchema.index({ assetTag: 1 }, { sparse: true });
assetSchema.index({ category: 1 });
assetSchema.index({ assignedTo: 1 });
assetSchema.index({ department: 1 });

// Generate asset tag if not provided
assetSchema.pre('save', function(next) {
  if (!this.assetTag) {
    const prefix = this.category.substring(0, 3).toUpperCase();
    const timestamp = Date.now().toString().slice(-8);
    this.assetTag = `${prefix}-${timestamp}`;
  }
  next();
});

// Add to history
assetSchema.methods.addToHistory = function(action, userId, description, details = {}) {
  this.history.push({
    action,
    performedBy: userId,
    date: new Date(),
    description,
    details
  });
};

const Asset = mongoose.model('Asset', assetSchema);

module.exports = Asset;