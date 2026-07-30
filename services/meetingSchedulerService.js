const schedule = require('node-schedule');
const Meeting = require('../HR-CDS/models/Meeting');
const User = require('../models/User');
const { sendEmail } = require('../utils/sendEmail');


const activeJobs = new Map();

 
const getMeetingStartDateTime = (date, timeStr) => {
  const meetingDate = new Date(date);
  const [hours, minutes] = timeStr.split(':').map(Number);
  meetingDate.setHours(hours, minutes, 0, 0);
  return meetingDate;
}; 

 
const sendMeetingReminder = async (meetingId) => {
  try {
    const meeting = await Meeting.findById(meetingId).populate('attendees', 'email name');
    if (!meeting) {
      void 0;
      return;
    }

    void 0;

    const linkHtml = meeting.link 
      ? `<p><b>Meeting Link:</b> <a href="${meeting.link}" target="_blank" rel="noopener noreferrer">${meeting.link}</a></p>`
      : '';

    for (const attendee of meeting.attendees) {
      if (attendee.email) {
        const html = `
          <h3>📅 Meeting Reminder: starting in 1 hour</h3>
          <p>Hi ${attendee.name || 'Team Member'},</p>
          <p>This is a reminder that the meeting <b>"${meeting.title}"</b> is scheduled to start in exactly 1 hour.</p>
          <p><b>Description:</b> ${meeting.description || "-"}</p>
          <p><b>Time:</b> ${meeting.time}</p>
          ${linkHtml}
          <p>See you there!</p>
        `;
        
        await sendEmail(attendee.email, `🔔 Meeting Reminder: "${meeting.title}" starts in 1 hour!`, html, {
          skipNotification: true
        });
      }
    }

    
    activeJobs.delete(meetingId.toString());
  } catch (error) {
    console.error(`[MeetingReminder] Error sending reminders for meeting ${meetingId}:`, error);
  }
};

 
const scheduleMeetingReminder = (meeting) => {
  try {
    const meetingIdStr = meeting._id.toString();
    
    
    cancelMeetingReminder(meetingIdStr);

    const startDateTime = getMeetingStartDateTime(meeting.date, meeting.time);
    const reminderTime = new Date(startDateTime.getTime() - 60 * 60 * 1000); 

    const now = new Date();   
    if (reminderTime <= now) {
      void 0;
      return;
    }

    void 0;

    const job = schedule.scheduleJob(reminderTime, async () => {
      try {
        await sendMeetingReminder(meeting._id);
      } catch (error) {
        console.error(`[MeetingScheduler] Reminder failed for meeting ${meeting._id}:`, error);
      }
    });

    if (job) {
      activeJobs.set(meetingIdStr, job);
    }
  } catch (error) {
    console.error(`[MeetingScheduler] Error scheduling reminder for meeting ${meeting?._id}:`, error);
  }
};

 
const cancelMeetingReminder = (meetingId) => {
  const meetingIdStr = meetingId.toString();
  if (activeJobs.has(meetingIdStr)) {
    const job = activeJobs.get(meetingIdStr);
    job.cancel();
    activeJobs.delete(meetingIdStr);
    void 0;
  }
};

 
const initMeetingScheduler = async () => {
  try {
    void 0;
    const now = new Date();
       
    
    const meetings = await Meeting.find();
    let scheduledCount = 0;

    for (const meeting of meetings) {
      const startDateTime = getMeetingStartDateTime(meeting.date, meeting.time);
      const reminderTime = new Date(startDateTime.getTime() - 60 * 60 * 1000);
      
      if (reminderTime > now) {
        scheduleMeetingReminder(meeting);
        scheduledCount++;
      }
    }

    void 0;
  } catch (error) {
    console.error('[MeetingScheduler] Failed to initialize scheduler:', error);
  }
};

module.exports = {
  scheduleMeetingReminder,
  cancelMeetingReminder,
  initMeetingScheduler
};
