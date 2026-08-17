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
  isActive: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
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
  if (this.isModified('isActive') && !this.isActive) {
    const User = mongoose.model('User');
    const usersCount = await User.countDocuments({ 
      department: this._id, 
      isActive: true 
    });
    
    if (usersCount > 0) {
      next(new Error('Cannot delete department with active users'));
    }
  }
  next();
});

module.exports = mongoose.model("Department", departmentSchema);
