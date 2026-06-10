// models/SidebarConfig.js
const mongoose = require('mongoose');

const menuItemSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true
  },
  name: {
    type: String,
    required: true
  },
  icon: {
    type: String,
    required: true
  },
  path: {
    type: String,
    required: true
  },
  category: {
    type: String,
    default: 'main'
  },
  notificationAccess: {
    scope: {
      type: String,
      enum: ['company', 'branch', 'department'],
      default: 'company'
    },
    branchIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch'
    }],
    departmentIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Department'
    }]
  }
});

const sidebarConfigSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  branchId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Branch',
    required: false // Optional for backward compatibility before migration
  },
  departmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
    required: true
  },
  role: {
    type: String,
    required: true,
      
  },
  menuItems: [menuItemSchema],
  isActive: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null // ✅ Allow null
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null // ✅ Allow null
  }
}, {
  timestamps: true
});

// Index including branchId for unique configurations
sidebarConfigSchema.index(
  { companyId: 1, branchId: 1, departmentId: 1, role: 1 },
  { unique: true, name: 'unique_sidebar_config_branch' }
);

module.exports = mongoose.model('SidebarConfig', sidebarConfigSchema);
