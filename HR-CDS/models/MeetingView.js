import mongoose from "mongoose";

const viewSchema = new mongoose.Schema({
  meetingId: { type: mongoose.Schema.Types.ObjectId, ref: "Meeting" },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  viewed: { type: Boolean, default: false },
  viewedAt: Date
});

export default mongoose.model("MeetingView", viewSchema);
