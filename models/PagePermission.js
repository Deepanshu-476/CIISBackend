const mongoose = require('mongoose');

const pagePermissionSchema = new mongoose.Schema({
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
    index: true
  },
  companyCode: {
    type: String,
    trim: true,
    default: '',
    index: true
  },
  pageKey: {
    type: String,
    required: true,
    trim: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  path: {
    type: String,
    required: true,
    trim: true
  },
  approvers: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    addedAt: {
      type: Date,
      default: Date.now
    }
  }],
  viewUsers: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    addedAt: {
      type: Date,
      default: Date.now
    }
  }],
  editUsers: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    addedAt: {
      type: Date,
      default: Date.now
    }
  }],
  deleteUsers: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    addedAt: {
      type: Date,
      default: Date.now
    }
  }],
  generateUsers: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    addedAt: {
      type: Date,
      default: Date.now
    }
  }],
  lockUsers: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    addedAt: {
      type: Date,
      default: Date.now
    }
  }],
  unlockUsers: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    addedAt: {
      type: Date,
      default: Date.now
    }
  }],
  userAccessScopes: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    accessType: {
      type: String,
      enum: ['view', 'edit', 'delete', 'approve', 'generate', 'lock', 'unlock'],
      required: true
    },
    branchIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch'
    }],
    departmentIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Department'
    }],
    addedAt: {
      type: Date,
      default: Date.now
    }
  }]
}, {
  timestamps: true
});

pagePermissionSchema.index({ company: 1, path: 1 }, { unique: true });
pagePermissionSchema.index({ company: 1, pageKey: 1 });
pagePermissionSchema.index({ company: 1, updatedAt: -1 });

module.exports = mongoose.model('PagePermission', pagePermissionSchema);
