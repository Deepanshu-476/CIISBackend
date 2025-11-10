import mongoose from "mongoose";

const meetingSchema = new mongoose.Schema({
  title: String,
  description: String,
  date: Date,
  time: String,
  recurring: { type: String, enum: ["No", "Daily"], default: "No" },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  attendees: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
});

export default mongoose.model("Meeting", meetingSchema);
