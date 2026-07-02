const schedule = require('node-schedule');
const ClientMeeting = require('../models/ClientMeeting');
const ClientMeetingView = require('../models/ClientMeetingView');
const Client = require('../models/Client');
const User = require('../../models/User');
const { sendEmail } = require('../../utils/sendEmail');
const { notifyDirectUsers } = require('../utils/systemNotificationService');
const { getPaginationOptions, buildPaginationMeta } = require('../../utils/pagination');

const clientMeetingJobs = new Map();

const normalizeCompanyCode = (value) => value?.trim().toUpperCase();

const buildCompanyFilter = (req) => {
  const companyCode = normalizeCompanyCode(req.query.companyCode || req.body?.companyCode);
  return companyCode ? { companyCode } : {};
};

const getMeetingStartDateTime = (date, timeStr) => {
  const meetingDate = new Date(date);
  const [hours = 0, minutes = 0] = String(timeStr || '00:00').split(':').map(Number);
  meetingDate.setHours(hours, minutes, 0, 0);
  return meetingDate;
};

const cancelClientMeetingReminder = (meetingId) => {
  const key = meetingId?.toString();
  if (key && clientMeetingJobs.has(key)) {
    clientMeetingJobs.get(key).cancel();
    clientMeetingJobs.delete(key);
  }
};

const sendClientMeetingEmail = async (meeting, subjectPrefix = 'Client Meeting Scheduled') => {
  const populated = await ClientMeeting.findById(meeting._id).populate('attendees', 'client company email phone userId');
  if (!populated) return;

  const linkHtml = populated.link
    ? `<p><b>Join Link:</b> <a href="${populated.link}" target="_blank" rel="noopener noreferrer">${populated.link}</a></p>`
    : '';

  for (const client of populated.attendees || []) {
    if (!client.email) continue;
    const html = `
      <h3>${subjectPrefix}</h3>
      <p>Hi ${client.client || 'Client'},</p>
      <p>A meeting has been scheduled with the CIIS team.</p>
      <p><b>Title:</b> ${populated.title}</p>
      <p><b>Description:</b> ${populated.description || '-'}</p>
      <p><b>Date:</b> ${new Date(populated.meetingDate).toDateString()}</p>
      <p><b>Time:</b> ${populated.meetingTime}</p>
      <p><b>Location/Platform:</b> ${populated.location || '-'}</p>
      ${linkHtml}
    `;
    await sendEmail(client.email, `${subjectPrefix}: ${populated.title}`, html, { skipNotification: true });
  }
};

const runClientMeetingSideEffects = async ({ meeting, clients, type, title, message, actor, emailPrefix }) => {
  try {
    scheduleClientMeetingReminder(meeting);
  } catch (error) {
    console.error('[ClientMeeting] Reminder schedule failed:', error.message);
  }

  try {
    await sendClientMeetingEmail(meeting, emailPrefix);
  } catch (error) {
    console.error('[ClientMeeting] Email notification failed:', error.message);
  }

  try {
    await notifyClientUsers({ clients, meeting, type, title, message, actor });
  } catch (error) {
    console.error('[ClientMeeting] System notification failed:', error.message);
  }
};

const scheduleClientMeetingReminder = (meeting) => {
  try {
    cancelClientMeetingReminder(meeting._id);
    const start = getMeetingStartDateTime(meeting.meetingDate, meeting.meetingTime);
    const reminderTime = new Date(start.getTime() - 60 * 60 * 1000);
    if (reminderTime <= new Date()) return;

    const job = schedule.scheduleJob(reminderTime, async () => {
      await sendClientMeetingEmail(meeting, 'Client Meeting Reminder: starts in 1 hour');
      clientMeetingJobs.delete(meeting._id.toString());
    });

    if (job) clientMeetingJobs.set(meeting._id.toString(), job);
  } catch (error) {
    console.error('[ClientMeetingReminder] Schedule failed:', error);
  }
};

