import Meeting from "../models/Meeting.js";
import MeetingView from "../models/MeetingView.js";
import User from "../models/User.js";
import sendEmail from "../utils/sendEmail.js"; // 🟢 using your existing mailer
import cron from "node-cron";

/**
 * 📌 Create Meeting (Admin)
 */
export const createMeeting = async (req, res) => {
  try {
    const { title, description, date, time, recurring, attendees, createdBy } = req.body;

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
          <h3>New Meeting Scheduled</h3>
          <p><b>Title:</b> ${title}</p>
          <p><b>Description:</b> ${description}</p>
          <p><b>Date:</b> ${new Date(date).toDateString()}</p>
          <p><b>Time:</b> ${time}</p>
        `;
        await sendEmail(emp.email, `📅 Meeting Scheduled: ${title}`, html);
      }
    }

    res.json({ success: true, meeting });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * 📌 Get Meetings (for specific user)
 */
export const getUserMeetings = async (req, res) => {
  try {
    const userMeetings = await Meeting.find({ attendees: req.params.userId }).sort({ date: 1 });
    res.json(userMeetings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * 📌 Mark as viewed by employee
 */
export const markAsViewed = async (req, res) => {
  try {
    const { meetingId, userId } = req.body;
    await MeetingView.updateOne(
      { meetingId, userId },
      { viewed: true, viewedAt: new Date() }
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * 📌 Get View Status (for Admin)
 */
export const getViewStatus = async (req, res) => {
  try {
    const views = await MeetingView.find({ meetingId: req.params.meetingId }).populate(
      "userId",
      "name email"
    );
    res.json(views);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * 🕒 Cron Jobs
 */
export const setupCronJobs = () => {
  // Daily recurring meeting
  cron.schedule("0 0 * * *", async () => {
    const today = new Date();
    const meetings = await Meeting.find({ recurring: "Daily" });
    meetings.forEach(async (m) => {
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
    });
  });

  // Reminder (10 minutes before)
  cron.schedule("*/5 * * * *", async () => {
    const now = new Date();
    const tenMin = new Date(now.getTime() + 10 * 60000);
    const meetings = await Meeting.find({ date: { $gte: now, $lte: tenMin } });

    for (const m of meetings) {
      const users = await User.find({ _id: { $in: m.attendees } });
      for (const u of users) {
        const html = `
          <p>⏰ Reminder: Your meeting "<b>${m.title}</b>" starts at ${m.time}</p>
        `;
        await sendEmail(u.email, `⏰ Reminder: ${m.title}`, html);
      }
    }
  });
};
