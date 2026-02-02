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
  isActive: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  }
}, {
  timestamps: true
});

// Compound index for unique department names within a company
departmentSchema.index({ name: 1, company: 1 }, { 
  unique: true,
  partialFilterExpression: { isActive: true }
});

// Prevent deletion of departments with active users
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