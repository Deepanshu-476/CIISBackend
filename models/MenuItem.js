const mongoose = require('mongoose');

const menuItemSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
    unique: true
  },
  name: {
    type: String,
    required: true
  },
  path: {
    type: String,
    required: true
  },
  icon: {
    type: String,
    required: true,
    default: 'FaCog'
  },
  section: {
    type: String,
    required: true,
    enum: ['main', 'tasks', 'communication', 'admin', 'custom']
  },
  sectionName: {
    type: String,
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  order: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('MenuItem', menuItemSchema);