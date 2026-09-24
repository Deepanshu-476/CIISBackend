const mongoose = require("mongoose");

const viewSchema = new mongoose.Schema({
  meetingId: { type: mongoose.Schema.Types.ObjectId, ref: "Meeting" },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  viewed: { type: Boolean, default: false },
  viewedAt: Date,
});

viewSchema.index({ userId: 1, meetingId: 1 });
viewSchema.index({ meetingId: 1 });

module.exports = mongoose.model("MeetingView", viewSchema);