const notifyClientUsers = async ({ clients, meeting, type, title, message, actor }) => {
  const userIds = clients.map(client => client.userId).filter(Boolean);
  if (userIds.length) {
    await notifyDirectUsers({
      userIds,
      targetPath: '/client/dashboard',
      type,
      title,
      message,
      actor,
      data: {
        meetingId: meeting._id,
        title: meeting.title,
        date: meeting.meetingDate,
        time: meeting.meetingTime,
      },
      priority: 'high',
    });
  }

  if (global.io) {
    clients.forEach(client => {
      if (client.userId) {
        global.io.to(`user:${client.userId}`).emit('client-meeting:new', meeting);
        global.io.to(`user_${client.userId}`).emit('client_meeting_new', meeting);
      }
    });
    global.io.to(`company:${meeting.companyCode}`).emit('client-meeting:updated', meeting);
  }
};

const resolveClients = async ({ attendeeIds = [], clientId, companyCode }) => {
  const ids = [...new Set([clientId, ...(attendeeIds || [])].filter(Boolean).map(String))];
  const filter = {
    _id: { $in: ids },
    ...(companyCode ? { companyCode } : {})
  };
  const clients = await Client.find(filter).lean();
  return clients;
};

const createViews = async (meeting, clients) => {
  await ClientMeetingView.deleteMany({ meetingId: meeting._id });
  const docs = clients.map(client => ({
    meetingId: meeting._id,
    clientId: client._id,
    userId: client.userId || null,
  }));
  if (docs.length) await ClientMeetingView.insertMany(docs, { ordered: false });
};

const meetingPopulate = [
  { path: 'clientId', select: 'client company email phone city companyCode userId status' },
  { path: 'attendees', select: 'client company email phone city companyCode userId status' },
  { path: 'createdBy', select: 'name email' },
];

const getMeetings = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPaginationOptions(req.query, { limit: 25, maxLimit: 100 });
    const filter = buildCompanyFilter(req);
    const [meetings, total] = await Promise.all([
      ClientMeeting.find(filter)
      .populate(meetingPopulate)
        .sort({ meetingDate: -1, meetingTime: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      ClientMeeting.countDocuments(filter)
    ]);

    res.status(200).json({
      success: true,
      count: meetings.length,
      total,
      pagination: buildPaginationMeta({ page, limit, total }),
      data: meetings
    });
  } catch (error) {
    next(error);
  }
};

const getMeeting = async (req, res, next) => {
  try {
    const meeting = await ClientMeeting.findById(req.params.id).populate(meetingPopulate).lean();
    if (!meeting) return res.status(404).json({ success: false, error: 'Meeting not found' });
    res.status(200).json({ success: true, data: meeting });
  } catch (error) {
    next(error);
  }
};

const createMeeting = async (req, res, next) => {
  try {
    const {
      title,
      clientId,
      attendees = [],
      companyCode,
      meetingType,
      priority,
      location,
      link,
      meetingDate,
      meetingTime,
      dates,
      duration,
      description,
      followUpRequired,
      recurring,
      createdBy
    } = req.body;

    const normalizedCompanyCode = normalizeCompanyCode(companyCode);
    const dateList = Array.isArray(dates) && dates.length ? dates : meetingDate ? [meetingDate] : [];

    if (!title || !clientId || !normalizedCompanyCode || !dateList.length || !meetingTime) {
      return res.status(400).json({
        success: false,
        error: 'Please select client and fill title, date, time, and company code'
      });
    }

    const selectedClients = await resolveClients({
      attendeeIds: attendees.length ? attendees : [clientId],
      clientId,
      companyCode: normalizedCompanyCode
    });

    const primaryClient = selectedClients.find(client => client._id.toString() === clientId.toString());
    if (!primaryClient) {
      return res.status(404).json({ success: false, error: 'Selected client not found for this company' });
    }

    const attendeeClientIds = selectedClients.map(client => client._id);
    const attendeeUserIds = selectedClients.map(client => client.userId).filter(Boolean);
    const createdMeetings = [];

    for (const dateValue of dateList) {
      const meeting = await ClientMeeting.create({
        title,
        clientId: primaryClient._id,
        clientName: primaryClient.client,
        phone: primaryClient.phone || '',
        email: primaryClient.email || '',
        company: primaryClient.company,
        companyCode: normalizedCompanyCode,
        meetingType,
        priority,
        location,
        link,
        meetingDate: new Date(dateValue),
        meetingTime,
        duration,
        description,
        followUpRequired,
        recurring,
        attendees: attendeeClientIds,
        attendeeUsers: attendeeUserIds,
        createdBy: createdBy || req.user?._id || null,
      });

      await createViews(meeting, selectedClients);
      await runClientMeetingSideEffects({
        meeting,
        clients: selectedClients,
        type: 'client_meeting_created',
        title: 'New Client Meeting Scheduled',
        message: `Meeting "${title}" is scheduled on ${new Date(dateValue).toDateString()} at ${meetingTime}`,
        actor: createdBy || req.user?._id,
        emailPrefix: 'Client Meeting Scheduled',
      });

      createdMeetings.push(meeting);
    }

    res.status(201).json({
      success: true,
      message: 'Client meeting scheduled successfully',
      data: createdMeetings,
      meeting: createdMeetings[0],
    });
  } catch (error) {
    next(error);
  }
};

