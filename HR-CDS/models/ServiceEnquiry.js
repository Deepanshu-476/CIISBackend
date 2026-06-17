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

const serviceEnquirySchema = new mongoose.Schema({
  enquiryNumber: {
    type: String,
    unique: true,
    sparse: true,
    index: true
  },
  serviceName: {
    type: String,
    required: [true, 'Service name is required'],
    trim: true,
    maxlength: [120, 'Service name cannot exceed 120 characters']
  },
  requirement: {
    type: String,
    trim: true,
    maxlength: [1500, 'Requirement cannot exceed 1500 characters'],
    default: ''
  },
  budget: {
    type: String,
    trim: true,
    maxlength: [100, 'Budget cannot exceed 100 characters'],
    default: ''
  },
  contactMethod: {
    type: String,
    trim: true,
    enum: ['Phone', 'Email', 'WhatsApp'],
    default: 'WhatsApp'
  },
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    default: null,
    index: true
  },
  clientName: {
    type: String,
    trim: true,
    maxlength: [120, 'Client name cannot exceed 120 characters'],
    default: ''
  },
  companyName: {
    type: String,
    trim: true,
    maxlength: [120, 'Company name cannot exceed 120 characters'],
    default: ''
  },
  companyCode: {
    type: String,
    trim: true,
    uppercase: true,
    index: true
  },
  companyIdentifier: {
    type: String,
    trim: true,
    default: ''
  },
  requestedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  status: {
    type: String,
    enum: ['Pending', 'Approved', 'Contacted', 'Proposal Sent', 'Closed'],
    default: 'Pending',
    index: true
  }
}, {
  timestamps: true
});

serviceEnquirySchema.pre('save', function(next) {
  if (!this.enquiryNumber) this.enquiryNumber = createPublicId('ENQ');
  if (this.companyCode) this.companyCode = this.companyCode.trim().toUpperCase();
  if (this.serviceName) this.serviceName = this.serviceName.trim();
  next();
});

serviceEnquirySchema.index({ companyCode: 1, createdAt: -1 });

module.exports = mongoose.model('ServiceEnquiry', serviceEnquirySchema);
