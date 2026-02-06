const mongoose = require('mongoose');

const clientMeetingSchema = new mongoose.Schema({
  clientName: {
    type: String,
    required: [true, 'Client name is required'],
    trim: true
  },
  phone: {
    type: String,
    required: [true, 'Phone number is required'],
    trim: true
  },
  email: {
    type: String,
    trim: true,
    lowercase: true
  },
  company: {
    type: String,
    trim: true
  },
  meetingType: {
    type: String,
    enum: ['Online', 'Demo', 'Discussion', 'Sales', 'Review'],
    default: 'Online'
  },
  priority: {
    type: String,
    enum: ['High', 'Normal', 'Low'],
    default: 'Normal'
  },
  location: {
    type: String,
    required: [true, 'Location/Platform is required'],
    trim: true
  },
  meetingDate: {
    type: Date,
    required: [true, 'Meeting date is required']
  },
  meetingTime: {
    type: String,
    required: [true, 'Meeting time is required']
  },
  duration: {
    type: String,
    default: '30'
  },
  description: {
    type: String,
    trim: true
  },
  followUpRequired: {
    type: String,
    enum: ['Yes', 'No'],
    default: 'No'
  },
  status: {
    type: String,
    enum: ['Scheduled', 'Completed', 'Cancelled', 'Rescheduled'],
    default: 'Scheduled'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Indexes for better query performance
clientMeetingSchema.index({ clientName: 1 });
clientMeetingSchema.index({ meetingDate: 1 });
clientMeetingSchema.index({ priority: 1 });
clientMeetingSchema.index({ status: 1 });

const ClientMeeting = mongoose.model('ClientMeeting', clientMeetingSchema);

module.exports = ClientMeeting;