const schedule = require('node-schedule');
const Meeting = require('../HR-CDS/models/Meeting');
const User = require('../models/User');
const { sendEmail } = require('../utils/sendEmail');

// In-memory store for active schedule jobs, keyed by meeting ID
const activeJobs = new Map();

/**
 * Combine meeting date and time into a single Date object
 */
const getMeetingStartDateTime = (date, timeStr) => {
  const meetingDate = new Date(date);
  const [hours, minutes] = timeStr.split(':').map(Number);
  meetingDate.setHours(hours, minutes, 0, 0);
  return meetingDate;
};

/**
 * Send email reminder to all attendees of a meeting
 */
const sendMeetingReminder = async (meetingId) => {
  try {
    const meeting = await Meeting.findById(meetingId).populate('attendees', 'email name');
    if (!meeting) {
      console.log(`[MeetingReminder] Meeting ${meetingId} not found, skipping reminder.`);
      return;
    }

    console.log(`[MeetingReminder] Sending 1-hour reminders for meeting "${meeting.title}"`);

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

    // Clean up map
    activeJobs.delete(meetingId.toString());
  } catch (error) {
    console.error(`[MeetingReminder] Error sending reminders for meeting ${meetingId}:`, error);
  }
};

/**
 * Schedule a 1-hour reminder job for a meeting
 */
const scheduleMeetingReminder = (meeting) => {
  try {
    const meetingIdStr = meeting._id.toString();
    
    // Cancel any existing job first
    cancelMeetingReminder(meetingIdStr);

    const startDateTime = getMeetingStartDateTime(meeting.date, meeting.time);
    const reminderTime = new Date(startDateTime.getTime() - 60 * 60 * 1000); // 1 hour before

    const now = new Date();
    if (reminderTime <= now) {
      console.log(`[MeetingScheduler] Reminder time for "${meeting.title}" has already passed or is too close, skipping.`);
      return;
    }

    console.log(`[MeetingScheduler] Scheduling 1-hour reminder for "${meeting.title}" at ${reminderTime.toLocaleString()}`);

    const job = schedule.scheduleJob(reminderTime, async () => {
      await sendMeetingReminder(meeting._id);
    });

    if (job) {
      activeJobs.set(meetingIdStr, job);
    }
  } catch (error) {
    console.error(`[MeetingScheduler] Error scheduling reminder for meeting ${meeting?._id}:`, error);
  }
};

/**
 * Cancel a scheduled reminder job
 */
const cancelMeetingReminder = (meetingId) => {
  const meetingIdStr = meetingId.toString();
  if (activeJobs.has(meetingIdStr)) {
    const job = activeJobs.get(meetingIdStr);
    job.cancel();
    activeJobs.delete(meetingIdStr);
    console.log(`[MeetingScheduler] Cancelled reminder job for meeting ${meetingIdStr}`);
  }
};

/**
 * Load all upcoming meetings from the database and schedule reminders
 */
const initMeetingScheduler = async () => {
  try {
    console.log('[MeetingScheduler] Initializing meeting scheduler...');
    const now = new Date();
    
    // Find all meetings
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

    console.log(`[MeetingScheduler] Scheduled reminders for ${scheduledCount} upcoming meetings.`);
  } catch (error) {
    console.error('[MeetingScheduler] Failed to initialize scheduler:', error);
  }
};

module.exports = {
  scheduleMeetingReminder,
  cancelMeetingReminder,
  initMeetingScheduler
};
