const mongoose = require('mongoose');

const clientMeetingViewSchema = new mongoose.Schema({
  meetingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ClientMeeting',
    required: true,
    index: true
  },
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true
  },
  viewed: {
    type: Boolean,
    default: false
  },
  viewedAt: Date,
  attendanceStatus: {
    type: String,
    enum: ['Pending', 'Seen', 'Joined', 'Missed'],
    default: 'Pending'
  },
  joinedAt: Date
}, { timestamps: true });

clientMeetingViewSchema.index({ meetingId: 1, clientId: 1 }, { unique: true });

module.exports = mongoose.model('ClientMeetingView', clientMeetingViewSchema);
