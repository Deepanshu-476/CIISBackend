const mongoose = require('mongoose');

const clientMeetingSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Meeting title is required'],
    trim: true
  },
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: [true, 'Client is required'],
    index: true
  },
  clientName: {
    type: String,
    required: [true, 'Client name is required'],
    trim: true
  },
  phone: {
    type: String,
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
  companyCode: {
    type: String,
    required: [true, 'Company code is required'],
    uppercase: true,
    trim: true,
    index: true
  },
  meetingType: {
    type: String,
    enum: ['Online', 'Demo', 'Discussion', 'Sales', 'Review', 'Support', 'Onboarding'],
    default: 'Online'
  },
  priority: {
    type: String,
    enum: ['High', 'Normal', 'Low'],
    default: 'Normal'
  },
  location: {
    type: String,
    trim: true
  },
  link: {
    type: String,
    trim: true,
    default: ''
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
  attendees: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client'
  }],
  attendeeUsers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  followUpRequired: {
    type: String,
    enum: ['Yes', 'No'],
    default: 'No'
  },
  recurring: {
    type: String,
    enum: ['No', 'Daily', 'Weekly', 'Monthly'],
    default: 'No'
  },
  status: {
    type: String,
    enum: ['Scheduled', 'Completed', 'Cancelled', 'Rescheduled'],
    default: 'Scheduled'
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  }
}, {
  timestamps: true
});


clientMeetingSchema.index({ clientName: 1 });
clientMeetingSchema.index({ meetingDate: 1 });
clientMeetingSchema.index({ priority: 1 });
clientMeetingSchema.index({ status: 1 });
clientMeetingSchema.index({ companyCode: 1, meetingDate: 1 });
clientMeetingSchema.index({ clientId: 1, meetingDate: -1 });

const ClientMeeting = mongoose.model('ClientMeeting', clientMeetingSchema);

module.exports = ClientMeeting;
