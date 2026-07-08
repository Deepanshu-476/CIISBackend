const mongoose = require('mongoose');

const createPublicId = (prefix) => {
  const now = new Date();
  const datePart = [
    String(now.getFullYear()).slice(-2),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('');
  const randomPart = Math.random().toString(36).slice(2, 8).toUpperCase().padEnd(6, '0');
  return `CIIS-${prefix}-${datePart}-${randomPart}`;
};

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
  companyCode: {
    type: String,
    required: [true, 'Company code is required'],
    uppercase: true,
    trim: true
  },
  projectManager: {
    type: [String],
    required: [true, 'At least one project manager is required'],
    validate: {
      validator: function(v) {
        return Array.isArray(v) && v.length > 0 && v.every(name => name && typeof name === 'string' && name.trim().length > 0);
      },
      message: 'At least one valid project manager is required'
    }
  },
  services: [{
    type: String,
    trim: true
  }],
  activeClientPlan: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ClientPlan',
    default: null
  },
  status: {
    type: String,
    required: true,
    enum: ['Active', 'On Hold', 'Inactive'],
    default: 'Active'
  },
  progress: {
    type: String,
    default: '0/0 (0%)'
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
    sparse: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true
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
  description: {
    type: String,
    trim: true,
    maxlength: [1000, 'Description cannot exceed 1000 characters'],
    default: ''
  },
  notes: {
    type: String,
    trim: true,
    maxlength: [500, 'Notes cannot exceed 500 characters']
  },
  subscription: {
    type: [{
      subscriptionNo: {
        type: Number,
        default: 1
      },
      planId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ClientPlan',
        default: null
      },
      planName: {
        type: String,
        trim: true,
        default: ''
      },
      servicesSnapshot: {
        type: [{
          service: String,
          tasks: [{
            name: String,
            description: String,
            priority: String,
            dueInDays: Number
          }]
        }],
        default: []
      },
      generatedTaskIds: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ClientTask'
      }],
      startDate: Date,
      endDate: Date,
      price: {
        type: Number,
        default: 0,
        min: [0, 'Price cannot be negative']
      },
      status: {
        type: String,
        enum: ['Active', 'Expired'],
        default: 'Active'
      },
      extraTasks: {
        type: Number,
        default: 0
      },
      benefits: {
        type: String,
        default: ''
      }
    }],
    default: []
  },
  paymentReceipts: {
    type: [{
      receiptNumber: {
        type: String,
        trim: true,
        index: true
      },
      dueInvoiceId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null
      },
      amount: Number,
      transactionId: String,
      receiptImage: String,
      uploadDate: {
        type: Date,
        default: Date.now
      },
      status: {
        type: String,
        enum: ['Pending', 'Approved', 'Rejected'],
        default: 'Pending'
      },
      verifiedAt: Date,
      notes: {
        type: String,
        default: ''
      }
    }],
    default: []
  },
  dueInvoices: {
    type: [{
      invoiceNumber: {
        type: String,
        trim: true,
        index: true
      },
      title: {
        type: String,
        default: 'Subscription Due'
      },
      subscriptionId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null
      },
      subscriptionNo: {
        type: Number,
        default: null
      },
      planName: {
        type: String,
        trim: true,
        default: ''
      },
      periodStart: Date,
      periodEnd: Date,
      billingCycle: {
        type: String,
        trim: true,
        default: ''
      },
      amount: {
        type: Number,
        default: 0,
        min: 0
      },
      dueDate: Date,
      note: {
        type: String,
        default: ''
      },
      status: {
        type: String,
        enum: ['Due', 'Pending Verification', 'Paid', 'Cancelled'],
        default: 'Due'
      },
      receiptId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null
      },
      createdAt: {
        type: Date,
        default: Date.now
      },
      clearedAt: Date
    }],
    default: []
  },
  reminder5DaysSent: {
    type: Boolean,
    default: false
  },
  reminder3DaysSent: {
    type: Boolean,
    default: false
  },
  expiredMailSent: {
    type: Boolean,
    default: false
  },
  expiredReminderLastSentAt: {
    type: Date,
    default: null
  }
}, { timestamps: true });


clientSchema.index({ client: 1, companyCode: 1 }, { unique: true });
clientSchema.index({ companyCode: 1 });
clientSchema.index({ status: 1 });
clientSchema.index({ city: 1 });
clientSchema.index({ 'projectManager': 1 });
clientSchema.index({ 'services': 1 });
clientSchema.index({ createdAt: -1 });


clientSchema.index({
  client: 'text',
  company: 'text',
  city: 'text',
  email: 'text',
  description: 'text',
  notes: 'text'
});


clientSchema.virtual('progressPercentage').get(function() {
  if (!this.progress) return 0;
  const match = this.progress.match(/\((\d+)%\)/);
  return match ? parseInt(match[1]) : 0;
});


clientSchema.virtual('primaryProjectManager').get(function() {
  return this.projectManager && this.projectManager.length > 0 ? this.projectManager[0] : 'Not assigned';
});


