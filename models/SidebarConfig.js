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
  }
});

const sidebarConfigSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
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

// Index
sidebarConfigSchema.index(
  { companyId: 1, departmentId: 1, role: 1 },
  { unique: true, name: 'unique_sidebar_config' }
);

module.exports = mongoose.model('SidebarConfig', sidebarConfigSchema);