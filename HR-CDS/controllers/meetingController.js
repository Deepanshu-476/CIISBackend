const Meeting = require("../models/Meeting");
const MeetingView = require("../models/MeetingView");
const User = require("../../models/User");
const { sendEmail } = require("../../utils/sendEmail");
const Notification = require("../../HR-CDS/models/Notification");

/**
 * 🟢 Create Meeting (Admin)
 */
const createMeeting = async (req, res) => {
  try {
    const { title, description, date, time, recurring, attendees, createdBy, companyCode } = req.body;

    if (!title || !date || !time || !Array.isArray(attendees))
      return res.status(400).json({ error: "Missing required fields" });

    const meeting = await Meeting.create({
      title,
      description,
      date,
      time,
      recurring,
      createdBy,
      attendees,
      companyCode,
    });

    // create MeetingView & send mail
    for (const empId of attendees) {
      await MeetingView.create({ meetingId: meeting._id, userId: empId });
      // ✅ ADD THIS BLOCK (notification)
      const notification = await Notification.create({
        recipient: empId, // 👈 IMPORTANT (userId nahi)
        title: "New Meeting Scheduled",
        message: `Meeting "${title}" on ${new Date(date).toDateString()} at ${time}`,
        type: "meeting"
      });

      // ✅ SOCKET EMIT
      if (global.io) {
        global.io.to(`user:${empId.toString()}`).emit("new_notification", notification);
      }

      // ✅ UNREAD COUNT
      const unreadCount = await Notification.countDocuments({
        recipient: empId,
        isRead: false
      });

      global.io.to(`user:${empId.toString()}`).emit("notification:unread_count", unreadCount);
      const emp = await User.findById(empId);
      if (emp && emp.email) {
        const html = `
          <h3>📅 New Meeting Scheduled</h3>
          <p><b>Title:</b> ${title}</p>
          <p><b>Description:</b> ${description || "-"}</p>
          <p><b>Date:</b> ${new Date(date).toDateString()}</p>
          <p><b>Time:</b> ${time}</p>
        `;
        await sendEmail(emp.email, `📅 Meeting Scheduled: ${title}`, html);
      }
    }

    res.json({ success: true, meeting });
  } catch (err) {
    console.error("Create Meeting Error:", err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * 👨‍💻 Get meetings for employee
 */
const getUserMeetings = async (req, res) => {
  try {
    const { companyCode } = req.query; // 👈 ADD THIS

    const userMeetings = await Meeting.find({
      attendees: req.params.userId,
      ...(companyCode && { companyCode }) // 👈 ADD FILTER
    }).sort({ date: 1 });

    const views = await MeetingView.find({ userId: req.params.userId });

    const data = userMeetings.map((m) => {
      const v = views.find((vv) => vv.meetingId.toString() === m._id.toString());
      return {
        ...m.toObject(),
        viewed: v ? v.viewed : false,
        viewedAt: v ? v.viewedAt : null,
      };
    });

    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * 👀 Mark as viewed
 */
const markAsViewed = async (req, res) => {
  try {
    const { meetingId, userId } = req.body;
    if (!meetingId || !userId)
      return res.status(400).json({ error: "Missing meetingId/userId" });

    await MeetingView.updateOne(
      { meetingId, userId },
      { viewed: true, viewedAt: new Date() },
      { upsert: false }
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * 📊 Get view status (for Admin)
 */
const getViewStatus = async (req, res) => {
  try {
    const data = await MeetingView.find({ meetingId: req.params.meetingId }).populate(
      "userId",
      "name email"
    );
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const getAllMeetings = async (req, res) => {
  try {
    const { companyCode } = req.query;
    const filter = companyCode ? { companyCode } : {};
    const meetings = await Meeting.find(filter).sort({ date: -1 });
    res.json(meetings);
  } catch (error) {
    console.error("Get All Meetings Error:", error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * ❌ Delete Meeting (Admin)
 */
const deleteMeeting = async (req, res) => {
  try {
    const { meetingId } = req.params;

    if (!meetingId) {
      return res.status(400).json({ error: "Meeting ID required" });
    }

    await Meeting.findByIdAndDelete(meetingId);

    // Related views bhi delete karo
    await MeetingView.deleteMany({ meetingId });

    res.json({ success: true, message: "Meeting deleted successfully" });

  } catch (error) {
    console.error("Delete Meeting Error:", error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  createMeeting,
  getUserMeetings,
  markAsViewed,
  getViewStatus,
  getAllMeetings, 
  deleteMeeting,
};
console.log("✅ meetingController.js loaded successfully");