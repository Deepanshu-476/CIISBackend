const Meeting = require("../models/Meeting");
const MeetingView = require("../models/MeetingView");
const User = require("../../models/User");
const sendEmail = require("../../utils/sendEmail");
const cron = require("node-cron");

/**
 * 📌 Create Meeting (Admin)
 */
const createMeeting = async (req, res) => {
  try {
    const { title, description, date, time, recurring, attendees, createdBy } = req.body;

    if (!title || !date || !time || !Array.isArray(attendees)) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const meeting = await Meeting.create({
      title,
      description,
      date,
      time,
      recurring,
      createdBy,
      attendees,
    });

    // Create view records & send emails
    for (const empId of attendees) {
      await MeetingView.create({ meetingId: meeting._id, userId: empId });

      const emp = await User.findById(empId);
      if (emp && emp.email) {
        const html = `
          <h3>📅 New Meeting Scheduled</h3>
          <p><b>Title:</b> ${title}</p>
          <p><b>Description:</b> ${description || "-"}</p>
          <p><b>Date:</b> ${new Date(date).toDateString()}</p>
          <p><b>Time:</b> ${time}</p>
        `;
        // sendEmail should handle failures internally, but we await to throttle
        await sendEmail(emp.email, `📅 Meeting Scheduled: ${title}`, html);
      }
    }

    res.json({ success: true, meeting });
  } catch (error) {
    console.error("Create Meeting Error:", error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * 📌 Get Meetings (for specific user)
 */
const getUserMeetings = async (req, res) => {
  try {
    const userMeetings = await Meeting.find({ attendees: req.params.userId }).sort({ date: 1 });
    // Optionally, attach viewed status:
    const views = await MeetingView.find({ userId: req.params.userId });
    const mapped = userMeetings.map((m) => {
      const v = views.find((vv) => vv.meetingId.toString() === m._id.toString());
      return {
        ...m.toObject(),
        viewed: v ? v.viewed : false,
        viewedAt: v ? v.viewedAt : null,
      };
    });
    res.json(mapped);
  } catch (error) {
    console.error("Get User Meetings Error:", error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * 📌 Mark as viewed by employee
 */
const markAsViewed = async (req, res) => {
  try {
    const { meetingId, userId } = req.body;
    if (!meetingId || !userId) return res.status(400).json({ error: "meetingId and userId required" });

    const result = await MeetingView.updateOne(
      { meetingId, userId },
      { viewed: true, viewedAt: new Date() },
      { upsert: false }
    );

    res.json({ success: true, result });
  } catch (error) {
    console.error("Mark As Viewed Error:", error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * 📌 Get View Status (for Admin)
 */
const getViewStatus = async (req, res) => {
  try {
    const views = await MeetingView.find({ meetingId: req.params.meetingId }).populate(
      "userId",
      "name email"
    );
    res.json(views);
  } catch (error) {
    console.error("Get View Status Error:", error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * 🕒 Cron Jobs
 */
const setupCronJobs = () => {
  // Daily recurring meeting (runs at 00:00 server time)
  cron.schedule("0 0 * * *", async () => {
    try {
      const today = new Date();
      const meetings = await Meeting.find({ recurring: "Daily" });
      for (const m of meetings) {
        const nextDay = new Date(today);
        nextDay.setDate(today.getDate() + 1);
        await Meeting.create({
          title: m.title,
          description: m.description,
          date: nextDay,
          time: m.time,
          recurring: "Daily",
          createdBy: m.createdBy,
          attendees: m.attendees,
        });
      }
      console.log("✅ Daily recurring meetings cloned.");
    } catch (err) {
      console.error("Cron (daily) error:", err);
    }
  });

  // Reminder (every 5 minutes; notifies meetings starting in next 10 minutes)
  cron.schedule("*/5 * * * *", async () => {
    try {
      const now = new Date();
      const tenMin = new Date(now.getTime() + 10 * 60000);
      const meetings = await Meeting.find({ date: { $gte: now, $lte: tenMin } });

      for (const m of meetings) {
        const users = await User.find({ _id: { $in: m.attendees } });
        for (const u of users) {
          if (!u || !u.email) continue;
          const html = `
            <p>⏰ Reminder: Your meeting "<b>${m.title}</b>" starts at ${m.time}</p>
            <p><b>Date:</b> ${new Date(m.date).toDateString()}</p>
          `;
          await sendEmail(u.email, `⏰ Reminder: ${m.title}`, html);
        }
      }
      console.log("🔔 Reminders checked/sent if any.");
    } catch (err) {
      console.error("Cron (reminder) error:", err);
    }
  });
};

module.exports = {
  createMeeting,
  getUserMeetings,
  markAsViewed,
  getViewStatus,
  setupCronJobs,
};