clientSchema.statics.getStats = async function(companyCode = null) {
  const matchStage = companyCode ? { companyCode } : {};
  
  const stats = await this.aggregate([
    { $match: matchStage },
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
        },
        avgProgress: {
          $avg: {
            $let: {
              vars: {
                progressMatch: { $regexFind: { input: "$progress", regex: /\\((\d+)%\\)/ } }
              },
              in: {
                $cond: [
                  { $ne: ["$$progressMatch", null] },
                  { $toInt: "$$progressMatch.captures.0" },
                  0
                ]
              }
            }
          }
        }
      }
    }
  ]);
  
  return stats.length > 0 ? stats[0] : { 
    total: 0, 
    active: 0, 
    onHold: 0, 
    inactive: 0, 
    avgProgress: 0 
  };
};


clientSchema.statics.getManagerStats = async function(companyCode = null) {
  const matchStage = companyCode ? { companyCode } : {};
  
  const stats = await this.aggregate([
    { $match: matchStage },
    { $unwind: '$projectManager' },
    {
      $group: {
        _id: '$projectManager',
        clientCount: { $sum: 1 },
        avgProgress: {
          $avg: {
            $let: {
              vars: {
                progressMatch: { $regexFind: { input: "$progress", regex: /\\((\d+)%\\)/ } }
              },
              in: {
                $cond: [
                  { $ne: ["$$progressMatch", null] },
                  { $toInt: "$$progressMatch.captures.0" },
                  0
                ]
              }
            }
          }
        }
      }
    },
    { $sort: { clientCount: -1, _id: 1 } }
  ]);
  
  return stats;
};


clientSchema.methods.updateProgress = function(completed, total) {
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
  this.progress = `${completed}/${total} (${percentage}%)`;
  return this.save();
};


clientSchema.methods.addProjectManager = function(managerName) {
  if (!this.projectManager.includes(managerName)) {
    this.projectManager.push(managerName);
  }
  return this.save();
};


clientSchema.methods.removeProjectManager = function(managerName) {
  const index = this.projectManager.indexOf(managerName);
  if (index > -1) {
    this.projectManager.splice(index, 1);
  }
  return this.save();
};


clientSchema.methods.updateSubscription = function(subscriptionData) {
  if (!this.subscription) {
    this.subscription = [];
  }
  
  if (subscriptionData && subscriptionData.startDate && subscriptionData.endDate) {
    this.subscription.push({
      startDate: new Date(subscriptionData.startDate),
      endDate: new Date(subscriptionData.endDate),
      price: subscriptionData.price || 0,
      status: subscriptionData.status || 'Active',
      extraTasks: subscriptionData.extraTasks || 0,
      benefits: subscriptionData.benefits || ''
    });
  }
  
  return this.save();
};


clientSchema.pre('save', function(next) {
  
  if (this.companyCode) {
    this.companyCode = this.companyCode.trim().toUpperCase();
  }
  
  
  if (this.projectManager) {
    if (!Array.isArray(this.projectManager)) {
      this.projectManager = [this.projectManager];
    }
    
    
    this.projectManager = this.projectManager
      .filter(manager => manager && typeof manager === 'string' && manager.trim().length > 0)
      .map(manager => manager.trim());
    
    
    this.projectManager = [...new Set(this.projectManager)];
    
    
    if (this.projectManager.length === 0) {
      const error = new Error('At least one valid project manager is required');
      error.name = 'ValidationError';
      return next(error);
    }
  }
  
  
  if (this.services && !Array.isArray(this.services)) {
    this.services = [this.services];
  }
  
  
  if (this.services && Array.isArray(this.services)) {
    this.services = this.services
      .filter(service => service && typeof service === 'string' && service.trim().length > 0)
      .map(service => service.trim());
  }

  if (Array.isArray(this.dueInvoices)) {
    this.dueInvoices.forEach(invoice => {
      if (!invoice.invoiceNumber) {
        invoice.invoiceNumber = createPublicId('INV');
      }
    });
  }

  if (Array.isArray(this.paymentReceipts)) {
    this.paymentReceipts.forEach(receipt => {
      if (!receipt.receiptNumber) {
        receipt.receiptNumber = createPublicId('PAY');
      }
    });
  }
  
  
  if (!this.progress) {
    this.progress = '0/0 (0%)';
  }
  
  next();
});


clientSchema.pre('findOneAndUpdate', function(next) {
  const update = this.getUpdate();
  
  
  if (update.companyCode) {
    update.companyCode = update.companyCode.trim().toUpperCase();
  }
  
  
  if (update.projectManager) {
    if (!Array.isArray(update.projectManager)) {
      update.projectManager = [update.projectManager];
    }
    
    
    update.projectManager = update.projectManager
      .filter(manager => manager && typeof manager === 'string' && manager.trim().length > 0)
      .map(manager => manager.trim());
    
    
    update.projectManager = [...new Set(update.projectManager)];
    
    
    if (update.projectManager.length === 0) {
      const error = new Error('At least one valid project manager is required');
      error.name = 'ValidationError';
      return next(error);
    }
  }
  
  
  if (update.subscription && Array.isArray(update.subscription)) {
    update.subscription = update.subscription.map(sub => ({
      startDate: sub.startDate ? new Date(sub.startDate) : sub.startDate,
      endDate: sub.endDate ? new Date(sub.endDate) : sub.endDate,
      price: sub.price || 0,
      status: sub.status || 'Active',
      extraTasks: sub.extraTasks || 0,
      benefits: sub.benefits || ''
    }));
  }
  
  next();
});

module.exports = mongoose.model('Client', clientSchema);
