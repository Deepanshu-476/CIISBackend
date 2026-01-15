const mongoose = require("mongoose");

const departmentSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, "Department name is required"],
    unique: true,
    trim: true,
    maxlength: [50, "Department name cannot exceed 50 characters"]
  },
  description: {
    type: String,
    maxlength: [200, "Description cannot exceed 200 characters"]
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

// Prevent deletion of departments with active users
departmentSchema.pre('remove', async function(next) {
  const User = mongoose.model('User');
  const usersCount = await User.countDocuments({ department: this._id });
  
  if (usersCount > 0) {
    next(new Error('Cannot delete department with active users'));
  }
  next();
});

module.exports = mongoose.model("Department", departmentSchema);