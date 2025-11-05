const mongoose = require('mongoose');

const historySchema = new mongoose.Schema({
  action: { type: String, enum: ['applied', 'approved', 'rejected', 'pending'], required: true },
  by: { type: String, required: true },        // Person Name
  role: { type: String, required: true },      // employee/hr/admin/manager
  at: { type: Date, default: Date.now },       // Timestamp
  remarks: { type: String, default: '' }       // Optional
});
const leaveSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    enum: ['Casual', 'Sick', 'Paid', 'Unpaid', 'Other'],
    required: true
  },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  reason: { type: String, required: true, trim: true },
  days: { type: Number, required: true, min: 1 },

  status: {
    type: String,
    enum: ['Pending', 'Approved', 'Rejected'],
    default: 'Pending'
  },

  // last action for quick display (optional)
  approvedBy: { type: String, default: '' },  
  remarks: { type: String, default: '' },

  history: [historySchema]      // ✅ Full timeline history
}, {
  timestamps: true
});

module.exports = mongoose.model('Leave', leaveSchema);
