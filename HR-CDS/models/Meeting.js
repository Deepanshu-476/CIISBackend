const mongoose = require("mongoose");

const meetingSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: String,
  date: { type: Date, required: true },
  time: { type: String, required: true },
  recurring: { type: String, enum: ["No", "Daily", "Weekly"], default: "No" },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  attendees: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  companyCode: { type: String, required: true }, 
  link: { type: String, default: "" },
  
});

meetingSchema.index({ companyCode: 1, date: 1 });
meetingSchema.index({ companyCode: 1, date: -1 });
meetingSchema.index({ attendees: 1, date: 1 });
meetingSchema.index({ attendees: 1, companyCode: 1, date: 1 });
meetingSchema.index({ attendees: 1, companyCode: 1, date: -1 });

module.exports = mongoose.model("Meeting", meetingSchema);
