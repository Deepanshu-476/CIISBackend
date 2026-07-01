const Meeting = require("../models/Meeting");
const MeetingView = require("../models/MeetingView");
const User = require("../../models/User");
const { sendEmail } = require("../../utils/sendEmail");
const { notifyDirectUsers } = require("../utils/systemNotificationService");
const { scheduleMeetingReminder, cancelMeetingReminder } = require("../../services/meetingSchedulerService");

 
const createMeeting = async (req, res) => {
  try {
    const { title, description, date, dates, time, recurring, attendees, createdBy, companyCode, link } = req.body;

    if (!title || (!date && (!Array.isArray(dates) || dates.length === 0)) || !time || !Array.isArray(attendees))
      return res.status(400).json({ error: "Missing required fields" });

    
    let datesToCreate = [];
    if (Array.isArray(dates) && dates.length > 0) {
      datesToCreate = dates;
    } else if (date) {
      datesToCreate = [date];
    }

    const createdMeetings = [];

    for (const d of datesToCreate) {
      const meeting = await Meeting.create({
        title,
        description,
        date: new Date(d),
        time,
        recurring,
        createdBy,
        attendees,
        companyCode,
        link: link || ""
      });

      createdMeetings.push(meeting);

      
      scheduleMeetingReminder(meeting);

      
      for (const empId of attendees) {
        await MeetingView.create({ meetingId: meeting._id, userId: empId });
      }

      
      await notifyDirectUsers({
        userIds: attendees,
        targetPath: '/ciisUser/employee-meeting',
        type: 'meeting_created',
        title: 'New Meeting Scheduled',
        message: `${req.user?.name || 'Admin'} scheduled "${title}" on ${new Date(d).toDateString()} at ${time}`,
        actor: req.user?._id || createdBy,
        data: {
          meetingId: meeting._id,
          title,
          date: d,
          time,
        },
        priority: 'high',
      });

      
      for (const empId of attendees) {
        const emp = await User.findById(empId);
        if (emp && emp.email) {
          const joinText = link ? `<p><b>Join Meeting Link:</b> <a href="${link}" target="_blank" rel="noopener noreferrer">${link}</a></p>` : "";
          const html = `
            <h3>📅 New Meeting Scheduled</h3>
            <p>Hi ${emp.name || 'Team Member'},</p>
            <p>You have been invited to a new meeting scheduled by the Admin team.</p>
            <p><b>Title:</b> ${title}</p>
            <p><b>Description:</b> ${description || "-"}</p>
            <p><b>Date:</b> ${new Date(d).toDateString()}</p>
            <p><b>Time:</b> ${time}</p>
            ${joinText}
            <p>See you there!</p>
          `;
          await sendEmail(emp.email, `📅 Meeting Scheduled: ${title}`, html, {
            skipNotification: true,
          });
        }
      }

      
      try {
        const Task = require("../models/Task");
        const statusByUser = attendees.map((uid) => ({
          user: uid,
          status: "pending",
        }));
        
        
        const taskDueDateTime = new Date(d);
        const [hours, minutes] = time.split(':').map(Number);
        taskDueDateTime.setHours(hours, minutes, 0, 0);

        const joinText = link ? `\n\nClickable Joining Link: ${link}` : "";

        const task = await Task.create({
          title: `Meeting: ${title}`,
          description: `Auto-generated task for scheduled meeting "${title}".\nAgenda/Description: ${description || "No agenda details provided."}${joinText}`,
          dueDateTime: taskDueDateTime,
          priority: "medium",
          companyCode: companyCode || req.user?.companyCode || "",
          assignedUsers: attendees,
          statusByUser,
          createdBy: createdBy || req.user?._id,
          taskFor: 'others',
          statusHistory: [{
            status: 'pending',
            changedBy: createdBy || req.user?._id,
            remarks: `Task automatically generated on meeting creation`
          }]
        });

        const actorId = createdBy || req.user?._id;
        const taskNotificationUsers = attendees
          .map(uid => uid?.toString?.() || String(uid))
          .filter(uid => uid && uid !== actorId?.toString?.());

        if (taskNotificationUsers.length) {
          await notifyDirectUsers({
            userIds: taskNotificationUsers,
            targetPath: '/ciisUser/task-management',
            type: 'task_assigned',
            title: 'New Meeting Task Assigned',
            message: `Meeting task "${title}" has been added to your task board`,
            actor: actorId,
            data: {
              taskId: task._id,
              meetingId: meeting._id,
              title: `Meeting: ${title}`,
              dueDateTime: taskDueDateTime,
              targetPath: '/ciisUser/task-management',
            },
            priority: 'high',
          });
        }
        void 0;
      } catch (taskError) {
        console.error("Failed to create auto-task for meeting:", taskError);
      }
    }

    res.json({ success: true, meetings: createdMeetings, meeting: createdMeetings[0] });
  } catch (err) {
    console.error("Create Meeting Error:", err);
    res.status(500).json({ error: err.message });
  }
};

 
const updateMeeting = async (req, res) => {
  try {
    const { meetingId } = req.params;
    const { title, description, date, time, recurring, attendees, link, companyCode } = req.body;

    const meeting = await Meeting.findById(meetingId);
    if (!meeting) {
      return res.status(404).json({ error: "Meeting not found" });
    }

    
    cancelMeetingReminder(meetingId);

    
    meeting.title = title || meeting.title;
    meeting.description = description !== undefined ? description : meeting.description;
    meeting.date = date ? new Date(date) : meeting.date;
    meeting.time = time || meeting.time;
    meeting.recurring = recurring || meeting.recurring;
    meeting.attendees = attendees || meeting.attendees;
    meeting.link = link !== undefined ? link : meeting.link;
    meeting.companyCode = companyCode || meeting.companyCode;

    await meeting.save();

    
    scheduleMeetingReminder(meeting);

    
    const existingViews = await MeetingView.find({ meetingId });
    const existingUserIds = existingViews.map(v => v.userId.toString());

    for (const attendeeId of meeting.attendees) {
      const attendeeIdStr = attendeeId.toString();
      if (!existingUserIds.includes(attendeeIdStr)) {
        await MeetingView.create({ meetingId, userId: attendeeId });
      }
    }

    
    await notifyDirectUsers({
      userIds: meeting.attendees,
      targetPath: '/ciisUser/employee-meeting',
      type: 'meeting_updated',
      title: 'Meeting Details Updated',
      message: `${req.user?.name || 'Admin'} updated meeting "${meeting.title}" to ${new Date(meeting.date).toDateString()} at ${meeting.time}`,
      actor: req.user?._id || meeting.createdBy,
      data: {
        meetingId: meeting._id,
        title: meeting.title,
        date: meeting.date,
        time: meeting.time,
      },
      priority: 'high',
    });

    
    for (const empId of meeting.attendees) {
      const emp = await User.findById(empId);
      if (emp && emp.email) {
        const joinText = meeting.link ? `<p><b>Join Meeting Link:</b> <a href="${meeting.link}" target="_blank" rel="noopener noreferrer">${meeting.link}</a></p>` : "";
        const html = `
          <h3>📅 Meeting Details Updated</h3>
          <p>Hi ${emp.name || 'Team Member'},</p>
          <p>Please note that the details of your scheduled meeting <b>"${meeting.title}"</b> have been updated.</p>
          <p><b>New Details:</b></p>
          <p><b>Title:</b> ${meeting.title}</p>
          <p><b>Description:</b> ${meeting.description || "-"}</p>
          <p><b>Date:</b> ${new Date(meeting.date).toDateString()}</p>
          <p><b>Time:</b> ${meeting.time}</p>
          ${joinText}
          <p>See you there!</p>
        `;
        await sendEmail(emp.email, `📅 Meeting Details Updated: ${meeting.title}`, html, {
          skipNotification: true,
        });
      }
    }

    res.json({ success: true, meeting });
  } catch (err) {
    console.error("Update Meeting Error:", err);
    res.status(500).json({ error: err.message });
  }
};

 
const getUserMeetings = async (req, res) => {
  try {
    const { companyCode } = req.query;

    const userMeetings = await Meeting.find({
      attendees: req.params.userId,
      ...(companyCode && { companyCode })
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
};

 
const deleteMeeting = async (req, res) => {
  try {
    const { meetingId } = req.params;

    if (!meetingId) {
      return res.status(400).json({ error: "Meeting ID required" });
    }

    
    cancelMeetingReminder(meetingId);

    await Meeting.findByIdAndDelete(meetingId);

    
    await MeetingView.deleteMany({ meetingId });

    res.json({ success: true, message: "Meeting deleted successfully" });

  } catch (error) {
    console.error("Delete Meeting Error:", error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  createMeeting,
  updateMeeting,
  getUserMeetings,
  markAsViewed,
  getViewStatus,
  getAllMeetings, 
  deleteMeeting,
};
void 0;
