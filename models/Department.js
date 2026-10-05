const mongoose = require("mongoose");

const departmentSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, "Department name is required"],
    trim: true,
    maxlength: [50, "Department name cannot exceed 50 characters"]
  },
  description: {
    type: String,
    maxlength: [200, "Description cannot exceed 200 characters"]
  },
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Company",
    required: true
  },
  companyCode: {
    type: String,
    required: true,
    trim: true
  },
  branch: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Branch",
    index: true
  },
  branchCode: {
    type: String,
    trim: true,
    index: true
  },
  branchName: {
    type: String,
    trim: true,
    default: ""
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  },
  createdByName: {
    type: String,
    trim: true,
    default: ""
  },
  supportHead: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    index: true
  },
  supportHeadName: {
    type: String,
    trim: true
  },
  workingDays: {
    type: Number,
    min: [1, "Working days must be between 1 and 7"],
    max: [7, "Working days must be between 1 and 7"],
    default: 5
  },
  workingDayHistory: [{
    workingDays: {
      type: Number,
      min: [1, "Working days must be between 1 and 7"],
      max: [7, "Working days must be between 1 and 7"],
      required: true
    },
    effectiveFrom: {
      type: Date,
      required: true,
      default: Date.now
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    }
  }]
}, {
  timestamps: true
});


departmentSchema.index({ name: 1, company: 1 }, { 
  unique: true,
  partialFilterExpression: { isActive: true }
});
departmentSchema.index({ company: 1, isActive: 1, createdAt: -1 });
departmentSchema.index({ company: 1, branch: 1, isActive: 1 });
departmentSchema.index({ company: 1, supportHead: 1, isActive: 1 });
departmentSchema.index({ company: 1, branch: 1, isActive: 1, createdAt: -1 });
departmentSchema.index({ companyCode: 1, isActive: 1 });

// Older deployments used a global unique `{ name: 1 }` index. MongoDB keeps
// that index even after the schema changes, which incorrectly blocks the same
// department name in different companies.
departmentSchema.statics.removeLegacyGlobalNameIndex = async function() {
  const indexes = await this.collection.indexes();
  const legacyIndex = indexes.find(index => (
    index.unique === true &&
    Object.keys(index.key || {}).length === 1 &&
    index.key.name === 1
  ));

  if (legacyIndex) {
    await this.collection.dropIndex(legacyIndex.name);
    console.log(`Removed legacy global Department index: ${legacyIndex.name}`);
  }
};


departmentSchema.pre('save', async function(next) {
  try {
    const { autoResolveDepartment } = require('../services/cascadeSyncEngine');
    await autoResolveDepartment(this);
  } catch (err) {}

  if (this.isModified('isActive') && !this.isActive) {
    const User = mongoose.model('User');
    const usersCount = await User.countDocuments({ 
      department: this._id, 
      isActive: true 
    });
    
    if (usersCount > 0) {
      return next(new Error('Cannot delete department with active users'));
    }
  }
  next();
});

// Post-save cascade synchronization
departmentSchema.post('save', async function(doc) {
  try {
    const { cascadeDepartmentUpdate } = require('../services/cascadeSyncEngine');
    await cascadeDepartmentUpdate(doc._id, doc);
  } catch (err) {
    console.error('Department post-save cascade error:', err.message);
  }
});

module.exports = mongoose.model("Department", departmentSchema);