const updateMeeting = async (req, res, next) => {
  try {
    let meeting = await ClientMeeting.findById(req.params.id);
    if (!meeting) return res.status(404).json({ success: false, error: 'Meeting not found' });

    const updateData = { ...req.body };
    if (updateData.companyCode) updateData.companyCode = normalizeCompanyCode(updateData.companyCode);

    const nextCompanyCode = updateData.companyCode || meeting.companyCode;
    const nextClientId = updateData.clientId || meeting.clientId;
    const nextAttendees = updateData.attendees || meeting.attendees || [nextClientId];
    const clients = await resolveClients({
      attendeeIds: nextAttendees,
      clientId: nextClientId,
      companyCode: nextCompanyCode
    });

    const primaryClient = clients.find(client => client._id.toString() === nextClientId.toString());
    if (!primaryClient) return res.status(404).json({ success: false, error: 'Selected client not found' });

    cancelClientMeetingReminder(meeting._id);

    updateData.clientId = primaryClient._id;
    updateData.clientName = primaryClient.client;
    updateData.phone = primaryClient.phone || '';
    updateData.email = primaryClient.email || '';
    updateData.company = primaryClient.company;
    updateData.companyCode = nextCompanyCode;
    updateData.attendees = clients.map(client => client._id);
    updateData.attendeeUsers = clients.map(client => client.userId).filter(Boolean);
    if (updateData.meetingDate) updateData.meetingDate = new Date(updateData.meetingDate);

    meeting = await ClientMeeting.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
      runValidators: true
    });

    await createViews(meeting, clients);
    await runClientMeetingSideEffects({
      meeting,
      clients,
      type: 'client_meeting_updated',
      title: 'Client Meeting Updated',
      message: `Meeting "${meeting.title}" has been updated`,
      actor: req.user?._id || meeting.createdBy,
      emailPrefix: 'Client Meeting Updated',
    });

    res.status(200).json({ success: true, message: 'Meeting updated successfully', data: meeting, meeting });
  } catch (error) {
    next(error);
  }
};

const deleteMeeting = async (req, res, next) => {
  try {
    const meeting = await ClientMeeting.findById(req.params.id);
    if (!meeting) return res.status(404).json({ success: false, error: 'Meeting not found' });

    cancelClientMeetingReminder(meeting._id);
    await ClientMeetingView.deleteMany({ meetingId: meeting._id });
    await meeting.deleteOne();

    if (global.io) {
      global.io.to(`company:${meeting.companyCode}`).emit('client-meeting:deleted', {
        meetingId: meeting._id,
        title: meeting.title,
      });
    }

    res.status(200).json({ success: true, message: 'Meeting deleted successfully', data: {} });
  } catch (error) {
    next(error);
  }
};

const getTodayMeetings = async (req, res, next) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const meetings = await ClientMeeting.find({
      ...buildCompanyFilter(req),
      meetingDate: { $gte: today, $lt: tomorrow }
    }).populate(meetingPopulate).sort({ meetingTime: 1 });

    res.status(200).json({ success: true, count: meetings.length, data: meetings });
  } catch (error) {
    next(error);
  }
};

const getMeetingsByStatus = async (req, res, next) => {
  try {
    const meetings = await ClientMeeting.find({
      ...buildCompanyFilter(req),
      status: req.params.status
    }).populate(meetingPopulate).sort({ meetingDate: -1 });

    res.status(200).json({ success: true, count: meetings.length, data: meetings });
  } catch (error) {
    next(error);
  }
};

const updateMeetingStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!['Scheduled', 'Completed', 'Cancelled', 'Rescheduled'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status value' });
    }

    const meeting = await ClientMeeting.findByIdAndUpdate(req.params.id, { status }, {
      new: true,
      runValidators: true
    });

    if (!meeting) return res.status(404).json({ success: false, error: 'Meeting not found' });
    res.status(200).json({ success: true, message: 'Meeting status updated successfully', data: meeting });
  } catch (error) {
    next(error);
  }
};

const markAsViewed = async (req, res, next) => {
  try {
    const { meetingId, clientId, userId } = req.body;
    if (!meetingId || (!clientId && !userId)) {
      return res.status(400).json({ success: false, error: 'Missing meetingId and client/user identity' });
    }

    const query = userId ? { meetingId, userId } : { meetingId, clientId };
    await ClientMeetingView.updateOne(query, {
      viewed: true,
      viewedAt: new Date(),
      attendanceStatus: 'Seen'
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};

const markAttendance = async (req, res, next) => {
  try {
    const { meetingId, clientId, userId, attendanceStatus = 'Joined' } = req.body;
    const query = userId ? { meetingId, userId } : { meetingId, clientId };
    await ClientMeetingView.updateOne(query, {
      viewed: true,
      viewedAt: new Date(),
      attendanceStatus,
      ...(attendanceStatus === 'Joined' ? { joinedAt: new Date() } : {})
    });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};

const getViewStatus = async (req, res, next) => {
  try {
    const data = await ClientMeetingView.find({ meetingId: req.params.meetingId })
      .populate('clientId', 'client company email phone')
      .populate('userId', 'name email');
    res.json(data);
  } catch (error) {
    next(error);
  }
};

const getMeetingHistory = async (req, res, next) => {
  try {
    const { clientId, companyCode } = req.query;
    const filter = {
      ...buildCompanyFilter(req),
      ...(clientId ? { attendees: clientId } : {}),
      ...(companyCode ? { companyCode: normalizeCompanyCode(companyCode) } : {})
    };
    const meetings = await ClientMeeting.find(filter).populate(meetingPopulate).sort({ meetingDate: -1 });
    res.json({ success: true, count: meetings.length, data: meetings });
  } catch (error) {
    next(error);
  }
};

const getMeetingStats = async (req, res, next) => {
  try {
    const filter = buildCompanyFilter(req);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [total, todayCount, highPriority, scheduled, completed] = await Promise.all([
      ClientMeeting.countDocuments(filter),
      ClientMeeting.countDocuments({ ...filter, meetingDate: { $gte: today, $lt: tomorrow } }),
      ClientMeeting.countDocuments({ ...filter, priority: 'High' }),
      ClientMeeting.countDocuments({ ...filter, status: 'Scheduled' }),
      ClientMeeting.countDocuments({ ...filter, status: 'Completed' }),
    ]);

    res.status(200).json({ success: true, data: { total, today: todayCount, highPriority, scheduled, completed } });
  } catch (error) {
    next(error);
  }
};

const searchMeetings = async (req, res, next) => {
  try {
    const { q, type, priority, date } = req.query;
    const query = buildCompanyFilter(req);

    if (q) {
      query.$or = [
        { title: { $regex: q, $options: 'i' } },
        { clientName: { $regex: q, $options: 'i' } },
        { company: { $regex: q, $options: 'i' } },
        { email: { $regex: q, $options: 'i' } }
      ];
    }
    if (type && type !== 'all') query.meetingType = type;
    if (priority && priority !== 'all') query.priority = priority;
    if (date) {
      const selectedDate = new Date(date);
      const nextDate = new Date(selectedDate);
      nextDate.setDate(nextDate.getDate() + 1);
      query.meetingDate = { $gte: selectedDate, $lt: nextDate };
    }

    const meetings = await ClientMeeting.find(query).populate(meetingPopulate).sort({ meetingDate: -1 });
    res.status(200).json({ success: true, count: meetings.length, data: meetings });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getMeetings,
  getMeeting,
  createMeeting,
  updateMeeting,
  deleteMeeting,
  getTodayMeetings,
  getMeetingsByStatus,
  updateMeetingStatus,
  getMeetingStats,
  searchMeetings,
  markAsViewed,
  markAttendance,
  getViewStatus,
  getMeetingHistory,
};

void 0;
